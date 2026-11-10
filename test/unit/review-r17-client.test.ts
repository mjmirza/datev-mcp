import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callOperation, type CallDeps } from "../../src/api/client.js";
import { problemOf } from "../../src/api/problem.js";
import { getOperation } from "../../src/tools/catalog.js";

// Guards errors[0] inside a list body's first member past the cap (ledger R17).
process.env.DATEV_MCP_SESSION_KEY ??= "77".repeat(32);
process.env.DATEV_SMARTTRANSFER_API_KEY ??= "test-key";
process.env.DATEV_MCP_HOME = mkdtempSync(join(tmpdir(), "datev-r17-"));

const get = getOperation("accounting-clients.getclients")!;
const HELP = "https://help.datev.de/12345";
const deps = (fetch: CallDeps["fetch"]): CallDeps => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch, sleep: async () => undefined, maxBodyChars: 1000, maxBinaryBytes: 1000 });
const json403 = (text: string) => async () => new Response(text, { status: 403, headers: { "content-type": "application/json" } });
const scanned = async (body: unknown) => problemOf((await callOperation(get, {}, deps(json403(JSON.stringify(body))))).body);

test("a list body whose first member nests errors keeps errors[0]'s title and help link", async () => {
  const p = await scanned([{ pad: "x".repeat(6000), errors: [{ title: "DENIED", type: HELP }] }]);
  assert.equal(p.title, "DENIED", JSON.stringify(p));
  assert.equal(p.help_url, HELP);
});

test("in a list body, the first member's own fields still win over its errors[0]", async () => {
  const p = await scanned([{ errors: [{ title: "INNER", type: "https://example.com/x" }], pad: "x".repeat(6000), title: "OUTER", type: HELP }]);
  assert.equal(p.title, "OUTER");
  assert.equal(p.help_url, HELP);
});

test("a list body reads errors[0] of the first object member only, never a later member", async () => {
  const p = await scanned(["skip", { pad: "x".repeat(6000), errors: [{ title: "FIRST" }] }, { errors: [{ title: "SECOND" }] }]);
  assert.equal(p.title, "FIRST");
});

test("a nested errors[0] value past the cap stays capped at 2000 chars", async () => {
  const p = await scanned([{ pad: "x".repeat(6000), errors: [{ detail: "d".repeat(5000), title: "DENIED" }] }]);
  assert.equal(p.title, "DENIED");
  assert.ok((p.detail ?? "").length <= 2000);
});
