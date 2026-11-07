// End-to-end check against the DATEV sandbox through the real MCP protocol (one server process).
// Run: npm run build && npx tsx test/live.ts   (server is started via DATEV_MCP_LAUNCHER or dist/index.js)
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type ToolResult = { content: { text: string }[]; isError?: boolean };
const launcher = process.env.DATEV_MCP_LAUNCHER;
const transport = new StdioClientTransport(
  launcher ? { command: launcher, args: [], env: process.env as Record<string, string> } : { command: process.execPath, args: ["dist/index.js"], env: process.env as Record<string, string> },
);
const client = new Client({ name: "datev-mcp-live", version: "0" });
await client.connect(transport, { timeout: 300_000 }); // leaves time to approve the vault prompt

const results: { check: string; ok: boolean; detail: string }[] = [];
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as ToolResult;
const json = (r: ToolResult) => {
  try {
    return JSON.parse(r.content[0].text);
  } catch {
    return r.content[0].text;
  }
};
async function check(name: string, fn: () => Promise<{ ok: boolean; detail: string }>) {
  try {
    results.push({ check: name, ...(await fn()) });
  } catch (e) {
    results.push({ check: name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}

const CLIENT = process.env.DATEV_LIVE_CLIENT ?? "455148-1";
let fiscalYear = "";

await check("list clients", async () => {
  const out = json(await call("datev_list_clients", {}));
  return { ok: Array.isArray(out) && out.some((c: { id: string }) => c.id === CLIENT), detail: `${out.length} clients` };
});
await check("fiscal years", async () => {
  const out = json(await call("datev_list_fiscal_years", { client_id: CLIENT }));
  fiscalYear = Array.isArray(out) && out[0]?.id ? out[0].id : "";
  return { ok: Boolean(fiscalYear), detail: `first ${fiscalYear}; keys ${Array.isArray(out) && out[0] ? Object.keys(out[0]).slice(0, 8).join(",") : JSON.stringify(out).slice(0, 120)}` };
});
await check("find accounts", async () => {
  const out = json(await call("datev_find_accounts", { client_id: CLIENT, fiscal_year_id: fiscalYear, query: "Bank", limit: 2 }));
  return { ok: out.matches > 0, detail: `${out.total_accounts} total, e.g. ${out.accounts?.[0]?.accountNumber} ${out.accounts?.[0]?.caption}` };
});
await check("sums and balances", async () => {
  const r = await call("datev_sums_and_balances", { client_id: CLIENT, fiscal_year_id: fiscalYear, limit: 1 });
  const out = json(r);
  return { ok: !r.isError, detail: r.isError ? String(out).slice(0, 200) : `${out.total_accounts} accounts; row keys ${Object.keys(out.rows?.[0] ?? {}).slice(0, 8).join(",")}` };
});
await check("account postings (async job)", async () => {
  const r = await call("datev_account_postings", { client_id: CLIENT, fiscal_year_id: fiscalYear, limit: 1, max_wait_seconds: 50 });
  const out = json(r);
  return { ok: !r.isError, detail: r.isError ? String(out).slice(0, 250) : `ready=${out.ready} job=${out.job_id} postings=${out.postings_on_page} keys ${Object.keys(out.rows?.[0] ?? {}).slice(0, 8).join(",")}` };
});

const dir = mkdtempSync(join(tmpdir(), "datev-live-"));
const extfPath = join(dir, "EXTF_live_test.csv");
await check("write EXTF batch (local)", async () => {
  const [berater, mandant] = CLIENT.split("-");
  const r = await call("datev_write_extf_batch", {
    output_path: extfPath,
    berater,
    mandant,
    wj_start: fiscalYear,
    account_length: 8,
    from: fiscalYear,
    to: `${fiscalYear.slice(0, 6)}31`,
    label: "datev-mcp live test",
    rows: [{ amount_cents: 1190, side: "S", account: "12000000", contra_account: "84000000", day: 3, month: Number(fiscalYear.slice(4, 6)), beleg1: "TEST1", text: "Testbuchung" }],
    lang: "de",
  });
  const out = json(r);
  return { ok: out.written === true, detail: r.isError ? JSON.stringify(out).slice(0, 300) : `${out.bytes} bytes, ${out.warnings} warnings` };
});
await check("validate EXTF (local)", async () => {
  const out = json(await call("datev_validate_extf", { file_path: extfPath, lang: "de" }));
  return { ok: out.valid === true, detail: `errors ${out.errors}, warnings ${out.warnings}` };
});
await check("upload EXTF preview (no confirm)", async () => {
  const out = json(await call("datev_upload_extf", { client_id: CLIENT, file_path: extfPath }));
  return { ok: out.preview === true, detail: "nothing sent" };
});
await check("upload EXTF to sandbox (confirm)", async () => {
  const r = await call("datev_upload_extf", { client_id: CLIENT, file_path: extfPath, confirm: true });
  const out = json(r);
  return { ok: !r.isError && out.uploaded === true, detail: `HTTP ${out.status} job ${out.job_location ?? ""} ${JSON.stringify(out.body ?? "").slice(0, 160)}` };
});
await check("document upload preview (no confirm)", async () => {
  const pdf = join(dir, "test-beleg.pdf");
  writeFileSync(pdf, "%PDF-1.4\n%test\n");
  const out = json(await call("datev_upload_document", { client_id: CLIENT, file_path: pdf, document_type: "Rechnungseingang" }));
  return { ok: out.preview === true, detail: "nothing sent" };
});

await client.close();
for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.check.padEnd(36)} ${r.detail}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
