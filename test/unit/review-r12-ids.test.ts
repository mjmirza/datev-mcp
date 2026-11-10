import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { clearClientGate, hideClientId } from "../../src/api/client-gate.js";
import { clearDataexchangeCache } from "../../src/api/dataexchange-guard.js";
import { OPERATIONS } from "../../src/tools/catalog.js";
import { clientParamRole, registerGenericTools } from "../../src/tools/generic.js";

// Guards for the R12 review of client id hiding (path parameters, GUID case, query bytes).
process.env.DATEV_MCP_SESSION_KEY ??= "33".repeat(32);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function harness(answer: (url: string) => Response) {
  clearClientGate();
  clearDataexchangeCache();
  const f: FetchLike = async (u) => answer(String(u));
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox" as const, creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f, sleep: async () => undefined }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  return async (args: Record<string, unknown>) => {
    const r = (await c.callTool({ name: "datev_call", arguments: args })) as { content: { text: string }[] };
    return JSON.parse(r.content[0]!.text) as Record<string, string>;
  };
}

const GUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("every declared path parameter that names a client is read as a client id, an unrelated one is not", () => {
  const missed: string[] = [];
  for (const op of OPERATIONS)
    for (const p of op.params.filter((x) => x.in === "path"))
      if (/client/i.test(p.name) && clientParamRole(p.name) === undefined) missed.push(`${op.id}:${p.name}`);
  assert.deepEqual(missed, []);
  for (const name of ["master-client-id", "consultantnumber-clientnumber", "client-id", "clientId", "client_guid"]) assert.equal(clientParamRole(name), "id", name);
  for (const name of ["document-id", "documentId", "tenant-id", "personnel-number", "id", "uuid"]) assert.equal(clientParamRole(name), undefined, name);
});

test("a master client id in the path is hidden from the answer", async () => {
  const call = await harness(() => json(200, {}, { location: `/master-clients/${GUID}/corporate-structure` }));
  const o = await call({ operation_id: "master-data-master-clients.findbyzmoid", path_params: { "master-client-id": GUID } });
  assert.ok(!o.url.includes(GUID), o.url);
  assert.ok(!o.location.includes(GUID), o.location);
});

test("the combined consultant-client number parameter is hidden from the answer", async () => {
  const call = await harness(() => json(200, { name: "Muster GmbH" }));
  const o = await call({ operation_id: "hr-documents.getclientbyconsultantclientnumber", path_params: { "consultantnumber-clientnumber": "455148-1" } });
  assert.ok(!o.url.includes("455148-1"), o.url);
});

test("a GUID is hidden whatever its case, and an id before a dot, semicolon or comma is hidden too", () => {
  assert.equal(hideClientId(`https://x/clients/${GUID.toUpperCase()}/documents`, [GUID]), "https://x/clients/{client}/documents");
  assert.equal(hideClientId("https://x/clients/455148-1.json", ["455148-1"]), "https://x/clients/{client}.json");
  assert.equal(hideClientId("https://x/clients/455148-1;v=1", ["455148-1"]), "https://x/clients/{client};v=1");
  assert.equal(hideClientId("https://x/a/455148-1,455148-2", ["455148-1"]), "https://x/a/{client},455148-2");
  assert.equal(hideClientId("https://x/clients/455148-10", ["455148-1"]), "https://x/clients/455148-10", "a longer id stays");
});

test("hiding an id in a query or fragment keeps every other byte as sent", () => {
  assert.equal(hideClientId("https://x/a?filter=455148-1%20and+x", ["455148-1"]), "https://x/a?filter={client}%20and+x");
  assert.equal(hideClientId("https://x/a?q=455148-1#frag-455148-1", ["455148-1"]), "https://x/a?q={client}#frag-{client}");
  assert.equal(hideClientId("https://x/a?a=%ZZ%2F455148-1", ["455148-1"]), "https://x/a?a=%ZZ%2F{client}");
  assert.equal(hideClientId("https://x/a?next=%2Fclients%2F455148%2D1%2Fjobs", ["455148-1"]), "https://x/a?next=%2Fclients%2F{client}%2Fjobs");
  assert.equal(hideClientId("https://x/a?doc=7&c=1455148-1", ["455148-1"]), "https://x/a?doc=7&c=1455148-1", "a longer number stays");
});

test("a client id encoded twice in a query is hidden too, and other bytes stay as sent", () => {
  assert.equal(hideClientId("https://api.datev.de/x?next=%252F455148-1%252Fdocs&y=%25ZZ", ["455148-1"]), "https://api.datev.de/x?next=%252F{client}%252Fdocs&y=%25ZZ");
  assert.equal(hideClientId("https://api.datev.de/x?next=%2534%2535%2535148-1", ["455148-1"]), "https://api.datev.de/x?next={client}");
});
