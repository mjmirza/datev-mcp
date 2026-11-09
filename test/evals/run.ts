// Offline eval: scenarios generated from the spec index, each run against a simulated DATEV server.
// Writes test/reports/eval-<time>.json and .md, exits 1 on any failure. Usage: npm run eval
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { decodeBytes, encodeCp1252, validateExtf, writeBuchungsstapel, type BatchRow } from "@seamless-engineering/datev-extf";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildHeaders, buildUrl, callOperation, CallError, checkAgainstSchema, mediaMatches, parseJsonOrLines, type CallDeps, type CallInput } from "../../src/api/client.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import type { Operation } from "../../src/spec/types.js";
import { OPERATIONS, searchOperations } from "../../src/tools/catalog.js";
import { registerGenericTools } from "../../src/tools/generic.js";
import { registerUploadTools } from "../../src/tools/upload.js";
import { matchAccounts, type LedgerAccount } from "../../src/tools/accounts.js";
import { fiscalYearIds, jobPhase } from "../../src/tools/accounting.js";

interface Result { category: string; op: string; pass: boolean; detail?: string }
const results: Result[] = [];
const pending: Promise<void>[] = [];
const record = (category: string, op: string, pass: boolean, detail?: string) => void results.push({ category, op, pass, detail });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Scenarios are independent (each has its own mock), so they run concurrently and are awaited together at the end.
function expectThrow(category: string, op: string, fn: () => unknown, pattern?: RegExp, after?: () => void) {
  const run = (async () => fn())().then(
    () => record(category, op, false, "expected a CallError, got success"),
    (e) => {
      const ok = e instanceof CallError && (!pattern || pattern.test(e.message));
      record(category, op, ok, ok ? undefined : `wrong error: ${msg(e)}`);
    },
  );
  pending.push(after ? run.then(after) : run);
}
function expectOk(category: string, op: string, fn: () => unknown, check?: (v: unknown) => string | undefined) {
  pending.push(
    (async () => fn())().then(
      (v) => {
        const why = check?.(v);
        record(category, op, !why, why);
      },
      (e) => record(category, op, false, `unexpected throw: ${msg(e)}`),
    ),
  );
}

const pathNames = (op: Operation) => [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const sampleHeader = (name: string) => (/filename/i.test(name) ? "EXTF_eval.csv" : "eval-1");

const SAMPLE_CANDIDATES = ["455148-1", "abc123", "1", "20230101", "A1", "3f2504e0-4f89-41d3-9a0c-0305e82c3301", "1234567890123", "EXTF_eval.csv"];
const paramSchema = (op: Operation, name: string) => op.params.find((p) => p.in === "path" && p.name === name)?.schema as
  | { type?: string; minimum?: number; pattern?: string; format?: string; maxLength?: number }
  | undefined;
const isConstrained = (op: Operation, name: string) => {
  const s = paramSchema(op, name);
  return !!s && (s.type === "integer" || !!s.pattern || s.format === "uuid" || s.maxLength !== undefined || (s as { minLength?: number }).minLength !== undefined);
};
const sharesSegment = (op: Operation, name: string) => (op.path.split("/").find((s) => s.includes(`{${name}}`))?.match(/\{/g) ?? []).length > 1;

// A value that satisfies the parameter's spec schema, so a valid call is actually valid.
function sampleFor(op: Operation, name: string): string {
  const s = paramSchema(op, name);
  if (s?.type === "integer") return String(s.minimum ?? 1);
  const pick = SAMPLE_CANDIDATES.find((c) => {
    try {
      checkAgainstSchema(name, c, s);
      return !sharesSegment(op, name) || !c.includes("-");
    } catch {
      return false;
    }
  });
  return pick ?? "abc123";
}

const isServerHeader = (name: string) => name.toLowerCase() === "x-api-key";

function validInput(op: Operation): CallInput {
  const pathParams = Object.fromEntries(pathNames(op).map((n) => [n, sampleFor(op, n)]));
  const query = Object.fromEntries(op.params.filter((p) => p.in === "query" && p.required).map((p) => [p.name, "1"]));
  // X-API-Key comes from the server's configuration, never from the caller.
  const headers = Object.fromEntries(op.params.filter((p) => p.in === "header" && p.required && !isServerHeader(p.name)).map((p) => [p.name, sampleHeader(p.name)]));
  const input: CallInput = { pathParams, query, headers };
  if (op.body?.required) {
    const ct = op.body.contentTypes[0] ?? "application/json";
    if (/multipart/i.test(ct)) input.rawBody = new FormData();
    else if (/octet-stream/i.test(ct)) input.rawBody = new Uint8Array([1, 2, 3]);
    else if (/json/i.test(ct)) input.body = {};
    else input.body = "<x/>";
  }
  return input;
}

function mockDeps(respond: (n: number) => Response, extra: Partial<CallDeps> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (u, init) => {
    calls.push({ url: String(u), init });
    return respond(calls.length);
  };
  const deps: CallDeps = {
    env: "sandbox",
    creds: { clientId: "cid", clientSecret: "SECRET" },
    token: async () => "TOK",
    fetch,
    sleep: async () => {},
    serviceKeys: { "x-api-key": "SERVICEKEY" },
    cooldowns: new Map(),
    ...extra,
  };
  return { deps, calls };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const TRAVERSAL = [".", "..", "", "a/b", "a\\b", "../../etc", "/"];
const ODD_VALUES = ["ä ö ü ß", "x?y", "x#y", "%2F", "😀", "١٢٣", "a b", "x;y=z", "<script>", "'OR 1=1--", "x&y", "‮evil"];
const RESERVED = ["Authorization", "authorization", "X-DATEV-Client-Id", "x-datev-client-secret", "Host", "Cookie", "Content-Length"];
const ERROR_STATUSES = [400, 401, 403, 404, 405, 406, 409, 415, 422, 500];
const BODIES: [string, () => Response, (b: unknown) => boolean][] = [
  ["json-object", () => json(200, { a: 1 }), (b) => (b as { a: number }).a === 1],
  ["json-array", () => json(200, [1, 2]), (b) => Array.isArray(b) && b.length === 2],
  ["ndjson-one", () => new Response("20230701\n", { headers: { "content-type": "application/x-ndjson" } }), (b) => Array.isArray(b) && b[0] === 20230701],
  ["ndjson-many", () => new Response('{"a":1}\n\n{"a":2}\r\n', { headers: { "content-type": "application/x-ndjson" } }), (b) => Array.isArray(b) && b.length === 2],
  ["lines-as-json", () => new Response('{"a":1}\n{"a":2}', { headers: { "content-type": "application/json" } }), (b) => Array.isArray(b) && b.length === 2],
  ["invalid-json", () => new Response("{nope", { headers: { "content-type": "application/json" } }), (b) => b === "{nope"],
  ["text", () => new Response("plain", { headers: { "content-type": "text/plain" } }), (b) => b === "plain"],
  ["empty", () => new Response("", { headers: { "content-type": "application/json" } }), (b) => b === ""],
  ["umlauts", () => json(200, { name: "Müller & Söhne GmbH" }), (b) => (b as { name: string }).name === "Müller & Söhne GmbH"],
];

function perOperation(op: Operation) {
  const id = op.id;
  const base = op.servers.sandbox;
  const good = validInput(op);
  const withPath = (name: string, v: string) => ({ ...good, pathParams: { ...good.pathParams, [name]: v } });

  for (const env of ["sandbox", "production"] as const) {
    const server = env === "sandbox" ? op.servers.sandbox : op.servers.production;
    if (!server) expectThrow(`url.${env}-no-server`, id, () => buildUrl(op, env, good), /no .* server/);
    else
      expectOk(`url.${env}-pinned`, id, () => buildUrl(op, env, good), (v) => {
        const u = v as URL;
        const b = new URL(server);
        if (u.origin !== b.origin) return `origin ${u.origin}`;
        if (u.pathname.includes("{")) return "unresolved placeholder";
        return u.pathname.startsWith(b.pathname.replace(/\/$/, "")) ? undefined : `path ${u.pathname}`;
      });
  }
  if (!base) return;
  const baseSearch = buildUrl(op, "sandbox", good).search;

  for (const name of pathNames(op)) {
    TRAVERSAL.forEach((bad) => expectThrow("path.traversal", id, () => buildUrl(op, "sandbox", withPath(name, bad))));
    if (isConstrained(op, name)) {
      ODD_VALUES.forEach((odd) => expectThrow("path.schema-rejects", id, () => buildUrl(op, "sandbox", withPath(name, odd)), /must|does not match/));
    } else {
      const shared = sharesSegment(op, name);
      ODD_VALUES.filter((odd) => shared && odd.includes("-")).forEach((odd) => expectThrow("path.segment-ambiguity", id, () => buildUrl(op, "sandbox", withPath(name, odd)), /must not contain/));
      ODD_VALUES.filter((odd) => !(shared && odd.includes("-"))).forEach((odd) =>
        expectOk("path.encoding", id, () => buildUrl(op, "sandbox", withPath(name, odd)), (v) => {
          const u = v as URL;
          if (u.search !== baseSearch || u.hash) return `value leaked into query or hash: ${u.href}`;
          if (u.origin !== new URL(base).origin) return "origin changed";
          return u.pathname.includes(encodeURIComponent(odd)) ? undefined : "value not round-tripped";
        }),
      );
    }
    if (sharesSegment(op, name)) expectThrow("path.segment-ambiguity", id, () => buildUrl(op, "sandbox", withPath(name, "1-2")), /must not contain/);
    const without = { ...good.pathParams };
    delete without[name];
    expectThrow("path.missing", id, () => buildUrl(op, "sandbox", { ...good, pathParams: without }), /Missing path parameter/);
  }

  for (const p of op.params.filter((x) => x.in === "query" && x.required)) {
    const q = { ...good.query };
    delete q[p.name];
    expectThrow("query.missing-required", id, () => buildUrl(op, "sandbox", { ...good, query: q }), /required query/);
  }
  expectOk("query.array", id, () => buildUrl(op, "sandbox", { ...good, query: { ...good.query, evalArr: ["a", "b"] } }), (v) =>
    (v as URL).searchParams.getAll("evalArr").join() === "a,b" ? undefined : "array not appended",
  );
  expectOk("query.injection", id, () => buildUrl(op, "sandbox", { ...good, query: { ...good.query, q: "a&b=c#d" } }), (v) =>
    (v as URL).searchParams.get("q") === "a&b=c#d" && !(v as URL).searchParams.has("b") ? undefined : "query value split",
  );

  for (const p of op.params.filter((x) => x.in === "header" && x.required && !isServerHeader(x.name))) {
    const h = { ...good.headers };
    delete h[p.name];
    expectThrow("header.missing-required", id, () => buildHeaders(op, { ...good, headers: h }), /required header/);
  }
  if (op.params.some((p) => p.in === "header" && isServerHeader(p.name))) {
    expectThrow("header.service-key-from-caller", id, () => buildHeaders(op, { ...good, headers: { ...good.headers, "X-API-Key": "stolen" } }), /set by the server/);
    expectThrow("header.service-key-missing", id, () => callOperation(op, good, mockDeps(() => json(200, {}), { serviceKeys: {} }).deps), /never passed through the assistant/);
  }
  RESERVED.forEach((r) => expectThrow("header.reserved", id, () => buildHeaders(op, { ...good, headers: { ...good.headers, [r]: "x" } }), /cannot be overridden/));
  ["a\r\nX-Evil: 1", "a\nb", "a\rb"].forEach((crlf) => expectThrow("header.crlf", id, () => buildHeaders(op, { ...good, headers: { ...good.headers, "X-Eval": crlf } }), /line break/));

  {
    const { deps, calls } = mockDeps(() => json(200, { ok: true }));
    expectOk("auth.headers", id, () => callOperation(op, good, deps), () => {
      const h = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
      if (h.authorization !== "Bearer TOK") return "missing bearer";
      if (h["X-DATEV-Client-Id"] !== "cid") return "missing client id";
      if (op.clientSecretHeader !== (h["X-DATEV-Client-Secret"] === "SECRET")) return "client secret header mismatch";
      if (calls[0].init?.redirect !== "manual") return "redirects followed automatically, credentials could leave the DATEV host";
      const wantsKey = op.params.some((p) => p.in === "header" && isServerHeader(p.name));
      if (wantsKey !== (h["X-API-Key"] === "SERVICEKEY")) return "the service key is missing, or sent where the spec has no such header";
      return calls[0].init?.method === op.method.toUpperCase() ? undefined : "wrong method";
    });
  }

  {
    // What actually leaves the machine: the exact URL, body bytes and content type, and no secret in the URL.
    const want = buildUrl(op, "sandbox", good).toString();
    const marker = { evalMarker: "äé😀 & <x>" };
    const ct = op.body?.contentTypes[0] ?? "";
    const input = op.body && /json/i.test(ct) ? { ...good, body: marker } : op.body && /octet/i.test(ct) ? { ...good, rawBody: new Uint8Array([0, 255, 128, 10]) } : good;
    const { deps, calls } = mockDeps(() => json(200, {}));
    expectOk("wire.request", id, () => callOperation(op, input, deps), () => {
      const c = calls[0];
      if (!c || calls.length !== 1) return `calls ${calls.length}`;
      if (c.url !== want) return `fetched ${c.url}, built ${want}`;
      if (/SECRET|TOK/.test(c.url)) return "credential in the URL";
      const h = (c.init?.headers ?? {}) as Record<string, string>;
      if (!Object.entries(h).some(([k, v]) => k.toLowerCase() === "accept" && String(v).trim() !== "")) return "no accept header"; // names are case-insensitive, the value must not be empty
      if (input.body === marker) {
        if (c.init?.body !== JSON.stringify(marker)) return "JSON body changed on the wire";
        if (h["content-type"] !== ct) return `content type ${h["content-type"]}, spec ${ct}`;
      } else if (input.rawBody instanceof Uint8Array) {
        const sent = c.init?.body as Uint8Array;
        if (!(sent instanceof Uint8Array) || [...sent].join() !== "0,255,128,10") return "file bytes changed on the wire";
      } else if (input.rawBody instanceof FormData) {
        if (h["content-type"]) return "multipart content type set by hand, the boundary would be lost";
      } else if (c.init?.body !== undefined) return "a body was sent that nobody asked for";
      return undefined;
    });
  }
  {
    const raw = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x0a]);
    expectOk("binary.byte-exact", id, () => callOperation(op, good, mockDeps(() => new Response(raw, { headers: { "content-type": "application/pdf" } })).deps), (v) => {
      const r = v as { bytes?: Uint8Array };
      return r.bytes && [...r.bytes].join() === [...raw].join() ? undefined : "binary answer altered";
    });
  }
  {
    const endless = () => new Response(new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(4096).fill(120)) }), { headers: { "content-type": "text/plain" } });
    expectOk("cap.endless-stream", id, () => callOperation(op, good, mockDeps(endless, { maxBodyChars: 50 }).deps), (v) => {
      const r = v as { truncated: boolean; body: string };
      return r.truncated && r.body.length === 50 ? undefined : "endless answer not capped";
    });
  }
  {
    const gone = new AbortController();
    gone.abort();
    const { deps, calls } = mockDeps(() => json(200, {}), { signal: gone.signal });
    expectThrow("cancel.never-sent", id, () => callOperation(op, good, deps), /cancelled/, () => record("cancel.no-request", id, calls.length === 0, `calls ${calls.length}`));
  }
  {
    // The asked wait (600 s) cannot fit a 30 s budget, so no retry; 30 s is too long for a slow runner to burn.
    const { deps, calls } = mockDeps(() => json(503, {}, { "retry-after": "600" }), { deadlineMs: 30_000 });
    expectOk("deadline.no-retry-past-budget", id, () => callOperation(op, good, deps), () => (calls.length === 1 ? undefined : `calls ${calls.length}`));
  }

  [429, 502, 503, 504].forEach((status) => {
    const { deps, calls } = mockDeps((n) => (n < 3 ? json(status, {}, status === 429 ? { "retry-after": "0" } : {}) : json(200, [])));
    expectOk(`retry.${status}`, id, () => callOperation(op, good, deps), (v) => {
      const r = v as { status: number };
      if (op.method === "get") return r.status === 200 && calls.length === 3 ? undefined : `status ${r.status}, calls ${calls.length}`;
      return r.status === status && calls.length === 1 ? undefined : `write retried (${calls.length} calls)`;
    });
  });
  {
    const { deps, calls } = mockDeps(() => json(503, {}));
    expectOk("retry.exhausted", id, () => callOperation(op, good, deps), (v) =>
      (v as { status: number }).status === 503 && calls.length === (op.method === "get" ? 3 : 1) ? undefined : `calls ${calls.length}`,
    );
  }
  {
    let n = 0;
    const failing: FetchLike = async () => {
      n++;
      throw new TypeError("fetch failed");
    };
    const expected = op.method === "get" ? 3 : 1;
    expectThrow("network.error", id, () => callOperation(op, good, mockDeps(() => json(200, {}), { fetch: failing }).deps), /did not answer/, () =>
      record("network.attempts", id, n === expected, `attempts ${n}, expected ${expected}`),
    );
  }
  ERROR_STATUSES.forEach((status) => {
    const { deps, calls } = mockDeps(() => json(status, { error: "e" }));
    expectOk(`status.${status}`, id, () => callOperation(op, good, deps), (v) =>
      (v as { status: number }).status === status && calls.length === 1 ? undefined : `status or call count wrong (${calls.length})`,
    );
  });

  BODIES.forEach(([name, mk, ok]) =>
    expectOk(`parse.${name}`, id, () => callOperation(op, good, mockDeps(mk).deps), (v) => (ok((v as { body: unknown }).body) ? undefined : `body ${JSON.stringify((v as { body: unknown }).body)}`)),
  );
  expectOk("parse.truncated", id, () => callOperation(op, good, mockDeps(() => json(200, "x".repeat(5000)), { maxBodyChars: 100 }).deps), (v) => {
    const r = v as { truncated: boolean; body: string };
    return r.truncated && r.body.length === 100 ? undefined : "not truncated";
  });

  const noFetch = () => mockDeps(() => json(200, {})).deps;
  if (op.body?.required) expectThrow("body.required-missing", id, () => callOperation(op, { ...good, body: undefined, rawBody: undefined }, noFetch()), /requires a request body/);
  if (!op.body) expectThrow("body.unexpected", id, () => callOperation(op, { ...good, body: { x: 1 } }, noFetch()), /does not take a request body/);
  if (op.body && /multipart|octet/i.test(op.body.contentTypes[0] ?? ""))
    expectThrow("body.file-as-json", id, () => callOperation(op, { ...good, rawBody: undefined, body: { x: 1 } }, noFetch()), /file upload/);

  const hits = searchOperations(op.summary || op.id, { limit: 50, includeHealth: true });
  record("search.recall-top50", id, hits.some((h) => h.id === id), "own summary did not find it");
}

async function writeConfirmGate() {
  const server = new McpServer({ name: "eval", version: "0" });
  let sent = 0;
  const fetch: FetchLike = async () => (sent++, json(200, {}));
  registerGenericTools(server, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch, sleep: async () => {} }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "eval", version: "0" });
  await c.connect(b);
  const writes = OPERATIONS.filter((o) => o.write && o.servers.sandbox);
  const replies = await Promise.all(
    writes.map((op) => {
      const g = validInput(op);
      return c.callTool({ name: "datev_call", arguments: { operation_id: op.id, path_params: g.pathParams, query: g.query, headers: g.headers } }) as Promise<{ content: { text: string }[] }>;
    }),
  );
  replies.forEach((r, i) => {
    const t = r.content[0].text;
    record("write.preview-no-send", writes[i].id, sent === 0 && t.includes('"preview": true'), sent ? `${sent} requests reached the network` : t.slice(0, 120));
  });
}

// Every multipart operation: the preview sends nothing, and the confirmed call sends each part in spec order with exact bytes.
type PartSchema = { type?: string; format?: string; enum?: string[]; required?: string[]; properties?: Record<string, PartSchema>; items?: { format?: string }; allOf?: PartSchema[] };
const flatPart = (s: PartSchema = {}): PartSchema =>
  s.allOf ? s.allOf.map(flatPart).reduce((a, b) => ({ ...a, ...b, required: [...(a.required ?? []), ...(b.required ?? [])], properties: { ...a.properties, ...b.properties } }), { ...s, allOf: undefined }) : s;
const sampleValue = (s: PartSchema): unknown =>
  s.type === "object" || s.properties
    ? Object.fromEntries((s.required ?? []).map((k) => [k, sampleValue(flatPart(s.properties?.[k]))]))
    : (s.enum?.[0] ?? "eval");

async function uploadShapes() {
  const dir = mkdtempSync(join(tmpdir(), "datev-eval-up-"));
  const fixture = (ext: string, n: number) => {
    const p = join(dir, `eval-${n}.${ext}`);
    writeFileSync(p, `eval file ${n} ${ext}`);
    return p;
  };
  const ops = OPERATIONS.filter((o) => o.body?.contentTypes.some((t) => /^multipart\/form-data/i.test(t)));
  for (const op of ops) {
    const env = op.servers.sandbox ? "sandbox" : "production";
    const calls: { body: unknown }[] = [];
    const fetch: FetchLike = async (_u, init) => (calls.push({ body: init?.body }), json(201, {}));
    const server = new McpServer({ name: "eval", version: "0" });
    registerUploadTools(server, () => ({ env, creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch, sleep: async () => {}, serviceKeys: { "x-api-key": "SERVICEKEY" }, cooldowns: new Map() }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    // The client can ask the person, and the person approves: production writes require that.
    const c = new Client({ name: "eval", version: "0" }, { capabilities: { elicitation: { form: {} } } });
    let asked = 0;
    c.setRequestHandler(ElicitRequestSchema, async () => (asked++, { action: "accept" as const, content: { approve: true } }));
    await c.connect(b);
    const schema = flatPart(op.body?.schema as PartSchema);
    const props = Object.entries(schema.properties ?? {}).map(([n, s]) => [n, flatPart(s)] as const);
    const extFor = (part: string) => (/xml/.test(op.body?.partTypes?.[part] ?? "") ? "xml" : /json/.test(op.body?.partTypes?.[part] ?? "") || part === "metadata" ? "json" : "pdf");
    let n = 0;
    const files = Object.fromEntries(
      props.filter(([, s]) => (s.type === "array" ? s.items?.format : s.format) === "binary").map(([name, s]) => [name, s.type === "array" ? [fixture(extFor(name), n++), fixture(extFor(name), n++)] : fixture(extFor(name), n++)]),
    );
    const fields = Object.fromEntries(props.filter(([name]) => !(name in files) && (schema.required ?? []).includes(name)).map(([name, s]) => [name, sampleValue(s)]));
    const g = validInput(op);
    const args = { operation_id: op.id, path_params: g.pathParams, query: g.query, headers: g.headers, files, fields };
    const preview = (await c.callTool({ name: "datev_upload_file", arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const p = preview.isError ? undefined : (JSON.parse(preview.content[0].text) as { preview?: boolean; confirm_token?: string });
    record("upload.preview-no-send", op.id, p?.preview === true && calls.length === 0, preview.content[0].text.slice(0, 160));
    if (!p?.confirm_token) continue;
    await c.callTool({ name: "datev_upload_file", arguments: { ...args, confirm: true, confirm_token: p.confirm_token } });
    const form = calls.length === 1 && calls[0].body instanceof FormData ? calls[0].body : undefined;
    const problems: string[] = [];
    if (!form) problems.push(`${calls.length} requests, expected one multipart request`);
    else {
      const expectOrder = props.map(([name]) => name).filter((name) => name in files || name in fields);
      const sentOrder = [...new Set(form.keys())];
      if (sentOrder.join() !== expectOrder.join()) problems.push(`order ${sentOrder.join()} instead of ${expectOrder.join()}`);
      for (const [name, value] of Object.entries(files)) {
        const want = Array.isArray(value) ? value : [value];
        const got = form.getAll(name) as File[];
        if (got.length !== want.length) problems.push(`${name}: ${got.length} files`);
        for (const [i, path] of want.entries()) {
          const f = got[i];
          if (!f || f.name !== path.split("/").pop() || (await f.text()) !== readFileSync(path, "utf8")) problems.push(`${name}[${i}] bytes or name`);
          const declared = op.body?.partTypes?.[name];
          if (f && declared && !declared.split(",").some((d) => mediaMatches(d.trim(), f.type))) problems.push(`${name}[${i}] type ${f.type}`);
        }
      }
      for (const [name, value] of Object.entries(fields)) {
        const got = form.get(name);
        const textOf = typeof got === "string" ? got : got ? await (got as File).text() : undefined;
        if (textOf !== (typeof value === "string" ? value : JSON.stringify(value))) problems.push(`field ${name}`);
      }
    }
    record("upload.parts-on-wire", op.id, problems.length === 0, problems.join(", "));
    if (env === "production") record("upload.human-approval-asked", op.id, asked === 1, `asked ${asked} times`);
  }
}

function properties() {
  const prop = (category: string, p: fc.IProperty<unknown>, runs = 2000) => {
    const out = fc.check(p, { numRuns: runs });
    const passed = out.failed ? out.numRuns - 1 : out.numRuns;
    for (let i = 0; i < passed; i++) record(category, "property", true);
    if (out.failed) record(category, "property", false, `counterexample ${JSON.stringify(out.counterexample)} path ${out.counterexamplePath}`);
  };
  prop("prop.ndjson-roundtrip", fc.property(fc.array(fc.dictionary(fc.string(), fc.jsonValue()), { minLength: 1, maxLength: 15 }), (objs) =>
    JSON.stringify(parseJsonOrLines(objs.map((o) => JSON.stringify(o)).join("\n"), true)) === JSON.stringify(JSON.parse(JSON.stringify(objs))),
  ));
  // Valid fiscal year ids (eight digits, 1992 to 2099) all come through; one invalid id refuses the whole answer.
  const fyId = fc.integer({ min: 19920101, max: 20991231 });
  prop("prop.fiscal-year-ids", fc.property(fc.array(fc.oneof(fyId, fyId.map(String), fyId.map((id) => ({ id })))), (xs) => fiscalYearIds(xs).length === xs.length));
  prop("prop.fiscal-year-ids-refuse", fc.property(fc.array(fyId), fc.oneof(fc.string(), fc.record({ id: fc.string() }), fc.constant({}), fc.integer({ max: 19920000 })), (good, bad) => {
    fc.pre(!/^(199[2-9]|20[0-9][0-9])[0-9]{4}$/.test(String(typeof bad === "object" ? (bad as { id?: unknown }).id : bad)));
    try {
      fiscalYearIds([...good, bad]);
      return false;
    } catch (e) {
      return e instanceof CallError;
    }
  }));
  prop("prop.job-phase-total", fc.property(fc.jsonValue(), (v) => ["done", "failed", "running"].includes(jobPhase(v))));
  const accounts: LedgerAccount[] = Array.from({ length: 300 }, (_, i) => ({ accountNumber: 10000000 + i * 37, caption: `Konto ${i}` }));
  prop("prop.account-prefix", fc.property(fc.stringMatching(/^[0-9]{1,8}$/), fc.integer({ min: 1, max: 50 }), (q, lim) => {
    const out = matchAccounts(accounts, q, lim);
    return out.length <= lim && out.every((a) => String(a.accountNumber).startsWith(q));
  }));
  const oneParam = OPERATIONS.find((o) => o.servers.sandbox && pathNames(o).length === 1)!;
  prop("prop.path-encoding", fc.property(fc.string({ minLength: 1 }).filter((s) => !/[/\\]/.test(s) && s !== "." && s !== ".."), (v) => {
    const u = buildUrl(oneParam, "sandbox", { ...validInput(oneParam), pathParams: { [pathNames(oneParam)[0]]: v } });
    return !u.search && !u.hash && u.pathname.split("/").map(decodeURIComponent).includes(v);
  }));
  const row: fc.Arbitrary<BatchRow> = fc.record({
    amount: fc.integer({ min: 1, max: 99_999_999 }),
    side: fc.constantFrom("S" as const, "H" as const),
    account: fc.integer({ min: 1000, max: 1999 }).map(String),
    contra: fc.integer({ min: 2000, max: 3999 }).map(String),
    day: fc.integer({ min: 1, max: 28 }),
    month: fc.constant(1),
    text: fc.string({ maxLength: 40 }).map((s) => s.replace(/[^A-Za-z0-9äöüÄÖÜß ]/g, "").trim()),
  });
  prop("prop.extf-written-batch-validates", fc.property(fc.array(row, { minLength: 1, maxLength: 20 }), (rows) => {
    const csv = writeBuchungsstapel({ berater: "455148", mandant: "1", wjStart: "20230101", skl: 4, from: "20230101", to: "20230131", label: "Eval", skr: "03", created: new Date("2023-02-01T10:00:00Z") }, rows);
    return !validateExtf(decodeBytes(encodeCp1252(csv))).findings.some((f) => f.severity === "error");
  }), 1000);
}

const started = Date.now();
OPERATIONS.forEach(perOperation);
await Promise.all(pending);
await writeConfirmGate();
await uploadShapes();
properties();

const byCat = new Map<string, { pass: number; fail: number }>();
for (const r of results) {
  const c = byCat.get(r.category) ?? { pass: 0, fail: 0 };
  if (r.pass) c.pass++;
  else c.fail++;
  byCat.set(r.category, c);
}
const failures = results.filter((r) => !r.pass);
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "");
mkdirSync("test/reports", { recursive: true });
const summary = { generatedAt: new Date().toISOString(), seconds: (Date.now() - started) / 1000, operations: OPERATIONS.length, total: results.length, passed: results.length - failures.length, failed: failures.length, categories: Object.fromEntries(byCat), failures: failures.slice(0, 500) };
writeFileSync(`test/reports/eval-${stamp}.json`, JSON.stringify(summary, null, 2));
const md = [
  `# DATEV MCP offline eval, ${summary.generatedAt}`,
  "",
  `${summary.total} scenarios over ${summary.operations} operations. Passed ${summary.passed}, failed ${summary.failed}. Runtime ${summary.seconds.toFixed(1)}s.`,
  "",
  "| Category | Passed | Failed |",
  "|---|---|---|",
  ...[...byCat].sort().map(([k, v]) => `| ${k} | ${v.pass} | ${v.fail} |`),
  "",
  ...(failures.length ? ["## First failures", "", ...failures.slice(0, 40).map((f) => `- ${f.category} ${f.op}: ${f.detail}`)] : []),
].join("\n");
writeFileSync(`test/reports/eval-${stamp}.md`, md);
console.log(md);
console.log(`\nreport: test/reports/eval-${stamp}.md`);
process.exit(failures.length ? 1 : 0);
