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
    if (!s) return { revoked: false, removed: false, message: "There is no saved DATEV connection." };
    if (!opts.localOnly && s.clientId === cfg.creds.clientId) {
      try {
        if (s.tokens.refreshToken) await revokeToken(cfg.endpoints.revoke, s.tokens.refreshToken, "refresh_token", cfg.creds, { fetch: opts.fetch, log });
        await revokeToken(cfg.endpoints.revoke, s.tokens.accessToken, "access_token", cfg.creds, { fetch: opts.fetch, log }).catch(() => undefined); // expires in minutes anyway
      } catch (e) {
        return {
          revoked: false,
          removed: false,
          message: `The connection was NOT removed: ${(e as Error).message}. Try again, or remove it at ${REVOKE_UI} and then run "datev-mcp disconnect --local-only".`,
        };
      }
    }
    store.clear();
    const revoked = !opts.localOnly && s.clientId === cfg.creds.clientId;
    return {
      revoked,
      removed: true,
      message: revoked
        ? "Disconnected. The refresh token was revoked at DATEV and the local session deleted."
        : `The local session was deleted. Check ${REVOKE_UI} that the app no longer appears there.`,
    };
  });
}
