process.env.DATEV_MCP_SESSION_KEY ??= "22".repeat(32); // never the real credential store

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENDPOINTS } from "../../src/auth/endpoints.js";
import { envKeyStore } from "../../src/auth/session-key.js";
import { TokenStore } from "../../src/auth/token-store.js";
import { complianceView, renderCompliance } from "../../src/setup/compliance.js";

const root = join(import.meta.dirname, "..", "..");
const tmp = () => mkdtempSync(join(tmpdir(), "datev-comp-"));

test("the compliance checklist and its data file are exactly what the generator builds, so they cannot drift", () => {
  const out = tmp();
  const r = spawnSync("python3", [join(root, "scripts/compliance/assess.py"), join(root, "scripts/compliance/requirements.md"), join(out, "c.md"), join(out, "c.json")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(out, "c.md"), "utf8"), readFileSync(join(root, "docs/COMPLIANCE-CHECKLIST.md"), "utf8"), "run npm run compliance and commit the result");
  assert.equal(readFileSync(join(out, "c.json"), "utf8"), readFileSync(join(root, "src/compliance.json"), "utf8"));
  assert.match(r.stdout, /missing \[\] extra \[\]/, "every DATEV requirement has a status");
});

test("the compliance view shows the person live problems and the sections of their own data services, in German too", () => {
  const store = new TokenStore("production", tmp(), envKeyStore());
  store.write({ env: "production", clientId: "cid", tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 9e5, obtainedAt: Date.now() }, services: ["accounting-documents"], pendingRevoke: ["OLD"] });
  const cfg = { env: "production" as const, endpoints: ENDPOINTS.production, creds: { clientId: "cid", clientSecret: "s" } };
  const v = complianceView(cfg, { store, lang: "de" });
  assert.ok(v.checks.some((c) => !c.ok && /Public client/.test(c.text)), "a blocked production setup is flagged");
  assert.ok(v.checks.some((c) => !c.ok && /Refresh-Token/.test(c.text)), "a pending revocation is flagged");
  assert.ok(v.sections.find((s) => s.title.includes("Belegbilderservice Rechnungswesen"))?.connected);
  const text = renderCompliance(v, "de");
  assert.match(text, /DATEV-Konformität/);
  assert.match(text, /<- Ihr Datenservice/);
  assert.ok(!text.includes("RT") && !text.includes("OLD"), "never shows a token");
});

test("the connection status tool answers with AKTIV or INAKTIV text the person can read", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { registerConnectionTools } = await import("../../src/tools/connection.js");
  const server = new McpServer({ name: "t", version: "0" });
  const cfg = { env: "sandbox" as const, endpoints: ENDPOINTS.sandbox, creds: { clientId: "cid" } };
  registerConnectionTools(server, cfg, new TokenStore("sandbox", tmp(), envKeyStore()), () => {});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const prev = process.env.DATEV_MCP_LANG;
  process.env.DATEV_MCP_LANG = "de";
  try {
    const r = await c.callTool({ name: "datev_connection_status", arguments: {} });
    assert.match((r.content as { text: string }[])[0]!.text, /INAKTIV \(getrennt\)/);
    const comp = await c.callTool({ name: "datev_compliance", arguments: {} });
    assert.match((comp.content as { text: string }[])[0]!.text, /DATEV-Konformität/);
  } finally {
    if (prev === undefined) delete process.env.DATEV_MCP_LANG;
    else process.env.DATEV_MCP_LANG = prev;
  }
});
