import { test } from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
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

async function client(env: "sandbox" | "production" = "sandbox") {
  const sent: Sent[] = [];
  const f: FetchLike = async (u, init) => {
    sent.push({ url: String(u), form: init?.body instanceof FormData ? init.body : undefined, headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ id: "ok" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const server = new McpServer({ name: "t", version: "0" });
  registerUploadTools(server, () => ({ env, creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  return { c, sent };
}

const dir = mkdtempSync(join(tmpdir(), "datev-up-"));
const file = (name: string, body: string) => (writeFileSync(join(dir, name), body), join(dir, name));
const pdf = file("lohn.pdf", "%PDF-1.4 test");
const view = file("view.pdf", "%PDF-1.4 view");
const xml = file("rechnung.xml", "<Invoice/>");
const html = file("view.html", "<html></html>");
const meta = file("meta.json", '{"a":1}');

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;
const GUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TQX = { traffiqx_id: "1234567890123" };

const hrDoc = { operation_id: "hr-documents.uploaddocument", path_params: { client_guid: GUID }, files: { file: pdf } };

async function send(c: Client, args: Record<string, unknown>) {
  const preview = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: args })));
  assert.equal(preview.preview, true, JSON.stringify(preview));
  return c.callTool({ name: "datev_upload_file", arguments: { ...args, confirm: true, confirm_token: preview.confirm_token } });
}

test("the preview sends nothing, and the confirmed call sends the file in the declared part", async () => {
  const { c, sent } = await client();
  const preview = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: hrDoc })));
  assert.equal(sent.length, 0);
  assert.deepEqual(preview.files[0], { part: "file", file: preview.files[0].file, sent_as: "lohn.pdf", bytes: 13, content_type: "application/pdf" });
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
  assert.ok(isError(await c.callTool({ name: "datev_upload_file", arguments: { ...hrDoc, confirm: true, confirm_token: preview.confirm_token } })));
  const p2 = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: hrDoc })));
  writeFileSync(pdf, "%PDF-1.4 changed");
  assert.ok(isError(await c.callTool({ name: "datev_upload_file", arguments: { ...hrDoc, confirm: true, confirm_token: p2.confirm_token } })));
  writeFileSync(pdf, "%PDF-1.4 test");
  assert.equal(sent.length, 1);
});

test("the name a file is sent under is part of the confirmation", async () => {
  const { c, sent } = await client();
  const renamed = join(dir, "renamed.pdf");
  symlinkSync(pdf, renamed);
  const preview = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: hrDoc })));
  const swapped = await c.callTool({ name: "datev_upload_file", arguments: { ...hrDoc, files: { file: renamed }, confirm: true, confirm_token: preview.confirm_token } });
  assert.ok(isError(swapped));
  assert.equal(sent.length, 0);
});

test("parts follow the declared types, and a JSON field goes out as JSON", async () => {
  const { c, sent } = await client();
  const args = {
    operation_id: "traffiqx-invoice.uploadstructureddata",
    path_params: TQX,
    headers: { "X-App-Display-Name": "datev-mcp test" },
    files: { data: xml, view_component: view },
    fields: { delivery_params: { preferred_format: "XRechnung" } },
  };
  await send(c, args);
  const form = sent[0].form!;
  assert.equal((form.get("data") as File).type, "application/xml");
  assert.equal((form.get("view_component") as File).type, "application/pdf");
  const params = form.get("delivery_params") as File;
  assert.equal(params.type, "application/json");
  assert.deepEqual(JSON.parse(await params.text()), { preferred_format: "XRechnung" });
  assert.equal(sent[0].headers.get("x-app-display-name"), "datev-mcp test");
});

test("parts go out in the order the spec lists them, not the order given", async () => {
  const { c, sent } = await client("production");
  await send(c, { operation_id: "cashregister.importfile", path_params: { "tenant-id": "455148-1" }, headers: { "Request-Id": GUID }, files: { file: xml, metadata: meta } });
  assert.deepEqual([...sent[0].form!.keys()], ["metadata", "file"]);
});

test("a list of files goes to an array part as repeated parts", async () => {
  const { c, sent } = await client();
  await send(c, { operation_id: "smarttransfer-outbound.post_documents_outbox", files: { files: [pdf, xml] } });
  assert.deepEqual((sent[0].form!.getAll("files") as File[]).map((f) => f.name), ["lohn.pdf", "rechnung.xml"]);
});

test("wrong parts, wrong types, bad fields and bad headers are refused before anything is sent", async () => {
  const { c, sent } = await client();
  const tqx = { operation_id: "traffiqx-invoice.uploadstructureddata", path_params: TQX, headers: { "X-App-Display-Name": "x" } };
  const big = file("too-big.xml", "x".repeat(3_000_001));
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...hrDoc, files: { attachment: pdf } }, /attachment/],
    [{ ...hrDoc, files: {} }, /file/],
    [{ ...hrDoc, files: { file: [pdf, xml] } }, /one file/],
    [{ ...hrDoc, fields: { file: "text" } }, /file part/],
    [{ operation_id: "accounting-extf-files.importextffile", files: { file: pdf } }, /datev_upload_extf/],
    [{ operation_id: "accounting-clients.getclients", files: { file: pdf } }, /does not take a file/],
    [{ operation_id: "nope", files: { file: pdf } }, /Unknown operation/],
    [{ ...hrDoc, files: { file: "relative.pdf" } }, /absolute/i],
    [{ ...tqx, files: { data: xml } }, /view_component/],
    [{ ...tqx, path_params: { traffiqx_id: "12345" }, files: { data: xml, view_component: view } }, /traffiqx_id/],
    [{ ...tqx, headers: {}, files: { data: xml, view_component: view } }, /X-App-Display-Name/],
    [{ ...tqx, files: { data: xml, view_component: html } }, /application\/pdf/],
    [{ ...tqx, files: { data: xml, view_component: view }, fields: { delivery_params: "text" } }, /JSON object/],
    [{ ...tqx, headers: { "X-App-Display-Name": "a", "x-app-display-name": "b" }, files: { data: xml, view_component: view } }, /twice/],
    [{ ...tqx, headers: { "X-App-Display-Name": "a", "Bad Header": "x" }, files: { data: xml, view_component: view } }, /not a valid HTTP header/],
    [{ operation_id: "my-tax-income-tax-documents.saveincometaxdocument", files: { file: pdf }, fields: { document: "eval" } }, /JSON object/],
    [{ operation_id: "my-tax-income-tax-documents.saveincometaxdocument", files: { file: pdf }, fields: { document: { note: "x" } } }, /source/],
    [{ operation_id: "hr-files.post_v1_clients_client_id_files", path_params: { "client-id": "455148-1" }, files: { file: big }, fields: { import_file_type: "bwd", target_system: "lodas", file_provider: "test", creation_time: "2026-11-08T10:00:00+01:00", payroll_accounting_month: "2026-10-31" } }, /limit is 3000000/],
    [{ operation_id: "hr-files.post_v1_clients_client_id_files", path_params: { "client-id": "455148-1" }, files: { file: xml }, fields: { import_file_type: "zip", target_system: "lodas", file_provider: "test", creation_time: "2026-11-08T10:00:00+01:00", payroll_accounting_month: "2026-10-31" } }, /one of/],
    [{ operation_id: "accounting-documents.post_clients_client_id_documents", path_params: { "client-id": "455148-1" }, files: { file: file("a.zip", "PK") } }, /ZIP/],
  ];
  for (const [args, why] of cases) {
    const r = await c.callTool({ name: "datev_upload_file", arguments: args });
    assert.ok(isError(r), JSON.stringify(args).slice(0, 200));
    assert.match(text(r), why, `${JSON.stringify(args).slice(0, 200)} -> ${text(r)}`);
  }
  assert.equal(sent.length, 0);
});

test("a file name that looks like an object key never becomes a content type", async () => {
  const { c } = await client();
  for (const name of ["invoice.__proto__", "invoice.constructor"]) {
    const preview = JSON.parse(text(await c.callTool({ name: "datev_upload_file", arguments: { operation_id: "smarttransfer-outbound.post_documents_outbox", files: { files: [file(name, "x")] } } })));
    assert.equal(preview.files[0].content_type, "application/octet-stream", name);
  }
});

test("fields count against the 50 MB budget", async () => {
  const { c, sent } = await client();
  const r = await c.callTool({
    name: "datev_upload_file",
    arguments: { operation_id: "accounting-documents.post_clients_client_id_documents", path_params: { "client-id": "455148-1" }, files: { file: pdf }, fields: { metadata: "x".repeat(51 * 1024 * 1024) } },
  });
  assert.ok(isError(r));
  assert.match(text(r), /50 MB/);
  assert.equal(sent.length, 0);
});

test("hidden folders, key files and hard links are refused and nothing is sent", async () => {
  const { c, sent } = await client();
  const hidden = join(dir, ".secret");
  mkdirSync(hidden, { recursive: true });
  const inside = join(hidden, "a.pdf");
  writeFileSync(inside, "x");
  const linked = join(dir, "receipt.pdf");
  linkSync(inside, linked);
  for (const p of [inside, file("signing.ppk", "x"), file("ssh_host_ed25519_key", "x"), linked]) {
    const r = await c.callTool({ name: "datev_upload_file", arguments: { operation_id: "smarttransfer-outbound.post_documents_outbox", files: { files: [p] } } });
    assert.ok(isError(r), p);
  }
  assert.equal(sent.length, 0);
});
