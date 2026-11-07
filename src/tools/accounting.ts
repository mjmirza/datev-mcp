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

async function call(id: string, input: CallInput, deps: CallDeps, maxBodyChars?: number) {
  const op = getOperation(id);
  if (!op) throw new CallError(`${id} is missing from the operation index`);
  const r = await callOperation(op, input, maxBodyChars ? { ...deps, maxBodyChars } : deps);
  if (r.status >= 400) throw new CallError(`DATEV returned HTTP ${r.status} for ${id}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r;
}

const asList = (body: unknown): Record<string, unknown>[] => (Array.isArray(body) ? (body as Record<string, unknown>[]) : []);

// DATEV does not document job state values; anything that reads as finished or failed counts.
export function jobPhase(body: unknown): "done" | "failed" | "running" {
  const text = JSON.stringify(body ?? "").toLowerCase();
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

const accountOf = (row: Record<string, unknown>): string =>
  String(row.accountNumber ?? row.account_number ?? row.account ?? row.generalLedgerAccount ?? "");

export function registerAccountingTools(server: McpServer, deps: () => CallDeps, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): void {
  server.registerTool(
    "datev_list_clients",
    {
      title: "List DATEV clients",
      description: "List the DATEV clients (Mandanten) this login can access, with their client ids and active data services.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const r = await call("accounting-clients.getclients", {}, deps());
        return ok(asList(r.body).map((c) => ({ id: c.id, name: c.name, number: c.client_number, services: Array.isArray(c.services) ? (c.services as { name?: string }[]).map((s) => s.name) : undefined })));
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
    async ({ client_id }) => {
      try {
        return ok((await call("accounting-dataexchange.getfiscalyears", { pathParams: { clientId: client_id } }, deps())).body);
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
    async ({ client_id, fiscal_year_id, account_prefix, limit }) => {
      try {
        const r = await call("accounting-dataexchange.getsumsandbalances", { pathParams: { clientId: client_id, fiscalYearId: fiscal_year_id } }, deps(), UNCAPPED);
        const all = asList(r.body);
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
        "Fetch the posted bookings of a client's fiscal year from DATEV, optionally for one account. DATEV prepares these asynchronously, so this waits for the export job (up to max_wait_seconds).",
      inputSchema: {
        client_id: z.string(),
        fiscal_year_id: z.string(),
        account: z.string().regex(/^\d+$/).optional().describe("Only postings on this account (number prefix)"),
        limit: z.number().int().min(1).max(500).optional(),
        max_wait_seconds: z.number().int().min(5).max(120).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client_id, fiscal_year_id, account, limit, max_wait_seconds }) => {
      try {
        const d = deps();
        const ids = { clientId: client_id, fiscalYearId: fiscal_year_id };
        const started = await call("accounting-dataexchange.postaccountpostingsjob", { pathParams: ids }, d);
        const jobId = jobIdFrom(started.body, started.location);
        if (!jobId) throw new CallError(`DATEV did not return a job id: ${JSON.stringify(started.body).slice(0, 200)}`);
        const deadline = Date.now() + (max_wait_seconds ?? 60) * 1000;
        let phase = jobPhase((await call("accounting-dataexchange.getjobstate", { pathParams: { clientId: client_id, jobId } }, d)).body);
        while (phase === "running" && Date.now() < deadline) {
          await sleep(2000); // BESTPRACTICE_OK: polling a job is sequential by nature
          phase = jobPhase((await call("accounting-dataexchange.getjobstate", { pathParams: { clientId: client_id, jobId } }, d)).body); // BESTPRACTICE_OK: same poll
        }
        if (phase === "failed") throw new CallError(`DATEV reported the postings job ${jobId} as failed`);
        if (phase === "running") return ok({ ready: false, job_id: jobId, note: "DATEV is still preparing the postings. Call again later or raise max_wait_seconds." });
        const page = await call("accounting-dataexchange.getaccountpostingsjob", { pathParams: { clientId: client_id, jobId }, query: { page: 1 } }, d, UNCAPPED);
        const all = asList(page.body);
        const rows = account ? all.filter((x) => accountOf(x).startsWith(account)) : all;
        return ok({ ready: true, job_id: jobId, page: 1, postings_on_page: all.length, matches: rows.length, rows: rows.slice(0, limit ?? 50) });
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
