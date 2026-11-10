import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { clearClientGate, hideClientId } from "../../src/api/client-gate.js";
import { clearDataexchangeCache } from "../../src/api/dataexchange-guard.js";
import { registerGenericTools } from "../../src/tools/generic.js";

// Guards for the R13 review of client id hiding (query in approvals, URL authority, double escapes).
process.env.DATEV_MCP_SESSION_KEY ??= "33".repeat(32);

const ID = "455148-1";
const GUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a write's approval and preview hide the client id in the query and in header values", async () => {
  clearClientGate();
  clearDataexchangeCache();
  const f: FetchLike = async (u, init) =>
    (init?.method ?? "GET").toUpperCase() === "GET" && /\/clients\/[^/]+$/.test(new URL(String(u)).pathname)
      ? json(200, { name: "Muster GmbH", consultant_number: 455148, client_number: 1, services: [{ name: "Rechnungsdatenservice 1.0" }] })
      : json(201, {});
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox" as const, creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" }, { capabilities: { elicitation: { form: {} } } });
  let asked = "";
  c.setRequestHandler(ElicitRequestSchema, async (req) => ((asked = String(req.params.message)), { action: "accept", content: { approve: true } }));
  await c.connect(b);
  const args = { operation_id: "accounting-dxso-jobs.post_clients_client_id_dxso_jobs", path_params: { "client-id": ID }, query: { "client-id": ID }, headers: { "Notify-Url": `https://hook.example/c/${ID}` }, body: { job_type: "x" } };
  const preview = ((await c.callTool({ name: "datev_call", arguments: args })) as { content: { text: string }[] }).content[0]!.text;
  assert.ok(!preview.includes(ID), preview);
  await c.callTool({ name: "datev_call", arguments: { ...args, confirm: true, confirm_token: JSON.parse(preview).confirm_token } });
  assert.match(asked, /query: \{"client-id":"\{client\}"\}/, asked);
  assert.ok(!asked.includes(ID), asked);
});

test("an id joined to a longer token by a dash, and the URL authority, are never rewritten", () => {
  assert.equal(hideClientId(`https://x/a?doc=abc-${ID}-def`, [ID]), `https://x/a?doc=abc-${ID}-def`);
  assert.equal(hideClientId(`https://x/clients/${GUID}-abcdef`, [GUID]), `https://x/clients/${GUID}-abcdef`);
  assert.equal(hideClientId(`https://${ID}.example/clients/${ID}`, [ID]), `https://${ID}.example/clients/{client}`);
  assert.equal(hideClientId(`https://u:${ID}@x.example:455148/a/455148`, [ID, "455148"]), `https://u:${ID}@x.example:455148/a/{client}`);
});

test("an id whose every character is escaped twice is hidden, and other bytes stay as sent", () => {
  const twice = [...ID].map((ch) => [...`%${ch.charCodeAt(0).toString(16).toUpperCase()}`].map((x) => `%${x.charCodeAt(0).toString(16).toUpperCase()}`).join("")).join("");
  assert.equal(hideClientId(`https://x/a?n=${twice}&y=%25ZZ`, [ID]), "https://x/a?n={client}&y=%25ZZ");
  assert.equal(hideClientId(`https://x/a?n=%2F${twice}%2Fz`, [ID]), "https://x/a?n=%2F{client}%2Fz");
});
