import { spawn } from "node:child_process";
import { writeHttpLog, type HttpLogEntry } from "../api/http-log.js";
import { buildAuthorizeUrl } from "../auth/authorize.js";
import { startCallbackServer } from "../auth/callback-server.js";
import { verifyIdToken } from "../auth/id-token.js";
import { newPkce, randomToken } from "../auth/pkce.js";
import { selectServices, serviceLabel, serviceList, ServiceSelectionError } from "../auth/services.js";
import { exchangeCode, revokeToken, type FetchLike } from "../auth/token-client.js";
import { TokenStore } from "../auth/token-store.js";
import { fetchUserInfo } from "../auth/userinfo.js";
import type { Config } from "../config.js";
import { tokenLog } from "./token-log.js";
import { formatDe, REVOKE_UI } from "./status.js";

// DATEV's short-lived refresh token lasts 11 hours from login and is not extended by a refresh.
export const REFRESH_LIFETIME_MS = 11 * 60 * 60_000;

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

export function chooseScopes(cfg: Config, cliServices?: string): { services?: string[]; scopes: string[] } {
  const list = cliServices ?? cfg.services;
  if (list !== undefined) return selectServices(list);
  if (cfg.scopes?.length) return { scopes: cfg.scopes.includes("openid") ? cfg.scopes : ["openid", ...cfg.scopes] };
  throw new ServiceSelectionError(`Choose the DATEV data services to connect: "datev-mcp login --services accounting-documents,accounting-extf-files". DATEV allows only the scopes of the services you use. ${serviceList()}`);
}

export async function login(cfg: Config, opts: LoginOptions = {}): Promise<void> {
  const log = opts.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  const httpLog = opts.httpLog ?? ((e: HttpLogEntry) => writeHttpLog(e));
  const { services, scopes } = chooseScopes(cfg, opts.services);
  const state = randomToken();
  const nonce = randomToken();
  const pkce = newPkce();
  const cb = await startCallbackServer(state, { timeoutMs: 600_000 });
  const url = buildAuthorizeUrl(cfg.endpoints, { clientId: cfg.creds.clientId, redirectUri: cb.redirectUri, scopes, state, nonce, codeChallenge: pkce.challenge });
  if (services) log(`Connecting these DATEV data services: ${services.map(serviceLabel).join(", ")}.`);
  log(`Opening the DATEV ${cfg.env} login in your browser. If nothing opens, visit:\n\n  ${url}\n`);
  if (opts.open) opts.open(url);
  else if (process.env.DATEV_MCP_NO_BROWSER !== "1") openBrowser(url); // set to 1 over SSH, or to open the link in a browser of your choice
  const { code } = await cb.result;
  const tokenOpts = { fetch: opts.fetch, log: tokenLog(httpLog) };
  const tokens = await exchangeCode(cfg.endpoints.token, { code, redirectUri: cb.redirectUri, codeVerifier: pkce.verifier }, cfg.creds, tokenOpts);
  if (!tokens.idToken) throw new Error("DATEV returned no ID token for this login, so it cannot be checked. Nothing was saved.");
  const claims = await verifyIdToken(tokens.idToken, { issuer: cfg.endpoints.issuer, clientId: cfg.creds.clientId, nonce, jwksUrl: cfg.endpoints.jwks, fetch: opts.fetch });
  let name: string | undefined;
  try {
    const u = await fetchUserInfo(cfg.endpoints.userinfo, tokens.accessToken, cfg.creds.clientId, { fetch: opts.fetch, log: httpLog });
    if (u.sub && u.sub !== claims.sub) throw new Error("DATEV's userinfo names a different user than the ID token. Nothing was saved.");
    name = u.name;
  } catch (e) {
    if ((e as Error).message.includes("different user")) throw e;
    log(`Note: DATEV's userinfo could not be read (${(e as Error).message}). The connection works, the status shows the user id instead of the name.`);
  }
  const refreshExpiresAt = tokens.refreshExpiresAt ?? tokens.obtainedAt + REFRESH_LIFETIME_MS;
  const store = opts.store ?? new TokenStore(cfg.env);
  // Under the session lock, so a refresh in another process cannot overwrite this login. The old refresh token is
  // revoked right after: DATEV allows only one valid refresh token per app and user at a time.
  const previous = await store.withLock(async () => {
    const old = store.read();
    store.write({ env: cfg.env, clientId: cfg.creds.clientId, tokens, identity: { sub: claims.sub, name }, services, scopes, refreshExpiresAt });
    return old;
  });
  if (previous?.tokens.refreshToken && previous.clientId === cfg.creds.clientId && previous.tokens.refreshToken !== tokens.refreshToken) {
    try {
      await revokeToken(cfg.endpoints.revoke, previous.tokens.refreshToken, "refresh_token", cfg.creds, tokenOpts);
      log("The refresh token of the previous login was revoked at DATEV.");
    } catch (e) {
      log(`WARNING: the previous refresh token could not be revoked (${(e as Error).message}). Remove the old connection at ${REVOKE_UI}.`);
    }
  }
  log(`Connected to DATEV ${cfg.env} as ${name ?? claims.sub}. The connection is valid until ${formatDe(refreshExpiresAt)}.`);
  log(`Session saved encrypted to ${store.file}. "datev-mcp status" shows the connection, "datev-mcp disconnect" ends it.`);
}
