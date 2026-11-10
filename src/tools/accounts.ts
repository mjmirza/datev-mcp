import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bounded, callOperation, CallError, problemText, type CallDeps } from "../api/client.js";
import { NeedsLoginError } from "../auth/session.js";
import { getOperation } from "./catalog.js";
import { dataexchangeGuard } from "../api/dataexchange-guard.js";
import { localize } from "../i18n.js";

// Reads the client's own chart of accounts (SKR03, SKR04 or custom) live from DATEV,
// so no DATEV-owned account data ships with this package.

export interface LedgerAccount {
  accountNumber: number;
  caption: string;
  mainFunction?: number;
  additionalFunction?: string;
}

const CACHE_MS = 10 * 60_000;
export interface AccountChart {
  accounts: LedgerAccount[];
  /** Rows DATEV sent that lack a numeric account number or a caption. */
  skipped: number;
}
const cache = new Map<string, { at: number; chart: AccountChart }>();

export function clearAccountCache(): void {
  cache.clear();
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

export function matchAccounts(accounts: LedgerAccount[], query: string, limit = 25): LedgerAccount[] {
  const q = query.trim();
  if (q === "") return accounts.slice(0, limit);
  if (/^\d+$/.test(q)) return accounts.filter((a) => String(a.accountNumber).startsWith(q)).slice(0, limit);
  const terms = fold(q).split(/\s+/).filter(Boolean);
  return accounts.filter((a) => terms.every((t) => fold(a.caption).includes(t))).slice(0, limit);
}

export async function loadAccounts(clientId: string, fiscalYearId: string, deps: CallDeps, now = Date.now()): Promise<LedgerAccount[]> {
  return (await loadAccountChart(clientId, fiscalYearId, deps, now)).accounts;
}

export async function loadAccountChart(clientId: string, fiscalYearId: string, deps: CallDeps, now = Date.now()): Promise<AccountChart> {
  // The key carries who is asking: a login or app change must never be served the previous user's cached chart.
  // The budget starts before the token wait, so a held session lock cannot push the call past the client timeout.
  const deadline = Date.now() + (deps.deadlineMs ?? 55_000);
  const token = await bounded(deps.token(), deadline, deps.signal, "while getting a DATEV access token");
  const who = createHash("sha256").update(`${deps.creds.clientId}|${token}`).digest("hex").slice(0, 16);
  const key = `${deps.env}|${who}|${clientId}|${fiscalYearId}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.chart;
  await dataexchangeGuard(clientId, fiscalYearId, deps, deadline);
  const op = getOperation("accounting-dataexchange.getgeneralledgeraccounts");
  if (!op) throw new CallError("The general ledger operation is missing from the index");
  // A full chart easily exceeds the generic response cap, so read it whole and filter here.
  const r = await callOperation(op, { pathParams: { clientId, fiscalYearId } }, { ...deps, maxBodyChars: Number.MAX_SAFE_INTEGER, deadlineMs: Math.max(0, deadline - Date.now()) });
  if (r.status !== 200) throw new CallError(`DATEV returned HTTP ${r.status} for the chart of accounts: ${problemText(r.status, r.body)}`);
  if (!Array.isArray(r.body)) throw new CallError("DATEV returned the chart of accounts in an unexpected format");
  const rows = r.body as LedgerAccount[];
  const accounts = rows.filter((a) => typeof a?.accountNumber === "number" && typeof a?.caption === "string").sort((a, b) => a.accountNumber - b.accountNumber);
  if (rows.length > 0 && accounts.length === 0)
    throw new CallError(`DATEV returned a chart of accounts, but none of the ${rows.length} rows has an account number and a name (first row: ${JSON.stringify(rows[0]).slice(0, 150)})`);
  const chart = { accounts, skipped: rows.length - accounts.length };
  // Charts of an old token or another client are dropped after 10 minutes, as SECURITY.md promises.
  for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
  cache.set(key, { at: now, chart });
  return chart;
}

export function registerAccountTools(server: McpServer, deps: (signal?: AbortSignal) => CallDeps): void {
  server.registerTool(
    "datev_find_accounts",
    {
      title: "Find accounts in a client's chart of accounts",
      description:
        "Look up general ledger accounts (Sachkonten) of one DATEV client and fiscal year, by number prefix or by name words. Uses the client's real chart (SKR03, SKR04 or custom). Use before booking to check an account exists.",
      inputSchema: {
        client_id: z.string().describe("Technical client id from datev_list_clients (format consultant-client, e.g. 12345-1). Never invent one."),
        fiscal_year_id: z.string().describe("Fiscal year id, e.g. 20230701 (from getfiscalyears)"),
        query: z.string().describe("Account number prefix like '1200', or words like 'Bank' or 'Umsatzsteuer'"),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client_id, fiscal_year_id, query, limit }, extra) => {
      try {
        const { accounts: all, skipped } = await loadAccountChart(client_id, fiscal_year_id, deps(extra.signal));
        const hits = matchAccounts(all, query, limit ?? 25);
        const note = skipped ? { note: `${skipped} account rows from DATEV had no account number or name and were left out.` } : {};
        const text = JSON.stringify({ total_accounts: all.length, matches: hits.length, skipped_rows: skipped, ...note, accounts: hits }, null, 2);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const message = e instanceof NeedsLoginError || e instanceof CallError ? e.message : `Account lookup failed: ${e instanceof Error ? e.message : String(e)}`;
        return { content: [{ type: "text" as const, text: localize(message) }], isError: true };
      }
    },
  );
}
