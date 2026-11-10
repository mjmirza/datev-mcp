import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callOperation, type CallDeps } from "../../src/api/client.js";
import type { HttpLogEntry } from "../../src/api/http-log.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { getOperation } from "../../src/tools/catalog.js";
import { registerGenericTools } from "../../src/tools/generic.js";
import { registerUploadTools } from "../../src/tools/upload.js";
import { registerExtfTools } from "../../src/tools/extf.js";
import { writeLocalFile } from "../../src/tools/files.js";
import { localize } from "../../src/i18n.js";

// Guards for a body that breaks off at the cap and the may-be-applied warning (ledger R15).
process.env.DATEV_MCP_SESSION_KEY ??= "77".repeat(32);
process.env.DATEV_SMARTTRANSFER_API_KEY ??= "test-key";
process.env.DATEV_MCP_HOME = mkdtempSync(join(tmpdir(), "datev-r15-"));

const WARN = /may already have applied this change/;
const get = getOperation("accounting-clients.getclients")!;
const write = getOperation("smarttransfer-inbound.put_documents_id_release")!;

/** Sends `head`, then breaks off instead of closing. */
const breaking = (head: Uint8Array, status: number, type: string) => () => {
  let sent = false;
  return new Response(new ReadableStream<Uint8Array>({ pull(c) { if (sent) c.error(new Error("socket hang up")); else { sent = true; c.enqueue(head); } } }), { status, headers: { "content-type": type } });
};
const deps = (answer: () => Response, extra: Partial<CallDeps> = {}): CallDeps => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: async () => answer(), sleep: async () => undefined, maxBodyChars: 1000, maxBinaryBytes: 1000, ...extra });

test("a read that fills the cap and then breaks off keeps the bytes and is not retried", async () => {
  const log: HttpLogEntry[] = [];
  let calls = 0;
  const answer = breaking(new Uint8Array(1000).fill(7), 200, "application/pdf");
  const r = await callOperation(get, {}, deps(() => (calls++, answer()), { httpLog: (e) => log.push(e), httpLogProblem: () => undefined }));
  assert.equal(r.truncated, true);
  assert.equal(r.bytes?.length, 1000);
  assert.equal(calls, 1, "a cap-filled answer is an answer, not a network error");
  assert.ok(log.some((e) => /answer broke off: socket hang up/.test(e.error ?? "")), JSON.stringify(log));
});

test("a 2xx write that fills the cap and then breaks off keeps the bytes it read", async () => {
  const r = await callOperation(write, { pathParams: { id: "42" } }, deps(breaking(new Uint8Array(1000).fill(1), 200, "application/pdf")));
  assert.equal(r.status, 200);
  assert.equal(r.truncated, true);
  assert.equal(r.bytes?.length, 1000);
});

test("a 5xx write that fills the cap and then breaks off returns its status instead of throwing", async () => {
  const r = await callOperation(write, { pathParams: { id: "42" } }, deps(breaking(new Uint8Array(1000).fill(1), 500, "application/pdf")));
  assert.equal(r.status, 500);
  assert.equal(r.truncated, true);
});

test("a JSON error that fills the cap exactly and then breaks off keeps its head and fields", async () => {
  const head = `{"title":"DENIED","detail":"`;
  const text = head + "d".repeat(4004 - head.length);
  const r = await callOperation(get, {}, deps(breaking(new TextEncoder().encode(text), 403, "application/json")));
  assert.equal(r.status, 403);
  assert.equal((r.body as { title?: string }).title, "DENIED");
});

async function connect(register: (s: McpServer) => void) {
  const server = new McpServer({ name: "t", version: "0" });
  register(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  return c;
}
const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
async function confirmed(c: Client, name: string, args: Record<string, unknown>) {
  const prev = JSON.parse(textOf(await c.callTool({ name, arguments: args })));
  assert.equal(prev.preview, true, JSON.stringify(prev));
  return textOf(await c.callTool({ name, arguments: { ...args, confirm: true, confirm_token: prev.confirm_token } }));
}
const release = { operation_id: "smarttransfer-inbound.put_documents_id_release", path_params: { id: "42" } };

test("datev_call keeps the may-be-applied warning on a binary 5xx answer that was cut off", async () => {
  const big = () => new Response(new Uint8Array(5000).fill(2), { status: 503, headers: { "content-type": "application/pdf" } });
  const c = await connect((s) => registerGenericTools(s, () => deps(big)));
  const out = JSON.parse(await confirmed(c, "datev_call", release));
  assert.match(out.note, WARN);
  assert.match(out.note, /not read completely/);
});

test("a write whose answer breaks off before the cap says the change may already be applied", async () => {
  const c = await connect((s) => registerGenericTools(s, () => deps(breaking(new TextEncoder().encode("{\"a\":"), 500, "application/json"))));
  const out = await confirmed(c, "datev_call", release);
  assert.match(out, /answer broke off/);
  assert.match(out, WARN);
  assert.match(localize("DATEV's answer broke off: socket hang up. DATEV may already have applied this change, so check in DATEV before sending it again.", "de"), /Antwort von DATEV brach ab: socket hang up\. DATEV hat diese Änderung möglicherweise schon übernommen/);
});

test("datev_upload_file warns on a 5xx or 408 that the files may already be stored", async () => {
  const GUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  for (const status of [503, 408]) {
    const f: FetchLike = async (u, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        const client = { name: "Muster GmbH", consultant_number: 455148, client_number: 1, client_guid: GUID };
        return new Response(JSON.stringify(new URL(String(u)).pathname.endsWith("/clients") ? { clients: [client] } : client), { headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ title: "BUSY" }), { status, headers: { "content-type": "application/json" } });
    };
    const c = await connect((s) => registerUploadTools(s, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f, sleep: async () => undefined })));
    const dir = mkdtempSync(join(tmpdir(), "datev-r15-up-"));
    const pdf = writeLocalFile(join(dir, `lohn-${status}.pdf`), new TextEncoder().encode("%PDF-1.4 r15"), false);
    const out = JSON.parse(await confirmed(c, "datev_upload_file", { operation_id: "hr-documents.uploaddocument", path_params: { client_guid: GUID }, files: { file: pdf } }));
    assert.equal(out.uploaded, false);
    assert.match(out.note ?? "", WARN, `HTTP ${status}`);
  }
});

test("datev_upload_extf warns on a 5xx that the batch may already be imported", async () => {
  const f: FetchLike = async (u, init) => {
    const url = String(u);
    if ((init?.method ?? "GET").toUpperCase() === "GET")
      return new Response(JSON.stringify({ name: "Test GmbH", services: [{ name: "Buchungsdatenservice" }] }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/extf-files/import")) return new Response(JSON.stringify({ title: "BOOM" }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response("{}", { headers: { "content-type": "application/json" } });
  };
  const c = await connect((s) => {
    const d = () => ({ env: "sandbox" as const, creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f, sleep: async () => undefined });
    registerGenericTools(s, d);
    registerExtfTools(s, d);
  });
  const dir = mkdtempSync(join(tmpdir(), "datev-r15-extf-"));
  const extfPath = join(dir, "EXTF_Buchungsstapel.csv");
  await c.callTool({ name: "datev_write_extf_batch", arguments: { output_path: extfPath, berater: "455148", mandant: "1", wj_start: "20230101", account_length: 8, from: "20230101", to: "20230131", label: "r15", rows: [{ amount_cents: 1515, side: "S", account: "12000000", contra_account: "84000000", day: 5, month: 1, beleg1: "R15", text: "Test" }], lang: "de" } });
  const out = JSON.parse(await confirmed(c, "datev_upload_extf", { client_id: "455148-1", file_path: extfPath }));
  assert.equal(out.uploaded, false);
  assert.match(out.note ?? "", WARN);
});

test("the joined binary note reads in German too", () => {
  const de = localize("DATEV may already have applied this change, so check in DATEV before sending it again. The file is larger than 1000 bytes and was not read completely. Nothing was saved.", "de");
  assert.equal(de, "DATEV hat diese Änderung möglicherweise schon übernommen. Prüfen Sie das in DATEV, bevor Sie sie erneut senden. Die Datei ist größer als 1000 Bytes und wurde nicht vollständig gelesen. Es wurde nichts gespeichert.");
});
