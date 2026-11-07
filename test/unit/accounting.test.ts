import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { fiscalYearIds, jobIdFrom, jobPhase, registerAccountingTools } from "../../src/tools/accounting.js";

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
    if (url.endsWith("/account-postings")) return json(202, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    if (url.includes("/jobs/3f2504e0-4f89-41d3-9a0c-0305e82c3301/state")) return json(200, { state: ++polls < 3 ? "processing" : "finished" });
    if (url.includes("/account-postings-jobs/3f2504e0-4f89-41d3-9a0c-0305e82c3301")) return json(200, '{"accountNumber":12000000,"amount":10}\n{"accountNumber":84000000,"amount":20}');
    return json(404, {});
  };
  const c = await client(f);
  const out = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230701", account: "1200" } })));
  assert.equal(out.ready, true);
  assert.equal(out.postings_read, 2);
  assert.equal(out.complete, true);
  assert.deepEqual(out.rows, [{ accountNumber: 12000000, amount: 10 }]);
  assert.equal(polls, 3);
  assert.equal(calls[0], "POST /platform-sandbox/v1/clients/455148-1/fiscal-years/20230701/account-postings");
});

test("account postings: a failed job and a slow job are reported, not hidden", async () => {
  const failing = await client(async (u) => (String(u).endsWith("/account-postings") ? json(202, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }) : json(200, { state: "failed" })));
  const r1 = await failing.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101" } });
  assert.equal((r1 as { isError?: boolean }).isError, true);
  assert.match(text(r1), /failed/);
  const slow = await client(async (u) => (String(u).endsWith("/account-postings") ? json(202, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }) : json(200, { state: "processing" })));
  const r2 = JSON.parse(text(await slow.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", max_wait_seconds: 5 } })));
  assert.equal(r2.ready, false);
  assert.equal(r2.job_id, "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
});

test("sums and balances: reads the full list and filters by account prefix", async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({ accountNumber: 10000000 + i * 1000, caption: "Konto mit einem recht langen Namen", balance: i }));
  const c = await client(async () => json(200, rows.map((r) => JSON.stringify(r)).join("\n")));
  const out = JSON.parse(text(await c.callTool({ name: "datev_sums_and_balances", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", account_prefix: "1000", limit: 5 } })));
  assert.equal(out.total_accounts, 2000);
  assert.ok(out.matches > 0 && out.rows.length <= 5);
  for (const r of out.rows) assert.ok(String(r.accountNumber).startsWith("1000"));
});

test("fiscal years: bare NDJSON ids (as DATEV sends them) become id objects", async () => {
  assert.deepEqual(fiscalYearIds(20230701), ["20230701"]);
  assert.deepEqual(fiscalYearIds([20230701, 20240701]), ["20230701", "20240701"]);
  assert.deepEqual(fiscalYearIds([{ id: "20230701" }]), ["20230701"]);
  assert.deepEqual(fiscalYearIds(undefined), []);
  const c = await client(async () => new Response("20230701\n", { status: 200, headers: { "content-type": "application/x-ndjson" } }));
  assert.deepEqual(JSON.parse(text(await c.callTool({ name: "datev_list_fiscal_years", arguments: { client_id: "455148-1" } }))), [{ id: "20230701" }]);
});

test("a DATEV error status surfaces as a tool error", async () => {
  const c = await client(async () => json(403, { error: "forbidden" }));
  const r = await c.callTool({ name: "datev_list_clients", arguments: {} });
  assert.equal((r as { isError?: boolean }).isError, true);
  assert.match(text(r), /HTTP 403/);
});

const JOB = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("account postings: reads every page DATEV reports, not only the first", async () => {
  const pages: number[] = [];
  const f: FetchLike = async (u) => {
    const url = new URL(String(u));
    if (url.pathname.endsWith("/account-postings")) return json(202, { id: JOB });
    if (url.pathname.includes("/state")) return json(200, { jobState: "COMPLETED" });
    const p = Number(url.searchParams.get("page"));
    pages.push(p);
    return json(200, `{"accountNumber":${p === 3 ? 12000000 : 84000000},"amount":${p}}`, { "x-total-pages": "3", "x-total-count": "3" });
  };
  const out = JSON.parse(text(await (await client(f)).callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", account: "1200" } })));
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(out.complete, true);
  assert.equal(out.total_postings, 3);
  assert.deepEqual(out.rows, [{ accountNumber: 12000000, amount: 3 }]);
});

test("account postings: job_id continues the same export instead of starting another", async () => {
  let created = 0;
  const f: FetchLike = async (u) => {
    const url = new URL(String(u));
    if (url.pathname.endsWith("/account-postings")) return (created++, json(202, { id: "other" }));
    if (url.pathname.includes("/state")) return json(200, { jobState: "COMPLETED" });
    return json(200, "[]");
  };
  const out = JSON.parse(text(await (await client(f)).callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", job_id: JOB } })));
  assert.equal(created, 0);
  assert.equal(out.job_id, JOB);
});

test("job phase follows the spec's JobState enum, DELETED included", () => {
  assert.equal(jobPhase({ jobState: "COMPLETED" }), "done");
  assert.equal(jobPhase({ jobState: "PENDING" }), "running");
  assert.equal(jobPhase({ jobState: "FAILED" }), "failed");
  assert.equal(jobPhase({ jobState: "DELETED" }), "failed");
});

test("a redirect or an unreadable body is an error, never an empty successful list", async () => {
  const redirected = await (await client(async () => new Response(null, { status: 302, headers: { location: "https://x" } }))).callTool({ name: "datev_list_clients", arguments: {} });
  assert.equal((redirected as { isError?: boolean }).isError, true);
  const garbled = await (await client(async () => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }))).callTool({ name: "datev_list_clients", arguments: {} });
  assert.equal((garbled as { isError?: boolean }).isError, true);
  assert.match(text(garbled), /unexpected format/);
});
