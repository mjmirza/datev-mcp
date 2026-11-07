import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeCp1252, writeBuchungsstapel } from "@seamless-engineering/datev-extf";
import { buildHeaders, callOperation, type CallDeps } from "../../src/api/client.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { getOperation } from "../../src/tools/catalog.js";
import { buildDocumentForm } from "../../src/tools/documents.js";
import { summarizeReport, validateBytes } from "../../src/tools/extf.js";
import { FileError, readLocalFile, writeLocalFile } from "../../src/tools/files.js";

const tmp = () => mkdtempSync(join(tmpdir(), "datev-mcp-files-"));
const deps = (f: FetchLike): CallDeps => ({ env: "sandbox", creds: { clientId: "cid", clientSecret: "S" }, token: async () => "T", fetch: f });

const goodBatch = () =>
  encodeCp1252(
    writeBuchungsstapel(
      { berater: "29098", mandant: "55003", wjStart: "20260101", skl: 4, from: "20260601", to: "20260630", label: "Shop 06/2026", skr: "03", created: new Date("2026-06-30T10:00:00Z") },
      [{ amount: 11900, side: "S", account: "1360", contra: "8400", day: 2, month: 6, beleg1: "RE2026-114", text: "Bestellung 114" }],
    ),
  );

test("file reads require an absolute path, a real file, and respect the size limit", () => {
  const dir = tmp();
  const f = join(dir, "a.csv");
  writeFileSync(f, "x".repeat(10));
  assert.equal(readLocalFile(f, 100).bytes.length, 10);
  assert.throws(() => readLocalFile("relative.csv", 100), FileError);
  assert.throws(() => readLocalFile(dir, 100), /Not a regular file/);
  assert.throws(() => readLocalFile(join(dir, "missing.csv"), 100), /not found/);
  assert.throws(() => readLocalFile(f, 5), /limit/);
});

test("writes never silently overwrite an existing file", () => {
  const f = join(tmp(), "out.csv");
  writeLocalFile(f, new Uint8Array([1]), false);
  assert.throws(() => writeLocalFile(f, new Uint8Array([2]), false), /already exists/);
  writeLocalFile(f, new Uint8Array([3]), true);
  assert.deepEqual([...readFileSync(f)], [3]);
});

test("a written Buchungsstapel passes the validator; a broken amount is explained in German", () => {
  const ok = summarizeReport(validateBytes(goodBatch()), "de");
  assert.equal(ok.valid, true, JSON.stringify(ok.findings));
  assert.equal(ok.rows, 1);
  const broken = new TextDecoder("latin1").decode(goodBatch()).replace("119,00", "119.00");
  const bad = summarizeReport(validateBytes(new TextEncoder().encode(broken)), "de");
  assert.equal(bad.valid, false);
  assert.ok(bad.findings.some((f) => f.code === "amount-dot" && f.line === 3 && /Komma/.test(f.message)), JSON.stringify(bad.findings));
});

test("a non-EXTF file is rejected by the validator", () => {
  assert.equal(summarizeReport(validateBytes(new TextEncoder().encode("name,amount\nfoo,1\n")), "en").valid, false);
});

test("required header params are enforced and auth headers cannot be overridden", () => {
  const op = getOperation("accounting-extf-files.importextffile")!;
  assert.throws(() => buildHeaders(op, {}), /Missing required header "Filename"/);
  assert.deepEqual(buildHeaders(op, { headers: { Filename: "a.csv" } }), { Filename: "a.csv" });
  assert.throws(() => buildHeaders(op, { headers: { Filename: "a.csv", Authorization: "Bearer x" } }), /cannot be overridden/);
  assert.throws(() => buildHeaders(op, { headers: { Filename: "a\r\nX-Evil: 1" } }), /line break/);
});

test("EXTF upload sends raw bytes with the Filename header to the sandbox import URL", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const f: FetchLike = async (u, init) => ((seen = { url: String(u), init }), new Response("", { status: 202, headers: { location: "/jobs/1" } }));
  const bytes = goodBatch();
  const r = await callOperation(getOperation("accounting-extf-files.importextffile")!, { pathParams: { "client-id": "455148-2" }, headers: { Filename: "EXTF_x.csv" }, rawBody: bytes }, deps(f));
  assert.equal(r.status, 202);
  assert.equal(r.location, "/jobs/1");
  assert.equal(seen?.url, "https://accounting-extf-files.api.datev.de/platform-sandbox/v3/clients/455148-2/extf-files/import");
  const h = seen?.init?.headers as Record<string, string>;
  assert.equal(h.Filename, "EXTF_x.csv");
  assert.equal(h["content-type"], "application/octet-stream");
  assert.equal(seen?.init?.body, bytes);
});

test("document upload sends multipart with the file and JSON metadata, letting fetch set the boundary", async () => {
  let seen: RequestInit | undefined;
  const f: FetchLike = async (_u, init) => ((seen = init), new Response("{}", { status: 201, headers: { "content-type": "application/json" } }));
  const form = buildDocumentForm({ name: "rechnung.pdf", bytes: new Uint8Array([37, 80, 68, 70]) }, { document_type: "Rechnungseingang" });
  await callOperation(getOperation("accounting-documents.post_clients_client_id_documents")!, { pathParams: { "client-id": "455148-2" }, rawBody: form }, deps(f));
  assert.ok(seen?.body instanceof FormData);
  assert.equal((seen?.headers as Record<string, string>)["content-type"], undefined);
  const file = (seen?.body as FormData).get("file") as File;
  assert.equal(file.name, "rechnung.pdf");
  assert.deepEqual(JSON.parse(await ((seen?.body as FormData).get("metadata") as Blob).text()), { document_type: "Rechnungseingang" });
});
