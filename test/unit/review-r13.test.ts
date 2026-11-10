import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callOperation, type CallDeps } from "../../src/api/client.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { getOperation } from "../../src/tools/catalog.js";
import { registerGenericTools } from "../../src/tools/generic.js";

// Guards for the write-path review after R12 (ledger R13).
process.env.DATEV_MCP_SESSION_KEY ??= "66".repeat(32);
process.env.DATEV_SMARTTRANSFER_API_KEY ??= "test-key";

async function writeCall(answer: () => Response) {
  const f: FetchLike = async () => answer();
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox" as const, creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f, sleep: async () => undefined }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const args = { operation_id: "smarttransfer-inbound.put_documents_id_release", path_params: { id: "42" } };
  const prev = JSON.parse(((await c.callTool({ name: "datev_call", arguments: args })) as { content: { text: string }[] }).content[0]!.text);
  const r = (await c.callTool({ name: "datev_call", arguments: { ...args, confirm: true, confirm_token: prev.confirm_token } })) as { content: { text: string }[] };
  return r.content[0]!.text;
}

test("a write that DATEV answers with a server error warns that the change may already be applied", async () => {
  const text = await writeCall(() => new Response(JSON.stringify({ title: "BOOM" }), { status: 500, headers: { "content-type": "application/json" } }));
  assert.match(text, /may already have applied this change/);
});

test("a write that DATEV refuses with a 4xx carries no may-be-applied warning", async () => {
  const text = await writeCall(() => new Response(JSON.stringify({ title: "NO" }), { status: 403, headers: { "content-type": "application/json" } }));
  assert.doesNotMatch(text, /may already have applied/);
});

test("a complete file exactly as long as the read limit is not called cut off when the answer closes slowly", { timeout: 15_000 }, async () => {
  const file = new Uint8Array(1000).fill(7);
  const slowClose = () =>
    new Response(new ReadableStream<Uint8Array>({ async pull(c) { c.enqueue(file); await new Promise((r) => setTimeout(r, 2500)); c.close(); } }), { status: 200, headers: { "content-type": "application/pdf" } });
  const deps: CallDeps = { env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: async () => slowClose(), sleep: async () => undefined, maxBodyChars: 1000, maxBinaryBytes: 1000 };
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, deps);
  assert.equal(r.truncated, false);
});
