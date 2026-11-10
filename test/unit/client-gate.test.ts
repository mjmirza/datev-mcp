import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { clearClientGate } from "../../src/api/client-gate.js";
import { registerClientCheckTool } from "../../src/tools/client-check.js";
import { registerGenericTools } from "../../src/tools/generic.js";

// DATEV's per-service permission rules for HR, Rechnungsdatenservice, Belege online and MyTax.
type Seen = { method: string; path: string };

async function harness(answer: (path: string) => Response) {
  clearClientGate();
  const seen: Seen[] = [];
  const f: FetchLike = async (u, init) => {
    const path = new URL(String(u)).pathname;
    seen.push({ method: (init?.method ?? "GET").toUpperCase(), path });
    return answer(path);
  };
  const server = new McpServer({ name: "t", version: "0" });
  const deps = () => ({ env: "sandbox" as const, creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined });
  registerGenericTools(server, deps);
  registerClientCheckTool(server, deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    return { error: r.isError === true, text: r.content[0]!.text };
  };
  return { seen, call };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const company = { client_id: "455148-1", name: "Muster GmbH", consultant_number: 455148, client_number: 1 };

test("the person enters consultant and client number and sees the company on success", async () => {
  const h = await harness(() => json(200, company));
  const r = await h.call("datev_check_client", { data_service: "hr-exports", consultant_number: 455148, client_number: 1 });
  assert.equal(r.error, false, r.text);
  assert.deepEqual(JSON.parse(r.text), { access: "granted", data_service: "hr-exports", company: "Muster GmbH", consultant_number: 455148, client_number: 1 });
  assert.equal(h.seen.length, 1);
  assert.equal(h.seen[0]!.method, "GET");
  assert.match(h.seen[0]!.path, /\/clients\/455148-1$/);
});

test("numbers without permission give an understandable error with a hint and DATEV's setup page", async () => {
  const h = await harness(() => json(403, { title: "Forbidden", type: "http://www.datev.de/hilfe/1080005" }));
  const r = await h.call("datev_check_client", { data_service: "hr-payrollreports", consultant_number: 455148, client_number: 99 });
  assert.equal(r.error, true);
  assert.match(r.text, /Please check the consultant and client number, or ask your administrator/);
  assert.match(r.text, /go\.datev\.de\/datenservices-einrichten/);
  assert.match(r.text, /Help: http:\/\/www\.datev\.de\/hilfe\/1080005/);
});

test("a client-bound call is refused before anything moves when DATEV denies the client", async () => {
  const h = await harness((path) => (/\/clients\/455148-1$/.test(path) ? json(403, {}) : json(200, [])));
  const r = await h.call("datev_call", { operation_id: "hr-exports.gettaxpaymentsbyemployeeid", path_params: { "client-id": "455148-1", "employee-id": "00001" } });
  assert.equal(r.error, true);
  assert.match(r.text, /Access to client 455148-1 could not be confirmed/);
  assert.equal(h.seen.length, 1, "only the permission read reached DATEV");
});

test("the permission is read once per transfer day, not before every call", async () => {
  const h = await harness((path) => (/\/clients\/455148-1$/.test(path) ? json(200, company) : json(200, [])));
  const args = { operation_id: "hr-exports.gettaxpaymentsbyemployeeid", path_params: { "client-id": "455148-1", "employee-id": "00001" } };
  await h.call("datev_call", args);
  await h.call("datev_call", args);
  assert.equal(h.seen.filter((s) => /\/clients\/455148-1$/.test(s.path)).length, 1);
  assert.equal(h.seen.length, 3);
});

test("payroll reports are only requested for report types the client grants", async () => {
  const granted = { ...company, document_types: { access_granted: ["LOBN"], access_denied: ["KOST"] } };
  const h = await harness((path) => (/\/clients\/455148-1$/.test(path) ? json(200, granted) : json(200, {})));
  const denied = await h.call("datev_call", { operation_id: "hr-payrollreports.getpdfdocuments", path_params: { "client-id": "455148-1", period: "2026-03-01" }, query: { document_types: "KOST" }, headers: { Accept: "application/pdf" } });
  assert.equal(denied.error, true);
  assert.match(denied.text, /does not grant the report types KOST\. Granted: LOBN/);
  assert.equal(h.seen.length, 1, "the report itself was not requested");
});

test("eAU reads the client through its own consultant and client number path", async () => {
  const h = await harness(() => json(200, company));
  await h.call("datev_call", { operation_id: "eau-api.getfeedbacks", path_params: { consultantNumber: "455148", clientNumber: "1", personnelNumber: "00001", eauRequest: "R1" } });
  assert.match(h.seen[0]!.path, /\/clients\/455148-1$/);
});
