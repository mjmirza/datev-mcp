import type { Endpoints } from "./endpoints.js";
import { revokeToken, type ClientCredentials, type TokenCallOptions } from "./token-client.js";
import type { TokenStore } from "./token-store.js";

// DATEV allows one valid refresh token per app and user. When a new login cannot revoke the previous token,
// it is kept here, encrypted with the session, and retried by every later status, doctor and server start.
export async function revokePending(
  store: TokenStore,
  endpoints: Pick<Endpoints, "revoke">,
  creds: ClientCredentials,
  opts: TokenCallOptions = {},
): Promise<{ revoked: number; left: number }> {
  const first = store.read();
  // An ended connection's access token is revoked again too, until DATEV confirms or it expires.
  const accessOpen = (s: typeof first) => !!s?.ended && s.tokens.expiresAt > Date.now();
  const earlier = (s: typeof first) => (s?.pendingAccessRevoke ?? []).filter((a) => a.expiresAt > Date.now());
  // Expired access tokens need no revoke, so their record is dropped instead of kept forever.
  const dropExpired = () =>
    store.withLock(async () => {
      const s = store.read();
      if (!s?.pendingAccessRevoke) return;
      const { pendingAccessRevoke: _gone, ...rest } = s;
      const keep = earlier(s);
      store.write(keep.length ? { ...rest, pendingAccessRevoke: keep } : rest);
    });
  if (first?.clientId !== creds.clientId) {
    // Another app's tokens cannot be revoked here, but an expired one needs no revoke at all.
    if (first?.pendingAccessRevoke?.some((a) => a.expiresAt <= Date.now())) await dropExpired();
    return { revoked: 0, left: first?.pendingRevoke?.length ?? 0 };
  }
  if (!first.pendingRevoke?.length && !accessOpen(first) && !earlier(first).length) {
    if (first.pendingAccessRevoke) await dropExpired();
    return { revoked: 0, left: 0 };
  }
  return store.withLock(async () => {
    const s = store.read();
    const list = s?.pendingRevoke ?? [];
    if (!s || (!list.length && !accessOpen(s) && !earlier(s).length)) return { revoked: 0, left: 0 };
    const olderAccess = earlier(s);
    const [results, access, older] = await Promise.all([
      Promise.allSettled(list.map((token) => revokeToken(endpoints.revoke, token, "refresh_token", creds, opts))),
      accessOpen(s) ? revokeToken(endpoints.revoke, s.tokens.accessToken, "access_token", creds, opts).then(() => true, () => false) : Promise.resolve(false),
      Promise.allSettled(olderAccess.map((a) => revokeToken(endpoints.revoke, a.token, "access_token", creds, opts))),
    ]);
    const accessLeft = olderAccess.filter((_, i) => older[i]!.status === "rejected");
    const left = list.filter((_, i) => results[i]!.status === "rejected");
    const { pendingRevoke: _drop, pendingAccessRevoke: _dropAccess, ...rest } = s;
    const tokens = access ? { ...s.tokens, expiresAt: 0 } : s.tokens;
    store.write({ ...rest, tokens, ...(left.length ? { pendingRevoke: left } : {}), ...(accessLeft.length ? { pendingAccessRevoke: accessLeft } : {}) });
    return { revoked: list.length - left.length, left: left.length };
  });
}
