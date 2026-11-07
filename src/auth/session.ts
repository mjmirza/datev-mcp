import type { Endpoints } from "./endpoints.js";
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
    private readonly opts: { fetch?: FetchLike; now?: () => number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  async accessToken(): Promise<string> {
    const s = this.store.read();
    if (!s) throw new NeedsLoginError("no saved session");
    if (s.clientId !== this.creds.clientId) throw new NeedsLoginError("saved session belongs to a different DATEV app");
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
      if (s.tokens.expiresAt - SKEW_MS > this.now()) return s.tokens.accessToken; // another process refreshed
      if (!s.tokens.refreshToken) throw new NeedsLoginError("session expired and has no refresh token");
      // On a dropped connection the token is kept on purpose: if DATEV never received it a retry succeeds, and if it did the session is lost either way.
      try {
        const next = await refreshTokens(this.endpoints.token, s.tokens.refreshToken, this.creds, { fetch: this.opts.fetch, now: this.opts.now });
        // DATEV refresh tokens are single-use. The one just sent is spent, so it is never kept, even if no new one came back.
        this.store.write({ ...s, tokens: { ...next, refreshToken: next.refreshToken } });
        return next.accessToken;
      } catch (e) {
        if (e instanceof TokenError && (e.code === "invalid_grant" || e.status === 400 || e.status === 401)) {
          this.store.clear();
          throw new NeedsLoginError(`DATEV no longer accepts the saved session (${e.code})`);
        }
        throw e;
      }
    });
  }
}
