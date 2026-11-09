import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callOperation, CallError, problemText, type CallDeps, type CallInput } from "../api/client.js";
import { NeedsLoginError } from "../auth/session.js";
import { getOperation } from "./catalog.js";
import { localize } from "../i18n.js";

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ content: [{ type: "text" as const, text: localize(m) }], isError: true });
const UNCAPPED = Number.MAX_SAFE_INTEGER;

// Data minimisation: what an assistant needs to answer a booking question, without VAT ids, links or EU details.
const BASIC_POSTING = ["date", "accountNumber", "contraAccountNumber", "amountDebit", "amountCredit", "currencyCode", "postingDescription", "documentField1", "taxRate", "kost1CostCenterId", "kost2CostCenterId", "accountingSequenceId"];
const basicPosting = (x: Record<string, unknown>) => Object.fromEntries(BASIC_POSTING.filter((k) => Object.hasOwn(x, k)).map((k) => [k, x[k]]));

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
  if (r.status < 200 || r.status >= 300) throw new CallError(`DATEV returned HTTP ${r.status} for ${id}: ${problemText(r.status, r.body)}`);
  if (r.bytes) throw new CallError(`DATEV answered ${id} with a binary file (${r.contentType ?? "unknown type"}) instead of data`);
  if (r.truncated) throw new CallError(`DATEV's answer for ${id} was larger than this tool can read safely; narrow the request`);
  return r;
}

// An object that only carries an error description is DATEV failing, even with HTTP 200.
const errorOnly = (o: object): boolean => {
  const keys = Object.keys(o);
  return keys.length > 0 && keys.every((k) => /^(error|errors|message|detail|title|status|httpMessage|code)$/i.test(k));
};

// An empty body is an empty list. Anything else that is not a list means DATEV answered in a shape we do not understand.
function asList(body: unknown, id: string): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body === "" || body === undefined || body === null) return [];
  // One NDJSON line sent as application/json parses to a single object: a list of one, not an error.
  // An object that only carries an error description is DATEV failing, even with HTTP 200.
  if (typeof body === "object") {
    if (errorOnly(body)) throw new CallError(`DATEV answered ${id} with an error instead of data: ${JSON.stringify(body).slice(0, 200)}`);
    return [body as Record<string, unknown>];
  }
  throw new CallError(`DATEV answered ${id} in an unexpected format (${typeof body}), so no result is shown rather than a wrong one`);
}

// Every row must look like what the endpoint promises; one stray row means the whole answer is not trusted.
function rowsOf(body: unknown, id: string, valid: (row: Record<string, unknown>) => boolean, what: string): Record<string, unknown>[] {
  const rows = asList(body, id);
  const bad = rows.findIndex((r) => !r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length === 0 || errorOnly(r) || !valid(r));
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
    // DATEV fiscal year ids are dates as eight digits, e.g. 20230701.
    if ((typeof id !== "string" && typeof id !== "number") || !/^(199[2-9]|20[0-9][0-9])[0-9]{4}$/.test(String(id)))
      throw new CallError(`DATEV sent something that is not a fiscal year id (entry ${i + 1}: ${JSON.stringify(x).slice(0, 150)})`);
    return String(id);
  });
}

const accountRaw = (row: Record<string, unknown>): unknown => row.accountNumber ?? row.account_number ?? row.account ?? row.generalLedgerAccount;
const accountOf = (row: Record<string, unknown>): string => {
  const v = accountRaw(row);
  return typeof v === "number" || typeof v === "string" ? String(v) : "";
};
// An account number is a whole number, sent as a number or as digits.
const hasAccountNumber = (row: Record<string, unknown>): boolean => {
  const v = accountRaw(row);
  return (typeof v === "number" && Number.isInteger(v) && v >= 0) || (typeof v === "string" && /^\d+$/.test(v));
};

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
        // DATEV: the technical id is for API calls only and is not shown to the user. People know a client by name and numbers.
        const clients = all.map((c) => ({
          name: c.name,
          consultant_number: c.consultant_number,
          client_number: c.client_number,
          data_services: Array.isArray(c.services) ? (c.services as { name?: string }[]).map((s) => s.name) : undefined,
          technical_id: c.id,
        }));
        const note = "Show the user name, consultant number and client number. technical_id is only for the client_id argument of other tools; DATEV asks apps not to display it.";
        return ok(complete ? { note, clients } : { complete: false, note: `More than 5000 clients; only the first 5000 are listed. ${note}`, clients });
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
        const all = rowsOf(r.body, "accounting-dataexchange.getsumsandbalances", hasAccountNumber, "an account with a number");
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
        "Fetch the posted bookings of a client's fiscal year from DATEV, optionally for one account. This starts an export job at DATEV (DATEV keeps it up to 12 hours; it changes no bookings), waits for it up to max_wait_seconds and reads every page it can in that time. The whole journal is read, because DATEV has no account filter; only matching rows are returned, with a basic set of fields unless fields is \"all\". If the job is not ready, call again with the returned job_id to continue the same job instead of starting a new one.",
      inputSchema: {
        client_id: z.string(),
        fiscal_year_id: z.string(),
        account: z.string().regex(/^\d+$/).optional().describe("Only postings on this account (number prefix)"),
        limit: z.number().int().min(1).max(500).optional(),
        job_id: z.string().optional().describe("Continue an export job returned by an earlier call"),
        from_page: z.number().int().min(1).optional().describe("First page to read, for continuing a partial read"),
        max_wait_seconds: z.number().int().min(5).max(50).optional().describe("Max 50: MCP clients usually cancel a call after 60 seconds"),
        fields: z.enum(["basic", "all"]).optional().describe("basic (default): account, contra account, date, amounts, text, document number, tax rate, cost centres. all: every field DATEV sends"),
      },
      // Not read-only: it creates an export job at DATEV. It changes no business data, so it needs no preview.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ client_id, fiscal_year_id, account, limit, job_id, from_page, max_wait_seconds, fields }, extra) => {
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
        const outOfTime = (e: unknown) => e instanceof CallError && /Ran out of time/.test(e.message);
        const state = async () => jobPhase((await call("accounting-dataexchange.getjobstate", { pathParams: { clientId: client_id, jobId: job } }, d, undefined, deadline)).body);
        let phase: "done" | "failed" | "running";
        try {
          phase = await state();
          while (phase === "running" && Date.now() + 2000 < deadline) {
            await sleep(2000); // BESTPRACTICE_OK: polling a job is sequential by nature
            phase = await state(); // BESTPRACTICE_OK: same poll
          }
        } catch (e) {
          // The job exists; running out of time must not lose it.
          if (outOfTime(e)) return ok({ ready: false, job_id: job, note: "Ran out of time while waiting for DATEV. Call again with this job_id to continue the same job." });
          throw e;
        }
        if (phase === "failed") throw new CallError(`DATEV reported the postings job ${job} as failed or deleted. Start a new one by calling without job_id.`);
        if (phase === "running") return ok({ ready: false, job_id: job, note: "DATEV is still preparing the postings. Call again with this job_id to continue the same job." });

        const first = from_page ?? 1;
        const keep = limit ?? 50;
        if (Date.now() + 1000 >= deadline) return ok({ ready: true, job_id: job, complete: false, pages_read: "none", note: `The job is ready but no time was left to read it. Call again with job_id and from_page ${first}.` });
        const rows: Record<string, unknown>[] = [];
        let matches = 0;
        let withoutAccount = 0;
        let read = 0;
        let pageNo = first;
        let pages: number | undefined;
        let total: number | undefined;
        // Each page's count comes from the previous answer and all pages share one deadline, so they are read in order.
        while (pages === undefined || pageNo <= pages) {
          if (pageNo > first && Date.now() >= deadline) break;
          let page;
          try {
            page = await call("accounting-dataexchange.getaccountpostingsjob", { pathParams: { clientId: client_id, jobId: job }, query: { page: pageNo } }, d, UNCAPPED, deadline); // BESTPRACTICE_OK: paging is sequential
          } catch (e) {
            if (outOfTime(e)) break; // keep what was read; the answer says where to continue
            throw e;
          }
          const all = rowsOf(page.body, "accounting-dataexchange.getaccountpostingsjob", () => true, "a posting");
          pages = Number(page.paging?.["x-total-pages"] ?? 1) || 1;
          total = page.paging?.["x-total-count"] !== undefined ? Number(page.paging["x-total-count"]) : undefined;
          read += all.length;
          // Only the rows that will be shown are kept, so many large pages never pile up in memory.
          for (const x of all) {
            if (!hasAccountNumber(x)) withoutAccount++;
            if (account && !accountOf(x).startsWith(account)) continue;
            matches++;
            if (rows.length < keep) rows.push(fields === "all" ? x : basicPosting(x));
          }
          pageNo++;
        }
        const done = pages !== undefined && pageNo > pages;
        return ok({
          ready: true,
          job_id: job,
          complete: done,
          pages_read: pageNo > first ? `${first}-${pageNo - 1} of ${pages ?? "unknown"}` : "none",
          postings_read: read,
          total_postings: total,
          matches,
          rows_without_account: withoutAccount,
          rows,
          ...(done
            ? account && withoutAccount > 0
              ? { note: `${withoutAccount} posting rows have no readable account number, so the account filter could not match them. Call without account to see them.` }
              : {}
            : { note: `Not every page was read in time. Call again with job_id and from_page ${pageNo} to continue.` }),
        });
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
