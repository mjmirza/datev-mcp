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

// Guards for ledger rows that were open before R6 (F16, F22, F23, F24, F39, F41, F42).
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
});

test("DATEV's API descriptions never ship: the package is private and the built index stays out of git", () => {
  const root = join(import.meta.dirname, "..", "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { private?: boolean };
  assert.equal(pkg.private, true, "no registry release can carry the built index");
  const ignored = readFileSync(join(root, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  for (const p of ["dist/", "src/data/operations.json"]) assert.ok(ignored.includes(p), `${p} is git-ignored`);
});
