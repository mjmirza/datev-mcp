import { test } from "node:test";
import assert from "node:assert/strict";
import type { FetchLike } from "../../src/auth/token-client.js";
import { callOperation, type CallDeps } from "../../src/api/client.js";
import { getOperation } from "../../src/tools/catalog.js";

// Guards for the error scan past the read limit (ledger R12).
process.env.DATEV_MCP_SESSION_KEY ??= "33".repeat(32);

const enc = new TextEncoder();
const head = enc.encode(`{"detail":"${"x".repeat(5000)}","title":"REFUSED","type":"https://help.datev.de/r12"`);
const deps = (f: FetchLike, extra: Partial<CallDeps> = {}): CallDeps => ({ env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined, maxBodyChars: 1000, ...extra });
const write = () => getOperation("accounting-extf-files.importextffile")!;
const writeInput = { pathParams: { "client-id": "455148-2" }, headers: { Filename: "EXTF_x.csv" }, rawBody: enc.encode("x") };

// An answer that sends its head, then one byte every 300 ms until the request is aborted, as fetch does.
const dribbling = (signal?: AbortSignal | null, status = 403) => {
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        signal?.addEventListener("abort", () => c.error(signal.reason));
      },
      async pull(c) {
        if (!sent) {
          sent = true;
          c.enqueue(head);
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
        c.enqueue(enc.encode("y"));
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
};

// An answer that sends some bytes, then breaks off.
const breaking = (first: Uint8Array, status = 403) => {
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (!sent) {
          sent = true;
          c.enqueue(first);
          return;
        }
        c.error(new TypeError("socket hang up"));
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
};

test("a refused write whose error answer keeps dribbling past the read limit is reported as refused, quickly", { timeout: 15_000 }, async () => {
  const started = Date.now();
  const r = await callOperation(write(), writeInput, deps(async (_u, init) => dribbling(init?.signal), { deadlineMs: 9000 }));
  const took = Date.now() - started;
  assert.ok(took < 8000, `took ${took} ms`);
  assert.equal(r.status, 403);
  assert.equal((r.body as Record<string, unknown>).title, "REFUSED");
  assert.equal((r.body as Record<string, unknown>).type, "https://help.datev.de/r12");
});

test("an error answer that breaks off past the read limit keeps its status and title", async () => {
  let calls = 0;
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, deps(async () => (calls++, breaking(head))));
  assert.equal(r.status, 403);
  assert.equal(calls, 1, "a kept answer is not asked for again");
  assert.equal((r.body as Record<string, unknown>).title, "REFUSED");
});

test("a write whose error answer breaks off past the read limit is reported as refused", async () => {
  const r = await callOperation(write(), writeInput, deps(async () => breaking(head)));
  assert.equal(r.status, 403);
  assert.equal((r.body as Record<string, unknown>).title, "REFUSED");
});

test("an error answer that breaks off before the read limit keeps its status and counts as cut off", async () => {
  const small = enc.encode(`{"title":"SHORT",`);
  const r = await callOperation(write(), writeInput, deps(async () => breaking(small)));
  assert.equal(r.status, 403);
  assert.equal(r.truncated, true);
  assert.deepEqual([(r.body as Record<string, unknown>).cut_off, (r.body as Record<string, unknown>).title], [true, "SHORT"]);
});

test("the error scan keeps a numeric request id, also one cut at a scan batch edge", async () => {
  const body = enc.encode(`{"detail":"${"x".repeat(5000)}","title":"T","request_id":123}`);
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, deps(async () => new Response(body, { status: 403, headers: { "content-type": "application/json" } })));
  assert.equal((r.body as Record<string, unknown>).request_id, "123");
  // The 64 KB scan batch ends after byte 65535, right inside the number, so a half-read id must not be kept.
  const pre = `{"detail":"${"x".repeat(65_496)}","title":"T","request_id":12`;
  const cut = enc.encode(`${pre}345}`);
  assert.equal(enc.encode(pre).length, 65_536);
  function* chunks() {
    yield cut.subarray(0, 4005);
    for (let i = 4005; i < cut.length; i++) yield cut.subarray(i, i + 1);
  }
  const s = new Response(new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks()) c.enqueue(x); c.close(); } }), { status: 403, headers: { "content-type": "application/json" } });
  const r2 = await callOperation(getOperation("accounting-clients.getclients")!, {}, deps(async () => s));
  assert.equal((r2.body as Record<string, unknown>).request_id, "12345");
});

test("an error answer exactly as long as the read limit that then goes quiet is not waited for", { timeout: 15_000 }, async () => {
  const shell = `{"detail":"","title":"EXACT"`;
  const exact = enc.encode(`{"detail":"${"x".repeat(1000 * 4 + 4 - shell.length)}","title":"EXACT"`);
  assert.equal(exact.length, 1000 * 4 + 4);
  const started = Date.now();
  const quiet = (signal?: AbortSignal | null) =>
    new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(exact); signal?.addEventListener("abort", () => c.error(signal.reason)); } }), { status: 403, headers: { "content-type": "application/json" } });
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, deps(async (_u, init) => quiet(init?.signal), { deadlineMs: 9000 }));
  assert.ok(Date.now() - started < 6000, `took ${Date.now() - started} ms`);
  assert.equal(r.status, 403);
  assert.equal((r.body as Record<string, unknown>).title, "EXACT");
});


test("an error answer that breaks off past the read limit still logs the break", async () => {
  const entries: { error?: string; status?: number }[] = [];
  const r = await callOperation(write(), writeInput, deps(async () => breaking(head), { httpLog: (e) => entries.push(e as { error?: string; status?: number }), httpLogProblem: () => undefined }));
  assert.equal(r.status, 403);
  assert.ok(entries.some((e) => /answer broke off: socket hang up/.test(e.error ?? "")), JSON.stringify(entries));
});

test("a title and help link that arrive after a pause past the read limit are still kept, inside the scan limit", { timeout: 15_000 }, async () => {
  const late = enc.encode(`,"title":"LATE","help_url":"https://help.datev.de/late"}`);
  let step = 0;
  const pausing = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        async pull(c) {
          if (step++ === 0) return c.enqueue(enc.encode(`{"detail":"${"x".repeat(5000)}"`));
          await new Promise((r) => setTimeout(r, 2500));
          c.enqueue(late);
          c.close();
        },
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  const started = Date.now();
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, deps(async () => pausing()));
  assert.ok(Date.now() - started < 6000, `took ${Date.now() - started} ms`);
  assert.equal((r.body as Record<string, unknown>).title, "LATE");
  assert.equal((r.body as Record<string, unknown>).help_url, "https://help.datev.de/late");
});
