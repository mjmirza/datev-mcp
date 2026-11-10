import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "../../src/auth/token-client.js";
import { withDatevBasics, type Basics } from "../helpers/datev-basics.js";
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

async function client(f: FetchLike, basics: Basics = {}) {
  const server = new McpServer({ name: "t", version: "0" });
  registerAccountingTools(server, () => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: withDatevBasics(f, basics) }), async () => undefined);
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
    if (url.includes("/account-postings-jobs/3f2504e0-4f89-41d3-9a0c-0305e82c3301")) return json(200, '{"accountNumber":12000000,"amountDebit":10}\n{"accountNumber":84000000,"amountDebit":20}');
    return json(404, {});
  };
  const c = await client(f);
  const out = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230701", account: "1200" } })));
  assert.equal(out.ready, true);
  assert.equal(out.postings_read, 2);
  assert.equal(out.complete, true);
  assert.deepEqual(out.rows, [{ accountNumber: 12000000, amountDebit: 10 }]);
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
  const c = await client(async () => new Response("20230701\n", { status: 200, headers: { "content-type": "application/x-ndjson" } }), { passFiscalYears: true });
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
    return json(200, `{"accountNumber":${p === 3 ? 12000000 : 84000000},"amountDebit":${p}}`, { "x-total-pages": "3", "x-total-count": "3" });
  };
  const out = JSON.parse(text(await (await client(f)).callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", account: "1200" } })));
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(out.complete, true);
  assert.equal(out.total_postings, 3);
  assert.deepEqual(out.rows, [{ accountNumber: 12000000, amountDebit: 3 }]);
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

test("clients are read page by page past DATEV's 100 per request", async () => {
  const seen: string[] = [];
  const c = await client(async (u) => {
    const url = new URL(String(u));
    seen.push(url.search);
    const skip = Number(url.searchParams.get("skip"));
    const n = skip === 0 ? 100 : 50;
    return json(200, Array.from({ length: n }, (_, i) => ({ id: `455148-${skip + i + 1}`, name: "x" })));
  });
  const out = JSON.parse(text(await c.callTool({ name: "datev_list_clients", arguments: {} })));
  assert.equal(out.clients.length, 150);
  assert.deepEqual(seen, ["?top=100&skip=0", "?top=100&skip=100"]);
  assert.equal(out.clients[0].id, undefined, "no field the user would read as the client id");
  assert.equal(out.clients[0].technical_id, "455148-1");
  assert.match(out.note, /DATEV asks apps not to display it/);
});

test("an HTTP 200 that carries only an error is an error, never data", async () => {
  const c = await client(async () => json(200, { error: "Backend broken" }), { passFiscalYears: true });
  for (const [name, args] of [["datev_list_clients", {}], ["datev_list_fiscal_years", { client_id: "455148-1" }], ["datev_sums_and_balances", { client_id: "455148-1", fiscal_year_id: "20230101" }]] as const) {
    const r = await c.callTool({ name, arguments: args });
    assert.equal((r as { isError?: boolean }).isError, true, name);
  }
  const rowless = await client(async () => json(200, [{ accountNumber: 1000 }, { note: "not an account" }]));
  const r = await rowless.callTool({ name: "datev_sums_and_balances", arguments: { client_id: "455148-1", fiscal_year_id: "20230101" } });
  assert.match(text(r), /row 2/);
});

test("postings keep only the rows asked for, but count every match", async () => {
  const c = await client(async (u, init) => {
    const p = new URL(String(u)).pathname;
    if ((init as RequestInit).method === "POST") return json(200, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    if (p.endsWith("/state")) return json(200, { jobState: "COMPLETED" });
    return json(200, Array.from({ length: 300 }, (_, i) => ({ accountNumber: 1200, amountDebit: i })), { "x-total-pages": "1" });
  });
  const out = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", limit: 3 } })));
  assert.equal(out.matches, 300);
  assert.equal(out.rows.length, 3);
});

test("postings stop before reading pages when the shared budget is spent", async () => {
  let pages = 0;
  const c = await client(async (u, init) => {
    const p = new URL(String(u)).pathname;
    if ((init as RequestInit).method === "POST") return json(200, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    if (p.endsWith("/state")) {
      await new Promise((r) => setTimeout(r, 4200));
      return json(200, { jobState: "COMPLETED" });
    }
    pages++;
    return json(200, []);
  });
  const out = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", max_wait_seconds: 5 } })));
  assert.equal(out.complete, false);
  assert.equal(out.job_id, "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  assert.equal(pages, 0);
});

test("fiscal years still accept bare ids, and rows need real field types", async () => {
  const bare = await client(async () => new Response("20230701\n", { headers: { "content-type": "application/json" } }), { passFiscalYears: true });
  assert.deepEqual(JSON.parse(text(await bare.callTool({ name: "datev_list_fiscal_years", arguments: { client_id: "455148-1" } }))), [{ id: "20230701" }]);
  const objNumber = await client(async () => json(200, [{ accountNumber: { bad: true } }]));
  assert.equal(((await objNumber.callTool({ name: "datev_sums_and_balances", arguments: { client_id: "455148-1", fiscal_year_id: "20230101" } })) as { isError?: boolean }).isError, true);
  const errorRow = await client(async (u, init) => {
    const p = new URL(String(u)).pathname;
    if ((init as RequestInit).method === "POST") return json(200, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    if (p.endsWith("/state")) return json(200, { jobState: "COMPLETED" });
    return json(200, [{ error: "Backend broken" }], { "x-total-pages": "1" });
  });
  const r = await errorRow.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101" } });
  assert.equal((r as { isError?: boolean }).isError, true);
});

test("postings that run out of time on a later page keep the rows read and say where to continue", async () => {
  const c = await client(async (u, init) => {
    const url = new URL(String(u));
    if ((init as RequestInit).method === "POST") return json(200, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    if (url.pathname.endsWith("/state")) return json(200, { jobState: "COMPLETED" });
    if (url.searchParams.get("page") === "1") return json(200, [{ accountNumber: 1200, n: 1 }], { "x-total-pages": "3" });
    // Page 2 never answers in time; like real fetch, the request ends when its signal aborts.
    return new Promise<Response>((_, reject) => (init as RequestInit).signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  });
  const out = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", max_wait_seconds: 5 } })));
  assert.equal(out.complete, false);
  assert.equal(out.job_id, "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  assert.equal(out.rows.length, 1);
  assert.match(out.note, /from_page 2/);
});

test("text that is not a fiscal year id, and empty posting rows, are refused", async () => {
  const text200 = await client(async () => new Response("Backend broken", { headers: { "content-type": "text/plain" } }), { passFiscalYears: true });
  assert.equal(((await text200.callTool({ name: "datev_list_fiscal_years", arguments: { client_id: "455148-1" } })) as { isError?: boolean }).isError, true);
  const empty = await client(async (u, init) => {
    const p = new URL(String(u)).pathname;
    if ((init as RequestInit).method === "POST") return json(200, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    if (p.endsWith("/state")) return json(200, { jobState: "COMPLETED" });
    return json(200, [{}], { "x-total-pages": "1" });
  });
  assert.equal(((await empty.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101" } })) as { isError?: boolean }).isError, true);
});

test("a page whose body stalls until the deadline still keeps the rows already read", async () => {
  const c = await client(async (u, init) => {
    const url = new URL(String(u));
    if ((init as RequestInit).method === "POST") return json(200, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    if (url.pathname.endsWith("/state")) return json(200, { jobState: "COMPLETED" });
    if (url.searchParams.get("page") === "1") return json(200, [{ accountNumber: 1200 }], { "x-total-pages": "2" });
    const signal = (init as RequestInit).signal;
    const body = new ReadableStream({ start: (ctl) => signal?.addEventListener("abort", () => ctl.error(new DOMException("aborted", "AbortError"))) });
    return new Response(body, { headers: { "content-type": "application/json", "x-total-pages": "2" } });
  });
  const out = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", max_wait_seconds: 5 } })));
  assert.equal(out.complete, false);
  assert.equal(out.rows.length, 1);
});

test("account postings: rows without a readable account are counted, not silently dropped", async () => {
  const f: FetchLike = async (u) => {
    const url = new URL(String(u));
    if (url.pathname.includes("/state")) return json(200, { jobState: "COMPLETED" });
    return json(200, '{"amountDebit":1}\n{"amountDebit":2,"accountNumber":null}', { "x-total-pages": "1", "x-total-count": "2" });
  };
  const out = JSON.parse(text(await (await client(f)).callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230101", job_id: JOB, account: "1200" } })));
  assert.equal(out.matches, 0);
  assert.equal(out.rows_without_account, 2);
  assert.match(out.note, /no readable account number/);
});

test("account postings return a minimal field set by default, and every field only when asked", async () => {
  const row = { accountNumber: 12000000, contraAccountNumber: 84000000, date: "2023-07-03", amountDebit: 119, postingDescription: "Miete", euVatId: "DE123456789", documentLink: "BEDI 1234", billingReference: "R-1" };
  const f: FetchLike = async (u) => {
    const url = String(u);
    if (url.endsWith("/account-postings")) return json(202, { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    if (url.includes("/state")) return json(200, { state: "finished" });
    return json(200, JSON.stringify(row), { "x-total-pages": "1" });
  };
  const c = await client(f);
  const basic = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230701" } })));
  assert.deepEqual(basic.rows[0], { date: "2023-07-03", accountNumber: 12000000, contraAccountNumber: 84000000, amountDebit: 119, postingDescription: "Miete" });
  const all = JSON.parse(text(await c.callTool({ name: "datev_account_postings", arguments: { client_id: "455148-1", fiscal_year_id: "20230701", fields: "all" } })));
  assert.deepEqual(all.rows[0], row);
});
