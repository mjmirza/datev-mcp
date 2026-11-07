import { spawn } from "node:child_process";
import { buildAuthorizeUrl } from "../auth/authorize.js";
import { startCallbackServer } from "../auth/callback-server.js";
import { newPkce, randomToken } from "../auth/pkce.js";
import { exchangeCode } from "../auth/token-client.js";
import { TokenStore } from "../auth/token-store.js";
import type { Config } from "../config.js";

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    /* the URL is printed as a fallback */
  }
}

export async function login(cfg: Config, log: (s: string) => void = (s) => process.stderr.write(`${s}\n`)): Promise<void> {
  const state = randomToken();
  const nonce = randomToken();
  const pkce = newPkce();
  const cb = await startCallbackServer(state, { timeoutMs: 600_000 });
  const url = buildAuthorizeUrl(cfg.endpoints, {
    clientId: cfg.creds.clientId,
    redirectUri: cb.redirectUri,
    scopes: cfg.scopes,
    state,
    nonce,
    codeChallenge: pkce.challenge,
  });
  log(`Opening the DATEV ${cfg.env} login in your browser. If nothing opens, visit:\n\n  ${url}\n`);
  openBrowser(url);
  const { code } = await cb.result;
  const tokens = await exchangeCode(cfg.endpoints.token, { code, redirectUri: cb.redirectUri, codeVerifier: pkce.verifier }, cfg.creds);
  const store = new TokenStore(cfg.env);
  // Under the session lock, so a refresh running in another process cannot overwrite or clear this fresh login.
  await store.withLock(async () => store.write({ env: cfg.env, clientId: cfg.creds.clientId, tokens }));
  const mins = Math.round((tokens.expiresAt - Date.now()) / 60000);
  log(`Logged in to DATEV ${cfg.env}. Access token valid ~${mins} min, refresh token ${tokens.refreshToken ? "received" : "NOT received"}.`);
  log(`Session saved to ${store.file} (owner-only).`);
}
