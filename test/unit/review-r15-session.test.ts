process.env.DATEV_MCP_SESSION_KEY ??= "44".repeat(32); // never the real credential store
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENDPOINTS } from "../../src/auth/endpoints.js";
import { envKeyStore } from "../../src/auth/session-key.js";
import { Session } from "../../src/auth/session.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { endForMissingPermission } from "../../src/setup/disconnect.js";

// Guards for the session review of 2026-11-10 (ledger R15, F115 and the refused access token).
const ep = ENDPOINTS.sandbox;
const cfg = { env: "sandbox" as const, endpoints: ep, creds: { clientId: "cid", clientSecret: "S" } };
const newStore = () => new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r15-")), envKeyStore());
const tokenOf = (init?: RequestInit) => new URLSearchParams(String(init?.body)).get("token")!;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** A session saved before login ids existed: the lease is taken, then a refresh replaces the access token. */
async function leasedThenRefreshed(store: TokenStore, loginId?: string) {
  store.write({ env: "sandbox", clientId: "cid", ...(loginId ? { loginId } : {}), tokens: { accessToken: "OLD-AT", refreshToken: "RT1", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const lease = await new Session(store, ep, cfg.creds).lease();
  store.write({ ...store.read()!, tokens: { ...store.read()!.tokens, expiresAt: Date.now() + 30_000 } });
  const refreshed = await new Session(store, ep, cfg.creds, { fetch: async () => json({ access_token: "REFRESHED-AT", refresh_token: "RT2", expires_in: 900 }) }).accessToken();
  assert.equal(refreshed, "REFRESHED-AT");
  return lease;
}

test("a refresh gives a session saved without a login id its own id, so later calls lease it", async () => {
  const store = newStore();
  await leasedThenRefreshed(store);
  const id = store.read()!.loginId;
  assert.ok(id && id.length >= 16, "the refreshed session carries a login id");
  assert.deepEqual(await new Session(store, ep, cfg.creds).lease(), { accessToken: "REFRESHED-AT", loginId: id });
});

test("a 403 on a pre-login-id session after a refresh ends that login and revokes both tokens and the refused one", async () => {
  const store = newStore();
  const lease = await leasedThenRefreshed(store);
  assert.deepEqual(lease, { accessToken: "OLD-AT", loginId: undefined });
  const revoked: string[] = [];
  const msg = await endForMissingPermission(cfg, { store, fetch: async (_u, init) => (revoked.push(tokenOf(init)), new Response("", { status: 200 })), httpLog: () => {}, ...lease });
  assert.doesNotMatch(msg, /newer login/);
  assert.deepEqual(revoked.sort(), ["OLD-AT", "REFRESHED-AT", "RT2"]);
  assert.equal(store.read(), undefined);
});

test("a 403 after a refresh with a login id also revokes the access token that was refused", async () => {
  const store = newStore();
  const lease = await leasedThenRefreshed(store, "L1");
  const revoked: string[] = [];
  await endForMissingPermission(cfg, { store, fetch: async (_u, init) => (revoked.push(tokenOf(init)), new Response("", { status: 200 })), httpLog: () => {}, ...lease });
  assert.deepEqual(revoked.sort(), ["OLD-AT", "REFRESHED-AT", "RT2"]);
});

test("a refused access token DATEV does not confirm as revoked stays on record and is retried", async () => {
  const store = newStore();
  const lease = await leasedThenRefreshed(store, "L1");
  const msg = await endForMissingPermission(cfg, { store, fetch: async (_u, init) => new Response("", { status: tokenOf(init) === "OLD-AT" ? 500 : 200 }), httpLog: () => {}, ...lease });
  assert.match(msg, /did not confirm/);
  const s = store.read()!;
  assert.equal(s.ended, true);
  assert.deepEqual(s.pendingAccessRevoke?.map((a) => a.token), ["OLD-AT"]);
  assert.ok(s.pendingAccessRevoke![0]!.expiresAt > Date.now());
});

test("a refused token of a genuinely newer login is still kept, with or without login ids", async () => {
  for (const ids of [{ old: "L1", now: "L2" }, { old: undefined, now: undefined }]) {
    const store = newStore();
    const live = { env: "sandbox" as const, clientId: "cid", ...(ids.now ? { loginId: ids.now } : {}), tokens: { accessToken: "NEW-AT", refreshToken: "NEW-RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } };
    store.write(live);
    const revoked: string[] = [];
    const msg = await endForMissingPermission(cfg, { store, fetch: async (_u, init) => (revoked.push(tokenOf(init)), new Response("", { status: 200 })), httpLog: () => {}, accessToken: "OLD-AT", loginId: ids.old });
    assert.match(msg, /newer login/);
    assert.deepEqual(revoked, []);
    assert.deepEqual(store.read(), live);
  }
});
