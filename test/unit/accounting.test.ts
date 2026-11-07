import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { jobIdFrom, jobPhase, registerAccountingTools } from "../../src/tools/accounting.js";

test("job phase reading covers finished, failed and running shapes", () => {
  assert.equal(jobPhase({ state: "Finished" }), "done");
  assert.equal(jobPhase({ status: "COMPLETED" }), "done");
  assert.equal(jobPhase({ state: "failed", reason: "x" }), "failed");
  assert.equal(jobPhase({ state: "processing" }), "running");
  assert.equal(jobPhase(undefined), "running");
});

test("job id comes from the body or the Location header", () => {
  assert.equal(jobIdFrom({ id: "abc123" }), "abc123");
  assert.equal(jobIdFrom("", "/clients/1/jobs/job-777"), "job-777");
  assert.equal(jobIdFrom({}, undefined), undefined);
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function client(f: FetchLike) {
  const server = new McpServer({ name: "t", version: "0" });
  registerAccountingTools(server, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f }), async () => undefined);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  return c;
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

test("account postings: starts the job, polls until finished, filters by account", async () => {
  const calls: string[] = [];
  let polls = 0;
  const f: FetchLike = async (u, init) => {
    const url = String(u);
    calls.push(`${init?.method} ${new URL(url).pathname}`);
    if (url.endsWith("/account-postings")) return json(202, { id: "job-1" });
    if (url.includes("/jobs/job-1/state")) return json(200, { state: ++polls < 3 ? "processing" : "finished" });
    if (url.includes("/account-postings-jobs/job-1")) return json(200, '{"accountNumber":12000000,"amount":10}\n{"accountNumber":84000000,"amount":20}');
    return json(404, {});
  };
  const c = await client(f);
  const out = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "1", fiscal_year_id: "20230701", account: "1200" } })));
  assert.equal(out.ready, true);
  assert.equal(out.postings_on_page, 2);
  assert.deepEqual(out.rows, [{ accountNumber: 12000000, amount: 10 }]);
  assert.equal(polls, 3);
  assert.equal(calls[0], "POST /platform-sandbox/v1/clients/1/fiscal-years/20230701/account-postings");
});

test("account postings: a failed job and a slow job are reported, not hidden", async () => {
  const failing = await client(async (u) => (String(u).endsWith("/account-postings") ? json(202, { id: "j" }) : json(200, { state: "failed" })));
  const r1 = await failing.callTool({ name: "datev_account_postings", arguments: { client_id: "1", fiscal_year_id: "y" } });
  assert.equal((r1 as { isError?: boolean }).isError, true);
  assert.match(text(r1), /failed/);
  const slow = await client(async (u) => (String(u).endsWith("/account-postings") ? json(202, { id: "j" }) : json(200, { state: "processing" })));
  const r2 = JSON.parse(text(await slow.callTool({ name: "datev_account_postings", arguments: { client_id: "1", fiscal_year_id: "y", max_wait_seconds: 5 } })));
  assert.equal(r2.ready, false);
  assert.equal(r2.job_id, "j");
});

test("sums and balances: reads the full list and filters by account prefix", async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({ accountNumber: 10000000 + i * 1000, caption: "Konto mit einem recht langen Namen", balance: i }));
  const c = await client(async () => json(200, rows.map((r) => JSON.stringify(r)).join("\n")));
  const out = JSON.parse(text(await c.callTool({ name: "datev_sums_and_balances", arguments: { client_id: "1", fiscal_year_id: "y", account_prefix: "1000", limit: 5 } })));
  assert.equal(out.total_accounts, 2000);
  assert.ok(out.matches > 0 && out.rows.length <= 5);
  for (const r of out.rows) assert.ok(String(r.accountNumber).startsWith("1000"));
});

test("a DATEV error status surfaces as a tool error", async () => {
  const c = await client(async () => json(403, { error: "forbidden" }));
  const r = await c.callTool({ name: "datev_list_clients", arguments: {} });
  assert.equal((r as { isError?: boolean }).isError, true);
  assert.match(text(r), /HTTP 403/);
});
