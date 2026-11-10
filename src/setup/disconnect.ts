import { writeHttpLog, type HttpLogEntry } from "../api/http-log.js";
import { revokeToken, type FetchLike } from "../auth/token-client.js";
import { TokenStore, type StoredSession } from "../auth/token-store.js";
import type { Config } from "../config.js";
import { REVOKE_UI } from "./status.js";
import { tokenLog } from "./token-log.js";

/** Access tokens of an earlier login still open at DATEV, kept until DATEV confirms their revoke or they expire. */
const openAccess = (s: StoredSession) => (s.pendingAccessRevoke ?? []).filter((a) => a.expiresAt > Date.now());

export interface DisconnectResult {
  revoked: boolean;
  removed: boolean;
  message: string;
}

/** Exit code for the CLI: tokens left live at DATEV are a failure, unless the person chose --local-only. */
export const disconnectExitCode = (r: { removed: boolean; revoked: boolean }, localOnly: boolean): number => (r.removed && (r.revoked || localOnly) ? 0 : 1);

// DATEV requires a "disconnect" that revokes the refresh token at DATEV and deletes it in the app.
// If DATEV cannot be reached the session is kept, so the token is never forgotten while it is still valid there.
export async function disconnect(
  cfg: Config,
  opts: { store?: TokenStore; fetch?: FetchLike; httpLog?: (e: HttpLogEntry) => void; localOnly?: boolean } = {},
): Promise<DisconnectResult> {
  const store = opts.store ?? new TokenStore(cfg.env);
  const log = tokenLog(opts.httpLog ?? ((e: HttpLogEntry) => writeHttpLog(e)));
  return store.withLock(async () => {
    const s = store.read();
    if (!s) return { revoked: false, removed: false, message: `There is no saved DATEV connection. Connected apps are listed at ${REVOKE_UI}.` };
    const sameApp = s.clientId === cfg.creds.clientId;
    const callOpts = { fetch: opts.fetch, log };
    if (!opts.localOnly && sameApp) {
      const notRemoved = (why: string) => ({
        revoked: false,
        removed: false,
        message: `The connection was NOT removed: ${why}. It is no longer used here and is revoked again on the next call. Try again, or remove it at ${REVOKE_UI} and then run "datev-mcp disconnect --local-only".`,
      });
      // Every refresh token this app still holds, the current one and any an earlier login could not revoke.
      const refresh = [...new Set([...(s.pendingRevoke ?? []), ...(s.tokens.refreshToken ? [s.tokens.refreshToken] : [])])];
      const accessLive = s.tokens.expiresAt > Date.now();
      const older = openAccess(s);
      const [results, accessError, olderResults] = await Promise.all([
        Promise.allSettled(refresh.map((t) => revokeToken(cfg.endpoints.revoke, t, "refresh_token", cfg.creds, callOpts))),
        accessLive ? revokeToken(cfg.endpoints.revoke, s.tokens.accessToken, "access_token", cfg.creds, callOpts).then(() => undefined, (e: Error) => e) : Promise.resolve(undefined),
        Promise.allSettled(older.map((a) => revokeToken(cfg.endpoints.revoke, a.token, "access_token", cfg.creds, callOpts))),
      ]);
      const left = refresh.filter((_, i) => results[i]!.status === "rejected");
      const olderLeft = older.filter((_, i) => olderResults[i]!.status === "rejected");
      const failed = [...results, ...olderResults].find((r): r is PromiseRejectedResult => r.status === "rejected");
      // A live access token DATEV did not confirm as revoked is kept on record and revoked again later.
      if (failed || accessError) {
        // A lost answer may hide a revoke that worked: no token is used again, and what DATEV did not confirm is retried.
        store.write({ ...s, ended: true, pendingRevoke: left, pendingAccessRevoke: olderLeft, tokens: { ...s.tokens, refreshToken: undefined, expiresAt: accessError || !accessLive ? s.tokens.expiresAt : 0 } });
        return notRemoved(((failed?.reason as Error | undefined) ?? accessError!).message);
      }
    }
    store.clear();
    const revoked = !opts.localOnly && sameApp;
    // Another app registration's tokens cannot be revoked with this app's credentials: say how many are left open.
    const foreign = sameApp ? 0 : new Set([...(s.pendingRevoke ?? []), ...(s.tokens.refreshToken ? [s.tokens.refreshToken] : []), ...openAccess(s).map((a) => a.token), ...(s.tokens.expiresAt > Date.now() ? [s.tokens.accessToken] : [])]).size;
    return {
      revoked,
      removed: true,
      message: revoked
        ? `Disconnected. The connection was revoked at DATEV and the local session deleted.`
        : foreign
          ? `The local session was deleted. ${foreign} token(s) of another DATEV app registration could not be revoked here, so remove that app at ${REVOKE_UI}.`
          : `The local session was deleted. Check ${REVOKE_UI} that the app no longer appears there.`,
    };
  });
}

/** DATEV's Export rules: without the data service, revoke both tokens at once and say exactly what happened. */
export async function endForMissingPermission(
  cfg: Config,
  opts: { store?: TokenStore; fetch?: FetchLike; httpLog?: (e: HttpLogEntry) => void; accessToken?: string; loginId?: string } = {},
): Promise<string> {
  const store = opts.store ?? new TokenStore(cfg.env);
  const log = tokenLog(opts.httpLog ?? ((e: HttpLogEntry) => writeHttpLog(e)));
  return store.withLock(async () => {
    const s = store.read();
    if (!s || s.clientId !== cfg.creds.clientId) return "There was no saved connection to end.";
    // A late 403 must not end a login saved since. The login id survives refreshes; older sessions fall back to the token.
    const sameLogin = opts.loginId !== undefined && s.loginId !== undefined ? s.loginId === opts.loginId : opts.accessToken === undefined || s.tokens.accessToken === opts.accessToken;
    if (!sameLogin) return " A newer login replaced the refused connection, so it was kept.";
    const callOpts = { fetch: opts.fetch, log };
    const refresh = [...new Set([...(s.pendingRevoke ?? []), ...(s.tokens.refreshToken ? [s.tokens.refreshToken] : [])])];
    const accessLive = s.tokens.expiresAt > Date.now();
    const older = openAccess(s);
    const [refreshResults, accessResult, olderResults] = await Promise.all([
      Promise.allSettled(refresh.map((t) => revokeToken(cfg.endpoints.revoke, t, "refresh_token", cfg.creds, callOpts))),
      accessLive ? revokeToken(cfg.endpoints.revoke, s.tokens.accessToken, "access_token", cfg.creds, callOpts).then(() => undefined, (e: Error) => e) : Promise.resolve(undefined),
      Promise.allSettled(older.map((a) => revokeToken(cfg.endpoints.revoke, a.token, "access_token", cfg.creds, callOpts))),
    ]);
    const left = refresh.filter((_, i) => refreshResults[i]!.status === "rejected");
    const olderLeft = older.filter((_, i) => olderResults[i]!.status === "rejected");
    if (left.length || accessResult || olderLeft.length) {
      // No token is used again after this, whatever DATEV answered: a lost answer may hide a revoke that worked.
      // Tokens DATEV did not confirm stay in pendingRevoke and are revoked again on the next call.
      // An access token whose revoke DATEV did not confirm keeps its expiry, so disconnect and status revoke it again.
      store.write({ ...s, ended: true, pendingRevoke: left, pendingAccessRevoke: olderLeft, tokens: { ...s.tokens, refreshToken: undefined, expiresAt: accessResult || !accessLive ? s.tokens.expiresAt : 0 } });
      return ` The connection was ended here, but DATEV did not confirm revoking it, so it is revoked again on the next call. It can also be removed at ${REVOKE_UI}.`;
    }
    store.clear();
    return " As DATEV requires, the connection was ended and both tokens revoked; sign in again after the service is switched on.";
  });
}
