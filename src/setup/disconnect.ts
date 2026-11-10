import { writeHttpLog, type HttpLogEntry } from "../api/http-log.js";
import { revokeToken, type FetchLike } from "../auth/token-client.js";
import { TokenStore } from "../auth/token-store.js";
import type { Config } from "../config.js";
import { REVOKE_UI } from "./status.js";
import { tokenLog } from "./token-log.js";

export interface DisconnectResult {
  revoked: boolean;
  removed: boolean;
  message: string;
}

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
    let accessNote = "";
    if (!opts.localOnly && sameApp) {
      const notRemoved = (why: string) => ({
        revoked: false,
        removed: false,
        message: `The connection was NOT removed: ${why}. Try again, or remove it at ${REVOKE_UI} and then run "datev-mcp disconnect --local-only".`,
      });
      // Every refresh token this app still holds, the current one and any an earlier login could not revoke.
      const refresh = [...new Set([...(s.pendingRevoke ?? []), ...(s.tokens.refreshToken ? [s.tokens.refreshToken] : [])])];
      const results = await Promise.allSettled(refresh.map((t) => revokeToken(cfg.endpoints.revoke, t, "refresh_token", cfg.creds, callOpts)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) return notRemoved((failed.reason as Error).message);
      const accessLive = s.tokens.expiresAt > Date.now();
      if (accessLive) {
        try {
          await revokeToken(cfg.endpoints.revoke, s.tokens.accessToken, "access_token", cfg.creds, callOpts);
        } catch (e) {
          // With no refresh token left, the access token is the only way in: it must be revoked before the session goes.
          if (!refresh.length) return notRemoved((e as Error).message);
          accessNote = ` DATEV did not confirm the access token revocation (${(e as Error).message}); it can no longer be renewed and expires at ${new Date(s.tokens.expiresAt).toISOString().slice(11, 16)} UTC.`;
        }
      }
    }
    store.clear();
    const revoked = !opts.localOnly && sameApp;
    return {
      revoked,
      removed: true,
      message: revoked
        ? `Disconnected. The connection was revoked at DATEV and the local session deleted.${accessNote}`
        : `The local session was deleted. Check ${REVOKE_UI} that the app no longer appears there.`,
    };
  });
}
