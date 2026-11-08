import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { decodeBytes, encodeCp1252, parseCsv } from "@seamless-engineering/datev-extf";
import { validateBytes, writeBatch } from "../../src/tools/extf.js";

const header = { berater: "1001", mandant: "1", wjStart: "20260101", skl: 4, from: "20260101", to: "20261231", label: "Test", skr: "03" as const, created: new Date(2026, 0, 2) };
const base = { amount: 11900, side: "S" as const, account: "1200", contra: "8400", day: 3, month: 2 };
const kost = fc.stringMatching(/^[A-Za-z0-9_ ]{0,36}$/).map((s) => s.trim()).filter((s) => s.length > 0);

test("cost centres land in KOST1 and KOST2 and the batch stays valid", () => {
  fc.assert(
    fc.property(fc.array(fc.record({ kost1: fc.option(kost, { nil: undefined }), kost2: fc.option(kost, { nil: undefined }), text: fc.string({ maxLength: 60 }) }), { minLength: 1, maxLength: 20 }), (rows) => {
      const csv = writeBatch(header, rows.map((r) => ({ ...base, ...r })));
      const report = validateBytes(encodeCp1252(csv));
      assert.equal(report.findings.filter((f) => f.severity === "error").length, 0, JSON.stringify(report.findings.slice(0, 3)));
      assert.equal(report.findings.filter((f) => f.code === "kost").length, 0);
      const parsed = parseCsv(decodeBytes(encodeCp1252(csv)).text, ";").rows.slice(2);
      assert.equal(parsed.length, rows.length);
      parsed.forEach((row, i) => {
        assert.equal(row.cells[36].value, rows[i].kost1 ?? "");
        assert.equal(row.cells[37].value, rows[i].kost2 ?? "");
      });
    }),
    { numRuns: 200 },
  );
});

test("a batch without cost centres is byte for byte what the library writes", async () => {
  const { writeBuchungsstapel } = await import("@seamless-engineering/datev-extf");
  assert.equal(writeBatch(header, [base]), writeBuchungsstapel(header, [base]));
});

test("the batch tool writes cost centres and refuses ones DATEV would flag", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { registerExtfTools } = await import("../../src/tools/extf.js");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const server = new McpServer({ name: "t", version: "0" });
  registerExtfTools(server, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T" }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  const args = (kost1: string) => ({ output_path: join(mkdtempSync(join(tmpdir(), "kost-")), "b.csv"), berater: "1001", mandant: "1", wj_start: "20260101", account_length: 4, from: "20260101", to: "20261231", label: "Test", rows: [{ amount_cents: 100, side: "S", account: "1200", contra_account: "8400", day: 3, month: 2, kost1 }] });
  const good = args("Vertrieb 1");
  const r = await c.callTool({ name: "datev_write_extf_batch", arguments: good });
  assert.equal((r as { isError?: boolean }).isError, undefined);
  assert.match(readFileSync(good.output_path, "latin1"), /"Vertrieb 1"/);
  const bad = await c.callTool({ name: "datev_write_extf_batch", arguments: args("A-1") });
  assert.equal((bad as { isError?: boolean }).isError, true);
});
