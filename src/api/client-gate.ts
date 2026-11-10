import { createHash } from "node:crypto";
import { bounded, callOperation, CallError, problemText, type CallDeps } from "./client.js";
import { getOperation } from "../tools/catalog.js";
import type { Operation } from "../spec/types.js";

// DATEV: before data moves for a client, read it with the service's own clients endpoint,
// refuse clearly when it is not permitted, and do so once per transfer day.

/** The service's own single-client endpoint, per DATEV product. */
export const CLIENT_CHECK: Record<string, string> = {
  "accounting-documents": "accounting-documents.get_clients_client_id",
  "accounting-dxso-jobs": "accounting-dxso-jobs.get_clients_client_id",
  "hr-documents": "hr-documents.getclientbyconsultantclientnumber",
  "hr-exchange": "hr-exchange.getclient",
  "hr-exports": "hr-exports.getclientbyclientid",
  "hr-files": "hr-files.get_v1_clients_client_id",
  "hr-payrollreports": "hr-payrollreports.getclientbyclientid",
  "my-tax-income-tax-documents": "my-tax-income-tax-documents.getclient",
  "eau-api": "eau-api.getclients",
};

export const SETUP_LINK = "http://go.datev.de/datenservices-einrichten";

export interface CheckedClient {
  client_id: string;
  name?: string;
  consultant_number?: number;
  client_number?: number;
  /** hr-payrollreports: the report types this client grants. */
  access_granted?: string[];
}

const ID_NAMES = ["client-id", "clientId", "consultantnumber-clientnumber"];

/** The consultant-client id a call is about, from whichever path parameter names it. */
function clientIdOf(pathParams: Record<string, unknown> | undefined): string | undefined {
  if (!pathParams) return undefined;
  for (const n of ID_NAMES) if (pathParams[n] !== undefined && pathParams[n] !== "") return String(pathParams[n]);
  if (pathParams.consultantNumber !== undefined && pathParams.clientNumber !== undefined) return `${pathParams.consultantNumber}-${pathParams.clientNumber}`;
  return undefined;
}

function checkParams(op: Operation, clientId: string): Record<string, string> {
  const names = op.params.filter((p) => p.in === "path").map((p) => p.name);
  if (names.includes("consultantNumber")) {
    const [consultantNumber = "", clientNumber = ""] = clientId.split("-");
    return { consultantNumber, clientNumber };
  }
  return { [names[0] ?? "client-id"]: clientId };
}

const day = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const checked = new Map<string, { day: string; client: CheckedClient }>();

export function clearClientGate(): void {
  checked.clear();
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

/** Reads the client with the product's own clients endpoint; throws a clear refusal when DATEV denies it. */
export async function checkClient(product: string, clientId: string, deps: CallDeps, opts: { fresh?: boolean; deadline?: number } = {}): Promise<CheckedClient> {
  const id = CLIENT_CHECK[product];
  const op = id ? getOperation(id) : undefined;
  if (!op) throw new CallError(`No permission check is known for ${product}`);
  const deadline = opts.deadline ?? Date.now() + 50_000;
  const token = await bounded(deps.token(), deadline, deps.signal, "while getting a DATEV access token");
  const who = createHash("sha256").update(`${deps.creds.clientId}|${token}`).digest("hex").slice(0, 16);
  const key = `${deps.env}|${who}|${product}|${clientId}`;
  const hit = checked.get(key);
  if (!opts.fresh && hit && hit.day === day()) return hit.client;
  const r = await callOperation(op, { pathParams: checkParams(op, clientId) }, { ...deps, maxBodyChars: Math.max(deps.maxBodyChars ?? 0, 100_000), deadlineMs: Math.max(1000, deadline - Date.now()) });
  if (r.status < 200 || r.status >= 300 || r.truncated) {
    checked.delete(key);
    const why = r.truncated ? "its answer was cut off" : `DATEV answered HTTP ${r.status}`;
    throw new CallError(
      `Access to client ${clientId} could not be confirmed for this data service (${why}). Nothing was sent. Please check the consultant and client number, or ask your administrator whether the data service is ordered and switched on at DATEV, see ${SETUP_LINK}.${r.status >= 400 ? ` ${problemText(r.status, r.body)}` : ""}`,
    );
  }
  const b = r.body && typeof r.body === "object" && !Array.isArray(r.body) ? (r.body as Record<string, unknown>) : {};
  const types = b.document_types && typeof b.document_types === "object" ? (b.document_types as { access_granted?: unknown }) : undefined;
  const client: CheckedClient = {
    client_id: clientId,
    name: typeof b.name === "string" ? b.name : typeof b.company_name === "string" ? b.company_name : undefined,
    consultant_number: num(b.consultant_number ?? b.consultantNumber),
    client_number: num(b.client_number ?? b.clientNumber),
    ...(Array.isArray(types?.access_granted) ? { access_granted: (types.access_granted as unknown[]).filter((x): x is string => typeof x === "string") } : {}),
  };
  checked.set(key, { day: day(), client });
  return client;
}

/** The gate datev_call and datev_upload_file run before a client-bound call of a gated product. */
export async function gateCall(op: Operation, pathParams: Record<string, unknown> | undefined, query: Record<string, unknown> | undefined, deps: CallDeps): Promise<CheckedClient | undefined> {
  const checkId = CLIENT_CHECK[op.product];
  if (!checkId || op.id === checkId) return undefined;
  const clientId = clientIdOf(pathParams);
  if (!clientId) return undefined;
  const client = await checkClient(op.product, clientId, deps);
  // Payroll reports: DATEV lists per client which report types are granted; ask only for those.
  const wanted = query?.document_types;
  if (client.access_granted && wanted !== undefined) {
    const asked = (Array.isArray(wanted) ? wanted : String(wanted).split(",")).map((x) => String(x).trim()).filter(Boolean);
    const denied = asked.filter((t) => !client.access_granted!.includes(t));
    if (denied.length) throw new CallError(`This client does not grant the report types ${denied.join(", ")}. Granted: ${client.access_granted.join(", ") || "none"}. Nothing was requested.`);
  }
  return client;
}
