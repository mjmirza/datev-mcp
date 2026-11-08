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
  assert.deepEqual(buildHeaders(op, { headers: { Filename: "EXTF_a.csv" } }), { Filename: "EXTF_a.csv" });
  assert.throws(() => buildHeaders(op, { headers: { Filename: "a.csv" } }), /format DATEV expects/);
  assert.throws(() => buildHeaders(op, { headers: { Filename: "EXTF_a.csv", Authorization: "Bearer x" } }), /cannot be overridden/);
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

test("files in hidden folders, key files and symlinks to them are never sent", async () => {
  const { mkdirSync, symlinkSync } = await import("node:fs");
  const dir = tmp();
  mkdirSync(join(dir, ".config"));
  writeFileSync(join(dir, ".config", "session-sandbox.json"), "{}");
  writeFileSync(join(dir, "id_rsa"), "key");
  writeFileSync(join(dir, ".env.local"), "X=1");
  symlinkSync(join(dir, ".config", "session-sandbox.json"), join(dir, "innocent.pdf"));
  for (const p of [join(dir, ".config", "session-sandbox.json"), join(dir, "id_rsa"), join(dir, ".env.local"), join(dir, "innocent.pdf")]) assert.throws(() => readLocalFile(p, 1000), FileError, p);
  writeFileSync(join(dir, "beleg.pdf"), "%PDF");
  assert.equal(readLocalFile(join(dir, "beleg.pdf"), 1000).name, "beleg.pdf");
});

test("a write never follows a symlink, creates owner-only files, and overwrites by rename", async () => {
  const { symlinkSync, statSync, lstatSync } = await import("node:fs");
  const dir = tmp();
  const victim = join(dir, "victim.txt");
  writeFileSync(victim, "keep me");
  symlinkSync(victim, join(dir, "out.csv"));
  assert.throws(() => writeLocalFile(join(dir, "out.csv"), new Uint8Array([1]), true), /symbolic link/);
  symlinkSync(join(dir, "missing-target"), join(dir, "dangling.csv"));
  assert.throws(() => writeLocalFile(join(dir, "dangling.csv"), new Uint8Array([1]), false), FileError);
  assert.equal(readFileSync(victim, "utf8"), "keep me");
  const fresh = writeLocalFile(join(dir, "new.csv"), new Uint8Array([65]), false);
  assert.equal(statSync(fresh).mode & 0o777, 0o600);
  writeLocalFile(fresh, new Uint8Array([66]), true);
  assert.equal(readFileSync(fresh, "utf8"), "B");
  assert.equal(lstatSync(fresh).isFile(), true);
});

test("the uploaded file part carries the content type DATEV requires, and ZIP is refused", async () => {
  const { mimeFor } = await import("../../src/tools/documents.js");
  const form = buildDocumentForm({ name: "rechnung.pdf", bytes: new Uint8Array([37]) }, {});
  assert.equal((form.get("file") as File).type, "application/pdf");
  assert.equal(mimeFor("scan.JPG"), "image/jpeg");
  assert.throws(() => mimeFor("belege.zip"), /ZIP/);
  assert.throws(() => mimeFor("tool.exe"), /Unsupported/);
});

// Confirm tests share module state and a forward-only clock, so each gets its own window after T0.
const T0 = Date.now() + 1_000_000_000;

test("a confirm token only fits the exact request it was issued for, and expires", async () => {
  const { issueConfirmToken, checkConfirmToken } = await import("../../src/tools/confirm.js");
  const req = { tool: "x", file: "/a.pdf", sha256: "abc", metadata: { b: 1, a: 2 } };
  const t = issueConfirmToken(req, T0 + 1 * 100_000_000 + 1_000);
  assert.equal(checkConfirmToken(t, { metadata: { a: 2, b: 1 }, sha256: "abc", file: "/a.pdf", tool: "x" }, T0 + 1 * 100_000_000 + 2_000), undefined);
  assert.match(checkConfirmToken(t, { ...req, sha256: "changed" }, T0 + 1 * 100_000_000 + 2_000)!, /does not match/);
  assert.match(checkConfirmToken(undefined, req, T0 + 1 * 100_000_000 + 2_000)!, /preview first/i);
  assert.match(checkConfirmToken(t, req, T0 + 1 * 100_000_000 + 1_000 + 16 * 60_000)!, /expired/);
  assert.match(checkConfirmToken("garbage", req, T0 + 1 * 100_000_000 + 2_000)!, /malformed/);
});

test("a confirm token works once, so one approval can never send a write twice", async () => {
  const { issueConfirmToken, checkConfirmToken } = await import("../../src/tools/confirm.js");
  const req = { tool: "datev_upload_extf", file: "/b.csv", sha256: "def" };
  const t = issueConfirmToken(req, T0 + 2 * 100_000_000 + 5_000);
  assert.equal(checkConfirmToken(t, req, T0 + 2 * 100_000_000 + 6_000), undefined);
  assert.match(checkConfirmToken(t, req, T0 + 2 * 100_000_000 + 7_000)!, /already used/);
  const fresh = issueConfirmToken(req, T0 + 2 * 100_000_000 + 8_000);
  assert.equal(checkConfirmToken(fresh, req, T0 + 2 * 100_000_000 + 9_000), undefined);
});

test("a spent confirm token cannot be replayed in another spelling", async () => {
  const { issueConfirmToken, checkConfirmToken } = await import("../../src/tools/confirm.js");
  const req = { tool: "datev_call", op: "x" };
  const t = issueConfirmToken(req, T0 + 3 * 100_000_000 + 10_000);
  assert.equal(checkConfirmToken(t, req, T0 + 3 * 100_000_000 + 11_000), undefined);
  for (const variant of [`${t}.a`, `0${t}`, t.toUpperCase(), ` ${t}`]) assert.ok(checkConfirmToken(variant, req, T0 + 3 * 100_000_000 + 11_500), `accepted ${variant}`);
});

test("two previews of the same request in the same millisecond get different tokens", async () => {
  const { issueConfirmToken, checkConfirmToken } = await import("../../src/tools/confirm.js");
  const req = { tool: "datev_call", op: "same" };
  const a = issueConfirmToken(req, T0 + 4 * 100_000_000 + 20_000);
  const b = issueConfirmToken(req, T0 + 4 * 100_000_000 + 20_000);
  assert.notEqual(a, b);
  assert.equal(checkConfirmToken(a, req, T0 + 4 * 100_000_000 + 21_000), undefined);
  assert.equal(checkConfirmToken(b, req, T0 + 4 * 100_000_000 + 21_000), undefined);
});

test("a clock that jumps back cannot bring a spent confirm token back to life", async () => {
  const { issueConfirmToken, checkConfirmToken } = await import("../../src/tools/confirm.js");
  const req = { tool: "datev_call", op: "rollback" };
  const issued = T0 + 5 * 100_000_000;
  const t = issueConfirmToken(req, issued);
  assert.equal(checkConfirmToken(t, req, issued + 1_000), undefined);
  assert.ok(checkConfirmToken("x", req, issued + 900_001)); // a later check that prunes old entries
  assert.ok(checkConfirmToken(t, req, issued + 899_999), "spent token accepted after the clock went back");
});

test("a clock that jumps forward and back does not block new confirmations", async () => {
  const { issueConfirmToken, checkConfirmToken } = await import("../../src/tools/confirm.js");
  const req = { tool: "datev_call", op: "jump" };
  const base = T0 + 6 * 100_000_000;
  assert.ok(checkConfirmToken("x", req, base + 50 * 24 * 60 * 60_000)); // a check far in the future
  const t = issueConfirmToken(req, base);
  assert.equal(checkConfirmToken(t, req, base + 1_000), undefined);
});

test("a burst of confirmations only blocks new ones until the burst expires", async () => {
  const { issueConfirmToken, checkConfirmToken } = await import("../../src/tools/confirm.js");
  const base = T0 + 7 * 100_000_000;
  for (let i = 0; i < 10_000; i++) {
    const req = { tool: "burst", i };
    assert.equal(checkConfirmToken(issueConfirmToken(req, base), req, base + 1), undefined);
  }
  const late = { tool: "burst", i: "late" };
  assert.match(checkConfirmToken(issueConfirmToken(late, base + 2), late, base + 3)!, /Too many/);
  const after = { tool: "burst", i: "after" };
  const at = base + 15 * 60_000 + 10;
  assert.equal(checkConfirmToken(issueConfirmToken(after, at), after, at + 1), undefined);
});

test("a failed save leaves no temp file behind, so the next attempt works", async () => {
  const { mkdtempSync, writeFileSync, readdirSync, chmodSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeLocalFile } = await import("../../src/tools/files.js");
  const dir = mkdtempSync(join(tmpdir(), "datev-retry-"));
  const target = join(dir, "out.pdf");
  writeFileSync(target, "old");
  chmodSync(dir, 0o500); // read-only folder: the temp file cannot be created
  assert.throws(() => writeLocalFile(target, new Uint8Array([1, 2, 3]), true), /Cannot create/);
  chmodSync(dir, 0o700);
  assert.deepEqual(readdirSync(dir), ["out.pdf"]);
  writeLocalFile(target, new Uint8Array([1, 2, 3]), true);
  assert.deepEqual([...readFileSync(target)], [1, 2, 3]);
});

test("a missing body and a null body never share a confirm token", async () => {
  const { issueConfirmToken, checkConfirmToken } = await import("../../src/tools/confirm.js");
  const at = T0 + 8 * 100_000_000;
  const t = issueConfirmToken({ op: "x", body: undefined }, at);
  assert.match(checkConfirmToken(t, { op: "x", body: null }, at + 1) ?? "", /does not match/);
  assert.equal(checkConfirmToken(t, { op: "x", body: undefined }, at + 1), undefined);
});

test("a named pipe is refused at once instead of hanging the server", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { readLocalFile } = await import("../../src/tools/files.js");
  const fifo = join(mkdtempSync(join(tmpdir(), "datev-fifo-")), "beleg.pdf");
  execFileSync("mkfifo", [fifo]);
  const t0 = Date.now();
  assert.throws(() => readLocalFile(fifo, 1000), /Not a regular file/);
  assert.ok(Date.now() - t0 < 1000);
});

test("a new file with a long name is saved, the temp name does not grow with it", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeLocalFile } = await import("../../src/tools/files.js");
  const dir = mkdtempSync(join(tmpdir(), "datev-long-"));
  const target = join(dir, "a".repeat(236) + ".pdf");
  writeLocalFile(target, new Uint8Array([9]), false);
  assert.deepEqual([...readFileSync(target)], [9]);
});
