import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { buildUrl, callOperation, CallError, MAX_ATTEMPTS, type CallDeps } from "../../src/api/client.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import type { Operation } from "../../src/spec/types.js";
import { needsClientSecretHeader } from "../../src/spec/build.js";
import { getOperation, searchOperations, OPERATIONS } from "../../src/tools/catalog.js";

const op = (o: Partial<Operation>): Operation => ({
  id: "demo.op",
  product: "demo",
  api: "demo",
  method: "get",
  path: "/clients/{client-id}",
  summary: "",
  write: false,
  health: false,
  scopes: [],
  clientSecretHeader: false,
  params: [{ name: "client-id", in: "path", required: true }],
  servers: { production: "https://x.api.datev.de/platform/v2", sandbox: "https://x.api.datev.de/platform-sandbox/v2" },
  ...o,
});

const deps = (f: FetchLike, extra: Partial<CallDeps> = {}): CallDeps => ({
  env: "sandbox",
  creds: { clientId: "cid", clientSecret: "SECRET" },
  token: async () => "TOKEN",
  fetch: f,
  sleep: async () => undefined,
  ...extra,
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("builds the sandbox URL with an encoded path parameter and query", () => {
  const u = buildUrl(op({ params: [{ name: "client-id", in: "path", required: true }] }), "sandbox", { pathParams: { "client-id": "455148-1" }, query: { top: 5, tags: ["a", "b"] } });
  assert.equal(u.toString(), "https://x.api.datev.de/platform-sandbox/v2/clients/455148-1?top=5&tags=a&tags=b");
});

test("property: no path parameter value can escape the operation's server path", () => {
  fc.assert(
    fc.property(fc.string(), (v) => {
      try {
        const u = buildUrl(op({}), "sandbox", { pathParams: { "client-id": v } });
        assert.equal(u.origin, "https://x.api.datev.de");
        assert.ok(u.pathname.startsWith("/platform-sandbox/v2/clients/"));
      } catch (e) {
        assert.ok(e instanceof CallError);
      }
    }),
    { numRuns: 1000 },
  );
  assert.throws(() => buildUrl(op({}), "sandbox", { pathParams: { "client-id": ".." } }), CallError);
  assert.throws(() => buildUrl(op({}), "sandbox", { pathParams: { "client-id": "a/../../evil" } }), CallError);
});

test("rejects missing required path and query parameters", () => {
  assert.throws(() => buildUrl(op({}), "sandbox", {}), /Missing path parameter/);
  const o = op({ path: "/x", params: [{ name: "year", in: "query", required: true }] });
  assert.throws(() => buildUrl(o, "sandbox", {}), /Missing required query parameter "year"/);
});

test("sends Bearer token and client id, and the secret header only when the spec asks for it", async () => {
  const seen: Record<string, string>[] = [];
  const f: FetchLike = async (_u, init) => (seen.push(init?.headers as Record<string, string>), json(200, []));
  await callOperation(op({}), { pathParams: { "client-id": "1" } }, deps(f));
  await callOperation(op({ clientSecretHeader: true }), { pathParams: { "client-id": "1" } }, deps(f));
  assert.equal(seen[0].authorization, "Bearer TOKEN");
  assert.equal(seen[0]["X-DATEV-Client-Id"], "cid");
  assert.equal(seen[0]["X-DATEV-Client-Secret"], undefined);
  assert.equal(seen[1]["X-DATEV-Client-Secret"], "SECRET");
});

test("chaos: a read retries 503 and network errors, then succeeds", async () => {
  let n = 0;
  const f: FetchLike = async () => {
    n++;
    if (n === 1) throw new TypeError("fetch failed");
    if (n === 2) return json(503, {});
    return json(200, [{ id: 1 }]);
  };
  const r = await callOperation(op({}), { pathParams: { "client-id": "1" } }, deps(f));
  assert.equal(r.status, 200);
  assert.equal(r.attempts, 3);
  assert.deepEqual(r.body, [{ id: 1 }]);
});

test("chaos: a read gives up after MAX_ATTEMPTS and returns the last error status", async () => {
  let n = 0;
  const r = await callOperation(op({}), { pathParams: { "client-id": "1" } }, deps(async () => (n++, json(503, { error: "busy" }))));
  assert.equal(n, MAX_ATTEMPTS);
  assert.equal(r.status, 503);
});

test("chaos: a write is never retried, even on 503 or a dropped connection", async () => {
  let n = 0;
  const w = op({ method: "post", write: true, path: "/x", params: [], body: { required: true, contentTypes: ["application/json"] } });
  const r = await callOperation(w, { body: { a: 1 } }, deps(async () => (n++, json(503, {}))));
  assert.equal(n, 1);
  assert.equal(r.status, 503);
  n = 0;
  await assert.rejects(callOperation(w, { body: { a: 1 } }, deps(async () => (n++, Promise.reject(new TypeError("reset"))))), CallError);
  assert.equal(n, 1);
});

test("refuses file uploads and missing bodies in the generic call", async () => {
  const up = op({ method: "post", write: true, path: "/x", params: [], body: { required: true, contentTypes: ["multipart/form-data"] } });
  await assert.rejects(callOperation(up, { body: "x" }, deps(async () => json(200, {}))), /file upload/);
  await assert.rejects(callOperation(up, {}, deps(async () => json(200, {}))), /requires a request body/);
});

test("truncates oversized responses instead of flooding the model context", async () => {
  const r = await callOperation(op({}), { pathParams: { "client-id": "1" } }, deps(async () => new Response("x".repeat(500), { status: 200 }), { maxBodyChars: 100 }));
  assert.equal(r.truncated, true);
  assert.equal(String(r.body).length, 100);
});

test("detects which security alternative needs the client secret header", () => {
  const doc = {
    components: {
      securitySchemes: {
        cid: { type: "apiKey", name: "X-Datev-Client-ID" },
        sec: { type: "apiKey", name: "X-Datev-Client-Secret" },
        oauth: { type: "oauth2" },
      },
    },
  };
  assert.equal(needsClientSecretHeader([{ cid: [], sec: [], oauth: [] }], doc), true);
  assert.equal(needsClientSecretHeader([{ cid: [], sec: [] }, { cid: [], oauth: [] }], doc), false);
  assert.equal(needsClientSecretHeader(undefined, doc), false);
});

test("catalog search finds the clients list and hides health checks by default", () => {
  const hits = searchOperations("list clients", { product: "accounting-clients" });
  assert.ok(hits.some((o) => o.path === "/clients" && o.method === "get"));
  assert.ok(searchOperations("health").every((o) => !o.health));
  assert.ok(searchOperations("health", { includeHealth: true }).some((o) => o.health));
  assert.equal(getOperation("does.not.exist"), undefined);
  assert.ok(OPERATIONS.some((o) => o.clientSecretHeader), "smarttransfer and master-data need the secret header");
});

test("chaos: a write retries a 429, because DATEV refused it and cannot have applied it", async () => {
  let n = 0;
  const w = op({ method: "post", write: true, path: "/x", params: [], body: { required: true, contentTypes: ["application/json"] } });
  const r = await callOperation(w, { body: { a: 1 } }, deps(async () => (++n < 3 ? json(429, {}, { "retry-after": "0" }) : json(201, { ok: true }))));
  assert.equal(n, 3);
  assert.equal(r.status, 201);
});

test("never follows redirects, so the client secret header cannot reach another host", async () => {
  let seen: RequestInit | undefined;
  const r = await callOperation(op({ clientSecretHeader: true }), { pathParams: { "client-id": "1" } }, deps(async (_u, init) => ((seen = init), new Response(null, { status: 302, headers: { location: "https://evil.example/" } }))));
  assert.equal(seen?.redirect, "manual");
  assert.equal(r.status, 302);
  assert.equal(r.location, "https://evil.example/");
});

test("checks path values against the spec schema before any request is sent", () => {
  const client = op({ params: [{ name: "client-id", in: "path", required: true, schema: { type: "string", pattern: "^(?<consultant>[1-9]\\d{3,6})-(?<client>[1-9]\\d{0,4})$", maxLength: 13 } }] });
  assert.match(buildUrl(client, "sandbox", { pathParams: { "client-id": "455148-1" } }).pathname, /455148-1$/);
  assert.throws(() => buildUrl(client, "sandbox", { pathParams: { "client-id": "455148" } }), /does not match/);
  const fy = op({ path: "/fy/{y}", params: [{ name: "y", in: "path", required: true, schema: { type: "integer", minimum: 19920101, maximum: 20991231 } }] });
  assert.throws(() => buildUrl(fy, "sandbox", { pathParams: { y: "2023" } }), /at least 19920101/);
  assert.throws(() => buildUrl(fy, "sandbox", { pathParams: { y: "abc" } }), /whole number/);
  const tq = op({ path: "/t/{t}", params: [{ name: "t", in: "path", required: true, schema: { type: "string", minLength: 13, maxLength: 15 } }] });
  assert.throws(() => buildUrl(tq, "sandbox", { pathParams: { t: "short" } }), /at least 13/);
});

test("two parameters in one segment cannot be made ambiguous by a separator inside a value", () => {
  const eau = op({ path: "/clients/{c}-{m}", params: [{ name: "c", in: "path", required: true }, { name: "m", in: "path", required: true }] });
  assert.match(buildUrl(eau, "sandbox", { pathParams: { c: "455148", m: "1" } }).pathname, /\/clients\/455148-1$/);
  assert.throws(() => buildUrl(eau, "sandbox", { pathParams: { c: "1-2", m: "3" } }), /must not contain "-"/);
});
