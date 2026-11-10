process.env.DATEV_MCP_SESSION_KEY ??= "22".repeat(32); // never the real credential store

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENDPOINTS } from "../../src/auth/endpoints.js";
import { verifyIdToken } from "../../src/auth/id-token.js";
import { envKeyStore } from "../../src/auth/session-key.js";
import { selectServices, serviceList } from "../../src/auth/services.js";
import { revokeToken, type FetchLike } from "../../src/auth/token-client.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { errorRate, redactHeaders, writeHttpLog, type HttpLogEntry } from "../../src/api/http-log.js";
import { loadConfig } from "../../src/config.js";
import { storeDir } from "../../src/paths.js";
import { disconnect } from "../../src/setup/disconnect.js";
import { chooseScopes, login } from "../../src/setup/login.js";
import { doctor } from "../../src/setup/doctor.js";
import { connectionStatus, formatDe, renderStatus, REVOKE_UI } from "../../src/setup/status.js";

const tmp = () => mkdtempSync(join(tmpdir(), "datev-req-"));
const ep = ENDPOINTS.sandbox;
const creds = { clientId: "cid", clientSecret: "SECRET" };
const cfg = { env: "sandbox" as const, endpoints: ep, creds };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig" };

function idToken(claims: Record<string, unknown>, kid = "k1", key = privateKey): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString("base64url")}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: ep.issuer, sub: "user-1", aud: "cid", exp: now + 900, iat: now, nonce: "N".repeat(43) };
const jwksFetch: FetchLike = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
const want = { issuer: ep.issuer, clientId: "cid", nonce: "N".repeat(43), jwksUrl: ep.jwks, fetch: jwksFetch };

test("an ID token is accepted only with DATEV's signature, issuer, audience, expiry and this login's nonce", async () => {
  assert.equal((await verifyIdToken(idToken(good), want)).sub, "user-1");
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const bad: [string, RegExp][] = [
    [idToken(good, "k1", other), /signature/],
    [idToken({ ...good, nonce: "x".repeat(43) }), /nonce/],
    [idToken({ ...good, iss: "https://evil.example" }), /issuer/],
    [idToken({ ...good, aud: "other-app" }), /different app/],
    [idToken({ ...good, aud: ["cid", "other"], azp: "other" }), /authorized party/],
    [idToken({ ...good, exp: now - 3600 }), /expired/],
    [idToken({ ...good, iat: now + 3600 }), /future/],
    [idToken(good, "unknown-kid"), /no DATEV signing key/],
    ["a.b", /signed JWT/],
  ];
  for (const [t, why] of bad) await assert.rejects(verifyIdToken(t, want), why);
  const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url")}.${Buffer.from(JSON.stringify(good)).toString("base64url")}.`;
  await assert.rejects(verifyIdToken(none, want), /algorithm/);
});

test("the ID token check rejects a foreign authorized party and a mismatching at_hash, and logs the signing-key request", async () => {
  const { createHash } = await import("node:crypto");
  await assert.rejects(verifyIdToken(idToken({ ...good, azp: "another-client" }), want), /authorized party/);
  const half = (t: string) => createHash("sha256").update(t).digest().subarray(0, 16).toString("base64url");
  const withHash = idToken({ ...good, at_hash: half("AT-1") });
  assert.equal((await verifyIdToken(withHash, { ...want, accessToken: "AT-1" })).sub, "user-1");
  await assert.rejects(verifyIdToken(withHash, { ...want, accessToken: "AT-2" }), /does not belong/);
  const logged: HttpLogEntry[] = [];
  await verifyIdToken(idToken(good), { ...want, log: (e) => logged.push(e) });
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.url, ep.jwks);
  assert.equal(logged[0]!.status, 200);
});

test("token, userinfo and revoke errors keep DATEV's help link, and a null token answer is logged, not a crash", async () => {
  const { postToken } = await import("../../src/auth/token-client.js");
  const { fetchUserInfo } = await import("../../src/auth/userinfo.js");
  const jsonRes = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  await assert.rejects(
    postToken(ep.token, { grant_type: "refresh_token", refresh_token: "RT" }, creds, { fetch: jsonRes(400, { error: "invalid_grant", error_uri: "https://developer.datev.de/err/9" }) }),
    /invalid_grant.*Help: https:\/\/developer\.datev\.de\/err\/9/,
  );
  await assert.rejects(fetchUserInfo(ep.userinfo, "AT", "cid", { fetch: jsonRes(403, { type: "https://help.datev.de/u1", title: "Forbidden" }) }), /HTTP 403\. Help: https:\/\/help\.datev\.de\/u1/);
  await assert.rejects(revokeToken(ep.revoke, "RT", "refresh_token", creds, { fetch: jsonRes(400, { error: "unsupported", error_uri: "https://developer.datev.de/err/r" }) }), /HTTP 400\)\. Help: https:\/\/developer\.datev\.de\/err\/r/);
  const lines: unknown[] = [];
  await assert.rejects(postToken(ep.token, { grant_type: "refresh_token", refresh_token: "RT" }, creds, { fetch: jsonRes(200, null), log: (e) => lines.push(e) }), /non-JSON|bad_response|not/i);
  assert.equal(lines.length, 1, "the null answer is in the log");
});

test("the session file holds no readable token, and an old plain-text session is encrypted on first read", () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir, envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT-SECRET", refreshToken: "RT-SECRET", expiresAt: 1, obtainedAt: 0 } });
  const raw = readFileSync(store.file, "utf8");
  assert.ok(!raw.includes("AT-SECRET") && !raw.includes("RT-SECRET"), "tokens are not in clear text");
  assert.equal(JSON.parse(raw).alg, "A256GCM");
  assert.equal(store.read()?.tokens.refreshToken, "RT-SECRET");
  writeFileSync(store.file, JSON.stringify({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD-AT", expiresAt: 1, obtainedAt: 0 } }), { mode: 0o644 });
  assert.equal(store.read()?.tokens.accessToken, "OLD-AT");
  assert.ok(!readFileSync(store.file, "utf8").includes("OLD-AT"), "migrated to the encrypted format");
  assert.equal(statSync(store.file).mode & 0o777, 0o600, "permissions tightened");
});

test("a session encrypted with another key is never read as valid, and a missing key says so", () => {
  const dir = tmp();
  new TokenStore("sandbox", dir, envKeyStore()).write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "A", expiresAt: 1, obtainedAt: 0 } });
  assert.equal(new TokenStore("sandbox", dir, envKeyStore({ DATEV_MCP_SESSION_KEY: "33".repeat(32) })).read(), undefined);
  assert.ok(readdirSync(dir).some((f) => f.includes(".corrupt-")), "kept for inspection");
  new TokenStore("sandbox", dir, envKeyStore()).write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "A", expiresAt: 1, obtainedAt: 0 } });
  assert.throws(() => new TokenStore("sandbox", dir, envKeyStore({})).read(), /key is missing/);
});

test("only the scopes of the chosen data services are requested, and choosing is required", () => {
  const docs = selectServices("accounting-documents");
  assert.deepEqual(docs.services, ["accounting-clients", "accounting-documents"], "the client list comes with every accounting service");
  assert.ok(docs.scopes.includes("accounting:documents") && !docs.scopes.some((s) => s.startsWith("datev:hr")), "no payroll or eAU scope");
  assert.throws(() => selectServices("nope"), /Unknown data service/);
  assert.throws(() => chooseScopes(cfg), /Choose the DATEV data services/);
  assert.deepEqual(chooseScopes({ ...cfg, scopes: ["datev:accounting:clients"] }).scopes, ["openid", "datev:accounting:clients"]);
  assert.equal(loadConfig({ DATEV_CLIENT_ID: "a", DATEV_CLIENT_SECRET: "b", DATEV_MCP_SERVICES: "eau-api" }).services, "eau-api");
});

test("an empty DATEV_MCP_HOME is ignored and a relative one is refused, so a session never lands in the working directory", () => {
  assert.equal(storeDir({ DATEV_MCP_HOME: "  ", XDG_CONFIG_HOME: "/x" }), "/x/datev-mcp");
  assert.throws(() => storeDir({ DATEV_MCP_HOME: "relative/dir" }), /absolute path/);
  assert.equal(storeDir({ DATEV_MCP_HOME: "/abs/dir" }), "/abs/dir");
});

test("revocation posts the token with Basic auth, refuses redirects, and fails loudly when DATEV says no", async () => {
  let seen: RequestInit | undefined;
  await revokeToken(ep.revoke, "RT", "refresh_token", creds, { fetch: async (_u, init) => ((seen = init), new Response(null, { status: 200 })) });
  assert.equal(seen?.redirect, "error");
  assert.match(String(seen?.body), /token=RT&token_type_hint=refresh_token/);
  assert.match(String((seen?.headers as Record<string, string>).authorization), /^Basic /);
  await assert.rejects(revokeToken(ep.revoke, "RT", "refresh_token", creds, { fetch: async () => new Response(null, { status: 400 }) }), /refused to revoke/);
});

test("a DATEV Public client signs in with PKCE and client_id alone, and production warns about a Confidential localhost setup", async () => {
  const pub = loadConfig({ DATEV_CLIENT_ID: " cid ", DATEV_ENV: "production" });
  assert.equal(pub.creds.clientSecret, undefined);
  assert.equal(loadConfig({ DATEV_CLIENT_ID: "cid", DATEV_CLIENT_SECRET: "  s3cret \n" }).creds.clientSecret, "s3cret", "the secret is trimmed");
  const { postToken } = await import("../../src/auth/token-client.js");
  const seen: RequestInit[] = [];
  const f: FetchLike = async (_u, i) => (seen.push(i!), new Response(JSON.stringify({ access_token: "AT", expires_in: 900 }), { headers: { "content-type": "application/json" } }));
  await postToken(ep.token, { grant_type: "refresh_token", refresh_token: "RT" }, pub.creds, { fetch: f });
  await revokeToken(ep.revoke, "RT", "refresh_token", pub.creds, { fetch: async (_u, i) => (seen.push(i!), new Response(null, { status: 200 })) });
  for (const i of seen) {
    assert.equal((i.headers as Record<string, string>).authorization, undefined, "no Basic header without a secret");
    assert.equal(new URLSearchParams(String(i.body)).get("client_id"), "cid");
  }
  const { setupWarnings } = await import("../../src/setup/status.js");
  assert.deepEqual(setupWarnings(pub), []);
  const conf = loadConfig({ DATEV_CLIENT_ID: "cid", DATEV_CLIENT_SECRET: "s", DATEV_ENV: "production" });
  assert.match(setupWarnings(conf)[0]!, /Public client/);
  const st = await connectionStatus(conf, { store: new TokenStore("production", tmp(), envKeyStore()) });
  assert.equal(st.app_type, "Confidential");
  assert.match(renderStatus(st, "de"), /Warnung\s+DATEV sperrt/);
});

test("disconnect never reports success when a usable token was not revoked, and revokes pending tokens too", async () => {
  const store = new TokenStore("sandbox", tmp(), envKeyStore());
  const live = { accessToken: "AT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() };
  const hint = (i?: RequestInit) => new URLSearchParams(String(i?.body)).get("token_type_hint");
  // Only an access token is left, and DATEV refuses to revoke it: the session must stay.
  store.write({ env: "sandbox", clientId: "cid", tokens: live });
  const refused = await disconnect(cfg, { store, httpLog: () => {}, fetch: async () => new Response(null, { status: 500 }) });
  assert.equal(refused.removed, false);
  assert.ok(store.read(), "kept, the access token still works at DATEV");
  // A pending token from an earlier login is revoked with the current one.
  store.write({ env: "sandbox", clientId: "cid", tokens: { ...live, refreshToken: "RT" }, pendingRevoke: ["OLD"] });
  const sent: string[] = [];
  const ok = await disconnect(cfg, { store, httpLog: () => {}, fetch: async (_u, i) => (sent.push(`${hint(i)}:${new URLSearchParams(String(i?.body)).get("token")}`), new Response(null, { status: 200 })) });
  assert.equal(ok.revoked, true);
  assert.deepEqual(sent.sort(), ["access_token:AT", "refresh_token:OLD", "refresh_token:RT"]);
  // With no session at all, the person is still pointed at DATEV's connected-apps page.
  assert.match((await disconnect(cfg, { store, httpLog: () => {} })).message, /apps\.datev\.de\/tokrevui/);
});

test("disconnect revokes at DATEV and deletes the session; if DATEV is unreachable it keeps the session and says so", async () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir, envKeyStore());
  const save = () => store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  save();
  const sent: string[] = [];
  const logged: HttpLogEntry[] = [];
  const ok = await disconnect(cfg, { store, httpLog: (e) => logged.push(e), fetch: async (_u, i) => (sent.push(String(i?.body)), new Response(null, { status: 200 })) });
  assert.equal(ok.revoked, true);
  assert.equal(store.read(), undefined);
  assert.ok(sent[0]!.includes("token=RT"), "the refresh token was revoked first");
  assert.equal(logged.length, 2, "both revocations are in the HTTP log");
  assert.ok(logged.every((e) => e.url === ep.revoke && e.status === 200));
  assert.ok(!JSON.stringify(logged).includes("RT") && !JSON.stringify(logged).includes("SECRET"), "no token or secret in the log");
  save();
  const down = await disconnect(cfg, { store, httpLog: () => {}, fetch: async () => Promise.reject(new TypeError("fetch failed")) });
  assert.equal(down.removed, false);
  assert.ok(store.read(), "kept, because the token is still valid at DATEV");
  assert.match(down.message, new RegExp(REVOKE_UI.replace(/\//g, "\\/")));
  const local = await disconnect(cfg, { store, httpLog: () => {}, localOnly: true });
  assert.equal(local.removed, true);
});

test("the status shows active or inactive, the full name, validity as TT.MM.JJJJ HH:MM, the data services and DATEV's connections page", async () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir, envKeyStore());
  const off = await connectionStatus(cfg, { store });
  assert.equal(off.connected, false);
  assert.match(renderStatus(off, "de"), /INAKTIV \(getrennt\)/);
  const until = Date.UTC(2026, 10, 9, 21, 5);
  store.write({
    env: "sandbox",
    clientId: "cid",
    tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() },
    identity: { sub: "u1", name: "Erika Mustermann" },
    services: ["accounting-documents"],
    refreshExpiresAt: until,
  });
  const userinfo: FetchLike = async () => new Response(JSON.stringify({ sub: "u1", given_name: "Erika", family_name: "Mustermann" }), { headers: { "content-type": "application/json" } });
  const on = await connectionStatus(cfg, { store, fetch: userinfo, httpLog: () => {}, now: () => until - 3600_000 });
  assert.equal(on.connected, true);
  assert.equal(on.user, "Erika Mustermann");
  assert.equal(on.refresh_valid_until, "09.11.2026 22:05", "German time, DATEV's format");
  assert.deepEqual(on.data_services, ["Belegbilderservice Rechnungswesen"]);
  const text = renderStatus(on, "de");
  for (const part of ["AKTIV (verbunden)", "Erika Mustermann", "09.11.2026 22:05", "Belegbilderservice Rechnungswesen", REVOKE_UI]) assert.ok(text.includes(part), part);
  assert.ok(!JSON.stringify(on).includes("RT") && !text.includes("RT"), "the status never shows a token");
  const expired = await connectionStatus(cfg, { store, fetch: userinfo, httpLog: () => {}, now: () => until + 1 });
  assert.equal(expired.connected, false);
  assert.equal(formatDe(Date.UTC(2026, 0, 2, 3, 4)), "02.01.2026 04:04");
});

test("status and doctor put every DATEV call they make into the HTTP log, with DATEV's tracing headers and no token", async () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir, envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", services: ["accounting-clients"], tokens: { accessToken: "AT-SECRET", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const trace = { "x-global-transaction-id": "g-1", "v-cap-request-id": "v-1", "content-type": "application/json" };
  const fake: FetchLike = async (u) =>
    new Response(String(u).endsWith("/clients") ? "[]" : JSON.stringify({ sub: "u1", name: "Erika Mustermann" }), { headers: trace });
  const statusLog: HttpLogEntry[] = [];
  await connectionStatus(cfg, { store, fetch: fake, httpLog: (e) => statusLog.push(e) });
  assert.ok(statusLog.some((e) => e.url === ep.userinfo && e.status === 200), "status logs its userinfo call");
  const doctorLog: HttpLogEntry[] = [];
  const checks = await doctor(cfg, { store, fetch: fake, httpLog: (e) => doctorLog.push(e) });
  assert.ok(checks.some((c) => c.name === "userinfo"), JSON.stringify(checks));
  const urls = doctorLog.map((e) => e.url);
  assert.ok(urls.includes(ep.userinfo), "doctor logs userinfo");
  assert.ok(urls.some((u) => u.endsWith("/clients")), "doctor logs the clients call");
  for (const e of [...statusLog, ...doctorLog]) {
    assert.ok(e.ts_request && e.ts_response, "both timestamps");
    if (e.status) assert.equal(e.response_headers?.["x-global-transaction-id"], "g-1");
  }
  assert.ok(!JSON.stringify([statusLog, doctorLog]).includes("AT-SECRET"), "no token in the log");
});

test("data services carry DATEV's own names, spelled as DATEV writes them, never an invented label", () => {
  const list = serviceList();
  for (const name of [
    "Belegbilderservice Rechnungswesen",
    "Buchungsdatenservice und DATEV-Format",
    "Rechnungsdatenservice 1.0 und DXSO-Format",
    "Datenservice Export Rechnungswesen",
    "TRAFFIQX® Invoice API für DATEV E-Rechnungsplattform",
    "Lohnimportdatenservice und ASCII-Format",
    "Lohnauswertungsdatenservice",
    "Lohnergebnisdatenservice",
    "Lohnaustauschdatenservice (hr:exchange)",
    "Lohnaustauschdatenservice (hr:eau)",
    "Datenservice Dokumente Personalwirtschaft",
    "Belegbilderservice Einkommensteuer",
    "accounting:clients (DATEV Rechnungswesen)",
    "DATEV Basisdaten online (master-data:master-clients)",
    "Dokumentenservice Grundsteuer",
  ])
    assert.ok(list.includes(name), name);
  assert.doesNotMatch(list, /Online-API|Einkommenssteuer/);
});

test("an old refresh token DATEV did not revoke is kept encrypted, shown in the status, and retried until DATEV confirms", async () => {
  const { revokePending } = await import("../../src/auth/pending-revoke.js");
  const dir = tmp();
  const store = new TokenStore("sandbox", dir, envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "NEW", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() }, pendingRevoke: ["OLD"] });
  const down: FetchLike = async () => Promise.reject(new TypeError("fetch failed"));
  assert.deepEqual(await revokePending(store, ep, creds, { fetch: down }), { revoked: 0, left: 1 });
  assert.deepEqual(store.read()?.pendingRevoke, ["OLD"], "kept until DATEV confirms");
  assert.ok(!readFileSync(store.file, "utf8").includes("OLD"), "stored encrypted");
  const userinfo: FetchLike = async (u) => (String(u) === ep.revoke ? Promise.reject(new TypeError("down")) : new Response(JSON.stringify({ sub: "u1", name: "Erika" })));
  const st = await connectionStatus(cfg, { store, fetch: userinfo, httpLog: () => {} });
  assert.equal(st.pending_revocations, 1);
  assert.match(renderStatus(st, "de"), /Alte Refresh-Tokens noch nicht widerrufen\s+1/);
  const bodies: string[] = [];
  const up: FetchLike = async (_u, i) => (bodies.push(String(i?.body)), new Response(null, { status: 200 }));
  assert.deepEqual(await revokePending(store, ep, creds, { fetch: up }), { revoked: 1, left: 0 });
  assert.ok(bodies[0]!.includes("token=OLD"));
  assert.equal(store.read()?.pendingRevoke, undefined);
  assert.equal(store.read()?.tokens.refreshToken, "NEW", "the current session is untouched");
});

test("a refresh token DATEV rejected is dropped, so it is never sent to DATEV again", async () => {
  const { Session } = await import("../../src/auth/session.js");
  const store = new TokenStore("sandbox", tmp(), envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "DEAD", expiresAt: 1, obtainedAt: 0 } });
  let sent = 0;
  const reject: FetchLike = async () => (sent++, new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } }));
  const s = new Session(store, ep, creds, { fetch: reject });
  await assert.rejects(s.accessToken(), /login needed/i);
  await assert.rejects(s.accessToken(), /login needed/i);
  assert.equal(sent, 1, "the dead token went to DATEV once");
  assert.equal(store.read()?.tokens.refreshToken, undefined);
});

test("token calls are logged with the real request time and redacted request headers, also when DATEV times out", async () => {
  const { postToken } = await import("../../src/auth/token-client.js");
  const { tokenLog } = await import("../../src/setup/token-log.js");
  const logged: HttpLogEntry[] = [];
  const log = tokenLog((e) => logged.push(e));
  const slow: FetchLike = async () => (await new Promise((r) => setTimeout(r, 30)), new Response(JSON.stringify({ access_token: "AT", expires_in: 900 }), { headers: { "x-global-transaction-id": "g-2" } }));
  await postToken(ep.token, { grant_type: "refresh_token", refresh_token: "RT" }, creds, { fetch: slow, log });
  const e = logged[0]!;
  assert.ok(Date.parse(e.ts_response!) - Date.parse(e.ts_request) >= 25, "request and answer time differ");
  assert.equal(e.request_headers?.["content-type"], "application/x-www-form-urlencoded");
  assert.equal(e.request_headers?.authorization, undefined, "Basic credentials never logged");
  assert.equal(e.response_headers?.["x-global-transaction-id"], "g-2");
  const timeout: FetchLike = async () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
  await assert.rejects(postToken(ep.token, { grant_type: "refresh_token", refresh_token: "RT" }, creds, { fetch: timeout, log }));
  assert.equal(logged[1]?.error, "timed out", "a timeout is a line in the log too");
});

test("DATEV's help link survives list-shaped errors and error_uri, and the tool message ends with it", async () => {
  const { problemOf, problemFields } = await import("../../src/api/client.js");
  assert.equal(problemOf([{ title: "Invalid", type: "https://help.datev.de/x1" }]).help_url, "https://help.datev.de/x1");
  assert.equal(problemOf({ error: "invalid_request", error_uri: "https://developer.datev.de/err/2" }).help_url, "https://developer.datev.de/err/2");
  const f = problemFields(400, { title: "Bad", type: "https://help.datev.de/x3" }, "accounting-dxso-jobs.x");
  assert.ok(f.message.startsWith("DATEV returned HTTP 400 for accounting-dxso-jobs.x: "), f.message);
  assert.ok(f.message.endsWith("Help: https://help.datev.de/x3"), f.message);
});

test("request bodies are logged as DATEV's minimum scope asks: small inline, large retrievable on demand, uploads part by part", async () => {
  const { bodyFingerprint } = await import("../../src/api/http-log.js");
  const env = { DATEV_MCP_LOG_DIR: tmp() };
  assert.equal(bodyFingerprint('{"a":1}', env)?.text, '{"a":1}');
  const big = JSON.stringify({ rows: "x".repeat(20_000) });
  const rec = bodyFingerprint(big, env)!;
  assert.equal(rec.text, undefined);
  assert.equal(readFileSync(rec.stored_at!, "utf8"), big, "the full body can be retrieved");
  assert.equal(statSync(rec.stored_at!).mode & 0o777, 0o600);
  const form = new FormData();
  form.append("metadata", '{"document_type":"Rechnungseingang"}');
  form.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "rechnung.pdf");
  const parts = bodyFingerprint(form, env)!.parts!;
  assert.deepEqual(parts.map((p) => [p.name, p.filename, p.bytes]), [["metadata", undefined, 36], ["file", "rechnung.pdf", 8]]);
});

test("the HTTP log keeps method, full URL, transaction ids and timestamps, never tokens or secrets, and yields the 14-day error rate", () => {
  const dir = tmp();
  const env = { DATEV_MCP_LOG_DIR: dir };
  const req = redactHeaders({ authorization: "Bearer SECRET-TOKEN", "X-DATEV-Client-Secret": "S", "x-api-key": "K", "X-DATEV-Client-Id": "cid", accept: "application/json" });
  assert.deepEqual(Object.keys(req!).sort(), ["accept", "x-datev-client-id"]);
  const base = { ts_request: new Date().toISOString(), method: "GET", url: "https://x.api.datev.de/v1/clients?top=1", request_headers: req };
  writeHttpLog({ ...base, status: 200, response_headers: { "x-global-transaction-id": "g1", "v-cap-request-id": "v1" } }, env);
  writeHttpLog({ ...base, status: 404, response_body: '{"type":"http://www.datev.de/hilfe/1"}' }, env);
  writeHttpLog({ ...base, error: "fetch failed" }, env);
  const lines = readFileSync(join(dir, readdirSync(dir)[0]!), "utf8").trim().split("\n");
  assert.equal(lines.length, 3);
  assert.ok(!lines.join("").includes("SECRET"));
  assert.equal(JSON.parse(lines[0]!).response_headers["x-global-transaction-id"], "g1");
  assert.equal(statSync(join(dir, readdirSync(dir)[0]!)).mode & 0o777, 0o600);
  const r = errorRate(14, env);
  assert.deepEqual([r.requests, r.errors], [2, 1]);
});

test("login checks the ID token, saves the name and chosen services, and revokes the previous refresh token", async () => {
  const dir = tmp();
  const store = new TokenStore("sandbox", dir, envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "OLD", refreshToken: "OLD-RT", expiresAt: 0, obtainedAt: 0 } });
  const revoked: string[] = [];
  let nonce = "";
  const fake: FetchLike = async (u, init) => {
    const url = String(u);
    if (url === ep.jwks) return jwksFetch(u, init);
    if (url === ep.token)
      return new Response(JSON.stringify({ access_token: "NEW", refresh_token: "NEW-RT", expires_in: 900, id_token: idToken({ ...good, nonce }) }), { headers: { "content-type": "application/json" } });
    if (url === ep.userinfo) return new Response(JSON.stringify({ sub: "user-1", name: "Max Muster" }), { headers: { "content-type": "application/json" } });
    if (url === ep.revoke) return (revoked.push(String(init?.body)), new Response(null, { status: 200 }));
    throw new Error(`unexpected ${url}`);
  };
  const out: string[] = [];
  await login(cfg, {
    services: "accounting-extf-files",
    store,
    fetch: fake,
    httpLog: () => {},
    log: (s) => out.push(s),
    open: (authUrl) => {
      const u = new URL(authUrl);
      nonce = u.searchParams.get("nonce")!;
      void fetch(`${u.searchParams.get("redirect_uri")}?code=C&state=${u.searchParams.get("state")}`);
    },
  });
  const s = store.read()!;
  assert.equal(s.tokens.refreshToken, "NEW-RT");
  assert.equal(s.identity?.name, "Max Muster");
  assert.deepEqual(s.services, ["accounting-clients", "accounting-extf-files"]);
  assert.ok(s.scopes!.includes("datev:accounting:extf-files-import"));
  assert.ok(revoked.some((b) => b.includes("token=OLD-RT")), "only one valid refresh token at DATEV");
  assert.ok(out.some((l) => l.includes("Max Muster")));
  assert.ok(out.some((l) => l.startsWith("Added accounting:clients")), "the added client list service is named, never added silently (F35)");
  const { localize } = await import("../../src/i18n.js");
  for (const l of out) assert.notEqual(localize(l, "de"), l, `every login line has a German version (F15): ${l.slice(0, 60)}`);
});

test("a login without the full user name saves nothing and revokes the tokens DATEV just issued", async () => {
  const store = new TokenStore("sandbox", tmp(), envKeyStore());
  const revoked: string[] = [];
  let nonce = "";
  const fake: FetchLike = async (u, init) => {
    const url = String(u);
    if (url === ep.jwks) return jwksFetch(u, init);
    if (url === ep.token)
      return new Response(JSON.stringify({ access_token: "NEW", refresh_token: "NEW-RT", expires_in: 900, id_token: idToken({ ...good, nonce }) }), { headers: { "content-type": "application/json" } });
    if (url === ep.userinfo) return new Response(JSON.stringify({ sub: "user-1", preferred_username: "mmuster" }), { headers: { "content-type": "application/json" } });
    if (url === ep.revoke) return (revoked.push(new URLSearchParams(String(init?.body)).get("token")!), new Response(null, { status: 200 }));
    throw new Error(`unexpected ${url}`);
  };
  await assert.rejects(
    login(cfg, {
      services: "accounting-extf-files",
      store,
      fetch: fake,
      httpLog: () => {},
      log: () => {},
      open: (authUrl) => {
        const u = new URL(authUrl);
        nonce = u.searchParams.get("nonce")!;
        void fetch(`${u.searchParams.get("redirect_uri")}?code=C&state=${u.searchParams.get("state")}`);
      },
    }),
    /no full name/,
  );
  assert.equal(store.read(), undefined, "nothing saved");
  assert.deepEqual(revoked.sort(), ["NEW", "NEW-RT"], "both new tokens revoked");
});

test("the status is ACTIVE only for a valid userinfo answer about the same person, with the real validity", async () => {
  const store = new TokenStore("sandbox", tmp(), envKeyStore());
  const save = (refreshToken?: string) =>
    store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", ...(refreshToken ? { refreshToken } : {}), expiresAt: Date.UTC(2026, 10, 9, 20, 15), obtainedAt: Date.now() }, identity: { sub: "u1", name: "Erika" }, refreshExpiresAt: Date.UTC(2026, 10, 10, 6, 0) });
  const reply = (body: string, type = "application/json"): FetchLike => async () => new Response(body, { headers: { "content-type": type } });
  const at = () => Date.UTC(2026, 10, 9, 20, 0);
  save("RT");
  assert.equal((await connectionStatus(cfg, { store, fetch: reply("<html>login</html>", "text/html"), httpLog: () => {}, now: at })).connected, false, "an HTML page is no answer");
  const other = await connectionStatus(cfg, { store, fetch: reply(JSON.stringify({ sub: "someone-else", name: "Mallory" })), httpLog: () => {}, now: at });
  assert.equal(other.connected, false);
  assert.notEqual(other.user, "Mallory", "never shows another person's name");
  save();
  const short = await connectionStatus(cfg, { store, fetch: reply(JSON.stringify({ sub: "u1", name: "Erika" })), httpLog: () => {}, now: at });
  assert.equal(short.refresh_valid_until, "09.11.2026 21:15", "without a refresh token the access token's end is the connection's end");
});

test("every DATEV error answer keeps its help link, title, detail and request id, as DATEV requires for 4xx", async () => {
  const { problemOf, problemText } = await import("../../src/api/client.js");
  const datev403 = { type: "http://www.datev.de/hilfe/1008829", title: "Missing required scope", detail: "Missing scope(s) are: datev:accounting:clients", request_id: "f11381c7", status: 403 };
  assert.deepEqual(problemOf(datev403), { title: "Missing required scope", detail: "Missing scope(s) are: datev:accounting:clients", help_url: "http://www.datev.de/hilfe/1008829", request_id: "f11381c7" });
  const long = { ...datev403, detail: "x".repeat(2000) };
  assert.match(problemText(403, long), /Help: http:\/\/www\.datev\.de\/hilfe\/1008829/, "the link survives a long detail");
  assert.equal(problemOf({ errors: [{ title: "t", type: "https://apps.datev.de/help/42" }] }).help_url, "https://apps.datev.de/help/42");
  assert.equal(problemOf("see https://www.datev.de/hilfe/77 for help").help_url, "https://www.datev.de/hilfe/77");
  assert.deepEqual(problemOf([]), {});
});

test("in production a write needs the person's approval in the client; the assistant's confirm code alone is not enough", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { ElicitRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
  const { registerGenericTools } = await import("../../src/tools/generic.js");
  const run = async (answer: "approve" | "decline" | "none") => {
    let sent = 0;
    const server = new McpServer({ name: "t", version: "0" });
    registerGenericTools(server, () => ({ env: "production" as const, creds, token: async () => "T", fetch: async (_u, init) => ((init?.method ?? "GET") !== "GET" && sent++, new Response("{}", { status: 201 })), cooldowns: new Map() }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const c = new Client({ name: "t", version: "0" }, { capabilities: answer === "none" ? {} : { elicitation: { form: {} } } });
    let asked = "";
    if (answer !== "none")
      c.setRequestHandler(ElicitRequestSchema, async (req) => ((asked = String(req.params.message)), answer === "approve" ? { action: "accept", content: { approve: true } } : { action: "decline" }));
    await c.connect(b);
    const args = { operation_id: "accounting-dxso-jobs.post_clients_client_id_dxso_jobs", path_params: { "client-id": "455148-1" }, body: { job_type: "x" } };
    const prev = JSON.parse(((await c.callTool({ name: "datev_call", arguments: args })) as { content: { text: string }[] }).content[0]!.text);
    const r = (await c.callTool({ name: "datev_call", arguments: { ...args, confirm: true, confirm_token: prev.confirm_token } })) as { isError?: boolean; content: { text: string }[] };
    return { sent, asked, r };
  };
  const yes = await run("approve");
  assert.equal(yes.sent, 1);
  assert.match(yes.asked, /POST accounting-dxso-jobs\.post_clients_client_id_dxso_jobs/, "the person sees what will be sent");
  const no = await run("decline");
  assert.equal(no.sent, 0);
  assert.match(no.r.content[0]!.text, /did not approve/);
  const blind = await run("none");
  assert.equal(blind.sent, 0, "without a way to ask the person, production writes are refused");
  assert.match(blind.r.content[0]!.text, /cannot ask you/);
});

test("property over all 209 operations: no DATEV wording leaves the server, every field name and constraint does", async () => {
  const { OPERATIONS, describe, summarize, structureOnly } = await import("../../src/tools/catalog.js");
  const prose = (v: unknown, acc: string[] = []): string[] => {
    if (Array.isArray(v)) v.forEach((x) => prose(x, acc));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (["description", "summary"].includes(k) && typeof x === "string" && x.trim().length > 25) acc.push(x.trim());
        else if (k !== "properties") prose(x, acc);
        else for (const field of Object.values(x as object)) prose(field, acc);
      }
    return acc;
  };
  const names = (v: unknown, acc = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach((x) => names(x, acc));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (k === "properties" && x && typeof x === "object") Object.keys(x).forEach((n) => acc.add(n));
        names(x, acc);
      }
    return acc;
  };
  let checked = 0;
  for (const op of OPERATIONS) {
    const out = JSON.stringify([summarize(op), describe(op, 10_000_000)]);
    for (const p of [op.summary, op.description, ...prose(op.params), ...prose(op.body?.schema)].filter((s): s is string => !!s && s.length > 25)) {
      assert.ok(!out.includes(JSON.stringify(p).slice(1, -1)), `${op.id} leaks DATEV text: ${p.slice(0, 60)}`);
      checked++;
    }
    const kept = names(structureOnly(op.body?.schema));
    for (const n of names(op.body?.schema)) assert.ok(kept.has(n), `${op.id} lost field ${n}`);
  }
  assert.ok(checked > 200, `checked ${checked} DATEV texts`);
  assert.deepEqual(structureOnly({ properties: { description: { maxLength: 9 } }, description: "x" }), { properties: { description: { maxLength: 9 } } });
});
