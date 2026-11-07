import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { registerGenericTools } from "../../src/tools/generic.js";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0xd8, 0x80, 0x0a]);
const pdf: FetchLike = async () => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });

async function client(f: FetchLike) {
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  return c;
}
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const call = { operation_id: "accounting-documents.get_clients_client_id", path_params: { "client-id": "455148-1" } };

test("a binary download is saved byte for byte, or returned as exact base64", async () => {
  const c = await client(pdf);
  const dir = mkdtempSync(join(tmpdir(), "datev-bin-"));
  const target = join(dir, "beleg.pdf");
  const saved = JSON.parse(text(await c.callTool({ name: "datev_call", arguments: { ...call, save_to: target } })));
  assert.equal(saved.saved_to, target);
  assert.deepEqual([...readFileSync(target)], [...PDF]);
  assert.equal(saved.bytes, undefined, "raw bytes never leak into the JSON answer");
  const inline = JSON.parse(text(await c.callTool({ name: "datev_call", arguments: call })));
  assert.deepEqual([...Buffer.from(inline.base64, "base64")], [...PDF]);
});

test("save_to refuses hidden folders and key files", async () => {
  const c = await client(pdf);
  for (const bad of [join(tmpdir(), ".ssh", "authorized_keys"), join(tmpdir(), "id_rsa")]) {
    const r = await c.callTool({ name: "datev_call", arguments: { ...call, save_to: bad } });
    assert.equal((r as { isError?: boolean }).isError, true, bad);
    assert.match(text(r), /Refusing/);
  }
});
