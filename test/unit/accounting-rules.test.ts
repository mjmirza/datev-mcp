import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { documentGuid, registerDocumentTools } from "../../src/tools/documents.js";
import { registerExtfTools } from "../../src/tools/extf.js";

// DATEV's rules for Belegbilderservice and Buchungsdatenservice, checked against a fake DATEV.
interface Fake {
  services?: string[];
  types?: string[];
  job?: "succeeded" | "failed" | "pending";
}
type Sent = { method: string; url: string };

async function harness(fake: Fake) {
  const sent: Sent[] = [];
  const json = (b: unknown, h: Record<string, string> = {}, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...h } });
  const f: FetchLike = async (u, init) => {
    const url = String(u);
    const method = (init?.method ?? "GET").toUpperCase();
    sent.push({ method, url });
    if (method === "GET" && /\/clients\/455148-1$/.test(url)) return json({ name: "Muster GmbH", consultant_number: 455148, client_number: 1, services: (fake.services ?? []).map((name) => ({ name })) });
    if (url.endsWith("/document-types")) return json((fake.types ?? []).map((name) => ({ name })));
    if (url.endsWith("/extf-files/import")) return new Response(null, { status: 202, headers: { location: "/clients/455148-1/extf-files/jobs/J7", "retry-after": "1" } });
    if (url.includes("/extf-files/jobs/J7")) return json({ id: "J7", result: fake.job ?? "succeeded", number_of_accounting_records: 1, validation_details: fake.job === "failed" ? [{ message: "Konto fehlt" }] : undefined });
    if (method === "PUT" && url.includes("/documents/")) return json({ id: "D1" }, {}, 201);
    return json({});
  };
  const server = new McpServer({ name: "t", version: "0" });
  const deps = () => ({ env: "sandbox" as const, creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f, sleep: async () => undefined });
  registerDocumentTools(server, deps);
  registerExtfTools(server, deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    return { error: r.isError === true, text: r.content[0]!.text };
  };
  const confirmed = async (name: string, args: Record<string, unknown>) => {
    const p = await call(name, args);
    if (p.error) return p;
    return call(name, { ...args, confirm: true, confirm_token: JSON.parse(p.text).confirm_token });
  };
  return { sent, call, confirmed };
}

const dir = mkdtempSync(join(tmpdir(), "datev-acc-"));
const pdf = join(dir, "beleg.pdf");
writeFileSync(pdf, "%PDF-1.4 test");
const extfPath = (name: string) => join(dir, name);

test("tests run with temporary folders, never the person's real session or log", () => {
  assert.ok(process.env.DATEV_MCP_HOME?.startsWith(tmpdir()) || process.env.DATEV_MCP_HOME?.includes("datev-test-home-"));
  assert.ok(process.env.DATEV_MCP_LOG_DIR?.includes("datev-test-logs-") || process.env.DATEV_MCP_LOG_DIR?.startsWith(tmpdir()));
});

test("a document is refused before sending when the client has not switched the service on, with DATEV's setup link", async () => {
  const h = await harness({ services: ["Buchungsdatenservice"], types: ["Rechnungseingang"] });
  const r = await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf, document_type: "Rechnungseingang" });
  assert.equal(r.error, true);
  assert.match(r.text, /Muster GmbH.*Belegbilderservice.*go\.datev\.de\/datenservices-einrichten/s);
  assert.ok(!h.sent.some((s) => s.method !== "GET"), "nothing was sent");
});

test("documents use only the client's document types and the field rules of the chosen service", async () => {
  const h = await harness({ services: ["Belegbilderservice", "Buchungsdatenservice"], types: ["Rechnungseingang"] });
  const wrongType = await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf, document_type: "Quittung" });
  assert.match(wrongType.text, /not a document type of this client\. Available: Rechnungseingang/);
  const levelsOnBbs = await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf, document_type: "Rechnungseingang", category: "App", folder: "ER", register: "2026/03" });
  assert.match(levelsOnBbs.text, /Belegbilderservice does not take category/);
  const missingLevels = await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf, document_type: "Rechnungseingang", service: "buchungsdatenservice" });
  assert.match(missingLevels.text, /needs category, folder and register/);
  const preview = JSON.parse((await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf, document_type: "Rechnungseingang" })).text);
  assert.deepEqual(preview.client, { name: "Muster GmbH", consultant_number: 455148, client_number: 1 }, "the person sees the client, not the technical id");
  assert.match(preview.destination, /\/clients\/455148-1\/documents\/[0-9a-f-]{36}$/);
});

test("document types are read once per day per client, never before every single document", async () => {
  const h = await harness({ services: ["Belegbilderservice"], types: ["Rechnungseingang"] });
  const pdf2 = join(dir, "beleg2.pdf");
  writeFileSync(pdf2, "%PDF-1.4 second");
  await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf, document_type: "Rechnungseingang" });
  await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf2, document_type: "Rechnungseingang" });
  assert.ok(h.sent.filter((s) => s.url.endsWith("/document-types")).length <= 1, "the type list is not fetched again for the second document");
  const bbs = await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf });
  assert.match(bbs.text, /Belegbilderservice needs a document_type/);
});

test("Buchungsdatenservice documents may leave out the document type, as DATEV recommends asking the user", async () => {
  const h = await harness({ services: ["Buchungsdatenservice"], types: [] });
  const p = await h.call("datev_upload_document", { client_id: "455148-1", file_path: pdf, service: "buchungsdatenservice", category: "App", folder: "ER", register: "2026/03" });
  assert.equal(p.error, false, p.text);
  assert.deepEqual(JSON.parse(p.text).metadata, { category: "App", folder: "ER", register: "2026/03" });
  assert.ok(!h.sent.some((s) => s.url.endsWith("/document-types")), "no type check when no type is sent");
});

test("the same file to the same client always reaches the same DATEV document id, so DATEV keeps one copy", async () => {
  const id = documentGuid("455148-1", "ab".repeat(32));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(documentGuid("455148-1", "ab".repeat(32)), id);
  assert.notEqual(documentGuid("455148-2", "ab".repeat(32)), id);
  const h = await harness({ services: ["Belegbilderservice"], types: ["Rechnungseingang"] });
  const r = await h.confirmed("datev_upload_document", { client_id: "455148-1", file_path: pdf, document_type: "Rechnungseingang" });
  assert.equal(r.error, false, r.text);
  assert.ok(h.sent.some((s) => s.method === "PUT" && s.url.includes("/documents/")), "uploaded with PUT and the app's id");
});

test("an EXTF import counts only when DATEV's job succeeded, and booking data is never sent twice by accident", async () => {
  const ok = await harness({ services: ["Buchungsdatenservice"], job: "succeeded" });
  const write = await ok.call("datev_write_extf_batch", { output_path: extfPath("EXTF_A.csv"), berater: "455148", mandant: "1", wj_start: "20260101", account_length: 8, from: "20260101", to: "20260131", label: "t", rows: [{ amount_cents: 1190, side: "S", account: "12000000", contra_account: "84000000", day: 3, month: 1, beleg1: "T1", text: "Test" }], lang: "de" });
  assert.equal(write.error, false, write.text);
  const first = JSON.parse((await ok.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: extfPath("EXTF_A.csv") })).text);
  assert.equal(first.imported, true);
  assert.equal(first.job_id, "J7");
  const again = await ok.call("datev_upload_extf", { client_id: "455148-1", file_path: extfPath("EXTF_A.csv") });
  assert.equal(again.error, true);
  assert.match(again.text, /already sent.*resend: true/s);
  const resent = await ok.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: extfPath("EXTF_A.csv"), resend: true });
  assert.equal(JSON.parse(resent.text).imported, true, "a deliberate resend works");

  const failed = await harness({ services: ["Buchungsdatenservice"], job: "failed" });
  await failed.call("datev_write_extf_batch", { output_path: extfPath("EXTF_B.csv"), berater: "455148", mandant: "1", wj_start: "20260101", account_length: 8, from: "20260101", to: "20260131", label: "b", rows: [{ amount_cents: 500, side: "S", account: "12000000", contra_account: "84000000", day: 4, month: 1, beleg1: "T2", text: "B" }], lang: "de" });
  const bad = await failed.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: extfPath("EXTF_B.csv") });
  assert.equal(bad.error, true);
  assert.match(bad.text, /"imported": false[\s\S]*Konto fehlt/);

  const noService = await harness({ services: ["Belegbilderservice"] });
  await noService.call("datev_write_extf_batch", { output_path: extfPath("EXTF_C.csv"), berater: "455148", mandant: "1", wj_start: "20260101", account_length: 8, from: "20260101", to: "20260131", label: "c", rows: [{ amount_cents: 700, side: "S", account: "12000000", contra_account: "84000000", day: 5, month: 1, beleg1: "T3", text: "C" }], lang: "de" });
  const refused = await noService.call("datev_upload_extf", { client_id: "455148-1", file_path: extfPath("EXTF_C.csv") });
  assert.match(refused.text, /has not switched on Buchungsdatenservice/);
});
