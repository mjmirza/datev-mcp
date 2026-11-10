import { createHash } from "node:crypto";
import { bounded, callOperation, CallError, problemText, type CallDeps } from "./client.js";
import { requireClientService } from "./permission.js";
import { getOperation } from "../tools/catalog.js";

// DATEV's rules for Datenservice Export Rechnungswesen (accounting-dataexchange): check the
// client's permission, read the fiscal years first, then the chosen year's configuration.

/** The fields of DATEV's fiscal year this server uses, and why (DATEV asks apps to explain this). */
export interface FiscalYearSettings {
  /** First and last day: postings and balances belong to this period. */
  year_begin?: string;
  year_end?: string;
  /** Length of a general ledger account number, so account numbers are read and shown correctly. */
  account_length?: number;
  /** DATEV standard chart of accounts (SKR), so accounts are named in the client's chart. */
  account_system?: number;
  /** Currency of the amounts. */
  currency_code?: string;
  /** DE or AT, which law the bookkeeping follows. */
  national_right?: string;
}

const TTL_MS = 10 * 60_000;
const permitted = new Map<string, number>();
const years = new Map<string, { at: number; ids: string[] }>();
const settings = new Map<string, { at: number; value: FiscalYearSettings }>();

export function clearDataexchangeCache(): void {
  permitted.clear();
  years.clear();
  settings.clear();
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// DATEV sends fiscal years as bare ids (one per NDJSON line); objects with an id are accepted too.
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

async function get(id: string, pathParams: Record<string, string>, deps: CallDeps, deadline: number) {
  const op = getOperation(id);
  if (!op) throw new CallError(`${id} is missing from the operation index`);
  const r = await callOperation(op, { pathParams }, { ...deps, maxBodyChars: Math.max(deps.maxBodyChars ?? 0, 100_000), deadlineMs: Math.max(1000, deadline - Date.now()) });
  if (r.status < 200 || r.status >= 300) throw new CallError(`DATEV returned HTTP ${r.status} for ${id}: ${problemText(r.status, r.body)}`);
  if (r.truncated) throw new CallError(`DATEV's answer for ${id} was cut off, so it cannot be checked`);
  return r.body;
}

/** Permission, fiscal years and year settings before any Datenservice Export call, each read at most every 10 minutes. */
export async function dataexchangeGuard(clientId: string, fiscalYearId: string | undefined, deps: CallDeps, deadline = Date.now() + 50_000): Promise<{ fiscal_years: string[]; settings?: FiscalYearSettings }> {
  // The key carries who is asking, so a new login never inherits the previous one's checks.
  const token = await bounded(deps.token(), deadline, deps.signal, "while getting a DATEV access token");
  const who = createHash("sha256").update(`${deps.creds.clientId}|${token}`).digest("hex").slice(0, 16);
  const key = `${deps.env}|${who}|${clientId}`;
  const now = Date.now();
  for (const m of [permitted, years, settings] as Map<string, unknown>[]) for (const [k, v] of m) if (now - (typeof v === "number" ? v : (v as { at: number }).at) > TTL_MS) m.delete(k);

  if (!permitted.has(key)) {
    await requireClientService(clientId, ["Datenservice Export Rechnungswesen"], deps, deadline);
    permitted.set(key, now);
  }
  let known = years.get(key);
  if (!known) {
    known = { at: now, ids: fiscalYearIds(await get("accounting-dataexchange.getfiscalyears", { clientId }, deps, deadline)) };
    years.set(key, known);
  }
  if (fiscalYearId === undefined) return { fiscal_years: known.ids };
  if (!known.ids.includes(fiscalYearId))
    throw new CallError(`Fiscal year ${fiscalYearId} does not exist for this client. Available: ${known.ids.join(", ") || "none"}. Nothing was read.`);
  const skey = `${key}|${fiscalYearId}`;
  let s = settings.get(skey);
  if (!s) {
    const b = await get("accounting-dataexchange.getfiscalyear", { clientId, fiscalYearId }, deps, deadline);
    const o = b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
    s = {
      at: now,
      value: { year_begin: str(o.yearBegin), year_end: str(o.yearEnd), account_length: num(o.accountLength), account_system: num(o.accountSystem), currency_code: str(o.currencyCode), national_right: str(o.nationalRight) },
    };
    settings.set(skey, s);
  }
  return { fiscal_years: known.ids, settings: s.value };
}
