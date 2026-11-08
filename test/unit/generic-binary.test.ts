import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, existsSync } from "node:fs";
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
  assert.equal(saved.saved_to, join(realpathSync(dir), "beleg.pdf"));
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

test("save_to through a symlinked folder that leads into a hidden folder is refused", async () => {
  const c = await client(pdf);
  const root = mkdtempSync(join(tmpdir(), "datev-link-"));
  const hidden = join(root, ".ssh");
  mkdirSync(hidden);
  symlinkSync(hidden, join(root, "export"));
  const r = await c.callTool({ name: "datev_call", arguments: { ...call, save_to: join(root, "export", "authorized_keys") } });
  assert.equal((r as { isError?: boolean }).isError, true);
  assert.match(text(r), /Refusing/);
  assert.equal(existsSync(join(hidden, "authorized_keys")), false);
});

test("the upload tools say when DATEV's answer was cut at the size cap", async () => {
  const { registerDocumentTools } = await import("../../src/tools/documents.js");
  const { registerExtfTools } = await import("../../src/tools/extf.js");
  const { writeLocalFile } = await import("../../src/tools/files.js");
  const big: FetchLike = async () => new Response("x".repeat(200), { status: 201, headers: { "content-type": "text/plain" } });
  const server = new McpServer({ name: "t", version: "0" });
  const deps = () => ({ env: "sandbox" as const, creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: big, maxBodyChars: 50 });
  registerDocumentTools(server, deps);
  registerExtfTools(server, deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const dir = mkdtempSync(join(tmpdir(), "datev-trunc-"));
  const pdfPath = writeLocalFile(join(dir, "beleg.pdf"), PDF, false);
  const docArgs = { client_id: "455148-1", file_path: pdfPath };
  const docPreview = JSON.parse(text(await c.callTool({ name: "datev_upload_document", arguments: docArgs })));
  const doc = JSON.parse(text(await c.callTool({ name: "datev_upload_document", arguments: { ...docArgs, confirm: true, confirm_token: docPreview.confirm_token } })));
  assert.equal(doc.uploaded, true);
  assert.equal(doc.truncated, true, "document upload hid a cut answer");
  const extfPath = join(dir, "EXTF_Buchungsstapel.csv");
  await c.callTool({ name: "datev_write_extf_batch", arguments: { output_path: extfPath, berater: "455148", mandant: "1", wj_start: "20230101", account_length: 8, from: "20230101", to: "20230131", label: "t", rows: [{ amount_cents: 1190, side: "S", account: "12000000", contra_account: "84000000", day: 3, month: 1, beleg1: "T1", text: "Test" }], lang: "de" } });
  const extfArgs = { client_id: "455148-1", file_path: extfPath };
  const extfPreview = JSON.parse(text(await c.callTool({ name: "datev_upload_extf", arguments: extfArgs })));
  const extf = JSON.parse(text(await c.callTool({ name: "datev_upload_extf", arguments: { ...extfArgs, confirm: true, confirm_token: extfPreview.confirm_token } })));
  assert.equal(extf.uploaded, true);
  assert.equal(extf.truncated, true, "EXTF upload hid a cut answer");
  // A name DATEV refuses is caught in the preview, so no confirm code is ever issued for it.
  const badPath = join(dir, "buchungen.csv");
  copyFileSync(extfPath, badPath);
  const bad = (await c.callTool({ name: "datev_upload_extf", arguments: { client_id: "455148-1", file_path: badPath } })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Filename/);
});
