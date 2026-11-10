import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import type { CallDeps } from "../../src/api/client.js";
import { clearClientGate } from "../../src/api/client-gate.js";
import { clearDataexchangeCache } from "../../src/api/dataexchange-guard.js";
import { requireClientService } from "../../src/api/permission.js";
import { ENDPOINTS } from "../../src/auth/endpoints.js";
import { envKeyStore } from "../../src/auth/session-key.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { endForMissingPermission } from "../../src/setup/disconnect.js";
import { documentGuid, registerDocumentTools } from "../../src/tools/documents.js";
import { registerExtfTools } from "../../src/tools/extf.js";
import { registerGenericTools } from "../../src/tools/generic.js";
import { registerUploadTools } from "../../src/tools/upload.js";

// Guards for the Codex attack of 2026-11-10 (ledger R4, F44 to F58).
process.env.DATEV_MCP_SESSION_KEY ??= "33".repeat(32);

type Seen = { method: string; path: string; url: string };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const dir = mkdtempSync(join(tmpdir(), "datev-r4-"));
const pdf = join(dir, "beleg.pdf");
writeFileSync(pdf, "%PDF-1.4 r4");

async function harness(answer: (s: Seen) => Response | Promise<Response>, extra: Partial<CallDeps> = {}) {
  clearClientGate();
  clearDataexchangeCache();
  const seen: Seen[] = [];
  const f: FetchLike = async (u, init) => {
    const url = String(u);
    const s = { method: (init?.method ?? "GET").toUpperCase(), path: new URL(url).pathname, url };
    seen.push(s);
    return answer(s);
  };
  const server = new McpServer({ name: "t", version: "0" });
  const deps = () => ({ env: "sandbox" as const, creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined, ...extra });
  registerGenericTools(server, deps);
  registerUploadTools(server, deps);
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
  return { seen, call, confirmed };
}

const client = (services: string[] = []) => ({ name: "Muster GmbH", consultant_number: 455148, client_number: 1, services: services.map((name) => ({ name })) });

async function extfFile(name: string, amount: number) {
  const h = await harness(() => json(200, {}));
  const out = join(dir, name);
  const r = await h.call("datev_write_extf_batch", { output_path: out, berater: "455148", mandant: "1", wj_start: "20260101", account_length: 8, from: "20260101", to: "20260131", label: name, rows: [{ amount_cents: amount, side: "S", account: "12000000", contra_account: "84000000", day: 3, month: 1, beleg1: "R4", text: "R4" }], lang: "de" });
  assert.equal(r.error, false, r.text);
  return out;
}

const extfDatev = (opts: { post?: (s: Seen) => Response | Promise<Response>; services?: string[]; clientStatus?: number } = {}) => (s: Seen) => {
  if (s.method === "GET" && /\/clients\/\d+-\d+$/.test(s.path)) return json(opts.clientStatus ?? 200, client(opts.services ?? ["Buchungsdatenservice"]));
  if (s.path.endsWith("/extf-files/import")) return opts.post ? opts.post(s) : json(202, {}, { location: "/clients/455148-1/extf-files/jobs/J9", "retry-after": "1" });
  if (s.path.includes("/jobs/J9")) return json(200, { id: "J9", result: "succeeded" });
  return json(200, {});
};

test("the permission check reads the client the URL targets, never a surplus parameter", async () => {
  const h = await harness(() => json(200, client()));
  await h.call("datev_call", { operation_id: "eau-api.getfeedbacks", path_params: { "client-id": "455148-1", consultantNumber: "455148", clientNumber: "99", personnelNumber: "00001", eauRequest: "R1" } });
  assert.match(h.seen[0]!.path, /\/clients\/455148-99$/, "the checked client is the one in the URL");
});

test("an hr-documents upload by GUID is checked through DATEV's client list", async () => {
  const GUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const h = await harness((s) => (s.path.endsWith("/clients") ? json(200, { clients: [{ client_guid: "other", consultant_number: 1000, client_number: 2 }] }) : json(200, client())));
  const r = await h.call("datev_upload_file", { operation_id: "hr-documents.uploaddocument", path_params: { client_guid: GUID }, files: { file: pdf } });
  assert.equal(r.error, true);
  assert.match(r.text, /not in this login's DATEV client list/);
  assert.ok(!h.seen.some((s) => s.method === "POST"), "nothing was uploaded");
});

test("two confirmed sends of the same EXTF file at once reach DATEV only once", async () => {
  const file = await extfFile("EXTF_R4A.csv", 4711);
  const h = await harness(extfDatev({ post: async () => (await new Promise((r) => setTimeout(r, 30)), json(202, {}, { location: "/clients/455148-1/extf-files/jobs/J9", "retry-after": "1" })) }));
  const args = { client_id: "455148-1", file_path: file };
  const [p1, p2] = await Promise.all([h.call("datev_upload_extf", args), h.call("datev_upload_extf", args)]);
  const tokens = [JSON.parse(p1.text).confirm_token, JSON.parse(p2.text).confirm_token];
  const results = await Promise.all(tokens.map((t) => h.call("datev_upload_extf", { ...args, confirm: true, confirm_token: t })));
  assert.equal(h.seen.filter((s) => s.method === "POST").length, 1);
  assert.equal(results.filter((r) => r.error && /already sent|being sent/.test(r.text)).length, 1);
});

test("a damaged send record refuses the send instead of forgetting earlier sends", async () => {
  const home = mkdtempSync(join(tmpdir(), "datev-r4-home-"));
  const prev = process.env.DATEV_MCP_HOME;
  process.env.DATEV_MCP_HOME = home;
  try {
    writeFileSync(join(home, "sent-sandbox.json"), "{not json");
    const file = await extfFile("EXTF_R4B.csv", 4712);
    const h = await harness(extfDatev());
    const r = await h.call("datev_upload_extf", { client_id: "455148-1", file_path: file });
    assert.equal(r.error, true);
    assert.match(r.text, /record of earlier sends .* is damaged/);
    assert.ok(!h.seen.some((s) => s.method === "POST"));
  } finally {
    if (prev === undefined) delete process.env.DATEV_MCP_HOME;
    else process.env.DATEV_MCP_HOME = prev;
  }
});

test("an EXTF send whose answer is lost still counts as sent", async () => {
  const file = await extfFile("EXTF_R4C.csv", 4713);
  const lost = await harness(extfDatev({ post: () => Promise.reject(new TypeError("socket hang up")) }));
  const first = await lost.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file });
  assert.equal(first.error, true);
  const again = await harness(extfDatev());
  const second = await again.call("datev_upload_extf", { client_id: "455148-1", file_path: file });
  assert.equal(second.error, true);
  assert.match(second.text, /answer never arrived/);
  assert.ok(!again.seen.some((s) => s.method === "POST"));
});

test("a missing Export permission revokes both tokens, and a failed revocation keeps the connection", async () => {
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  const session = { env: "sandbox" as const, clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } };
  const revoked: string[] = [];
  const okStore = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r4-s-")), envKeyStore());
  okStore.write(session);
  const okFetch: FetchLike = async (_u, init) => (revoked.push(String(new URLSearchParams(String(init?.body)).get("token_type_hint"))), new Response("", { status: 200 }));
  const done = await endForMissingPermission(cfg, { store: okStore, fetch: okFetch, httpLog: () => {} });
  assert.deepEqual(revoked.sort(), ["access_token", "refresh_token"]);
  assert.equal(okStore.read(), undefined, "the session is gone");
  assert.match(done, /both tokens revoked/);

  const failStore = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r4-s-")), envKeyStore());
  failStore.write(session);
  const failFetch: FetchLike = async (_u, init) => (String(init?.body).includes("refresh_token") ? new Response("{}", { status: 500 }) : new Response("", { status: 200 }));
  const kept = await endForMissingPermission(cfg, { store: failStore, fetch: failFetch, httpLog: () => {} });
  assert.match(kept, /did not confirm revoking the connection, so it was kept/);
  assert.deepEqual(failStore.read()?.pendingRevoke, ["RT"]);
});

test("a DATEV server error during the permission check never ends the connection", async () => {
  let ended = 0;
  const deps: CallDeps = {
    env: "sandbox",
    creds: { clientId: "c" },
    token: async () => "T",
    fetch: async () => json(500, { title: "down" }),
    sleep: async () => undefined,
    onMissingPermission: async () => (ended++, " ended"),
  };
  await assert.rejects(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps), /could not confirm the client's data services right now \(HTTP 500\)/);
  assert.equal(ended, 0);
});

test("datev_call of the fiscal year list runs the Export permission check", async () => {
  const h = await harness((s) => (/\/clients\/\d+-\d+$/.test(s.path) ? json(200, client([])) : json(200, [20230101])), { onMissingPermission: async () => " ended" });
  const r = await h.call("datev_call", { operation_id: "accounting-dataexchange.getfiscalyears", path_params: { clientId: "455148-1" } });
  assert.equal(r.error, true);
  assert.match(r.text, /has not switched on Datenservice Export Rechnungswesen/);
  assert.ok(!h.seen.some((s) => s.path.endsWith("/fiscal-years")), "the fiscal years were not read");
});

test("payroll report types are refused when DATEV lists no granted types", async () => {
  const h = await harness((s) => (/\/clients\/\d+-\d+$/.test(s.path) ? json(200, { ...client(), document_types: { access_denied: ["KOST"] } }) : json(200, {})));
  const r = await h.call("datev_call", { operation_id: "hr-payrollreports.getpdfdocuments", path_params: { "client-id": "455148-1", period: "2026-03-01" }, query: { document_types: "KOST" }, headers: { Accept: "application/pdf" } });
  assert.equal(r.error, true);
  assert.match(r.text, /does not grant the report types KOST\. Granted: none/);
  assert.equal(h.seen.length, 1);
});

test("a different filing of the same file gets its own DATEV document id", () => {
  const sha = "cd".repeat(32);
  const inbox = documentGuid("455148-1", sha, { service: "belegbilderservice", document_type: "Rechnungseingang" });
  assert.equal(documentGuid("455148-1", sha, { document_type: "Rechnungseingang", service: "belegbilderservice" }), inbox, "same filing, same id, whatever the key order");
  assert.notEqual(documentGuid("455148-1", sha, { service: "buchungsdatenservice", category: "App", folder: "ER", register: "2026/03" }), inbox);
  assert.notEqual(documentGuid("455148-1", sha, { service: "belegbilderservice", document_type: "Rechnungsausgang" }), inbox);
});

test("a Retry-After longer than the call is honored, not shortened", async () => {
  const file = await extfFile("EXTF_R4D.csv", 4714);
  const h = await harness(extfDatev({ post: () => json(202, {}, { location: "/clients/455148-1/extf-files/jobs/J9", "retry-after": "60" }) }));
  const r = await h.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file });
  assert.match(r.text, /DATEV asked to wait 60 seconds/);
  assert.ok(!h.seen.some((s) => s.path.includes("/jobs/J9")), "the job was not asked early");
});

test("document types read by one login are not reused for another", async () => {
  let token = "A";
  const types = () => (token === "A" ? ["TypeA"] : ["TypeB"]);
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, types().map((name) => ({ name }))) : json(200, client(["Belegbilderservice"]))), { token: async () => token });
  const args = { client_id: "455148-1", file_path: pdf, document_type: "TypeA" };
  assert.equal((await h.call("datev_upload_document", args)).error, false);
  token = "B";
  const r = await h.call("datev_upload_document", args);
  assert.equal(r.error, true);
  assert.match(r.text, /"TypeA" is not a document type of this client\. Available: TypeB/);
});

test("parallel uploads and the document type tool share one daily read", async () => {
  const h = await harness((s) => (s.path.endsWith("/document-types") ? new Promise<Response>((r) => setTimeout(() => r(json(200, [{ name: "Rechnungseingang" }])), 20)) : json(200, client(["Belegbilderservice"]))), { token: async () => "PAR" });
  const args = { client_id: "455148-3", file_path: pdf, document_type: "Rechnungseingang" };
  await Promise.all([h.call("datev_upload_document", args), h.call("datev_upload_document", args)]);
  await h.call("datev_document_types", { client_id: "455148-3" });
  assert.equal(h.seen.filter((s) => s.path.endsWith("/document-types")).length, 1);
});

test("an earlier send is not shown to a login without permission for the client", async () => {
  const file = await extfFile("EXTF_R4E.csv", 4715);
  const sent = await harness(extfDatev());
  assert.equal((await sent.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file })).error, false);
  const other = await harness(extfDatev({ services: [] }));
  const r = await other.call("datev_upload_extf", { client_id: "455148-1", file_path: file });
  assert.equal(r.error, true);
  assert.match(r.text, /has not switched on Buchungsdatenservice/);
  assert.doesNotMatch(r.text, /EXTF_R4E|job J9|already sent/);
});
