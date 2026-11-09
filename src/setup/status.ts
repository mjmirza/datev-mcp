import { errorRate, type ErrorRate, type HttpLogEntry } from "../api/http-log.js";
import { serviceLabel } from "../auth/services.js";
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
  error_rate_14_days?: ErrorRate;
}

export async function connectionStatus(cfg: Config, opts: { store?: TokenStore; fetch?: FetchLike; httpLog?: (e: HttpLogEntry) => void; now?: () => number } = {}): Promise<ConnectionStatus> {
  const store = opts.store ?? new TokenStore(cfg.env);
  const now = (opts.now ?? Date.now)();
  const base: ConnectionStatus = { connected: false, env: cfg.env, manage_connections: REVOKE_UI };
  let s;
  try {
    s = store.read();
  } catch (e) {
    return { ...base, reason: (e as Error).message };
  }
  if (!s) return { ...base, reason: "not connected" };
  const until = s.refreshExpiresAt ?? s.tokens.obtainedAt + 11 * 60 * 60_000;
  const out: ConnectionStatus = {
    ...base,
    user: s.identity?.name ?? s.identity?.sub,
    refresh_valid_until: formatDe(until),
    data_services: s.services?.map(serviceLabel),
    error_rate_14_days: errorRate(14),
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
    actions: "Verbinden: datev-mcp login --services ...   Trennen: datev-mcp disconnect",
  },
};

const REASON_DE: Record<string, string> = {
  "not connected": "keine Verbindung eingerichtet",
  "the connection has expired": "die Verbindung ist abgelaufen",
  "the saved connection belongs to a different DATEV app": "die gespeicherte Verbindung gehört zu einer anderen DATEV-App",
};

export function renderStatus(st: ConnectionStatus, lang: MessageLang, color = false): string {
  const t = T[lang];
  const light = st.connected ? (color ? "\u001b[32m●\u001b[0m" : "●") : color ? "\u001b[31m●\u001b[0m" : "○";
  const rows: [string, string | undefined][] = [
    [t.env, st.env],
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
    [t.manage, st.manage_connections],
  ];
  return [`${light} ${t.title}: ${st.connected ? t.on : t.off}`, ...rows.filter(([, v]) => v).map(([k, v]) => `  ${k.padEnd(34)} ${v}`), "", `  ${t.actions}`].join("\n");
}
