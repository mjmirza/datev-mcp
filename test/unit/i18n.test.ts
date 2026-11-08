import { test } from "node:test";
import assert from "node:assert/strict";
import { localize, messageLang } from "../../src/i18n.js";

// The ten most common errors, as the server writes them in English.
const COMMON = [
  'DATEV login needed: session expired and has no refresh token. Run "datev-mcp login".',
  "Ran out of time before DATEV answered. Try again, or narrow the request.",
  "Ran out of time while getting a DATEV access token. Try again, or narrow the request.",
  "Show the preview first: call without confirm, then call again with confirm: true and the confirm_token it returned.",
  "The confirm_token is malformed. Request a new preview.",
  "The confirm_token expired. Request a new preview.",
  "The confirm_token does not match this request. Something changed since the preview, so request a new one.",
  "The confirm_token was already used. Request a new preview to send this again.",
  'Unknown operation "x.y". Use datev_search_operations first.',
  'DATEV returned HTTP 403 for accounting-clients.getclients: {"error":"forbidden"}',
];

test("English stays English, byte for byte", () => {
  for (const m of COMMON) assert.equal(localize(m, "en"), m);
});

test("each of the ten common errors has a German version", () => {
  for (const m of COMMON) {
    const de = localize(m, "de");
    assert.notEqual(de, m, m);
    assert.doesNotMatch(de, /Try again|Request a new|Run "datev-mcp|Use datev_search|returned HTTP|login needed/, de);
  }
});

test("the German versions keep the details the user needs", () => {
  assert.match(localize(COMMON[0], "de"), /session expired and has no refresh token/);
  assert.match(localize(COMMON[0], "de"), /datev-mcp login/);
  assert.match(localize(COMMON[2], "de"), /Zugriffstoken/);
  assert.match(localize(COMMON[8], "de"), /"x\.y"/);
  assert.match(localize(COMMON[9], "de"), /HTTP 403/);
  assert.match(localize(COMMON[9], "de"), /\{"error":"forbidden"\}/);
});

test("unknown messages pass through unchanged in German", () => {
  assert.equal(localize("Something rare happened", "de"), "Something rare happened");
});

test("the language comes from DATEV_MCP_LANG, English by default", () => {
  assert.equal(messageLang({}), "en");
  assert.equal(messageLang({ DATEV_MCP_LANG: "de" }), "de");
  assert.equal(messageLang({ DATEV_MCP_LANG: "DE" }), "de");
  assert.equal(messageLang({ DATEV_MCP_LANG: "fr" }), "en");
});

test("a tool error reaches the user in German when DATEV_MCP_LANG=de", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { registerGenericTools } = await import("../../src/tools/generic.js");
  const server = new McpServer({ name: "t", version: "0" });
  registerGenericTools(server, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: async () => new Response("{}") }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const before = process.env.DATEV_MCP_LANG;
  try {
    process.env.DATEV_MCP_LANG = "de";
    const de = (await c.callTool({ name: "datev_call", arguments: { operation_id: "nope" } })) as { content: { text: string }[] };
    assert.match(de.content[0].text, /^Unbekannte Operation "nope"/);
    delete process.env.DATEV_MCP_LANG;
    const en = (await c.callTool({ name: "datev_call", arguments: { operation_id: "nope" } })) as { content: { text: string }[] };
    assert.match(en.content[0].text, /^Unknown operation "nope"/);
  } finally {
    if (before === undefined) delete process.env.DATEV_MCP_LANG;
    else process.env.DATEV_MCP_LANG = before;
  }
});
