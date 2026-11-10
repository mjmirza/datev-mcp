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
  if (!first?.pendingRevoke?.length || first.clientId !== creds.clientId) return { revoked: 0, left: first?.pendingRevoke?.length ?? 0 };
  return store.withLock(async () => {
    const s = store.read();
    const list = s?.pendingRevoke ?? [];
    if (!s || !list.length) return { revoked: 0, left: 0 };
    const results = await Promise.allSettled(list.map((token) => revokeToken(endpoints.revoke, token, "refresh_token", creds, opts)));
    const left = list.filter((_, i) => results[i]!.status === "rejected");
    const { pendingRevoke: _drop, ...rest } = s;
    store.write(left.length ? { ...rest, pendingRevoke: left } : rest);
    return { revoked: list.length - left.length, left: left.length };
  });
}
