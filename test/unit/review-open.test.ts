import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { clearClientGate } from "../../src/api/client-gate.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { envKeyStore, loadOrCreateKey, type KeyStore } from "../../src/auth/session-key.js";
import { ENDPOINTS } from "../../src/auth/endpoints.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { doctor } from "../../src/setup/doctor.js";
import { registerGenericTools } from "../../src/tools/generic.js";

// Guards for ledger rows that were open before R6 (F12, F15, F16, F22, F23, F24, F39, F41, F42).
process.env.DATEV_MCP_SESSION_KEY ??= "33".repeat(32);

test("a corrupt plain text session is kept only as an encrypted copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "datev-open-"));
  const store = new TokenStore("sandbox", dir, envKeyStore());
  writeFileSync(store.file, '{"env":"sandbox","tokens":{"refreshToken":"RT-PLAIN-SECRET"', { mode: 0o600 });
  assert.equal(store.read(), undefined);
  assert.equal(existsSync(store.file), false, "the plain text file is gone");
  const kept = readdirSync(dir).filter((f) => f.includes(".corrupt-"));
  assert.equal(kept.length, 1, "an encrypted copy is kept for inspection");
  assert.ok(!readFileSync(join(dir, kept[0]!), "utf8").includes("RT-PLAIN-SECRET"));
});

test("a plain text session for the wrong environment is not kept in clear text either", () => {
  const dir = mkdtempSync(join(tmpdir(), "datev-open-"));
  const store = new TokenStore("sandbox", dir, envKeyStore());
  writeFileSync(store.file, JSON.stringify({ env: "production", clientId: "c", tokens: { accessToken: "AT-PLAIN-SECRET", expiresAt: 1, obtainedAt: 0 } }), { mode: 0o600 });
  assert.equal(store.read(), undefined);
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(join(dir, f), "utf8").includes("AT-PLAIN-SECRET"), f);
});

test("datev_call reports a DATEV redirect as an error and never saves its body", async () => {
  const dir = mkdtempSync(join(tmpdir(), "datev-open-"));
  const f: FetchLike = async () => new Response("moved", { status: 302, headers: { location: "https://elsewhere.example/x", "content-type": "application/octet-stream" } });
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox" as const, creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const target = join(dir, "out.bin");
  const r = (await c.callTool({ name: "datev_call", arguments: { operation_id: "accounting-clients.getclients", save_to: target } })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /redirect/);
  assert.equal(existsSync(target), false);
});

test("a session key stored by another process while this one waited is used, not overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "datev-open-"));
  const theirs = Buffer.alloc(32, 7);
  let reads = 0;
  let sets = 0;
  // The first look finds nothing, the look under the lock finds the other process's key.
  const store: KeyStore = { name: "test", get: () => (reads++ === 0 ? undefined : theirs), set: () => void sets++ };
  assert.ok(loadOrCreateKey(store, dir).equals(theirs));
  assert.equal(sets, 0, "no second key was created");
  assert.equal(existsSync(join(dir, "session-key.lock")), false, "the lock is released");
});

test("a session key lock left by a dead process does not block key creation", () => {
  const dir = mkdtempSync(join(tmpdir(), "datev-open-"));
  const lock = join(dir, "session-key.lock");
  mkdirSync(lock);
  const old = (Date.now() - 10 * 60_000) / 1000;
  utimesSync(lock, old, old);
  let kept: Buffer | undefined;
  const store: KeyStore = { name: "test", get: () => kept, set: (k) => void (kept = k) };
  const key = loadOrCreateKey(store, dir);
  assert.equal(key.length, 32);
  assert.equal(existsSync(lock), false);
});

test("doctor never calls accounting-clients when the login chose no accounting service", async () => {
  const dir = mkdtempSync(join(tmpdir(), "datev-open-"));
  const store = new TokenStore("sandbox", dir, envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", services: ["hr-files"], scopes: ["openid"], tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const urls: string[] = [];
  const f: FetchLike = async (u) => {
    urls.push(String(u));
    return new Response(JSON.stringify({ sub: "u1" }), { headers: { "content-type": "application/json" } });
  };
  const checks = await doctor({ env: "sandbox", endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid", clientSecret: "s" } }, { store, fetch: f, httpLog: () => {} });
  assert.ok(!urls.some((u) => u.endsWith("/clients")), urls.join(", "));
  assert.match(checks.find((c) => c.name === "accounting-clients API")?.detail ?? "", /not connected/);
});

test("the setup and README login examples grant the service their first questions need", () => {
  const root = join(import.meta.dirname, "..", "..");
  for (const doc of ["docs/SETUP.md", "README.md"]) {
    const login = readFileSync(join(root, doc), "utf8").split("\n").find((l) => l.includes("index.js login --services"));
    assert.ok(login?.includes("accounting-dataexchange"), `${doc}: fiscal years, balances and the chart of accounts come from accounting-dataexchange`);
  }
});

test("a write's approval dialog names the client by name and numbers, not only the technical id", async () => {
  clearClientGate();
  const f: FetchLike = async (u, init) => {
    const path = new URL(String(u)).pathname;
    if ((init?.method ?? "GET").toUpperCase() === "GET" && /\/clients\/[^/]+$/.test(path))
      return new Response(JSON.stringify({ id: "455148-1", name: "Muster GmbH", consultant_number: 455148, client_number: 1, services: [{ name: "Rechnungsdatenservice 1.0" }] }), { headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
  };
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox" as const, creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" }, { capabilities: { elicitation: { form: {} } } });
  let asked = "";
  c.setRequestHandler(ElicitRequestSchema, async (req) => ((asked = String(req.params.message)), { action: "accept", content: { approve: true } }));
  await c.connect(b);
  const args = { operation_id: "accounting-dxso-jobs.post_clients_client_id_dxso_jobs", path_params: { "client-id": "455148-1" }, body: { job_type: "x" } };
  const prev = JSON.parse(((await c.callTool({ name: "datev_call", arguments: args })) as { content: { text: string }[] }).content[0]!.text);
  await c.callTool({ name: "datev_call", arguments: { ...args, confirm: true, confirm_token: prev.confirm_token } });
  assert.match(asked, /Client: Muster GmbH, consultant 455148, client 1/);
  assert.ok(!asked.includes("455148-1"), "DATEV's technical client id is not shown to the person");
});

test("DATEV's API descriptions never ship: the package is private and the built index stays out of git", () => {
  const root = join(import.meta.dirname, "..", "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { private?: boolean };
  assert.equal(pkg.private, true, "no registry release can carry the built index");
  const ignored = readFileSync(join(root, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  for (const p of ["dist/", "src/data/operations.json"]) assert.ok(ignored.includes(p), `${p} is git-ignored`);
});

test("an operation with no scope of its own is refused unless its service was chosen at login", async () => {
  const { localize } = await import("../../src/i18n.js");
  let sent = 0;
  const f: FetchLike = async () => (sent++, new Response("[]", { headers: { "content-type": "application/json" } }));
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox" as const, creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined, chosenServices: new Set(["accounting-clients", "accounting-documents"]) }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const r = (await c.callTool({ name: "datev_call", arguments: { operation_id: "cashregister.gettenants" } })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /belongs to cashregister, which is not part of the connected data services/);
  assert.equal(sent, 0, "nothing reached DATEV");
  assert.match(localize(r.content[0]!.text, "de"), /gehört zu cashregister/);
});

test("German mode puts doctor, previews and approval dialogs in German", async () => {
  const { doctorLine } = await import("../../src/i18n.js");
  const dir = mkdtempSync(join(tmpdir(), "datev-open-"));
  const store = new TokenStore("sandbox", dir, envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", services: ["accounting-clients"], scopes: ["openid"], tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const doc: FetchLike = async (u) => new Response(String(u).endsWith("/clients") ? "[]" : JSON.stringify({ sub: "u1" }), { headers: { "content-type": "application/json" } });
  const checks = await doctor({ env: "sandbox", endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid", clientSecret: "s" } }, { store, fetch: doc, httpLog: () => {} });
  for (const c of checks) if (c.name !== "saved session") assert.notEqual(doctorLine(c, "de"), doctorLine(c, "en"), c.name);

  const before = process.env.DATEV_MCP_LANG;
  process.env.DATEV_MCP_LANG = "de";
  try {
    clearClientGate();
    const f: FetchLike = async (u, init) => {
      const path = new URL(String(u)).pathname;
      if ((init?.method ?? "GET").toUpperCase() === "GET" && /\/clients\/[^/]+$/.test(path))
        return new Response(JSON.stringify({ id: "455148-1", name: "Muster GmbH", consultant_number: 455148, client_number: 1, services: [{ name: "Rechnungsdatenservice 1.0" }] }), { headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
    };
    const server = new McpServer({ name: "t", version: "0" });
    registerGenericTools(server, () => ({ env: "sandbox" as const, creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const c = new Client({ name: "t", version: "0" }, { capabilities: { elicitation: { form: {} } } });
    let asked = "";
    c.setRequestHandler(ElicitRequestSchema, async (req) => ((asked = String(req.params.message)), { action: "accept", content: { approve: true } }));
    await c.connect(b);
    const args = { operation_id: "accounting-dxso-jobs.post_clients_client_id_dxso_jobs", path_params: { "client-id": "455148-1" }, body: { job_type: "x" } };
    const prev = JSON.parse(((await c.callTool({ name: "datev_call", arguments: args })) as { content: { text: string }[] }).content[0]!.text);
    assert.match(prev.note, /^Dieses POST ändert Daten in DATEV sandbox\. Es wurde nichts gesendet\./);
    await c.callTool({ name: "datev_call", arguments: { ...args, confirm: true, confirm_token: prev.confirm_token } });
    assert.match(asked, /Mandant: Muster GmbH, Berater 455148, Mandant 1/);
    assert.match(asked, /Inhalt: /);
  } finally {
    if (before === undefined) delete process.env.DATEV_MCP_LANG;
    else process.env.DATEV_MCP_LANG = before;
  }
});

test("every preview note and approval line the upload, document and EXTF tools write has a German version", async () => {
  const { localize, localizeApproval } = await import("../../src/i18n.js");
  const notes = [
    "Nothing was sent. This uploads beleg.pdf (12 bytes, application/pdf) to Belegbilderservice Rechnungswesen of Muster GmbH, consultant 455148, client 1 in DATEV sandbox. Ask the user, then call again with confirm: true and this confirm_token.",
    "Nothing was sent. This imports 3 rows into Buchungsdatenservice of Muster GmbH, consultant 455148, client 1 in DATEV sandbox, AGAIN although it was sent before. Ask the user, then call again with confirm: true and this confirm_token.",
    "Nothing was sent. This sends 2 file(s) to POST https://x.example/v1/files in DATEV sandbox. Ask the user, then call again with confirm: true and this confirm_token.",
  ];
  for (const n of notes) assert.notEqual(localize(n, "de"), n, n.slice(0, 60));
  const lines = ["Upload beleg.pdf (12 bytes, Rechnungseingang) to Belegbilderservice Rechnungswesen of Muster GmbH, consultant 455148, client 1", "Import 3 booking rows from extf.csv into Buchungsdatenservice of Muster GmbH (sent again)", "file file: beleg.pdf (12 bytes, application/pdf)", "fields: {}"];
  for (const l of lines) assert.notEqual(localizeApproval(l, "de"), l, l);
  assert.match(localizeApproval(lines[0]!, "de"), /von Muster GmbH, Berater 455148, Mandant 1$/);
});

test("every DATEV requirement proof names a test that exists", () => {
  const root = join(import.meta.dirname, "..", "..");
  const testText = readdirSync(join(root, "test", "unit"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(root, "test", "unit", f), "utf8"))
    .join("\n");
  const review = readFileSync(join(root, "docs", "DATEV-REVIEW.md"), "utf8");
  const table = review.slice(review.indexOf("## Requirement by requirement"));
  const rowsWithProof = table
    .split("\n")
    .filter((l) => /^\| [A-Z]/.test(l) && !l.startsWith("| Requirement"))
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((c) => c.length >= 5 && c[3]);
  assert.ok(rowsWithProof.length >= 19);
  for (const c of rowsWithProof) {
    const names = [...c[3]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    assert.ok(names.length, `${c[1]}: the proof names no test`);
    for (const n of names) assert.ok(testText.includes(`test("${n}"`), `${c[1]}: "${n}" is not a test`);
  }
});

test("tests and evals always keep their records in temporary folders, never the person's own", () => {
  const root = join(import.meta.dirname, "..", "..");
  const setup = readFileSync(join(root, "test", "setup.ts"), "utf8");
  const evals = readFileSync(join(root, "test", "evals", "run.ts"), "utf8");
  for (const [name, text] of [["test/setup.ts", setup], ["test/evals/run.ts", evals]] as const) {
    assert.match(text, /process\.env\.DATEV_MCP_HOME = mkdtempSync/, `${name} sets a temporary home unconditionally`);
    assert.match(text, /process\.env\.DATEV_MCP_LOG_DIR = mkdtempSync/, `${name} sets a temporary log folder unconditionally`);
  }
  assert.ok(process.env.DATEV_MCP_HOME?.startsWith(tmpdir()) || process.env.DATEV_MCP_HOME?.includes("datev-test-home-"));
});
