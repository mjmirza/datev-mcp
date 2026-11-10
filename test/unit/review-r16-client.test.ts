import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callOperation, type CallDeps } from "../../src/api/client.js";
import { problemOf } from "../../src/api/problem.js";
import { getOperation } from "../../src/tools/catalog.js";
import { localize } from "../../src/i18n.js";

// Guards for nested error shapes past the cap, a pause after an exact-cap head, and a write timeout (ledger R16).
process.env.DATEV_MCP_SESSION_KEY ??= "77".repeat(32);
process.env.DATEV_SMARTTRANSFER_API_KEY ??= "test-key";
process.env.DATEV_MCP_HOME = mkdtempSync(join(tmpdir(), "datev-r16-"));

const get = getOperation("accounting-clients.getclients")!;
const write = getOperation("smarttransfer-inbound.put_documents_id_release")!;
const HELP = "https://help.datev.de/12345";
const deps = (fetch: CallDeps["fetch"], extra: Partial<CallDeps> = {}): CallDeps => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch, sleep: async () => undefined, maxBodyChars: 1000, maxBinaryBytes: 1000, ...extra });
const json403 = (text: string) => async () => new Response(text, { status: 403, headers: { "content-type": "application/json" } });

test("a large JSON error that is a list keeps the first member's title and help link", async () => {
  const text = JSON.stringify([{ detail: "d".repeat(600_000), title: "DENIED", type: HELP }]);
  const r = await callOperation(get, {}, deps(json403(text)));
  const p = problemOf(r.body);
  assert.equal(p.title, "DENIED", JSON.stringify(p));
  assert.equal(p.help_url, HELP);
});

test("a large JSON error with a nested errors list keeps errors[0]'s title and help link", async () => {
  const text = JSON.stringify({ errors: [{ detail: "d".repeat(600_000), title: "DENIED", type: HELP }, { title: "OTHER" }] });
  const r = await callOperation(get, {}, deps(json403(text)));
  const p = problemOf(r.body);
  assert.equal(p.title, "DENIED", JSON.stringify(p));
  assert.equal(p.help_url, HELP);
});

test("the outer object's own fields still win over errors[0]", async () => {
  const text = JSON.stringify({ errors: [{ detail: "d".repeat(600_000), title: "INNER" }], title: "OUTER", type: HELP });
  const p = problemOf((await callOperation(get, {}, deps(json403(text)))).body);
  assert.equal(p.title, "OUTER");
  assert.equal(p.help_url, HELP);
});

test("an exact-cap JSON error head followed by a pause past 2 s keeps the later fields", async () => {
  const head = `{"detail":"`;
  const first = new TextEncoder().encode(head + "d".repeat(4004 - head.length));
  const rest = new TextEncoder().encode(`","title":"DENIED","type":"${HELP}"}`);
  const answer = async () => {
    let step = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(c) {
          if (step === 0) c.enqueue(first);
          else if (step === 1) {
            await new Promise((r) => setTimeout(r, 2600));
            c.enqueue(rest);
          } else c.close();
          step++;
        },
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  };
  const r = await callOperation(get, {}, deps(answer));
  const p = problemOf(r.body);
  assert.equal(p.title, "DENIED", JSON.stringify(r.body).slice(0, 200));
  assert.equal(p.help_url, HELP);
});

test("a write that times out before DATEV answers warns it may be applied and does not invite a retry", async () => {
  const fetch = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  const err = await callOperation(write, { pathParams: { id: "42" } }, deps(fetch)).then(
    () => assert.fail("expected the write to fail"),
    (e: unknown) => e as Error,
  );
  assert.match(err.message, /may already have applied this change/);
  assert.doesNotMatch(err.message, /Try again/);
  const de = localize(err.message, "de");
  assert.match(de, /möglicherweise schon übernommen/);
  assert.doesNotMatch(de, /Ran out|DATEV may/);
});

test("a read that times out before DATEV answers still invites a retry", async () => {
  const fetch = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  const err = await callOperation(get, {}, deps(fetch, { deadlineMs: 500 })).then(
    () => assert.fail("expected the read to fail"),
    (e: unknown) => e as Error,
  );
  assert.match(err.message, /Try again/);
  assert.doesNotMatch(err.message, /may already have applied/);
});
