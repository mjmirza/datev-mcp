import { errorRate, type ErrorRate, type HttpLogEntry } from "../api/http-log.js";
import { revokePending } from "../auth/pending-revoke.js";
import { serviceLabel } from "../auth/services.js";
import { tokenLog } from "./token-log.js";
import type { FetchLike } from "../auth/token-client.js";
import { TokenStore } from "../auth/token-store.js";
import { fetchUserInfo } from "../auth/userinfo.js";
import { Session } from "../auth/session.js";
import type { Config } from "../config.js";
import type { MessageLang } from "../i18n.js";

/** DATEV's page where a user sees and removes the apps connected to their DATEV identity. */
export const REVOKE_UI = "https://apps.datev.de/tokrevui";

const DE_TIME = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** TT.MM.JJJJ HH:MM in German time, the format DATEV asks for. */
export const formatDe = (t: number) => DE_TIME.format(new Date(t)).replace(",", "");

export interface ConnectionStatus {
  connected: boolean;
  env: string;
  /** Why the connection is not active, if it is not. */
  reason?: string;
  user?: string;
  refresh_valid_until?: string;
  data_services?: string[];
  manage_connections: string;
  /** DATEV client type: "Public" (PKCE, no secret) or "Confidential" (with secret). */
  app_type: "Public" | "Confidential";
  /** Setups DATEV does not allow, shown so the person sees them before DATEV's review does. */
  warnings?: string[];
  error_rate_14_days?: ErrorRate;
  /** Refresh tokens of earlier logins that DATEV has not yet confirmed as revoked. Should be 0. */
  pending_revocations?: number;
}

/** Configurations DATEV blocks or forbids, worded for the person running the app. */
export function setupWarnings(cfg: Pick<Config, "env" | "creds">): string[] {
  const w: string[] = [];
  if (cfg.env === "production" && cfg.creds.clientSecret)
    w.push("DATEV blocks Confidential apps with a localhost redirect in production since 01.03.2026. Ask DATEV to switch this app to a Public client and remove DATEV_CLIENT_SECRET.");
  return w;
}

export async function connectionStatus(cfg: Config, opts: { store?: TokenStore; fetch?: FetchLike; httpLog?: (e: HttpLogEntry) => void; now?: () => number } = {}): Promise<ConnectionStatus> {
  const store = opts.store ?? new TokenStore(cfg.env);
  const now = (opts.now ?? Date.now)();
  const warnings = setupWarnings(cfg);
  const base: ConnectionStatus = { connected: false, env: cfg.env, manage_connections: REVOKE_UI, app_type: cfg.creds.clientSecret ? "Confidential" : "Public", ...(warnings.length ? { warnings } : {}) };
  let s;
  try {
    s = store.read();
  } catch (e) {
    return { ...base, reason: (e as Error).message };
  }
  if (!s) return { ...base, reason: "not connected" };
  let pending = s.pendingRevoke?.length ?? 0;
  if (pending) {
    try {
      pending = (await revokePending(store, cfg.endpoints, cfg.creds, { fetch: opts.fetch, log: opts.httpLog && tokenLog(opts.httpLog) })).left;
    } catch {
      /* the count stays as read */
    }
  }
  const until = s.refreshExpiresAt ?? s.tokens.obtainedAt + 11 * 60 * 60_000;
  const out: ConnectionStatus = {
    ...base,
    user: s.identity?.name ?? s.identity?.sub,
    refresh_valid_until: formatDe(until),
    data_services: s.services?.map(serviceLabel),
    error_rate_14_days: errorRate(14),
    ...(pending ? { pending_revocations: pending } : {}),
  };
  if (s.clientId !== cfg.creds.clientId) return { ...out, reason: "the saved connection belongs to a different DATEV app" };
  if (!s.tokens.refreshToken && s.tokens.expiresAt <= now) return { ...out, reason: "the connection has expired" };
  if (until <= now) return { ...out, reason: "the connection has expired" };
  // Active only if DATEV confirms it right now: the token works and userinfo answers.
  try {
    const token = await new Session(store, cfg.endpoints, cfg.creds, { fetch: opts.fetch, log: opts.httpLog }).accessToken();
    const u = await fetchUserInfo(cfg.endpoints.userinfo, token, cfg.creds.clientId, { fetch: opts.fetch, log: opts.httpLog });
    return { ...out, connected: true, user: u.name ?? out.user };
  } catch (e) {
    return { ...out, reason: (e as Error).message };
  }
}

const T = {
  en: {
    title: "DATEV connection",
    on: "ACTIVE (connected)",
    off: "INACTIVE (disconnected)",
    env: "Environment",
    user: "Signed in as",
    until: "Valid until",
    services: "Data services",
    reason: "Reason",
    manage: "Manage connected apps at DATEV",
    rate: "Error rate, last 14 days",
    appType: "App type",
    warning: "Warning",
    pending: "Old refresh tokens not yet revoked",
    actions: 'Connect: datev-mcp login --services ...   Disconnect: datev-mcp disconnect',
  },
  de: {
    title: "DATEV-Verbindung",
    on: "AKTIV (verbunden)",
    off: "INAKTIV (getrennt)",
    env: "Umgebung",
    user: "Angemeldet als",
    until: "Gültig bis",
    services: "Datenservices",
    reason: "Grund",
    manage: "Verbundene Anwendungen bei DATEV",
    rate: "Fehlerquote, letzte 14 Tage",
    appType: "App-Typ",
    warning: "Warnung",
    pending: "Alte Refresh-Tokens noch nicht widerrufen",
    actions: "Verbinden: datev-mcp login --services ...   Trennen: datev-mcp disconnect",
  },
};

const REASON_DE: Record<string, string> = {
  "not connected": "keine Verbindung eingerichtet",
  "the connection has expired": "die Verbindung ist abgelaufen",
  "the saved connection belongs to a different DATEV app": "die gespeicherte Verbindung gehört zu einer anderen DATEV-App",
};

const WARN_DE: Record<string, string> = {
  "DATEV blocks Confidential apps with a localhost redirect in production since 01.03.2026. Ask DATEV to switch this app to a Public client and remove DATEV_CLIENT_SECRET.":
    "DATEV sperrt seit 01.03.2026 Confidential-Apps mit localhost-Redirect in der Produktion. Lassen Sie die App bei DATEV auf einen Public Client umstellen und entfernen Sie DATEV_CLIENT_SECRET.",
};

export function renderStatus(st: ConnectionStatus, lang: MessageLang, color = false): string {
  const t = T[lang];
  const light = st.connected ? (color ? "\u001b[32m●\u001b[0m" : "●") : color ? "\u001b[31m●\u001b[0m" : "○";
  const rows: [string, string | undefined][] = [
    [t.env, st.env],
    [t.appType, st.app_type],
    [t.user, st.user],
    [t.until, st.refresh_valid_until],
    [t.services, st.data_services?.join(", ")],
    [t.reason, st.reason && (lang === "de" ? (REASON_DE[st.reason] ?? st.reason) : st.reason)],
    [
      t.rate,
      st.error_rate_14_days && st.error_rate_14_days.requests > 0
        ? `${(st.error_rate_14_days.rate * 100).toFixed(1).replace(".", lang === "de" ? "," : ".")} % (${st.error_rate_14_days.errors}/${st.error_rate_14_days.requests})`
        : undefined,
    ],
    [t.pending, st.pending_revocations ? String(st.pending_revocations) : undefined],
    [t.manage, st.manage_connections],
    ...(st.warnings ?? []).map((w): [string, string] => [t.warning, lang === "de" ? (WARN_DE[w] ?? w) : w]),
  ];
  return [`${light} ${t.title}: ${st.connected ? t.on : t.off}`, ...rows.filter(([, v]) => v).map(([k, v]) => `  ${k.padEnd(34)} ${v}`), "", `  ${t.actions}`].join("\n");
}
