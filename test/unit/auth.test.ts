process.env.DATEV_MCP_SESSION_KEY ??= "11".repeat(32); // tests never touch the real credential store
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import fc from "fast-check";
import { buildAuthorizeUrl } from "../../src/auth/authorize.js";
import { ENDPOINTS, parseEnv } from "../../src/auth/endpoints.js";
import { challengeFor, newPkce, randomToken } from "../../src/auth/pkce.js";
import { postToken, TokenError, type FetchLike } from "../../src/auth/token-client.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { Session, NeedsLoginError } from "../../src/auth/session.js";
import { startCallbackServer } from "../../src/auth/callback-server.js";

const creds = { clientId: "cid", clientSecret: "secret" };
const tmp = () => mkdtempSync(join(tmpdir(), "datev-mcp-test-"));
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("property: PKCE challenge is base64url(sha256(verifier)) and verifier length is RFC-valid", () => {
  fc.assert(
    fc.property(fc.constant(null), () => {
      const p = newPkce();
      assert.ok(p.verifier.length >= 43 && p.verifier.length <= 128);
      assert.match(p.verifier, /^[A-Za-z0-9_-]+$/);
      assert.equal(p.challenge, createHash("sha256").update(p.verifier).digest("base64url"));
    }),
    { numRuns: 200 },
  );
  assert.equal(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("state and nonce tokens meet DATEV's 20-character minimum", () => {
  assert.ok(randomToken().length >= 20);
});

test("authorize URL carries every DATEV-required parameter and always includes openid", () => {
  const u = new URL(
    buildAuthorizeUrl(ENDPOINTS.sandbox, { clientId: "cid", redirectUri: "http://localhost:5555/redirect/x/", scopes: ["datev:accounting:clients"], state: "s".repeat(20), nonce: "n".repeat(20), codeChallenge: "c" }),
  );
  assert.equal(u.origin + u.pathname, "https://login.datev.de/openidsandbox/authorize");
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.response_type, "code");
  assert.equal(q.code_challenge_method, "S256");
  assert.equal(q.scope, "openid datev:accounting:clients");
  assert.equal(q.redirect_uri, "http://localhost:5555/redirect/x/");
});

test("authorize URL refuses a state or nonce shorter than 20 characters", () => {
  assert.throws(() => buildAuthorizeUrl(ENDPOINTS.sandbox, { clientId: "c", redirectUri: "r", scopes: [], state: "short", nonce: "n".repeat(20), codeChallenge: "c" }));
});

test("parseEnv defaults to sandbox and rejects unknown values", () => {
  assert.equal(parseEnv(undefined), "sandbox");
  assert.equal(parseEnv("production"), "production");
  assert.throws(() => parseEnv("prod"));
});

test("token call sends Basic auth and parses a successful response", async () => {
  let seen: RequestInit | undefined;
  const f: FetchLike = async (_u, init) => ((seen = init), json(200, { access_token: "A", refresh_token: "R", expires_in: 900 }));
  const t = await postToken("https://t", { grant_type: "x" }, creds, { fetch: f, now: () => 1000 });
  assert.equal(t.accessToken, "A");
  assert.equal(t.refreshToken, "R");
  assert.equal(t.expiresAt, 1000 + 900_000);
  assert.equal((seen?.headers as Record<string, string>).authorization, `Basic ${Buffer.from("cid:secret").toString("base64")}`);
  assert.ok(!String(seen?.body).includes("secret"), "client secret must not be in the form body");
});

test("token call maps failures to typed errors (chaos: 400, 500, non-JSON, network, timeout)", async () => {
  const cases: [FetchLike, string][] = [
    [async () => json(400, { error: "invalid_grant" }), "invalid_grant"],
    [async () => json(500, {}), "http_500"],
    [async () => new Response("<html>", { status: 502 }), "bad_response"],
    [async () => json(200, { token_type: "bearer" }), "bad_response"],
    [async () => { throw new TypeError("fetch failed"); }, "network"],
    [async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, "timeout"],
  ];
  for (const [f, code] of cases) {
    await assert.rejects(postToken("https://t", {}, creds, { fetch: f }), (e: unknown) => e instanceof TokenError && e.code === code);
  }
});

test("token store writes owner-only, atomically, and quarantines a corrupt file instead of deleting it", () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir);
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "A", expiresAt: 1, obtainedAt: 0 } });
  assert.equal(statSync(store.file).mode & 0o777, 0o600);
  assert.equal(store.read()?.tokens.accessToken, "A");
  writeFileSync(store.file, "{not json");
  assert.equal(store.read(), undefined);
  assert.ok(readdirSync(dir).some((f) => f.includes(".corrupt-")));
});

test("session refreshes exactly once for concurrent callers (single-use refresh tokens)", async () => {
  const store = new TokenStore("sandbox", tmp());
  let now = 1_000_000;
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: now - 1, obtainedAt: 0 } });
  let calls = 0;
  const f: FetchLike = async () => (calls++, await new Promise((r) => setTimeout(r, 20)), json(200, { access_token: "NEW", refresh_token: "R2", expires_in: 900 }));
  const s = new Session(store, ENDPOINTS.sandbox, creds, { fetch: f, now: () => now });
  const tokens = await Promise.all(Array.from({ length: 10 }, () => s.accessToken()));
  assert.deepEqual(new Set(tokens), new Set(["NEW"]));
  assert.equal(calls, 1);
  assert.equal(store.read()?.tokens.refreshToken, "R2");
  now += 1000;
  assert.equal(await s.accessToken(), "NEW");
  assert.equal(calls, 1, "a still-valid token must not trigger another refresh");
});

test("two processes sharing one session file refresh only once (cross-process lock + re-read)", async () => {
  const dir = tmp();
  const now = 1_000_000;
  new TokenStore("sandbox", dir).write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: now - 1, obtainedAt: 0 } });
  let calls = 0;
  const f: FetchLike = async () => (calls++, await new Promise((r) => setTimeout(r, 30)), json(200, { access_token: "NEW", refresh_token: "R2", expires_in: 900 }));
  const a = new Session(new TokenStore("sandbox", dir), ENDPOINTS.sandbox, creds, { fetch: f, now: () => now });
  const b = new Session(new TokenStore("sandbox", dir), ENDPOINTS.sandbox, creds, { fetch: f, now: () => now });
  const [ta, tb] = await Promise.all([a.accessToken(), b.accessToken()]);
  assert.equal(ta, "NEW");
  assert.equal(tb, "NEW");
  assert.equal(calls, 1);
});

test("session asks for login when DATEV rejects the refresh token, and when nothing is saved", async () => {
  const store = new TokenStore("sandbox", tmp());
  const s0 = new Session(store, ENDPOINTS.sandbox, creds);
  await assert.rejects(s0.accessToken(), NeedsLoginError);
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 0, obtainedAt: 0 } });
  const s = new Session(store, ENDPOINTS.sandbox, creds, { fetch: async () => json(400, { error: "invalid_grant" }), now: () => 10_000_000 });
  await assert.rejects(s.accessToken(), NeedsLoginError);
  // The session file is kept (another process may have saved a newer one), but the rejected token is dropped,
  // so it is never sent to DATEV again.
  assert.equal(store.read()?.clientId, "cid");
  assert.equal(store.read()?.tokens.refreshToken, undefined);
  // A newer session another process saved meanwhile is never touched.
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 0, obtainedAt: 0 } });
  const racing = new Session(store, ENDPOINTS.sandbox, creds, {
    fetch: async () => (store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "NEWER", refreshToken: "R2", expiresAt: 20_000_000, obtainedAt: 0 } }), json(400, { error: "invalid_grant" })),
    now: () => 10_000_000,
  });
  assert.equal(await racing.accessToken(), "NEWER");
  assert.equal(store.read()?.tokens.refreshToken, "R2");
});

test("session keeps the saved tokens on a network failure (no silent logout)", async () => {
  const store = new TokenStore("sandbox", tmp());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 0, obtainedAt: 0 } });
  const s = new Session(store, ENDPOINTS.sandbox, creds, { fetch: async () => { throw new TypeError("fetch failed"); }, now: () => 10_000_000 });
  await assert.rejects(s.accessToken(), (e: unknown) => e instanceof TokenError && e.code === "network");
  assert.equal(store.read()?.tokens.refreshToken, "R1");
});

test("callback server accepts the right state and rejects a forged one", async () => {
  const ok = await startCallbackServer("S".repeat(24), { timeoutMs: 5000 });
  const res = await fetch(`${ok.redirectUri.replace("localhost", "127.0.0.1")}?code=CODE&state=${"S".repeat(24)}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(res.status, 200);
  assert.deepEqual(await ok.result, { code: "CODE" });

  const bad = await startCallbackServer("S".repeat(24), { timeoutMs: 5000 });
  const rejected = assert.rejects(bad.result, /State mismatch/);
  const r2 = await fetch(`${bad.redirectUri.replace("localhost", "127.0.0.1")}?code=X&state=forged`, { signal: AbortSignal.timeout(5000) });
  assert.equal(r2.status, 400);
  await rejected;
});

test("callback server escapes a hostile error value instead of reflecting HTML", async () => {
  const cb = await startCallbackServer("S".repeat(24), { timeoutMs: 5000 });
  const rejected = assert.rejects(cb.result);
  const r = await fetch(`${cb.redirectUri.replace("localhost", "127.0.0.1")}?error=${encodeURIComponent("<script>x</script>")}&state=${"S".repeat(24)}`, { signal: AbortSignal.timeout(5000) });
  assert.ok(!(await r.text()).includes("<script>"));
  await rejected;
});

test("a refresh answer without a new refresh token drops the spent one instead of replaying it later", async () => {
  const store = new TokenStore("sandbox", tmp());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 0, obtainedAt: 0 } });
  const s = new Session(store, ENDPOINTS.sandbox, creds, { fetch: async () => json(200, { access_token: "NEW", expires_in: 900 }), now: () => 10_000_000 });
  assert.equal(await s.accessToken(), "NEW");
  assert.equal(store.read()?.tokens.refreshToken, undefined);
});

test("the locked re-read refuses a session that another login saved for a different app", async () => {
  const store = new TokenStore("sandbox", tmp());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 0, obtainedAt: 0 } });
  let sent = 0;
  const s = new Session(store, ENDPOINTS.sandbox, creds, { fetch: async () => (sent++, json(200, { access_token: "X", refresh_token: "R2", expires_in: 900 })), now: () => 10_000_000 });
  const original = store.read.bind(store);
  let reads = 0;
  store.read = () => (++reads === 1 ? original() : { ...original()!, clientId: "other-app" });
  await assert.rejects(s.accessToken(), /different DATEV app/);
  assert.equal(sent, 0);
});

test("a live lock holder keeps the lock past the stale age, and only the owner releases it", async () => {
  const dir = tmp();
  const a = new TokenStore("sandbox", dir);
  const b = new TokenStore("sandbox", dir);
  let release!: () => void;
  const holding = a.withLock(() => new Promise<void>((r) => (release = r)), { staleMs: 1 });
  await new Promise((r) => setTimeout(r, 30));
  await assert.rejects(b.withLock(async () => "stolen", { staleMs: 1, waitMs: 200 }), /Timed out/);
  release();
  await holding;
  assert.equal(await b.withLock(async () => "free now"), "free now");
});

test("a lock left by a dead process is reclaimed", async () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir);
  const { mkdirSync, utimesSync } = await import("node:fs");
  mkdirSync(join(dir, "session-sandbox.lock"));
  writeFileSync(join(dir, "session-sandbox.lock", "owner"), JSON.stringify({ pid: 999_999_9, token: "ghost" }));
  utimesSync(join(dir, "session-sandbox.lock"), new Date(0), new Date(0));
  assert.equal(await store.withLock(async () => "reclaimed", { waitMs: 2000 }), "reclaimed");
});

test("a takeover never removes a lock that was replaced after it was judged stale", async () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir) as unknown as { generation(): string; takeOver(g: string, s: number, m: number): void };
  const { mkdirSync, utimesSync, rmSync, readFileSync } = await import("node:fs");
  const lock = join(dir, "session-sandbox.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner"), JSON.stringify({ pid: 999_999_9, token: "ghost" }));
  utimesSync(lock, new Date(0), new Date(0));
  const judged = store.generation();
  // Meanwhile another process takes the lock over and a live owner gets it.
  rmSync(lock, { recursive: true });
  mkdirSync(lock);
  writeFileSync(join(lock, "owner"), JSON.stringify({ pid: process.pid, token: "live" }));
  store.takeOver(judged, 1, 120_000);
  assert.equal(JSON.parse(readFileSync(join(lock, "owner"), "utf8")).token, "live");
});

test("a lock held past the maximum hold is taken over even if its pid now belongs to a live process", async () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir);
  const { mkdirSync, utimesSync } = await import("node:fs");
  const lock = join(dir, "session-sandbox.lock");
  mkdirSync(lock);
  // The pid is alive, but it belongs to a process that started at another time: the holder is gone.
  writeFileSync(join(lock, "owner"), JSON.stringify({ pid: process.ppid, token: "reused-pid", started: "Mon Jan  1 00:00:00 1990" }));
  utimesSync(lock, new Date(0), new Date(0));
  assert.equal(await store.withLock(async () => "taken", { waitMs: 2000 }), "taken");
});

test("a live holder is never evicted, however long it holds the lock", async () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir);
  const { mkdirSync, utimesSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const lock = join(dir, "session-sandbox.lock");
  mkdirSync(lock);
  const started = execFileSync("ps", ["-o", "lstart=", "-p", String(process.ppid)], { encoding: "utf8", env: { ...process.env, TZ: "UTC", LC_ALL: "C" } }).trim();
  writeFileSync(join(lock, "owner"), JSON.stringify({ pid: process.ppid, token: "slow-but-alive", started }));
  utimesSync(lock, new Date(0), new Date(0));
  await assert.rejects(store.withLock(async () => "stolen", { waitMs: 300 }), /Timed out/);
});

test("a refresh that lost the race to another process keeps that process's newer session", async () => {
  const store = new TokenStore("sandbox", tmp());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 0, obtainedAt: 0 } });
  // DATEV refuses R1 because the other process already used it and saved R2.
  const s = new Session(store, ENDPOINTS.sandbox, creds, {
    fetch: async () => {
      store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "NEW", refreshToken: "R2", expiresAt: 99_000_000, obtainedAt: 0 } });
      return json(400, { error: "invalid_grant" });
    },
    now: () => 10_000_000,
  });
  assert.equal(await s.accessToken(), "NEW");
  assert.equal(store.read()?.tokens.refreshToken, "R2");
});

test("a wrong client secret keeps the saved session instead of logging out", async () => {
  const store = new TokenStore("sandbox", tmp());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 0, obtainedAt: 0 } });
  const s = new Session(store, ENDPOINTS.sandbox, creds, { fetch: async () => json(401, { error: "invalid_client" }), now: () => 10_000_000 });
  await assert.rejects(s.accessToken(), /invalid_client.*kept/);
  assert.equal(store.read()?.tokens.refreshToken, "R1");
});

test("a recovered session is used only if it belongs to the same DATEV app", async () => {
  const store = new TokenStore("sandbox", tmp());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 0, obtainedAt: 0 } });
  const s = new Session(store, ENDPOINTS.sandbox, creds, {
    fetch: async () => {
      store.write({ env: "sandbox", clientId: "other-app", tokens: { accessToken: "FOREIGN", refreshToken: "R9", expiresAt: 99_000_000, obtainedAt: 0 } });
      return json(400, { error: "invalid_grant" });
    },
    now: () => 10_000_000,
  });
  await assert.rejects(s.accessToken(), NeedsLoginError);
  assert.equal(store.read()?.clientId, "other-app", "the other app's session is left alone");
});
