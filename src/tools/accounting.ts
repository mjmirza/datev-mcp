import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callOperation, CallError, type CallDeps, type CallInput } from "../api/client.js";
import { NeedsLoginError } from "../auth/session.js";
import { getOperation } from "./catalog.js";

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ content: [{ type: "text" as const, text: m }], isError: true });
const UNCAPPED = Number.MAX_SAFE_INTEGER;

function errorText(e: unknown): string {
  if (e instanceof CallError || e instanceof NeedsLoginError) return e.message;
  return `Failed: ${e instanceof Error ? e.message : String(e)}`;
}

// deadline: one absolute end time shared by every request of a tool call.
async function call(id: string, input: CallInput, deps: CallDeps, maxBodyChars?: number, deadline?: number) {
  const op = getOperation(id);
  if (!op) throw new CallError(`${id} is missing from the operation index`);
  const left = deadline === undefined ? undefined : deadline - Date.now();
  if (left !== undefined && left <= 0) throw new CallError(`Ran out of time before ${id} could run`);
  const r = await callOperation(op, input, { ...deps, ...(maxBodyChars ? { maxBodyChars } : {}), ...(left !== undefined ? { deadlineMs: left } : {}) });
  // Anything but 2xx is a failure here, a redirect included: a typed tool must never turn it into an empty answer.
  if (r.status < 200 || r.status >= 300) throw new CallError(`DATEV returned HTTP ${r.status} for ${id}: ${JSON.stringify(r.body).slice(0, 300)}`);
  if (r.bytes) throw new CallError(`DATEV answered ${id} with a binary file (${r.contentType ?? "unknown type"}) instead of data`);
  if (r.truncated) throw new CallError(`DATEV's answer for ${id} was larger than this tool can read safely; narrow the request`);
  return r;
}

// An empty body is an empty list. Anything else that is not a list means DATEV answered in a shape we do not understand.
function asList(body: unknown, id: string): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body === "" || body === undefined || body === null) return [];
  // One NDJSON line sent as application/json parses to a single object: a list of one, not an error.
  // An object that only carries an error description is DATEV failing, even with HTTP 200.
  if (typeof body === "object") {
    const keys = Object.keys(body as object);
    if (keys.length > 0 && keys.every((k) => /^(error|errors|message|detail|title|status|httpMessage|code)$/i.test(k)))
      throw new CallError(`DATEV answered ${id} with an error instead of data: ${JSON.stringify(body).slice(0, 200)}`);
    return [body as Record<string, unknown>];
  }
  throw new CallError(`DATEV answered ${id} in an unexpected format (${typeof body}), so no result is shown rather than a wrong one`);
}

// Every row must look like what the endpoint promises; one stray row means the whole answer is not trusted.
function rowsOf(body: unknown, id: string, valid: (row: Record<string, unknown>) => boolean, what: string): Record<string, unknown>[] {
  const rows = asList(body, id);
  const bad = rows.findIndex((r) => !r || typeof r !== "object" || Array.isArray(r) || !valid(r));
  if (bad >= 0) throw new CallError(`DATEV answered ${id} with a row that is not ${what} (row ${bad + 1}: ${JSON.stringify(rows[bad]).slice(0, 150)})`);
  return rows;
}

// The spec's JobState enum is PENDING, COMPLETED, FAILED, DELETED; other shapes fall back to reading the words.
export function jobPhase(body: unknown): "done" | "failed" | "running" {
  const state = body && typeof body === "object" ? (body as { jobState?: unknown }).jobState : undefined;
  if (state === "COMPLETED") return "done";
  if (state === "FAILED" || state === "DELETED") return "failed";
  if (state === "PENDING") return "running";
  const text = JSON.stringify(body ?? "").toLowerCase();
  if (/delet/.test(text)) return "failed";
  if (/fail|error|abort|cancel/.test(text)) return "failed";
  if (/finish|complet|done|success|succeed|ready|processed/.test(text)) return "done";
  return "running";
}

export function jobIdFrom(body: unknown, location?: string): string | undefined {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const o = body as Record<string, unknown>;
    for (const k of ["id", "jobId", "job_id"]) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  }
  if (typeof body === "string" && /^[\w-]{6,}$/.test(body.trim())) return body.trim();
  return location?.split("/").filter(Boolean).pop();
}

// DATEV sends fiscal years as bare ids (one per NDJSON line); accept objects with an id as well.
export function fiscalYearIds(body: unknown): string[] {
  const items = Array.isArray(body) ? body : body === undefined || body === null || body === "" ? [] : [body];
  return items.map((x, i) => {
    const id = x && typeof x === "object" ? (x as Record<string, unknown>).id : x;
    if (typeof id !== "string" && typeof id !== "number") throw new CallError(`DATEV sent a fiscal year without an id (entry ${i + 1}: ${JSON.stringify(x).slice(0, 150)})`);
    return String(id);
  });
}

const accountOf = (row: Record<string, unknown>): string =>
  String(row.accountNumber ?? row.account_number ?? row.account ?? row.generalLedgerAccount ?? "");

export function registerAccountingTools(server: McpServer, deps: (signal?: AbortSignal) => CallDeps, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): void {
  server.registerTool(
    "datev_list_clients",
    {
      title: "List DATEV clients",
      description: "List the DATEV clients (Mandanten) this login can access, with their client ids and active data services.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (_args, extra) => {
      try {
        const d = deps(extra.signal);
        const deadline = Date.now() + 50_000;
        const all: Record<string, unknown>[] = [];
        // DATEV returns at most 100 clients per request, so page with skip until a short page arrives.
        let complete = false;
        for (let page = 0; page < 50; page++) {
          const r = await call("accounting-clients.getclients", { query: { top: 100, skip: page * 100 } }, d, undefined, deadline); // BESTPRACTICE_OK: each page depends on the previous count
          const rows = rowsOf(r.body, "accounting-clients.getclients", (c) => typeof c.id === "string" && c.id !== "", "a client with an id");
          all.push(...rows);
          if (rows.length < 100) {
            complete = true;
            break;
          }
        }
        const clients = all.map((c) => ({ id: c.id, name: c.name, number: c.client_number, services: Array.isArray(c.services) ? (c.services as { name?: string }[]).map((s) => s.name) : undefined }));
        return ok(complete ? clients : { complete: false, note: "More than 5000 clients; only the first 5000 are listed.", clients });
      } catch (e) {
        return err(errorText(e));
      }
    },
  );

  server.registerTool(
    "datev_list_fiscal_years",
    {
      title: "List fiscal years of a DATEV client",
      description: "List a client's fiscal years (Wirtschaftsjahre) with their ids, needed for accounts, balances and postings.",
      inputSchema: { client_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client_id }, extra) => {
      try {
        const body = (await call("accounting-dataexchange.getfiscalyears", { pathParams: { clientId: client_id } }, deps(extra.signal))).body;
        if (body !== "" && body !== undefined && body !== null) asList(body, "accounting-dataexchange.getfiscalyears");
        return ok(fiscalYearIds(body).map((id) => ({ id })));
      } catch (e) {
        return err(errorText(e));
      }
    },
  );

  server.registerTool(
    "datev_sums_and_balances",
    {
      title: "Sums and balances (Summen- und Saldenliste)",
      description: "Opening balances, monthly values and balances per account for a client's fiscal year. Filter by account number prefix to keep the answer small.",
      inputSchema: {
        client_id: z.string(),
        fiscal_year_id: z.string(),
        account_prefix: z.string().regex(/^\d*$/).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client_id, fiscal_year_id, account_prefix, limit }, extra) => {
      try {
        const r = await call("accounting-dataexchange.getsumsandbalances", { pathParams: { clientId: client_id, fiscalYearId: fiscal_year_id } }, deps(extra.signal), UNCAPPED);
        const all = rowsOf(r.body, "accounting-dataexchange.getsumsandbalances", (x) => accountOf(x) !== "", "an account with a number");
        const rows = account_prefix ? all.filter((x) => accountOf(x).startsWith(account_prefix)) : all;
        return ok({ total_accounts: all.length, matches: rows.length, rows: rows.slice(0, limit ?? 50) });
      } catch (e) {
        return err(errorText(e));
      }
    },
  );

  server.registerTool(
    "datev_account_postings",
    {
      title: "Account postings (Kontobuchungen)",
      description:
        "Fetch the posted bookings of a client's fiscal year from DATEV, optionally for one account. DATEV prepares these asynchronously, so this waits for the export job (up to max_wait_seconds) and reads every page it can in that time. If the job is not ready, call again with the returned job_id to continue the same job instead of starting a new one.",
      inputSchema: {
        client_id: z.string(),
        fiscal_year_id: z.string(),
        account: z.string().regex(/^\d+$/).optional().describe("Only postings on this account (number prefix)"),
        limit: z.number().int().min(1).max(500).optional(),
        job_id: z.string().optional().describe("Continue an export job returned by an earlier call"),
        from_page: z.number().int().min(1).optional().describe("First page to read, for continuing a partial read"),
        max_wait_seconds: z.number().int().min(5).max(50).optional().describe("Max 50: MCP clients usually cancel a call after 60 seconds"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client_id, fiscal_year_id, account, limit, job_id, from_page, max_wait_seconds }, extra) => {
      try {
        const d = deps(extra.signal);
        const ids = { clientId: client_id, fiscalYearId: fiscal_year_id };
        // One budget for the whole call, polling and page reads included, so the tool answers before the MCP client gives up.
        const deadline = Date.now() + (max_wait_seconds ?? 45) * 1000;
        let jobId = job_id;
        if (!jobId) {
          const started = await call("accounting-dataexchange.postaccountpostingsjob", { pathParams: ids }, d, undefined, deadline);
          jobId = jobIdFrom(started.body, started.location);
          if (!jobId) throw new CallError(`DATEV did not return a job id: ${JSON.stringify(started.body).slice(0, 200)}`);
        }
        const job = jobId;
        let phase = jobPhase((await call("accounting-dataexchange.getjobstate", { pathParams: { clientId: client_id, jobId: job } }, d, undefined, deadline)).body);
        while (phase === "running" && Date.now() + 2000 < deadline) {
          await sleep(2000); // BESTPRACTICE_OK: polling a job is sequential by nature
          phase = jobPhase((await call("accounting-dataexchange.getjobstate", { pathParams: { clientId: client_id, jobId: job } }, d, undefined, deadline)).body); // BESTPRACTICE_OK: same poll
        }
        if (phase === "failed") throw new CallError(`DATEV reported the postings job ${job} as failed or deleted. Start a new one by calling without job_id.`);
        if (phase === "running") return ok({ ready: false, job_id: job, note: "DATEV is still preparing the postings. Call again with this job_id to continue the same job." });

        const first = from_page ?? 1;
        const keep = limit ?? 50;
        if (Date.now() + 1000 >= deadline) return ok({ ready: true, job_id: job, complete: false, pages_read: "none", note: `The job is ready but no time was left to read it. Call again with job_id and from_page ${first}.` });
        const rows: Record<string, unknown>[] = [];
        let matches = 0;
        let read = 0;
        let pageNo = first;
        let pages: number | undefined;
        let total: number | undefined;
        // Each page's count comes from the previous answer and all pages share one deadline, so they are read in order.
        while (pages === undefined || pageNo <= pages) {
          if (pageNo > first && Date.now() >= deadline) break;
          const page = await call("accounting-dataexchange.getaccountpostingsjob", { pathParams: { clientId: client_id, jobId: job }, query: { page: pageNo } }, d, UNCAPPED, deadline); // BESTPRACTICE_OK: paging is sequential
          const all = rowsOf(page.body, "accounting-dataexchange.getaccountpostingsjob", () => true, "a posting");
          pages = Number(page.paging?.["x-total-pages"] ?? 1) || 1;
          total = page.paging?.["x-total-count"] !== undefined ? Number(page.paging["x-total-count"]) : undefined;
          read += all.length;
          // Only the rows that will be shown are kept, so many large pages never pile up in memory.
          for (const x of all) {
            if (account && !accountOf(x).startsWith(account)) continue;
            matches++;
            if (rows.length < keep) rows.push(x);
          }
          pageNo++;
        }
        const done = pages !== undefined && pageNo > pages;
        return ok({
          ready: true,
          job_id: job,
          complete: done,
          pages_read: `${first}-${pageNo - 1} of ${pages}`,
          postings_read: read,
          total_postings: total,
          matches,
          rows,
          ...(done ? {} : { note: `Not every page was read in time. Call again with job_id and from_page ${pageNo} to continue.` }),
        });
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
