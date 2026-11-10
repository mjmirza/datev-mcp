import type { Endpoints } from "./endpoints.js";
import type { HttpLogEntry } from "../api/http-log.js";
import { tokenLog } from "../setup/token-log.js";
import { refreshTokens, TokenError, type ClientCredentials, type FetchLike } from "./token-client.js";
import type { TokenStore } from "./token-store.js";

export class NeedsLoginError extends Error {
  constructor(reason: string) {
    super(`DATEV login needed: ${reason}. Run "datev-mcp login".`);
    this.name = "NeedsLoginError";
  }
}

const SKEW_MS = 60_000;

// Hands out a valid access token. Refreshes at most once per expiry, across concurrent
// callers in this process (shared promise) and across processes (store lock + re-read).
export class Session {
  private inflight?: Promise<string>;

  constructor(
    private readonly store: TokenStore,
    private readonly endpoints: Endpoints,
    private readonly creds: ClientCredentials,
    private readonly opts: { fetch?: FetchLike; now?: () => number; log?: (e: HttpLogEntry) => void } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  async accessToken(): Promise<string> {
    const s = this.store.read();
    if (!s) throw new NeedsLoginError("no saved session");
    if (s.clientId !== this.creds.clientId) throw new NeedsLoginError("saved session belongs to a different DATEV app");
    if (s.ended) throw new NeedsLoginError("the connection was ended because a data service permission is missing");
    if (s.tokens.expiresAt - SKEW_MS > this.now()) return s.tokens.accessToken;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private refresh(): Promise<string> {
    return this.store.withLock(async () => {
      const s = this.store.read();
      if (!s) throw new NeedsLoginError("no saved session");
      if (s.clientId !== this.creds.clientId) throw new NeedsLoginError("saved session belongs to a different DATEV app");
      if (s.ended) throw new NeedsLoginError("the connection was ended because a data service permission is missing");
      if (s.tokens.expiresAt - SKEW_MS > this.now()) return s.tokens.accessToken; // another process refreshed
      if (!s.tokens.refreshToken) throw new NeedsLoginError("session expired and has no refresh token");
      // On a dropped connection the token is kept on purpose: if DATEV never received it a retry succeeds, and if it did the session is lost either way.
      try {
        const next = await refreshTokens(this.endpoints.token, s.tokens.refreshToken, this.creds, { fetch: this.opts.fetch, now: this.opts.now, log: this.opts.log && tokenLog(this.opts.log) });
        // DATEV refresh tokens are single-use. The one just sent is spent, so it is never kept, even if no new one came back.
        this.store.write({ ...s, tokens: { ...next, refreshToken: next.refreshToken } });
        return next.accessToken;
      } catch (e) {
        // Only a rejected refresh token ends the session. A wrong client secret (invalid_client) or a server hiccup keeps it.
        if (e instanceof TokenError && e.code === "invalid_grant") {
          // If another process already rotated the token, its newer session is valid: keep it, never delete it.
          const now = this.store.read();
          if (now && now.clientId === this.creds.clientId && now.tokens.refreshToken !== s.tokens.refreshToken) {
            if (now.tokens.expiresAt - SKEW_MS > this.now()) return now.tokens.accessToken;
            throw new Error("Another process refreshed the DATEV session at the same moment. Try the call again");
          }
          // The session file is never deleted here: another process may have just saved a newer one.
          // The rejected refresh token is dropped, so it is never sent to DATEV again.
          if (now && now.clientId === this.creds.clientId && now.tokens.refreshToken === s.tokens.refreshToken) {
            this.store.write({ ...now, tokens: { ...now.tokens, refreshToken: undefined } });
          }
          throw new NeedsLoginError(`DATEV no longer accepts the saved session (${e.code})`);
        }
        if (e instanceof TokenError && e.code === "invalid_client") throw new Error("DATEV rejected the app credentials (invalid_client). Check DATEV_CLIENT_ID and DATEV_CLIENT_SECRET. The saved session was kept, so no new login is needed once they are right");
        throw e;
      }
    });
  }
}
