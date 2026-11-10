process.env.DATEV_MCP_SESSION_KEY ??= "44".repeat(32); // never the real credential store
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENDPOINTS } from "../../src/auth/endpoints.js";
import { envKeyStore } from "../../src/auth/session-key.js";
import { Session } from "../../src/auth/session.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { localize } from "../../src/i18n.js";
import { endForMissingPermission } from "../../src/setup/disconnect.js";
import { login } from "../../src/setup/login.js";

// Guards for the login-identity review of 2026-11-10 (ledger R13).
const ep = ENDPOINTS.sandbox;
const cfg = { env: "sandbox" as const, endpoints: ep, creds: { clientId: "cid", clientSecret: "S" } };
const newStore = () => new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r13-")), envKeyStore());
const tokenOf = (init?: RequestInit) => new URLSearchParams(String(init?.body)).get("token")!;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig" };
const idToken = (claims: object) => {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};

async function relogin(store: TokenStore): Promise<void> {
  let nonce = "";
  const now = Math.floor(Date.now() / 1000);
  const fake: FetchLike = async (u) => {
    const url = String(u);
    if (url === ep.jwks) return json({ keys: [jwk] });
    if (url === ep.token) return json({ access_token: `AT-${Math.random()}`, refresh_token: `RT-${Math.random()}`, expires_in: 900, id_token: idToken({ iss: ep.issuer, sub: "user-1", aud: "cid", exp: now + 900, iat: now, nonce }) });
    if (url === ep.userinfo) return json({ sub: "user-1", name: "Max Muster" });
    if (url === ep.revoke) return new Response(null, { status: 200 });
    throw new Error(`unexpected ${url}`);
  };
  await login(cfg, { services: "hr-files", store, fetch: fake, httpLog: () => {}, log: () => {}, open: (authUrl) => {
    const u = new URL(authUrl);
    nonce = u.searchParams.get("nonce")!;
    void fetch(`${u.searchParams.get("redirect_uri")}?code=C&state=${u.searchParams.get("state")}`);
  } });
}

test("every login saves its own login id", async () => {
  const store = newStore();
  await relogin(store);
  const first = store.read()!.loginId;
  assert.ok(first && first.length >= 16, "a login id is saved");
  await relogin(store);
  assert.notEqual(store.read()!.loginId, first, "a new login gets a new id");
});

test("a 403 that arrives after an ordinary refresh still ends that login and revokes its tokens", async () => {
  const store = newStore();
  store.write({ env: "sandbox", clientId: "cid", loginId: "L1", tokens: { accessToken: "OLD-AT", refreshToken: "RT1", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  // The permission request leases the old token, then another call refreshes it before the 403 arrives.
  const lease = await new Session(store, ep, cfg.creds).lease();
  assert.deepEqual(lease, { accessToken: "OLD-AT", loginId: "L1" });
  store.write({ ...store.read()!, tokens: { ...store.read()!.tokens, expiresAt: 0 } });
  const refreshed = await new Session(store, ep, cfg.creds, { fetch: async () => json({ access_token: "REFRESHED-AT", refresh_token: "RT2", expires_in: 900 }) }).accessToken();
  assert.equal(refreshed, "REFRESHED-AT");
  assert.equal(store.read()!.loginId, "L1", "a refresh keeps the login id");
  const revoked: string[] = [];
  const msg = await endForMissingPermission(cfg, { store, fetch: async (_u, init) => (revoked.push(tokenOf(init)), new Response("", { status: 200 })), httpLog: () => {}, ...lease });
  assert.deepEqual(revoked.sort(), ["REFRESHED-AT", "RT2"]);
  assert.equal(store.read(), undefined);
  assert.doesNotMatch(msg, /newer login/);
});

test("a 403 for an older login id keeps a newer login, even when it carries no token match", async () => {
  const store = newStore();
  const live = { env: "sandbox" as const, clientId: "cid", loginId: "L2", tokens: { accessToken: "NEW-AT", refreshToken: "NEW-RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } };
  store.write(live);
  const revoked: string[] = [];
  const msg = await endForMissingPermission(cfg, { store, fetch: async (_u, init) => (revoked.push(tokenOf(init)), new Response("", { status: 200 })), httpLog: () => {}, accessToken: "OLD-AT", loginId: "L1" });
  assert.deepEqual(revoked, []);
  assert.deepEqual(store.read(), live);
  assert.match(msg, /newer login/);
});

test("a session saved by an older version without a login id still ends when the refused token matches", async () => {
  const store = newStore();
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const revoked: string[] = [];
  await endForMissingPermission(cfg, { store, fetch: async (_u, init) => (revoked.push(tokenOf(init)), new Response("", { status: 200 })), httpLog: () => {}, accessToken: "AT", loginId: "L-NEW" });
  assert.deepEqual(revoked.sort(), ["AT", "RT"]);
  assert.equal(store.read(), undefined);
});

const errOf = (store: TokenStore, fetch?: FetchLike) => new Session(store, ep, cfg.creds, { fetch }).accessToken().then(() => assert.fail("no token may be handed out"), (e: Error) => e);

test("an ended connection whose unconfirmed access token expired says so, never that DATEV confirmed it", async () => {
  const store = newStore();
  store.write({ env: "sandbox", clientId: "cid", ended: true, tokens: { accessToken: "AT", expiresAt: Date.now() - 1000, obtainedAt: Date.now() - 9e5 } });
  const err = await errOf(store);
  assert.doesNotMatch(err.message, /confirmed every revoke/);
  assert.match(err.message, /expired/);
  assert.match(err.message, /datev-mcp login/);
  assert.notEqual(localize(err.message, "de"), err.message, "the message has a German version");
});

test("an ended connection drops an expired access token record and keeps saying it expired", async () => {
  const store = newStore();
  store.write({ env: "sandbox", clientId: "cid", ended: true, pendingAccessRevoke: [{ token: "OLD", expiresAt: Date.now() - 1000 }], tokens: { accessToken: "AT", expiresAt: 0, obtainedAt: Date.now() } });
  let sent = 0;
  const err = await errOf(store, async () => (sent++, new Response("", { status: 200 })));
  assert.doesNotMatch(err.message, /confirmed every revoke/);
  for (let i = 0; i < 50 && store.read()?.pendingAccessRevoke; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.read()?.pendingAccessRevoke, undefined, "the expired record is cleaned up");
  assert.equal(sent, 0, "an expired token is never sent");
  const again = await errOf(store);
  assert.doesNotMatch(again.message, /confirmed every revoke/, "the cleanup does not turn into a claim of confirmation");
  assert.match(again.message, /expired/);
});

test("an access token that had already expired when the connection ended is never later reported as confirmed", async () => {
  const store = newStore();
  store.write({ env: "sandbox", clientId: "cid", loginId: "L1", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() - 1000, obtainedAt: Date.now() - 9e5 } });
  await endForMissingPermission(cfg, { store, fetch: async () => new Response("", { status: 500 }), httpLog: () => {}, accessToken: "AT", loginId: "L1" });
  const { revokePending } = await import("../../src/auth/pending-revoke.js");
  await revokePending(store, ep, cfg.creds, { fetch: async () => new Response("", { status: 200 }) });
  const err = await errOf(store);
  assert.doesNotMatch(err.message, /confirmed every revoke/);
  assert.match(err.message, /expired/);
});
