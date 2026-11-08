import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenericTools } from "../../src/tools/generic.js";
import { OPERATIONS } from "../../src/tools/catalog.js";

async function client() {
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: async () => new Response("{}") }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  return c;
}
const ids = (r: unknown) => {
  const t = (r as { content: { text: string }[] }).content[0].text;
  return t.startsWith("[") ? (JSON.parse(t) as { id: string }[]).map((o) => o.id) : [];
};

test("datev_search_operations leaves health checks out by default", async () => {
  const c = await client();
  const health = new Set(OPERATIONS.filter((o) => o.health).map((o) => o.id));
  const r = await c.callTool({ name: "datev_search_operations", arguments: { query: "health", limit: 50 } });
  assert.ok(ids(r).every((id) => !health.has(id)));
});

test("include_health finds every health check operation", async () => {
  const c = await client();
  const health = OPERATIONS.filter((o) => o.health);
  assert.ok(health.length > 0);
  for (const op of health) {
    const r = await c.callTool({ name: "datev_search_operations", arguments: { query: op.id, product: op.product, include_health: true } });
    assert.ok(ids(r).includes(op.id), op.id);
  }
});
