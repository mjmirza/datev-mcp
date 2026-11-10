import { spawn } from "node:child_process";
import { writeHttpLog, type HttpLogEntry } from "../api/http-log.js";
import { buildAuthorizeUrl } from "../auth/authorize.js";
import { startCallbackServer } from "../auth/callback-server.js";
import { verifyIdToken } from "../auth/id-token.js";
import { newPkce, randomToken } from "../auth/pkce.js";
import { selectServices, serviceLabel, serviceList, servicesForScopes, ServiceSelectionError } from "../auth/services.js";
import { exchangeCode, revokeToken, type FetchLike } from "../auth/token-client.js";
import { revokePending } from "../auth/pending-revoke.js";
import { TokenStore } from "../auth/token-store.js";
import { fetchUserInfo } from "../auth/userinfo.js";
import type { Config } from "../config.js";
import { tokenLog } from "./token-log.js";
import { formatDe, REVOKE_UI, setupWarnings } from "./status.js";

// DATEV's short-lived refresh token lasts 11 hours from login and is not extended by a refresh.
const REFRESH_LIFETIME_MS = 11 * 60 * 60_000;

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    /* the URL is printed as a fallback */
  }
}

export interface LoginOptions {
  /** Product ids from --services; wins over DATEV_MCP_SERVICES and DATEV_SCOPES. */
  services?: string;
  log?: (s: string) => void;
  fetch?: FetchLike;
  store?: TokenStore;
  httpLog?: (e: HttpLogEntry) => void;
  /** Opens the login page; tests answer the redirect instead. */
  open?: (url: string) => void;
}

export function chooseScopes(cfg: Config, cliServices?: string): { services?: string[]; scopes: string[]; added?: string[] } {
  const list = cliServices ?? cfg.services;
  if (list !== undefined) return selectServices(list);
  if (cfg.scopes?.length) {
    const scopes = cfg.scopes.includes("openid") ? cfg.scopes : ["openid", ...cfg.scopes];
    // Expert scopes still record the services they cover, so every service boundary applies to them too.
    return { services: servicesForScopes(scopes), scopes };
  }
  throw new ServiceSelectionError(`Choose the DATEV data services to connect: "datev-mcp login --services accounting-documents,accounting-extf-files". DATEV allows only the scopes of the services you use. ${serviceList()}`);
}

export async function login(cfg: Config, opts: LoginOptions = {}): Promise<void> {
  const log = opts.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  const httpLog = opts.httpLog ?? ((e: HttpLogEntry) => writeHttpLog(e));
  const { services, scopes, added } = chooseScopes(cfg, opts.services);
  for (const w of setupWarnings(cfg)) log(`WARNING: ${w}`);
  const state = randomToken();
  const nonce = randomToken();
  const pkce = newPkce();
  const cb = await startCallbackServer(state, { timeoutMs: 600_000 });
  const url = buildAuthorizeUrl(cfg.endpoints, { clientId: cfg.creds.clientId, redirectUri: cb.redirectUri, scopes, state, nonce, codeChallenge: pkce.challenge });
  if (services) log(`Connecting these DATEV data services: ${services.map(serviceLabel).join(", ")}.`);
  // Never widen the request silently: say which service was added and why.
  if (added?.length) log(`Added ${added.map(serviceLabel).join(", ")}, because DATEV requires checking the client list before any accounting data service.`);
  log(`Opening the DATEV ${cfg.env} login in your browser. If nothing opens, visit:\n\n  ${url}\n`);
  if (opts.open) opts.open(url);
  else if (process.env.DATEV_MCP_NO_BROWSER !== "1") openBrowser(url); // set to 1 over SSH, or to open the link in a browser of your choice
  const { code } = await cb.result;
  const tokenOpts = { fetch: opts.fetch, log: tokenLog(httpLog) };
  const tokens = await exchangeCode(cfg.endpoints.token, { code, redirectUri: cb.redirectUri, codeVerifier: pkce.verifier }, cfg.creds, tokenOpts);
  // Every check after the token exchange is final. If one fails, the tokens DATEV just issued are revoked,
  // so a failed login never leaves a valid refresh token behind that nothing knows about.
  let claims: Awaited<ReturnType<typeof verifyIdToken>>;
  let name: string;
  try {
    if (!tokens.idToken) throw new Error("DATEV returned no ID token for this login, so it cannot be checked. Nothing was saved.");
    claims = await verifyIdToken(tokens.idToken, { issuer: cfg.endpoints.issuer, clientId: cfg.creds.clientId, nonce, jwksUrl: cfg.endpoints.jwks, fetch: opts.fetch, accessToken: tokens.accessToken, log: httpLog });
    const u = await fetchUserInfo(cfg.endpoints.userinfo, tokens.accessToken, cfg.creds.clientId, { fetch: opts.fetch, log: httpLog });
    if (u.sub !== claims.sub) throw new Error("DATEV's userinfo names a different user than the ID token. Nothing was saved.");
    if (!u.name) throw new Error("DATEV's userinfo gives no full name for this user, and DATEV requires apps to show it. Nothing was saved.");
    name = u.name;
  } catch (e) {
    await Promise.allSettled([
      ...(tokens.refreshToken ? [revokeToken(cfg.endpoints.revoke, tokens.refreshToken, "refresh_token", cfg.creds, tokenOpts)] : []),
      revokeToken(cfg.endpoints.revoke, tokens.accessToken, "access_token", cfg.creds, tokenOpts),
    ]);
    throw e;
  }
  const refreshExpiresAt = tokens.refreshExpiresAt ?? tokens.obtainedAt + REFRESH_LIFETIME_MS;
  const store = opts.store ?? new TokenStore(cfg.env);
  // Under the session lock, so a refresh in another process cannot overwrite this login. The old refresh token is
  // revoked right after: DATEV allows only one valid refresh token per app and user at a time.
  await store.withLock(async () => {
    const old = store.read();
    const sameApp = old?.clientId === cfg.creds.clientId;
    const stale = [...(sameApp ? (old?.pendingRevoke ?? []) : []), ...(sameApp && old?.tokens.refreshToken ? [old.tokens.refreshToken] : [])].filter((t) => t !== tokens.refreshToken);
    // The old login's access token, ended or still active, is revoked before it is overwritten.
    // One DATEV did not confirm is kept with the new login and retried until it expires, never forgotten.
    const openAccess = [...(sameApp ? [...(old?.pendingAccessRevoke ?? []), ...(old?.replacedAccess ?? [])] : []), ...(sameApp && old ? [{ token: old.tokens.accessToken, expiresAt: old.tokens.expiresAt }] : [])].filter((a) => a.expiresAt > Date.now() && a.token !== tokens.accessToken);
    const results = await Promise.allSettled(openAccess.map((a) => revokeToken(cfg.endpoints.revoke, a.token, "access_token", cfg.creds, tokenOpts)));
    const accessLeft = openAccess.filter((_, i) => results[i]!.status === "rejected");
    store.write({ env: cfg.env, clientId: cfg.creds.clientId, loginId: randomToken(), tokens, identity: { sub: claims.sub, name }, services, scopes, refreshExpiresAt, ...(stale.length ? { pendingRevoke: stale } : {}), ...(accessLeft.length ? { pendingAccessRevoke: accessLeft } : {}) });
  });
  const r = await revokePending(store, cfg.endpoints, cfg.creds, tokenOpts);
  if (r.revoked) log("The refresh token of the previous login was revoked at DATEV.");
  if (r.left) log(`WARNING: ${r.left} earlier refresh token(s) could not be revoked yet. Every "datev-mcp status" and server start retries. To end it now, remove the old connection at ${REVOKE_UI}.`);
  log(`Connected to DATEV ${cfg.env} as ${name}. The connection is valid until ${formatDe(refreshExpiresAt)}.`);
  log(`Session saved encrypted to ${store.file}. "datev-mcp status" shows the connection, "datev-mcp disconnect" ends it.`);
}
