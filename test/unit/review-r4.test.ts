import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { callOperation, type CallDeps } from "../../src/api/client.js";
import { clearClientGate } from "../../src/api/client-gate.js";
import { clearDataexchangeCache } from "../../src/api/dataexchange-guard.js";
import { requireClientService } from "../../src/api/permission.js";
import { ENDPOINTS } from "../../src/auth/endpoints.js";
import { envKeyStore, loadOrCreateKey, type KeyStore } from "../../src/auth/session-key.js";
import { Session } from "../../src/auth/session.js";
import { revokePending } from "../../src/auth/pending-revoke.js";
import { selectServices, servicesForScopes, servicesOfSession, serviceList } from "../../src/auth/services.js";
import { localize, localizeApproval } from "../../src/i18n.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { disconnect, endForMissingPermission } from "../../src/setup/disconnect.js";
import { connectionStatus } from "../../src/setup/status.js";
import { doctor } from "../../src/setup/doctor.js";
import { documentGuid, registerDocumentTools } from "../../src/tools/documents.js";
import { registerExtfTools } from "../../src/tools/extf.js";
import { registerGenericTools } from "../../src/tools/generic.js";
import { registerUploadTools } from "../../src/tools/upload.js";
import { getOperation } from "../../src/tools/catalog.js";

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
  assert.match(second.text, /answer was lost or was a server error/);
  assert.ok(!again.seen.some((s) => s.method === "POST"));
});

test("a missing Export permission revokes both tokens, and an unconfirmed revocation is retried with no token left in use", async () => {
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
  assert.match(kept, /DATEV did not confirm revoking it, so it is revoked again on the next call/);
  const left = failStore.read()!;
  assert.deepEqual(left.pendingRevoke, ["RT"]);
  assert.equal(left.tokens.refreshToken, undefined, "an unconfirmed refresh token is never used to refresh again");
  assert.equal(left.tokens.expiresAt, 0, "the access token is never handed out again");
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

// Round 5: the Codex check of the R4 fixes, ledger F46 to F68.

test("a stapled upload follows the document rules of datev_upload_document", async () => {
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, [{ name: "Rechnungseingang" }]) : json(200, client(["Belegbilderservice", "Buchungsdatenservice"]))));
  const base = { operation_id: "accounting-documents.put_clients_client_id_documents_stapled", path_params: { "client-id": "455148-1" }, files: { files: [pdf] } };
  const invented = await h.call("datev_upload_file", { ...base, fields: { metadata: { document_type: "INVENTED" } } });
  assert.match(invented.text, /"INVENTED" is not a document type of this client/);
  const partial = await h.call("datev_upload_file", { ...base, fields: { metadata: { document_type: "Rechnungseingang", category: "App" } } });
  assert.match(partial.text, /needs category, folder and register together/);
  const none = await h.call("datev_upload_file", base);
  assert.match(none.text, /Belegbilderservice needs a document_type/);
  assert.ok(!h.seen.some((s) => s.method === "PUT"));
});

test("two deliberate resends at once reach DATEV only once", async () => {
  const file = await extfFile("EXTF_R5A.csv", 5101);
  const first = await harness(extfDatev());
  assert.equal((await first.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file })).error, false);
  const h = await harness(extfDatev({ post: async () => (await new Promise((r) => setTimeout(r, 30)), json(202, {}, { location: "/clients/455148-1/extf-files/jobs/J9", "retry-after": "1" })) }));
  const args = { client_id: "455148-1", file_path: file, resend: true };
  const previews = await Promise.all([h.call("datev_upload_extf", args), h.call("datev_upload_extf", args)]);
  await Promise.all(previews.map((p) => h.call("datev_upload_extf", { ...args, confirm: true, confirm_token: JSON.parse(p.text).confirm_token })));
  assert.equal(h.seen.filter((s) => s.method === "POST").length, 1);
});

test("a refused resend keeps the record of the earlier accepted send", async () => {
  const file = await extfFile("EXTF_R5B.csv", 5102);
  assert.equal((await (await harness(extfDatev())).confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file })).error, false);
  const refused = await harness(extfDatev({ post: () => json(400, { title: "bad" }) }));
  assert.equal((await refused.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file, resend: true })).error, true);
  const again = await (await harness(extfDatev())).call("datev_upload_extf", { client_id: "455148-1", file_path: file });
  assert.match(again.text, /already sent to this client/);
});

test("a send record with the wrong shape counts as damaged", async () => {
  const home = mkdtempSync(join(tmpdir(), "datev-r5-home-"));
  const prev = process.env.DATEV_MCP_HOME;
  process.env.DATEV_MCP_HOME = home;
  try {
    writeFileSync(join(home, "sent-sandbox.json"), JSON.stringify({ extf: [] }));
    const file = await extfFile("EXTF_R5C.csv", 5103);
    const r = await (await harness(extfDatev())).call("datev_upload_extf", { client_id: "455148-1", file_path: file });
    assert.match(r.text, /is damaged/);
  } finally {
    if (prev === undefined) delete process.env.DATEV_MCP_HOME;
    else process.env.DATEV_MCP_HOME = prev;
  }
});

test("a gateway error after the POST keeps the file counted as sent", async () => {
  const file = await extfFile("EXTF_R5D.csv", 5104);
  assert.equal((await (await harness(extfDatev({ post: () => json(503, {}) }))).confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file })).error, true);
  const again = await (await harness(extfDatev())).call("datev_upload_extf", { client_id: "455148-1", file_path: file });
  assert.match(again.text, /may already be imported/);
});

test("a send cancelled before it left releases its reservation", async () => {
  const file = await extfFile("EXTF_R5E.csv", 5105);
  const ctl = new AbortController();
  const h = await harness(extfDatev(), { signal: ctl.signal, token: async () => (ctl.abort(), "T") });
  const preview = JSON.parse((await (await harness(extfDatev())).call("datev_upload_extf", { client_id: "455148-1", file_path: file })).text);
  await h.call("datev_upload_extf", { client_id: "455148-1", file_path: file, confirm: true, confirm_token: preview.confirm_token });
  assert.ok(!h.seen.some((s) => s.method === "POST"), "nothing left");
  const again = await (await harness(extfDatev())).call("datev_upload_extf", { client_id: "455148-1", file_path: file });
  assert.equal(again.error, false, again.text);
});

test("no field value can imitate another in the document id", () => {
  const sha = "ef".repeat(32);
  const a = documentGuid("455148-1", sha, { service: "buchungsdatenservice", category: "x&folder=y", folder: "z", register: "2026/03" });
  const b = documentGuid("455148-1", sha, { service: "buchungsdatenservice", category: "x", folder: "y&folder=z", register: "2026/03" });
  assert.notEqual(a, b);
});

test("the same filing uploaded twice reaches the same DATEV document id", async () => {
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, [{ name: "Rechnungseingang" }]) : s.method === "PUT" ? json(201, {}) : json(200, client(["Belegbilderservice"]))));
  const args = { client_id: "455148-4", file_path: pdf, document_type: "Rechnungseingang" };
  await h.confirmed("datev_upload_document", args);
  await h.confirmed("datev_upload_document", args);
  const puts = h.seen.filter((s) => s.method === "PUT").map((s) => s.path);
  assert.equal(puts.length, 2);
  assert.equal(puts[0], puts[1]);
});

test("a token refresh keeps the daily document type read, a new login does not", async () => {
  let token = "A";
  let sub = "user-1";
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, [{ name: "Rechnungseingang" }]) : json(200, client(["Belegbilderservice"]))), { token: async () => token, identity: () => sub });
  const args = { client_id: "455148-5", file_path: pdf, document_type: "Rechnungseingang" };
  await h.call("datev_upload_document", args);
  token = "B";
  await h.call("datev_upload_document", args);
  assert.equal(h.seen.filter((s) => s.path.endsWith("/document-types")).length, 1, "refresh keeps the read");
  sub = "user-2";
  await h.call("datev_upload_document", args);
  assert.equal(h.seen.filter((s) => s.path.endsWith("/document-types")).length, 2, "another person reads again");
});

test("an hr-documents GUID mapping is never reused by another login", async () => {
  const GUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  let sub = "user-1";
  let list = [{ client_guid: GUID, consultant_number: 455148, client_number: 1 }];
  const h = await harness((s) => (s.path.endsWith("/clients") ? json(200, { clients: list }) : json(200, client())), { identity: () => sub });
  await h.call("datev_upload_file", { operation_id: "hr-documents.uploaddocument", path_params: { client_guid: GUID }, files: { file: pdf } });
  sub = "user-2";
  list = [];
  const r = await h.call("datev_upload_file", { operation_id: "hr-documents.uploaddocument", path_params: { client_guid: GUID }, files: { file: pdf } });
  assert.match(r.text, /not in this login's DATEV client list/);
});

test("a partly revoked connection never hands out the revoked access token again", async () => {
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r5-s-")), envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const f: FetchLike = async (_u, init) => (String(init?.body).includes("refresh_token") ? new Response("{}", { status: 500 }) : new Response("", { status: 200 }));
  await endForMissingPermission(cfg, { store, fetch: f, httpLog: () => {} });
  assert.ok((store.read()?.tokens.expiresAt ?? 1) <= Date.now(), "the revoked access token counts as expired");
});

test("one caller cancelling a shared document type read does not fail the others", async () => {
  const ctl = new AbortController();
  let calls = 0;
  const server = new McpServer({ name: "t", version: "0" });
  const f: FetchLike = async (u) => (new URL(String(u)).pathname.endsWith("/document-types") ? new Promise<Response>((r) => setTimeout(() => r(json(200, [{ name: "Rechnungseingang" }])), 30)) : json(200, client(["Belegbilderservice"])));
  registerDocumentTools(server, () => ({ env: "sandbox", creds: { clientId: "c" }, token: async () => "CANCEL", fetch: f, signal: calls++ === 0 ? ctl.signal : undefined }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const first = c.callTool({ name: "datev_document_types", arguments: { client_id: "455148-6" } });
  const second = c.callTool({ name: "datev_document_types", arguments: { client_id: "455148-6" } });
  setTimeout(() => ctl.abort(), 5);
  const [, r2] = (await Promise.all([first, second])) as { isError?: boolean; content: { text: string }[] }[];
  assert.notEqual(r2!.isError, true, r2!.content[0]!.text);
});

test("a cancelled document type read does not wait for a token that never comes", async () => {
  const ctl = new AbortController();
  const server = new McpServer({ name: "t", version: "0" });
  registerDocumentTools(server, () => ({ env: "sandbox", creds: { clientId: "c" }, token: () => new Promise<string>(() => {}), fetch: async () => json(200, []), signal: ctl.signal }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  setTimeout(() => ctl.abort(), 10);
  const started = Date.now();
  const r = (await c.callTool({ name: "datev_document_types", arguments: { client_id: "455148-8" } })) as { isError?: boolean };
  assert.equal(r.isError, true);
  assert.ok(Date.now() - started < 2000, "the cancel ended the wait");
});

// Guards for the Grok attack of 2026-11-10 (ledger R6, F66 to F73).

test("an EXTF send answered with a timeout or a redirect still counts as sent", async () => {
  for (const [i, status] of [408, 302].entries()) {
    const file = await extfFile(`EXTF_R6A${i}.csv`, 6100 + i);
    const first = await harness(extfDatev({ post: () => json(status, {}, status === 302 ? { location: "https://elsewhere.example/" } : {}) }));
    assert.equal((await first.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file })).error, true);
    const again = await harness(extfDatev());
    const r = await again.call("datev_upload_extf", { client_id: "455148-1", file_path: file });
    assert.match(r.text, /may already be imported/, `HTTP ${status}`);
    assert.ok(!again.seen.some((s) => s.method === "POST"));
  }
});

test("only a 403 or a missing service ends the connection, never a timeout, a bad token or an unknown client", async () => {
  for (const status of [400, 401, 404, 408]) {
    let ended = 0;
    const deps: CallDeps = { env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: async () => json(status, { title: "x" }), sleep: async () => undefined, onMissingPermission: async () => (ended++, " ended") };
    await assert.rejects(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps), /could not confirm/, `HTTP ${status}`);
    assert.equal(ended, 0, `HTTP ${status} must not end the connection`);
  }
  let ended = 0;
  const deps: CallDeps = { env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: async () => json(403, { title: "forbidden" }), sleep: async () => undefined, onMissingPermission: async () => (ended++, " ended") };
  await assert.rejects(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps));
  assert.equal(ended, 1);
});

test("an answer DATEV gave before the call was cancelled is kept, with its job id", async () => {
  const op = getOperation("accounting-extf-files.importextffile");
  assert.ok(op, "EXTF import operation");
  const ac = new AbortController();
  const r = await callOperation(op!, { pathParams: { "client-id": "455148-1" }, headers: { Filename: "EXTF_R6C.csv" }, rawBody: new Uint8Array([1]) }, {
    env: "sandbox",
    creds: { clientId: "c" },
    token: async () => "T",
    signal: ac.signal,
    sleep: async () => undefined,
    fetch: async () => (ac.abort(), json(202, {}, { location: "/clients/455148-1/extf-files/jobs/J7" })),
  });
  assert.equal(r.status, 202);
  assert.match(String(r.location), /J7/);
});

test("a resend that is lost after an accepted import still names the accepted job", async () => {
  const file = await extfFile("EXTF_R6B.csv", 6200);
  assert.equal((await (await harness(extfDatev())).confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file })).error, false);
  for (let n = 0; n < 2; n++) {
    const h = await harness(extfDatev({ post: () => json(503, {}) }));
    await h.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file, resend: true });
    const look = await (await harness(extfDatev())).call("datev_upload_extf", { client_id: "455148-1", file_path: file });
    assert.match(look.text, /DATEV already accepted it on .* \(job J9\)/, `after lost resend ${n + 1}`);
  }
});

test("a changed note reaches the same DATEV document, and a stapled upload is never repeated by accident", async () => {
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, [{ name: "Rechnungseingang" }]) : s.method === "PUT" ? json(201, {}) : json(200, client(["Belegbilderservice"]))));
  await h.confirmed("datev_upload_document", { client_id: "455148-6", file_path: pdf, document_type: "Rechnungseingang", note: "first" });
  await h.confirmed("datev_upload_document", { client_id: "455148-6", file_path: pdf, document_type: "Rechnungseingang", note: "second" });
  const puts = h.seen.filter((s) => s.method === "PUT").map((s) => s.path);
  assert.equal(puts[0], puts[1]);

  const stapledPdf = join(dir, "stapled-r6.pdf");
  writeFileSync(stapledPdf, "%PDF-1.4 r6 stapled");
  const base = { operation_id: "accounting-documents.put_clients_client_id_documents_stapled", path_params: { "client-id": "455148-6" }, files: { files: [stapledPdf] }, fields: { metadata: { document_type: "Rechnungseingang" } } };
  assert.equal((await h.confirmed("datev_upload_file", base)).error, false);
  const again = await h.call("datev_upload_file", base);
  assert.match(again.text, /already sent to this client/);
  const before = h.seen.filter((s) => s.method === "PUT").length;
  assert.equal((await h.confirmed("datev_upload_file", { ...base, resend: true })).error, false);
  assert.equal(h.seen.filter((s) => s.method === "PUT").length, before + 1, "resend: true sends again on purpose");
});

test("an empty document type answer is not kept for the rest of the day", async () => {
  let answer: { name: string }[] = [];
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, answer) : json(200, client(["Belegbilderservice"]))));
  const args = { client_id: "455148-7", file_path: pdf, document_type: "Rechnungseingang" };
  assert.match((await h.call("datev_upload_document", args)).text, /not a document type/);
  answer = [{ name: "Rechnungseingang" }];
  const r = await h.call("datev_upload_document", args);
  assert.equal(r.error, false, r.text);
});

test("the safety refusals for sends, permissions, the client gate and documents read fully in German", async () => {
  const { localize } = await import("../../src/i18n.js");
  const ENGLISH = /Nothing was|was sent|Try again|this client|connection was|switched on|Check the batch|DATEV requires|Available:|Granted:|not a document type|needs a document_type|does not take|is damaged|being sent|already accepted|not in this login|is not a consultant|could not confirm|answered HTTP/;
  const messages: string[] = [];
  const grab = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      messages.push((e as Error).message);
    }
  };
  const deps = (status: number, body: unknown, ended = " As DATEV requires, the connection was ended and both tokens revoked; sign in again after the service is switched on."): CallDeps => ({ env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: async () => json(status, body), sleep: async () => undefined, onMissingPermission: async () => ended });
  await grab(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps(500, { title: "down" })));
  await grab(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps(200, client([]))));
  await grab(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps(403, { title: "no" }, " The connection was ended here, but DATEV did not confirm revoking it, so it is revoked again on the next call. It can also be removed at https://apps.datev.de/tokrevui.")));

  const docs = await harness((s) => (s.path.endsWith("/document-types") ? json(200, [{ name: "Rechnungseingang" }]) : s.method === "PUT" ? json(201, {}) : json(200, client(["Belegbilderservice", "Buchungsdatenservice"]))));
  for (const args of [
    { client_id: "455148-8", file_path: pdf, document_type: "Rechnungseingang", category: "a", folder: "b", register: "c" },
    { client_id: "455148-8", file_path: pdf, service: "buchungsdatenservice", category: "a" },
    { client_id: "455148-8", file_path: pdf },
    { client_id: "455148-8", file_path: pdf, document_type: "INVENTED" },
  ])
    messages.push((await docs.call("datev_upload_document", args)).text);
  messages.push((await docs.call("datev_call", { operation_id: "accounting-dxso-jobs.get_clients_client_id", path_params: { "client-id": "abc" } })).text);
  const stapledPdf = join(dir, "stapled-r6-de.pdf");
  writeFileSync(stapledPdf, "%PDF-1.4 r6 de");
  const stapled = { operation_id: "accounting-documents.put_clients_client_id_documents_stapled", path_params: { "client-id": "455148-8" }, files: { files: [stapledPdf] }, fields: { metadata: { document_type: "Rechnungseingang" } } };
  await docs.confirmed("datev_upload_file", stapled);
  messages.push((await docs.call("datev_upload_file", stapled)).text);

  for (const [i, post] of [() => json(202, {}, { location: "/clients/455148-1/extf-files/jobs/J9", "retry-after": "1" }), () => json(503, {})].entries()) {
    const file = await extfFile(`EXTF_R6D${i}.csv`, 6300 + i);
    await (await harness(extfDatev({ post }))).confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file });
    messages.push((await (await harness(extfDatev())).call("datev_upload_extf", { client_id: "455148-1", file_path: file })).text);
  }

  assert.ok(messages.length >= 11);
  for (const m of messages) {
    const de = localize(m, "de");
    assert.doesNotMatch(de, ENGLISH, `still English: ${de.slice(0, 200)}`);
  }
});

// Guards for the Codex check of 2026-11-10 (ledger R7).

test("an expert scope login records the services its scopes cover, so no service boundary is skipped", () => {
  const hr = selectServices("hr-files").scopes;
  const covered = servicesForScopes(hr);
  assert.ok(covered.includes("hr-files"));
  for (const outside of ["accounting-clients", "cashregister", "smarttransfer-inbound"]) assert.ok(!covered.includes(outside), outside);
});

test("the services command reads in German", () => {
  assert.match(localize(serviceList(), "de"), /^Verfügbar, als --services/);
});

test("a stapled upload with reordered metadata or a changed note is still recognised as sent", async () => {
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, [{ name: "Rechnungseingang" }]) : s.method === "PUT" ? json(201, {}) : json(200, client(["Belegbilderservice"]))));
  const stapledPdf = join(dir, "stapled-r7.pdf");
  writeFileSync(stapledPdf, "%PDF-1.4 r7 stapled");
  const base = { operation_id: "accounting-documents.put_clients_client_id_documents_stapled", path_params: { "client-id": "455148-9" }, files: { files: [stapledPdf] } };
  assert.equal((await h.confirmed("datev_upload_file", { ...base, fields: { metadata: { document_type: "Rechnungseingang", note: "a" } } })).error, false);
  for (const metadata of [{ note: "a", document_type: "Rechnungseingang" }, { document_type: "Rechnungseingang", note: "b" }])
    assert.match((await h.call("datev_upload_file", { ...base, fields: { metadata } })).text, /already sent to this client/);
});

test("a permission refusal keeps DATEV's help link and title", async () => {
  const deps: CallDeps = { env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: async () => json(403, { type: "https://help.datev.de/403-x", title: "Forbidden here" }), sleep: async () => undefined, onMissingPermission: async () => "" };
  await assert.rejects(requireClientService("455148-1", ["Belegbilderservice"], deps), /help\.datev\.de\/403-x[\s\S]*|Forbidden here/);
  await assert.rejects(requireClientService("455148-1", ["Belegbilderservice"], deps), (e: Error) => e.message.includes("https://help.datev.de/403-x"));
});

test("the session key of a per-user credential store is created under one lock for every home folder", () => {
  const lockHome = mkdtempSync(join(tmpdir(), "datev-r7-userlock-"));
  const lock = join(lockHome, "key-lock");
  let kept: Buffer | undefined;
  const seen: boolean[] = [];
  const store: KeyStore = { name: "test keychain", userLock: () => lock, get: () => kept, set: (k) => (seen.push(existsSync(join(lock, "session-key.lock"))), (kept = k)) };
  const before = process.env.TMPDIR;
  try {
    // Two processes of one user may differ in TMPDIR and DATEV_MCP_HOME; the lock must not.
    for (const t of [mkdtempSync(join(tmpdir(), "datev-r8-a-")), mkdtempSync(join(tmpdir(), "datev-r8-b-"))]) {
      process.env.TMPDIR = t;
      kept = undefined;
      loadOrCreateKey(store, mkdtempSync(join(tmpdir(), "datev-r7-home-")));
    }
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
  assert.deepEqual(seen, [true, true], "both creations ran under the same per-user lock");
});

test("an EXTF file DATEV accepted returns its job id even when asking for the result fails", async () => {
  const file = await extfFile("EXTF_R7A.csv", 7100);
  const h = await harness(extfDatev({}), {});
  const fail = await harness((s) => (s.path.includes("/jobs/J9") ? Promise.reject(new TypeError("socket hang up")) : extfDatev()(s)));
  const r = await fail.confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file });
  assert.match(r.text, /J9/);
  assert.match(r.text, /Do not send the file again/);
  void h;
});

test("an ended connection never hands out a token, and its unconfirmed access token is still revoked later", async () => {
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r7-s-")), envKeyStore());
  const expiresAt = Date.now() + 9e5;
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt, obtainedAt: Date.now() } });
  await endForMissingPermission(cfg, { store, fetch: async () => new Response("{}", { status: 500 }), httpLog: () => {} });
  const s = store.read()!;
  assert.equal(s.ended, true);
  assert.equal(s.tokens.expiresAt, expiresAt, "the real expiry is kept so the access token is revoked again");
  await assert.rejects(new Session(store, ENDPOINTS.sandbox, cfg.creds).accessToken(), /connection was ended/);
  const hints: string[] = [];
  await revokePending(store, ENDPOINTS.sandbox, cfg.creds, { fetch: async (_u, init) => (hints.push(String(new URLSearchParams(String(init?.body)).get("token_type_hint"))), new Response("", { status: 200 })) });
  assert.deepEqual(hints.sort(), ["access_token", "refresh_token"]);
  assert.equal(store.read()!.tokens.expiresAt, 0);
});

test("a write answered with a redirect never claims that nothing changed", async () => {
  const h = await harness((s) => (s.method === "GET" ? json(200, client(["Rechnungsdatenservice 1.0"])) : new Response(null, { status: 303, headers: { location: "https://x.example/r" } })));
  const r = await h.confirmed("datev_call", { operation_id: "accounting-dxso-jobs.post_clients_client_id_dxso_jobs", path_params: { "client-id": "455148-1" }, body: { job_type: "x" } });
  assert.equal(r.error, true);
  assert.doesNotMatch(r.text, /Nothing was read or changed/);
  assert.match(r.text, /may already have applied this change/);
});

test("the income tax health check stays reachable when its service was chosen", async () => {
  let sent = 0;
  const op = getOperation("my-tax-mytax-income-tax-documents-health.health")!;
  await callOperation(op, {}, { env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", sleep: async () => undefined, chosenServices: new Set(["my-tax-income-tax-documents"]), fetch: async () => (sent++, json(200, {})) });
  assert.equal(sent, 1);
});

test("German approvals translate the client labels, never the client's name", () => {
  assert.equal(localizeApproval("Client: Best client 123 GmbH (consultant 455148, client 1)", "de"), "Mandant: Best client 123 GmbH (Berater 455148, Mandant 1)");
  assert.equal(localizeApproval("Client: ACME, client 123", "de"), "Mandant: ACME, client 123", "a name DATEV sent without numbers stays as it is");
});

test("a send record keeps the accepted import but does not grow with every resend", async () => {
  const file = await extfFile("EXTF_R7B.csv", 7200);
  assert.equal((await (await harness(extfDatev())).confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file })).error, false);
  for (let n = 0; n < 4; n++) await (await harness(extfDatev({ post: () => json(503, {}) }))).confirmed("datev_upload_extf", { client_id: "455148-1", file_path: file, resend: true });
  const { sentBefore } = await import("../../src/tools/sent-ledger.js");
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const e = sentBefore("extf", "sandbox", "455148-1", createHash("sha256").update(readFileSync(file)).digest("hex"))!;
  let depth = 0;
  for (let x = e.previous; x; x = x.previous) depth++;
  assert.ok(depth <= 2, `depth ${depth}`);
  assert.match((await (await harness(extfDatev())).call("datev_upload_extf", { client_id: "455148-1", file_path: file })).text, /\(job J9\)/);
});

test("a client access refusal from the client gate reads fully in German", async () => {
  const h = await harness((s) => (s.method === "GET" && /\/clients\/\d+-\d+$/.test(s.path) ? json(404, { title: "Not found", type: "https://help.datev.de/404" }) : json(200, {})));
  const r = await h.call("datev_call", { operation_id: "accounting-dxso-jobs.get_clients_client_id_dxso_jobs_job_id", path_params: { "client-id": "455148-1", "job-id": "J1" } });
  assert.match(r.text, /Access to client 455148-1 could not be confirmed/);
  const de = localize(r.text, "de");
  assert.doesNotMatch(de, /Access to client|Please check|Nothing was sent|could not be confirmed/, de);
});

// Guards for the Codex check of 2026-11-10 (ledger R8).

test("a saved expert login without a service list is bounded by the services its scopes cover", async () => {
  const hr = selectServices("hr-files").scopes;
  const covered = servicesOfSession({ scopes: hr })!;
  let sent = 0;
  const op = getOperation("cashregister.gettenants")!;
  await assert.rejects(callOperation(op, {}, { env: "sandbox", creds: { clientId: "c" }, token: async () => "T", sleep: async () => undefined, chosenServices: new Set(covered), fetch: async () => (sent++, json(200, [])) }), /not part of the connected data services/);
  assert.equal(sent, 0);
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r8-doc-")), envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", scopes: hr, tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const urls: string[] = [];
  await doctor({ env: "sandbox", endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid", clientSecret: "s" } }, { store, fetch: async (u) => (urls.push(String(u)), json(200, { sub: "u" })), httpLog: () => {} });
  assert.ok(!urls.some((u) => u.endsWith("/clients")), urls.join(" "));
});

test("a partial expert scope set keeps the health check of the service it touches", async () => {
  assert.ok(servicesForScopes(["openid", "datev:master-data:master-clients:read"]).includes("master-data-master-clients"));
});

test("previews and approvals hide the technical client id but never other values that look like it", async () => {
  const h = await harness((s) => (s.method === "GET" ? json(200, client(["Rechnungsdatenservice 1.0"])) : json(201, {})));
  const args = { operation_id: "accounting-dxso-jobs.post_clients_client_id_dxso_jobs", path_params: { "client-id": "455148-1" }, body: { note: "455148-1", job_type: "x" } };
  const preview = await h.call("datev_call", args);
  assert.ok(!JSON.parse(preview.text).url.includes("455148-1"), "the preview URL hides the technical id");
  assert.ok(!JSON.stringify(JSON.parse(preview.text).client).includes("455148-1"));
  assert.match(preview.text, /"note":"455148-1"|"note": "455148-1"/, "a body value equal to the id is shown as it is");
});

test("a permission refusal keeps DATEV's title as well as its link, also for a very long answer", async () => {
  let ended = 0;
  const long = { type: "https://help.datev.de/403-y", title: "Forbidden title", detail: "x".repeat(110_000) };
  const deps: CallDeps = { env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: async () => json(403, long), sleep: async () => undefined, onMissingPermission: async () => (ended++, "") };
  await assert.rejects(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps), (e: Error) => e.message.includes("https://help.datev.de/403-y") && e.message.includes("Forbidden title"));
  assert.equal(ended, 1, "a long 403 still ends the connection, as a missing permission");
});

test("a disconnect whose revoke answer is lost never uses the refresh token again", async () => {
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r8-d-")), envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: 0, obtainedAt: 0 } });
  const r = await disconnect(cfg, { store, fetch: async () => Promise.reject(new TypeError("socket hang up")), httpLog: () => {} });
  assert.equal(r.removed, false);
  const tokenCalls: string[] = [];
  await assert.rejects(new Session(store, ENDPOINTS.sandbox, cfg.creds, { fetch: async (u) => (tokenCalls.push(String(u)), json(200, {})) }).accessToken(), /connection was ended/);
  assert.deepEqual(tokenCalls.filter((u) => u === ENDPOINTS.sandbox.token), [], "the refresh token is never sent to /token again");
  assert.deepEqual(store.read()!.pendingRevoke, ["RT"]);
});

test("an access token still open after the refresh token was revoked keeps being retried by the status", async () => {
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r8-s-")), envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", ended: true, tokens: { accessToken: "AT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  const hints: string[] = [];
  const f: FetchLike = async (u, init) => (String(u) === ENDPOINTS.sandbox.revoke ? (hints.push(String(new URLSearchParams(String(init?.body)).get("token_type_hint"))), new Response("", { status: 200 })) : json(401, {}));
  await connectionStatus(cfg, { store, fetch: f, httpLog: () => {} });
  assert.deepEqual(hints, ["access_token"], "no refresh token is queued, the access token is still revoked");
  assert.equal(store.read()!.tokens.expiresAt, 0);
});

test("lost answers and the EXTF result note read in German", async () => {
  const stapledPdf = join(dir, "stapled-r8.pdf");
  writeFileSync(stapledPdf, "%PDF-1.4 r8 lost");
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, [{ name: "Rechnungseingang" }]) : s.method === "PUT" ? Promise.reject(new TypeError("socket hang up")) : json(200, client(["Belegbilderservice"]))));
  const lost = await h.confirmed("datev_upload_file", { operation_id: "accounting-documents.put_clients_client_id_documents_stapled", path_params: { "client-id": "455148-2" }, files: { files: [stapledPdf] }, fields: { metadata: { document_type: "Rechnungseingang" } } });
  assert.match(localize(lost.text, "de"), /^DATEV hat nicht geantwortet: /);
  const note = "DATEV accepted the file, but asking for the result stopped (DATEV did not answer: socket hang up). Check with datev_extf_job (client_id 455148-1, job_id J9). Do not send the file again.";
  assert.doesNotMatch(localize(note, "de"), /accepted|Check with|Do not send|did not answer/);
});

test("a stapled upload answered 429 counts as possibly stored, not as refused", async () => {
  const stapledPdf = join(dir, "stapled-r8-429.pdf");
  writeFileSync(stapledPdf, "%PDF-1.4 r8 429");
  const h = await harness((s) => (s.path.endsWith("/document-types") ? json(200, [{ name: "Rechnungseingang" }]) : s.method === "PUT" ? json(429, { title: "slow down" }) : json(200, client(["Belegbilderservice"]))));
  const base = { operation_id: "accounting-documents.put_clients_client_id_documents_stapled", path_params: { "client-id": "455148-3" }, files: { files: [stapledPdf] }, fields: { metadata: { document_type: "Rechnungseingang" } } };
  await h.confirmed("datev_upload_file", base);
  assert.match((await h.call("datev_upload_file", base)).text, /already sent to this client/);
});

test("a send record with a damaged earlier entry counts as damaged", async () => {
  const home = mkdtempSync(join(tmpdir(), "datev-r8-home-"));
  writeFileSync(join(home, "sent-sandbox.json"), JSON.stringify({ extf: { "455148-1": { abc: { at: "2026-11-10T00:00:00Z", name: "x", status: "uncertain", previous: { status: "sent" } } } } }));
  const { sentBefore } = await import("../../src/tools/sent-ledger.js");
  assert.throws(() => sentBefore("extf", "sandbox", "455148-1", "abc", { DATEV_MCP_HOME: home }), /damaged/);
});

// Guards for the Codex check of 2026-11-10 (ledger R9).

test("a saved login known only by DATEV's granted scopes is bounded by them, and an unknown one fails closed", async () => {
  const hr = selectServices("hr-files").scopes.join(" ");
  const covered = servicesOfSession({ tokens: { scope: hr } })!;
  assert.ok(covered.includes("hr-files") && !covered.includes("cashregister"), covered.join(","));
  assert.deepEqual(servicesOfSession({}), [], "a login with no service and no scope opens nothing without its own scope");
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r9-doc-")), envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now(), scope: hr } });
  const urls: string[] = [];
  await doctor({ env: "sandbox", endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid", clientSecret: "s" } }, { store, fetch: async (u) => (urls.push(String(u)), json(200, { sub: "u" })), httpLog: () => {} });
  assert.ok(!urls.some((u) => u.endsWith("/clients")), urls.join(" "));
});

test("a scope every service shares, like openid, never connects a service on its own", () => {
  const hr = selectServices("hr-files").scopes;
  const got = servicesForScopes(hr);
  assert.ok(got.includes("hr-files"), got.join(","));
  assert.ok(!got.includes("master-data-master-clients") && !got.includes("accounting-dataexchange"), got.join(","));
});

test("an access token DATEV did not confirm as revoked stays on record, after a disconnect and after ending for a missing permission", async () => {
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  const f: FetchLike = async (_u, init) => (new URLSearchParams(String(init?.body)).get("token_type_hint") === "access_token" ? Promise.reject(new TypeError("socket hang up")) : new Response("", { status: 200 }));
  for (const run of [(store: TokenStore) => disconnect(cfg, { store, fetch: f, httpLog: () => {} }), (store: TokenStore) => endForMissingPermission(cfg, { store, fetch: f, httpLog: () => {} })]) {
    const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r9-rv-")), envKeyStore());
    const expiresAt = Date.now() + 9e5;
    store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt, obtainedAt: Date.now() } });
    await run(store);
    const s = store.read();
    assert.ok(s, "the session is kept so the access token is revoked again");
    assert.equal(s!.ended, true);
    assert.equal(s!.tokens.refreshToken, undefined);
    assert.equal(s!.tokens.expiresAt, expiresAt);
  }
});

test("a successful datev_call answer names the client, never its technical id in DATEV's addresses", async () => {
  const h = await harness((s) => (s.method === "GET" && /\/clients\/\d+-\d+$/.test(s.path) ? json(200, client(["Rechnungsdatenservice 1.0"])) : json(200, { id: "J1" }, { location: "/clients/455148-1/dxso-jobs/J1" })));
  const r = await h.call("datev_call", { operation_id: "accounting-dxso-jobs.get_clients_client_id_dxso_jobs_job_id", path_params: { "client-id": "455148-1", "job-id": "J1" } });
  assert.equal(r.error, false, r.text);
  const out = JSON.parse(r.text);
  assert.ok(!out.url.includes("455148-1"), out.url);
  assert.equal(out.client.name, "Muster GmbH");
});

test("a permission refusal keeps DATEV's title and link even when the detail before them is larger than the read limit", async () => {
  let ended = 0;
  const long = { detail: "x".repeat(2_100_000), type: "https://help.datev.de/403-z", title: "Forbidden later title" };
  const deps: CallDeps = { env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: async () => json(403, long), sleep: async () => undefined, onMissingPermission: async () => (ended++, "") };
  await assert.rejects(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps), (e: Error) => e.message.includes("https://help.datev.de/403-z") && e.message.includes("Forbidden later title"));
  assert.equal(ended, 1);
});

test("an EXTF note whose bracket holds several sentences reads fully in German", () => {
  const note = "DATEV accepted the file, but asking for the result stopped (Ran out of time while waiting for DATEV to answer. Try again, or narrow the request.). Check with datev_extf_job (client_id 455148-1, job_id J9). Do not send the file again.";
  const de = localize(note, "de");
  assert.doesNotMatch(de, /accepted|Ran out of time|Try again|Check with|Do not send/, de);
});

test("a client whose name starts with the words unnamed client keeps its name in German", () => {
  assert.equal(localizeApproval("Client: unnamed client GmbH (consultant 455148, client 1)", "de"), "Mandant: unnamed client GmbH (Berater 455148, Mandant 1)");
  assert.equal(localizeApproval("Client: unnamed client (consultant 455148, client 1)", "de"), "Mandant: Mandant ohne Namen (Berater 455148, Mandant 1)");
});

test("a send record whose status is not a plain text counts as damaged, and a long history from an older version is still read", async () => {
  const home = mkdtempSync(join(tmpdir(), "datev-r9-home-"));
  const { sentBefore } = await import("../../src/tools/sent-ledger.js");
  writeFileSync(join(home, "sent-sandbox.json"), JSON.stringify({ extf: { "455148-1": { abc: { at: "2026-11-10T00:00:00Z", name: "x", status: ["sending"] } } } }));
  assert.throws(() => sentBefore("extf", "sandbox", "455148-1", "abc", { DATEV_MCP_HOME: home }), /damaged/);
  let chain: Record<string, unknown> | undefined;
  for (let n = 0; n < 12; n++) chain = { at: `2026-11-${String(n + 1).padStart(2, "0")}T00:00:00Z`, name: "x", status: n === 0 ? "sent" : "uncertain", ...(chain ? { previous: chain } : {}) };
  writeFileSync(join(home, "sent-sandbox.json"), JSON.stringify({ extf: { "455148-1": { abc: chain } } }));
  assert.equal(sentBefore("extf", "sandbox", "455148-1", "abc", { DATEV_MCP_HOME: home })!.status, "uncertain");
});

// Guards for the Grok attack of 2026-11-10 (ledger R10).

const streamed = (status: number, contentType: string, chunks: Iterable<Uint8Array>, pulled = { bytes: 0 }) => {
  const it = chunks[Symbol.iterator]();
  return new Response(new ReadableStream<Uint8Array>({ pull(c) { const n = it.next(); if (n.done) c.close(); else { pulled.bytes += n.value.length; c.enqueue(n.value); } } }), { status, headers: { "content-type": contentType } });
};
const readDeps = (f: FetchLike): CallDeps => ({ env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined, maxBodyChars: 1000 });

test("an error answer sent in tiny pieces past the read limit is scanned quickly and keeps DATEV's title", async () => {
  const enc = new TextEncoder();
  function* body() {
    yield enc.encode(`{"detail":"`);
    for (let n = 0; n < 300_000; n++) yield enc.encode("x");
    yield enc.encode(`","type":"https://help.datev.de/tiny","title":"Tiny title"}`);
  }
  // Best of two runs, so a moment of load on the machine is not read as a slow scanner.
  const times: number[] = [];
  for (let run = 0; run < 2; run++) {
    const started = Date.now();
    const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, readDeps(async () => streamed(403, "application/json", body())));
    times.push(Date.now() - started);
    assert.equal((r.body as Record<string, unknown>).title, "Tiny title");
    if (times[run]! < 5000) break;
  }
  assert.ok(Math.min(...times) < 5000, `took ${times.join(" and ")} ms`);
});

test("a non-JSON error answer is not read past the read limit", async () => {
  const pulled = { bytes: 0 };
  function* body() {
    for (let n = 0; n < 1000; n++) yield new Uint8Array(4096).fill(120);
  }
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, readDeps(async () => streamed(500, "text/html", body(), pulled)));
  assert.equal(r.truncated, true);
  assert.ok(pulled.bytes < 200_000, `${pulled.bytes} bytes read`);
});

test("a title just after the read limit and far from the end of the answer is still kept", async () => {
  const enc = new TextEncoder();
  const head = `{"detail":"${"x".repeat(5000)}","title":"GAP TITLE","type":"https://help.datev.de/gap","more":"${"y".repeat(80_000)}"}`;
  const bytes = enc.encode(head);
  function* body() {
    for (let at = 0; at < bytes.length; at += 1000) yield bytes.subarray(at, at + 1000);
  }
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, readDeps(async () => streamed(403, "application/problem+json", body())));
  assert.equal((r.body as Record<string, unknown>).title, "GAP TITLE");
  assert.equal((r.body as Record<string, unknown>).type, "https://help.datev.de/gap");
});

test("a refused call on an ended connection retries the revoke and keeps an unconfirmed access token on record", async () => {
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r10-s-")), envKeyStore());
  const later = Date.now() + 9e5;
  store.write({ env: "sandbox", clientId: "cid", ended: true, tokens: { accessToken: "AT", expiresAt: later, obtainedAt: Date.now() }, pendingAccessRevoke: [{ token: "OLD-AT", expiresAt: later }] });
  const bodies: string[] = [];
  const f: FetchLike = async (_u, init) => (bodies.push(String(init?.body)), new URLSearchParams(String(init?.body)).get("token") === "OLD-AT" ? Promise.reject(new TypeError("socket hang up")) : new Response("", { status: 200 }));
  await assert.rejects(new Session(store, ENDPOINTS.sandbox, { clientId: "cid" }, { fetch: f }).accessToken(), /connection was ended here and is not used again/);
  for (let n = 0; n < 50 && store.read()!.tokens.expiresAt !== 0; n++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(bodies.some((b) => b.includes("token=AT&")) || bodies.some((b) => /token=AT($|&)/.test(b)), bodies.join(" | "));
  assert.equal(store.read()!.tokens.expiresAt, 0, "the confirmed access token is done");
  assert.deepEqual(store.read()!.pendingAccessRevoke, [{ token: "OLD-AT", expiresAt: later }], "the unconfirmed one stays on record");
});

test("a datev_call to an operation the client gate does not check hides the id in its path and query", async () => {
  const h = await harness(() => json(200, {}, { location: "/clients/455148-1/x?next=/clients/455148-1/jobs&client-id=455148-1" }));
  const r = await h.call("datev_call", { operation_id: "accounting-clients.getclient", path_params: { "client-id": "455148-1" } });
  assert.equal(r.error, false, r.text);
  const out = JSON.parse(r.text);
  assert.ok(!out.url.includes("455148-1"), out.url);
  assert.ok(!out.location.includes("455148-1"), out.location);
});

test("German keeps a client name that starts with unnamed client, and translates every sentence after an open bracket", () => {
  assert.equal(localizeApproval("Client: unnamed client (Ost) (consultant 455148, client 1)", "de"), "Mandant: unnamed client (Ost) (Berater 455148, Mandant 1)");
  assert.doesNotMatch(localize("Nothing was sent. (See the note. Try again later.", "de"), /Try again later/);
});

test("an empty stored service list falls back to the scopes DATEV granted", () => {
  const hr = selectServices("hr-files").scopes.join(" ");
  assert.ok(servicesOfSession({ services: [], tokens: { scope: hr } })!.includes("hr-files"));
});

// Guards for the Codex check of 2026-11-10 (ledger R11).

const errorFields = async (chunks: Iterable<Uint8Array>, contentType = "application/json") =>
  (await callOperation(getOperation("accounting-clients.getclients")!, {}, readDeps(async () => streamed(403, contentType, chunks)))).body as Record<string, unknown>;
const enc = new TextEncoder();

test("a permission refusal far larger than the permission check's read limit keeps the title and link at its end", async () => {
  let ended = 0;
  function* body() {
    yield enc.encode(`{"detail":"`);
    const block = new Uint8Array(1024 * 1024).fill(120);
    for (let n = 0; n < 20; n++) yield block;
    yield enc.encode(`","type":"https://help.datev.de/late","title":"LATE TITLE"}`);
  }
  const deps: CallDeps = { env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: async () => streamed(403, "application/json", body()), sleep: async () => undefined, onMissingPermission: async () => (ended++, "") };
  await assert.rejects(requireClientService("455148-1", ["Datenservice Export Rechnungswesen"], deps), (e: Error) => e.message.includes("LATE TITLE") && e.message.includes("https://help.datev.de/late"));
  assert.equal(ended, 1);
});

test("the error scan costs the same per byte however small the pieces are", async () => {
  function* body() {
    yield enc.encode(`{"detail":"`);
    // Escaped quotes, so every rescan has to stop at each one instead of skipping ahead.
    const one = enc.encode('\\"');
    for (let n = 0; n < 300_000; n++) yield one;
    yield enc.encode(`","title":"T"}`);
  }
  // Best of two runs, so a moment of load on the machine is not read as a slow scanner.
  const times: number[] = [];
  for (let run = 0; run < 2; run++) {
    const started = Date.now();
    assert.equal((await errorFields(body())).title, "T");
    times.push(Date.now() - started);
    if (times[run]! < 5000) break;
  }
  assert.ok(Math.min(...times) < 5000, `took ${times.join(" and ")} ms`);
});

test("the error scan keeps a help link and request id that come after the title", async () => {
  function* body() {
    yield enc.encode(`{"detail":"${"x".repeat(5000)}","title":"T","type":"about:blank"`);
    yield enc.encode(" ".repeat(10));
    yield enc.encode(`,"help_url":"https://help.datev.de/after","request_id":"R-9"}`);
  }
  const f = await errorFields(body());
  assert.equal(f.help_url, "https://help.datev.de/after");
  assert.equal(f.request_id, "R-9");
});

test("a character cut at the read limit is read whole", async () => {
  const bytes = enc.encode(`{"detail":"${"x".repeat(5000)}","title":"Prüfung"}`);
  const at = bytes.indexOf(0xc3);
  function* body() {
    yield bytes.subarray(0, at + 1);
    yield bytes.subarray(at + 1);
  }
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, { ...readDeps(async () => streamed(403, "application/json", body())), maxBodyChars: Math.floor((at + 1 - 4) / 4) });
  assert.equal((r.body as Record<string, unknown>).title, "Prüfung");
});

test("a character cut between two scan batches is read whole", async () => {
  // The 64 KB scan batch ends after byte 65535, where the title's first ü starts.
  const pre = `{"detail":"${"x".repeat(65_535 - 22)}","title":"`;
  const bytes = enc.encode(`${pre}üü"}`);
  assert.equal(bytes[65_535], 0xc3);
  function* body() {
    yield bytes.subarray(0, 4005);
    for (let i = 4005; i < bytes.length; i++) yield bytes.subarray(i, i + 1);
  }
  assert.equal((await errorFields(body())).title, "üü");
});

test("an error answer that goes quiet past the read limit is not waited for", async () => {
  const head = enc.encode(`{"detail":"${"x".repeat(5000)}","title":"Quiet"`);
  const res = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(head); } }), { status: 403, headers: { "content-type": "application/json" } });
  const started = Date.now();
  const r = await callOperation(getOperation("accounting-clients.getclients")!, {}, readDeps(async () => res));
  assert.ok(Date.now() - started < 6000, `took ${Date.now() - started} ms`);
  assert.equal((r.body as Record<string, unknown>).title, "Quiet");
});

test("ending a connection also revokes an earlier login's access token, and keeps it when DATEV does not confirm", async () => {
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  const later = Date.now() + 9e5;
  for (const run of [(store: TokenStore, f: FetchLike) => disconnect(cfg, { store, fetch: f, httpLog: () => {} }), (store: TokenStore, f: FetchLike) => endForMissingPermission(cfg, { store, fetch: f, httpLog: () => {} })]) {
    for (const confirm of [true, false]) {
      const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r11-old-")), envKeyStore());
      store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "NEW-AT", refreshToken: "NEW-RT", expiresAt: later, obtainedAt: Date.now() }, pendingAccessRevoke: [{ token: "OLD-AT", expiresAt: later }] });
      const sent: string[] = [];
      const f: FetchLike = async (_u, init) => {
        const token = String(new URLSearchParams(String(init?.body)).get("token"));
        sent.push(token);
        return token === "OLD-AT" && !confirm ? Promise.reject(new TypeError("socket hang up")) : new Response("", { status: 200 });
      };
      await run(store, f);
      assert.ok(sent.includes("OLD-AT"), sent.join(","));
      if (confirm) assert.equal(store.read(), undefined);
      else assert.deepEqual(store.read()!.pendingAccessRevoke, [{ token: "OLD-AT", expiresAt: later }]);
    }
  }
});

test("a second disconnect still revokes an access token DATEV did not confirm the first time", async () => {
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r11-2nd-")), envKeyStore());
  const later = Date.now() + 9e5;
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: later, obtainedAt: Date.now() } });
  const hints: string[] = [];
  const fail: FetchLike = async (_u, init) => (new URLSearchParams(String(init?.body)).get("token_type_hint") === "access_token" ? Promise.reject(new TypeError("socket hang up")) : new Response("", { status: 200 }));
  await disconnect(cfg, { store, fetch: fail, httpLog: () => {} });
  const ok: FetchLike = async (_u, init) => (hints.push(String(new URLSearchParams(String(init?.body)).get("token_type_hint"))), new Response("", { status: 200 }));
  const r = await disconnect(cfg, { store, fetch: ok, httpLog: () => {} });
  assert.deepEqual(hints, ["access_token"]);
  assert.equal(r.removed, true);
});

test("many refused calls on an ended connection send one revoke, not one each", async () => {
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r11-storm-")), envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", ended: true, tokens: { accessToken: "AT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() } });
  let revokes = 0;
  const s = new Session(store, ENDPOINTS.sandbox, { clientId: "cid" }, { fetch: async () => (revokes++, Promise.reject(new TypeError("down"))) });
  await Promise.all(Array.from({ length: 30 }, () => s.accessToken().catch(() => undefined)));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(revokes, 1);
});

test("an expired access token waiting for its revoke is dropped from the record", async () => {
  const store = new TokenStore("sandbox", mkdtempSync(join(tmpdir(), "datev-r11-exp-")), envKeyStore());
  store.write({ env: "sandbox", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() }, pendingAccessRevoke: [{ token: "OLD", expiresAt: Date.now() - 1 }] });
  await revokePending(store, ENDPOINTS.sandbox, { clientId: "cid" }, { fetch: async () => new Response("", { status: 200 }) });
  assert.equal(store.read()!.pendingAccessRevoke, undefined);
});

test("only a declared client path parameter is hidden, also as a consultant and client number pair and when percent-encoded", async () => {
  const h = await harness(() => json(200, {}, { location: "/jobs/J1?next=%2Fclients%2F455148-1%2Fjobs&client-id=455148%2D1" }));
  const r1 = await h.call("datev_call", { operation_id: "accounting-clients.getclient", path_params: { "client-id": "455148-1", unusedClientId: "J1" } });
  const o1 = JSON.parse(r1.text);
  assert.match(o1.location, /\/jobs\/J1/, "an undeclared parameter hides nothing");
  assert.ok(!decodeURIComponent(o1.location).includes("455148-1"), o1.location);
  const r2 = await h.call("datev_call", { operation_id: "eau-api.getclients", path_params: { consultantNumber: "455148", clientNumber: "1" } });
  assert.ok(!JSON.parse(r2.text).url.includes("455148-1"), JSON.parse(r2.text).url);
});

test("a damaged entry deep in a send record's history counts as damaged", async () => {
  const home = mkdtempSync(join(tmpdir(), "datev-r11-deep-"));
  const { sentBefore } = await import("../../src/tools/sent-ledger.js");
  const good = (at: string, previous?: unknown) => ({ at, name: "x", status: "uncertain", ...(previous ? { previous } : {}) });
  writeFileSync(join(home, "sent-sandbox.json"), JSON.stringify({ extf: { "455148-1": { abc: good("2026-11-03T00:00:00Z", good("2026-11-02T00:00:00Z", { at: "2026-11-01T00:00:00Z", name: "x", status: ["sent"] })) } } }));
  assert.throws(() => sentBefore("extf", "sandbox", "455148-1", "abc", { DATEV_MCP_HOME: home }), /damaged/);
});
