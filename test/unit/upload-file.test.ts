import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { registerUploadTools } from "../../src/tools/upload.js";

interface Sent {
  url: string;
  form?: FormData;
  headers: Headers;
}

async function client() {
  const sent: Sent[] = [];
  const f: FetchLike = async (u, init) => {
    sent.push({ url: String(u), form: init?.body instanceof FormData ? init.body : undefined, headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ id: "ok" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const server = new McpServer({ name: "t", version: "0" });
  registerUploadTools(server, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  return { c, sent };
}

const dir = mkdtempSync(join(tmpdir(), "datev-up-"));
const pdf = join(dir, "lohn.pdf");
writeFileSync(pdf, "%PDF-1.4 test");
const xml = join(dir, "rechnung.xml");
writeFileSync(xml, "<Invoice/>");
const html = join(dir, "view.html");
writeFileSync(html, "<html></html>");

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;
const GUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const hrDoc = { operation_id: "hr-documents.uploaddocument", path_params: { client_guid: GUID }, files: { file: pdf } };

test("the preview sends nothing, and the confirmed call sends the file in the declared part", async () => {
  const { c, sent } = await client();
  const preview = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: hrDoc })));
  assert.equal(preview.preview, true);
  assert.equal(sent.length, 0);
  assert.equal(preview.files[0].part, "file");
  assert.equal(preview.files[0].content_type, "application/pdf");
  const done = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: { ...hrDoc, confirm: true, confirm_token: preview.confirm_token } })));
  assert.equal(done.uploaded, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, new RegExp(`/platform-sandbox/v1/clients/${GUID}/documents$`));
  const part = sent[0].form?.get("file") as File;
  assert.equal(part.name, "lohn.pdf");
  assert.equal(part.type, "application/pdf");
  assert.equal(await part.text(), "%PDF-1.4 test");
});

test("one confirm code sends once, and a changed file needs a new preview", async () => {
  const { c, sent } = await client();
  const preview = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: hrDoc })));
  await c.callTool({ name: "datev_upload_file", arguments: { ...hrDoc, confirm: true, confirm_token: preview.confirm_token } });
  const again = await c.callTool({ name: "datev_upload_file", arguments: { ...hrDoc, confirm: true, confirm_token: preview.confirm_token } });
  assert.ok(isError(again));
  assert.equal(sent.length, 1);
  const p2 = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: hrDoc })));
  writeFileSync(pdf, "%PDF-1.4 changed");
  const changed = await c.callTool({ name: "datev_upload_file", arguments: { ...hrDoc, confirm: true, confirm_token: p2.confirm_token } });
  assert.ok(isError(changed));
  assert.equal(sent.length, 1);
  writeFileSync(pdf, "%PDF-1.4 test");
});

test("several file parts and a JSON field go out with their own part names", async () => {
  const { c, sent } = await client();
  const args = {
    operation_id: "traffiqx-invoice.uploadstructureddata",
    path_params: { traffiqx_id: "1234567890123" },
    headers: { "X-App-Display-Name": "datev-mcp test" },
    files: { data: xml, view_component: html },
    fields: { delivery_params: { channel: "email" } },
  };
  const preview = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: args })));
  assert.equal(preview.preview, true, JSON.stringify(preview));
  await c.callTool({ name: "datev_upload_file", arguments: { ...args, confirm: true, confirm_token: preview.confirm_token } });
  const form = sent[0].form!;
  assert.equal((form.get("data") as File).type, "application/xml");
  assert.equal((form.get("view_component") as File).type, "text/html");
  const params = form.get("delivery_params") as File;
  assert.equal(params.type, "application/json");
  assert.deepEqual(JSON.parse(await params.text()), { channel: "email" });
  assert.equal(sent[0].headers.get("x-app-display-name"), "datev-mcp test");
});

test("a list of files goes to an array part as repeated parts", async () => {
  const { c, sent } = await client();
  const args = { operation_id: "smarttransfer-outbound.post_documents_outbox", files: { files: [pdf, xml] } };
  const preview = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: args })));
  await c.callTool({ name: "datev_upload_file", arguments: { ...args, confirm: true, confirm_token: preview.confirm_token } });
  assert.deepEqual((sent[0].form!.getAll("files") as File[]).map((f) => f.name), ["lohn.pdf", "rechnung.xml"]);
});

test("wrong part names, missing required parts and misuse are refused before anything is sent", async () => {
  const { c, sent } = await client();
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...hrDoc, files: { attachment: pdf } }, /attachment/],
    [{ ...hrDoc, files: {} }, /file/],
    [{ ...hrDoc, files: { file: [pdf, xml] } }, /one file/],
    [{ ...hrDoc, fields: { file: "text" } }, /file part/],
    [{ operation_id: "accounting-extf-files.importextffile", files: { file: pdf } }, /datev_upload_extf/],
    [{ operation_id: "accounting-clients.getclients", files: { file: pdf } }, /does not take a file/],
    [{ operation_id: "nope", files: { file: pdf } }, /Unknown operation/],
    [{ ...hrDoc, files: { file: "relative.pdf" } }, /absolute/i],
    [{ operation_id: "traffiqx-invoice.uploadstructureddata", path_params: { traffiqx_id: "1234567890123" }, headers: { "X-App-Display-Name": "x" }, files: { data: xml } }, /view_component/],
    [{ operation_id: "traffiqx-invoice.uploadstructureddata", path_params: { traffiqx_id: "12345" }, headers: { "X-App-Display-Name": "x" }, files: { data: xml, view_component: html } }, /traffiqx_id/],
    [{ operation_id: "traffiqx-invoice.uploadstructureddata", path_params: { traffiqx_id: "1234567890123" }, files: { data: xml, view_component: html } }, /X-App-Display-Name/],
  ];
  for (const [args, why] of cases) {
    const r = await c.callTool({ name: "datev_upload_file", arguments: args });
    assert.ok(isError(r), JSON.stringify(args));
    assert.match(text(r), why, JSON.stringify(args));
  }
  assert.equal(sent.length, 0);
});

test("files in hidden folders are never read", async () => {
  const { c } = await client();
  const hidden = join(dir, ".secret");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(hidden, { recursive: true });
  writeFileSync(join(hidden, "a.pdf"), "x");
  const r = await c.callTool({ name: "datev_upload_file", arguments: { ...hrDoc, files: { file: join(hidden, "a.pdf") } } });
  assert.ok(isError(r));
});
