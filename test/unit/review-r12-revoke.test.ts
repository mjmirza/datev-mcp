process.env.DATEV_MCP_SESSION_KEY ??= "44".repeat(32); // never the real credential store
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENDPOINTS } from "../../src/auth/endpoints.js";
import { revokePending } from "../../src/auth/pending-revoke.js";
import { envKeyStore } from "../../src/auth/session-key.js";
import { Session } from "../../src/auth/session.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { localize } from "../../src/i18n.js";
import { disconnect, endForMissingPermission } from "../../src/setup/disconnect.js";
import { login } from "../../src/setup/login.js";

// Guards for the revoke review of 2026-11-10 (ledger R12).
const ep = ENDPOINTS.sandbox;
const cfg = { env: "sandbox" as const, endpoints: ep, creds: { clientId: "cid", clientSecret: "S" } };
const newStore = () => new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r12-")), envKeyStore());
const tokenOf = (init?: RequestInit) => new URLSearchParams(String(init?.body)).get("token")!;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig" };
const idToken = (claims: object) => {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};

async function relogin(store: TokenStore, onRevoke: (token: string) => Response | Promise<Response>): Promise<void> {
  let nonce = "";
  const now = Math.floor(Date.now() / 1000);
  const fake: FetchLike = async (u, init) => {
    const url = String(u);
    if (url === ep.jwks) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
    if (url === ep.token) {
      const id = idToken({ iss: ep.issuer, sub: "user-1", aud: "cid", exp: now + 900, iat: now, nonce });
      return new Response(JSON.stringify({ access_token: "NEW", refresh_token: "NEW-RT", expires_in: 900, id_token: id }), { headers: { "content-type": "application/json" } });
    }
    if (url === ep.userinfo) return new Response(JSON.stringify({ sub: "user-1", name: "Max Muster" }), { headers: { "content-type": "application/json" } });
    if (url === ep.revoke) return onRevoke(tokenOf(init));
    throw new Error(`unexpected ${url}`);
  };
  await login(cfg, { services: "hr-files", store, fetch: fake, httpLog: () => {}, log: () => {}, open: (authUrl) => {
    const u = new URL(authUrl);
    nonce = u.searchParams.get("nonce")!;
    void fetch(`${u.searchParams.get("redirect_uri")}?code=C&state=${u.searchParams.get("state")}`);
  } });
}

test("a late 403 from an older access token never ends a newer login saved meanwhile", async () => {
  const store = newStore();
  const live = { env: "sandbox" as const, clientId: "cid", tokens: { accessToken: "NEW-AT", refreshToken: "NEW-RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } };
  store.write(live);
  const revoked: string[] = [];
  const fetch: FetchLike = async (_u, init) => (revoked.push(tokenOf(init)), new Response("", { status: 200 }));
  const msg = await endForMissingPermission(cfg, { store, fetch, httpLog: () => {}, accessToken: "OLD-AT" });
  assert.deepEqual(revoked, [], "nothing of the newer login is revoked");
  assert.deepEqual(store.read(), live, "the newer login is kept as it was");
  assert.notEqual(localize(msg.trim(), "de"), msg.trim(), "the message has a German version");
  // The token that really got the 403 still ends its own connection.
  await endForMissingPermission(cfg, { store, fetch, httpLog: () => {}, accessToken: "NEW-AT" });
  assert.deepEqual(revoked.sort(), ["NEW-AT", "NEW-RT"]);
  assert.equal(store.read(), undefined);
});

test("a new login over an active one revokes the old unexpired access token too", async () => {
  const store = newStore();
  const later = Date.now() + 9e5;
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD-AT", refreshToken: "OLD-RT", expiresAt: later, obtainedAt: Date.now() } });
  const revoked: string[] = [];
  await relogin(store, (t) => (revoked.push(t), new Response(null, { status: 200 })));
  assert.ok(revoked.includes("OLD-AT"), `the old access token is revoked: ${revoked.join(",")}`);
  assert.equal(store.read()!.pendingAccessRevoke, undefined);
});

test("a new login keeps an active login's access token on record when DATEV does not confirm its revoke", async () => {
  const store = newStore();
  const later = Date.now() + 9e5;
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD-AT", refreshToken: "OLD-RT", expiresAt: later, obtainedAt: Date.now() } });
  await relogin(store, (t) => (t === "OLD-AT" ? Promise.reject(new TypeError("socket hang up")) : new Response(null, { status: 200 })));
  const s = store.read()!;
  assert.equal(s.tokens.accessToken, "NEW");
  assert.deepEqual(s.pendingAccessRevoke, [{ token: "OLD-AT", expiresAt: later }]);
});

test("once DATEV confirmed every revoke, an ended connection no longer claims a revoke is still open", async () => {
  const store = newStore();
  store.write({ env: "sandbox", clientId: "cid", ended: true, pendingRevoke: ["RT"], tokens: { accessToken: "AT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const ok: FetchLike = async () => new Response("", { status: 200 });
  await revokePending(store, ep, cfg.creds, { fetch: ok });
  let calls = 0;
  const err = await new Session(store, ep, cfg.creds, { fetch: async () => (calls++, new Response("", { status: 200 })) }).accessToken().then(() => undefined, (e: Error) => e);
  assert.ok(err, "no token is handed out");
  assert.doesNotMatch(err.message, /has not confirmed/);
  assert.match(err.message, /datev-mcp login/);
  assert.notEqual(localize(err.message, "de"), err.message, "the message has a German version");
  assert.equal(calls, 0, "nothing is retried once every revoke was confirmed");
});

test("a disconnect of a session from another app registration says which tokens could not be revoked here", async () => {
  const store = newStore();
  const later = Date.now() + 9e5;
  store.write({ env: "sandbox", clientId: "other", pendingRevoke: ["P1"], pendingAccessRevoke: [{ token: "PA", expiresAt: later }], tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: later, obtainedAt: Date.now() } });
  let calls = 0;
  const r = await disconnect(cfg, { store, fetch: async () => (calls++, new Response("", { status: 200 })), httpLog: () => {} });
  assert.equal(calls, 0, "another app's tokens cannot be revoked with this app's credentials");
  assert.equal(r.removed, true);
  assert.match(r.message, /4 token\(s\) of another DATEV app registration could not be revoked here/);
  assert.notEqual(localize(r.message, "de"), r.message, "the message has a German version");
});

test("an expired backlog entry of another app registration's session is dropped, a live one is kept and nothing is sent", async () => {
  const store = newStore();
  const later = Date.now() + 9e5;
  store.write({ env: "sandbox", clientId: "other-app", tokens: { accessToken: "AT", expiresAt: later, obtainedAt: Date.now() }, pendingAccessRevoke: [{ token: "GONE", expiresAt: Date.now() - 1000 }, { token: "LIVE", expiresAt: later }] });
  let sent = 0;
  await revokePending(store, ep, cfg.creds, { fetch: (async () => (sent++, new Response("", { status: 200 }))) as FetchLike });
  assert.equal(sent, 0);
  assert.deepEqual(store.read()?.pendingAccessRevoke?.map((a) => a.token), ["LIVE"]);
});
