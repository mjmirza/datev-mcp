import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callOperation, type CallDeps } from "../../src/api/client.js";
import type { HttpLogEntry } from "../../src/api/http-log.js";
import { problemOf } from "../../src/api/problem.js";
import { getOperation } from "../../src/tools/catalog.js";
import { localize } from "../../src/i18n.js";

// Guards for a write whose connection drops before DATEV answers, and error answers that break off below the cap (ledger R19).
process.env.DATEV_MCP_SESSION_KEY ??= "77".repeat(32);
process.env.DATEV_SMARTTRANSFER_API_KEY ??= "test-key";
process.env.DATEV_MCP_HOME = mkdtempSync(join(tmpdir(), "datev-r19-"));

const get = getOperation("accounting-clients.getclients")!;
const write = getOperation("smarttransfer-inbound.put_documents_id_release")!;
const HELP = "https://help.datev.de/123";
const deps = (fetch: CallDeps["fetch"], extra: Partial<CallDeps> = {}): CallDeps => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch, sleep: async () => undefined, maxBodyChars: 1000, maxBinaryBytes: 1000, ...extra });

const failing = (code: string) => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    throw new TypeError("fetch failed", { cause: Object.assign(new Error(`read ${code}`), { code }) });
  };
  return { fetch, calls: () => calls };
};

const reject = (p: Promise<unknown>) =>
  p.then(
    () => assert.fail("expected the call to fail"),
    (e: unknown) => e as Error,
  );

// A body that sends the given text, then the connection resets before the end.
const breaking = (status: number, text: string) => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    let step = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          if (step++ === 0) c.enqueue(new TextEncoder().encode(text));
          else c.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
        },
      }),
      { status, headers: { "content-type": "application/json" } },
    );
  };
  return { fetch, calls: () => calls };
};

test("a write whose connection resets before DATEV answers warns it may be applied and is not resent", async () => {
  const f = failing("ECONNRESET");
  const err = await reject(callOperation(write, { pathParams: { id: "42" } }, deps(f.fetch)));
  assert.match(err.message, /may already have applied this change/);
  assert.doesNotMatch(err.message, /Try again/);
  assert.equal(f.calls(), 1);
  const de = localize(err.message, "de");
  assert.match(de, /möglicherweise schon übernommen/);
  assert.doesNotMatch(de, /DATEV may|did not answer|connection|broke off|fetch failed/);
});

test("a write whose connection was refused does not warn: nothing reached DATEV", async () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]) {
    const err = await reject(callOperation(write, { pathParams: { id: "42" } }, deps(failing(code).fetch)));
    assert.equal(err.message, "DATEV did not answer: fetch failed", code);
  }
});

test("a read whose connection resets keeps its current wording", async () => {
  const f = failing("ECONNRESET");
  const err = await reject(callOperation(get, {}, deps(f.fetch)));
  assert.equal(err.message, "DATEV did not answer: fetch failed");
  assert.ok(f.calls() > 1, "a read is still retried");
});

test("a 403 that breaks off below the cap keeps its status, title and help link, logged as broken off", async () => {
  const b = breaking(403, `{"title":"DENIED","type":"${HELP}","detail":"`);
  const log: HttpLogEntry[] = [];
  const r = await callOperation(write, { pathParams: { id: "42" } }, deps(b.fetch, { httpLog: (e) => log.push(e), httpLogProblem: () => undefined }));
  assert.equal(r.status, 403);
  const p = problemOf(r.body);
  assert.equal(p.title, "DENIED", JSON.stringify(r.body));
  assert.equal(p.help_url, HELP);
  assert.equal((r.body as { cut_off?: boolean }).cut_off, true);
  assert.equal(r.truncated, true);
  assert.equal(b.calls(), 1, "a write is never resent");
  assert.equal(log.length, 1);
  assert.equal(log[0]!.status, 403);
  assert.match(log[0]!.error ?? "", /answer broke off/);
});

test("a 2xx read that breaks off below the cap is still an error, never returned as success", async () => {
  const b = breaking(200, `{"items":[{"id":1},`);
  const err = await reject(callOperation(get, {}, deps(b.fetch)));
  assert.match(err.message, /DATEV's answer broke off/);
});
