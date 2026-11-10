import { loginKey } from "./login-key.js";
import { callOperation, CallError, problemText, type CallDeps } from "./client.js";
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

/** How a person recognises the client: its name and numbers, never the technical id alone. */
export function describeClient(c: Pick<CheckedClient, "name" | "consultant_number" | "client_number"> & { client_id?: string }): string {
  // The numbers sit in one final bracket, so a translation never has to guess what belongs to the name.
  const nums = [c.consultant_number !== undefined && `consultant ${c.consultant_number}`, c.client_number !== undefined && `client ${c.client_number}`].filter(Boolean);
  return `${c.name ?? "unnamed client"}${nums.length ? ` (${nums.join(", ")})` : ""}`;
}

/** A URL for a person: DATEV's technical client id becomes {client} in path, query and fragment. Every other byte stays as sent. */
export function hideClientId(url: string, ids: (string | undefined)[]): string {
  // Passes insert a private-use mark absent from the URL (BMP, then planes 15 and 16), never "{client}".
  const free = (from: number, to: number) => { for (let c = from; c <= to; c++) if (!url.includes(String.fromCodePoint(c))) return String.fromCodePoint(c); return undefined; };
  const MARK = free(0xe000, 0xf8ff) ?? free(0xf0000, 0xffffd) ?? free(0x100000, 0x10fffd);
  // An astral mark reads as one unit absent from the URL, so no id can match it; none free means one plain pass.
  const READ = MARK && MARK.length > 1 ? [...Array.from({ length: 32 }, (_, i) => 0xfdd0 + i), 0xfffe, 0xffff].map((c) => String.fromCharCode(c)).find((c) => !url.includes(c)) : MARK;
  const plainIds = [...new Set(ids.filter((x): x is string => !!x && (!MARK || !READ || (!x.includes(MARK) && !x.includes(READ)))))];
  if (!plainIds.length) return url;
  // Scheme, userinfo, host and port are never rewritten; a host never holds "%", so an escaped slash starts the path.
  const authority = /^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/(?:[^/?#]*@)?[^/?#@%]*/.exec(url)?.[0] ?? "";
  type Ch = { ch: string; from: number; to: number };
  const chars = (text: string): Ch[] => [...text.matchAll(/[\s\S]/gu)].map((m) => ({ ch: m[0].length === 1 ? m[0] : m[0] === MARK ? READ! : "�", from: m.index, to: m.index + m[0].length }));
  const hex = (c?: Ch) => !!c && /^[0-9A-Fa-f]$/.test(c.ch);
  const decode = (r: Ch[]): Ch[] => {
    const out: Ch[] = [];
    for (let i = 0; i < r.length; ) {
      const esc = r[i]!.ch === "%" && hex(r[i + 1]) && hex(r[i + 2]);
      out.push(esc ? { ch: String.fromCharCode(parseInt(r[i + 1]!.ch + r[i + 2]!.ch, 16)), from: r[i]!.from, to: r[i + 2]!.to } : r[i]!);
      i += esc ? 3 : 1;
    }
    return out;
  };
  const alts = plainIds.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // An id stands on its own: no letter, digit, underscore or digit-dash before it, nothing of a longer token after it.
  const ownWord = new RegExp(`(?<![A-Za-z0-9_])(?<![0-9]-)(?:${alts})(?![A-Za-z0-9_-])`, "gi");
  // Hidden when it shows raw, decoded once or decoded twice; each match maps back to the raw bytes it came from.
  const hideOnce = (rest: string, mark: string): string => {
    const raw = chars(rest);
    const once = decode(raw);
    const hits: [number, number][] = [];
    for (const reading of [raw, once, decode(once)])
      for (const m of reading.map((c) => c.ch).join("").matchAll(ownWord)) hits.push([reading[m.index]!.from, reading[m.index + m[0].length - 1]!.to]);
    hits.sort((a, b) => a[0] - b[0]);
    let out = "";
    let at = 0;
    for (const [from, to] of hits) {
      if (to <= at) continue;
      if (from >= at) out += rest.slice(at, from) + mark;
      at = to;
    }
    return out + rest.slice(at);
  };
  // Hiding one id can change how a neighbouring escape decodes, so repeat until nothing changes.
  let rest = url.slice(authority.length);
  if (!MARK || !READ) return authority + hideOnce(rest, "{client}");
  for (let next = hideOnce(rest, MARK); next !== rest; next = hideOnce(rest, MARK)) rest = next;
  return authority + rest.replaceAll(MARK, "{client}");
}

/** Query or header values for a person: each string or number, also in a list, has the client id hidden like a URL. */
export function hideClientValues<T extends Record<string, unknown> | undefined>(values: T, ids: (string | undefined)[]): T {
  if (!values) return values;
  const one = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(one);
    if (typeof v !== "string" && typeof v !== "number") return v;
    const shown = hideClientId(String(v), ids);
    return shown === String(v) ? v : shown;
  };
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, one(v)])) as T;
}

/** Path ids for a person: the client's technical id is replaced, every other id is shown as sent. */
export function hideClientParams(params: Record<string, unknown> | undefined, ids: (string | undefined)[]): Record<string, unknown> | undefined {
  if (!params) return params;
  const hidden = new Set(ids.filter(Boolean).map(String));
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, hidden.has(String(v)) ? "{client}" : v]));
}

/** The client as a person sees it in a preview: name and numbers, never the technical id. */
export const shownClient = (c: CheckedClient) => ({ name: c.name, consultant_number: c.consultant_number, client_number: c.client_number });

export interface CheckedClient {
  client_id: string;
  name?: string;
  consultant_number?: number;
  client_number?: number;
  /** hr-documents: the client's GUID as DATEV names it. */
  guid?: string;
  /** hr-payrollreports: the report types this client grants. */
  access_granted?: string[];
}

const ID_NAMES = ["client-id", "clientId", "consultantnumber-clientnumber"];
const placeholders = (op: Operation) => [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);

/** Who the URL actually targets: only the operation's own path placeholders count, never surplus parameters. */
function targetOf(op: Operation, pathParams: Record<string, unknown> | undefined): { clientId?: string; guid?: string; unknown?: string } {
  const names = placeholders(op);
  const v = (n: string) => (pathParams?.[n] === undefined ? "" : String(pathParams[n]));
  if (names.includes("consultantNumber") && names.includes("clientNumber")) return { clientId: `${v("consultantNumber")}-${v("clientNumber")}` };
  const id = names.find((n) => ID_NAMES.includes(n));
  if (id) return { clientId: v(id) };
  if (names.includes("client_guid")) return { guid: v("client_guid") };
  // A client-bound path we cannot map is refused rather than sent unchecked.
  return op.path.startsWith("/clients/{") || op.path.startsWith("/v1/clients/{") ? { unknown: names[0] } : {};
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
  guids.clear();
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

/** Reads the client with the product's own clients endpoint; throws a clear refusal when DATEV denies it. */
export async function checkClient(product: string, clientId: string, deps: CallDeps, opts: { fresh?: boolean; deadline?: number } = {}): Promise<CheckedClient> {
  const id = CLIENT_CHECK[product];
  const op = id ? getOperation(id) : undefined;
  if (!op) throw new CallError(`No permission check is known for ${product}`);
  const deadline = opts.deadline ?? Date.now() + 50_000;
  const key = `${await loginKey(deps, deadline)}|${product}|${clientId}`;
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
    ...(typeof b.client_guid === "string" ? { guid: b.client_guid } : {}),
    ...(Array.isArray(types?.access_granted) ? { access_granted: (types.access_granted as unknown[]).filter((x): x is string => typeof x === "string") } : {}),
  };
  checked.set(key, { day: day(), client });
  return client;
}

const guids = new Map<string, { day: string; clientId: string }>();

/** hr-documents names a client by GUID; DATEV's client list maps it to consultant and client number. */
async function clientIdForGuid(product: string, guid: string, deps: CallDeps): Promise<string> {
  const listId = product === "hr-documents" ? "hr-documents.getclients" : undefined;
  const op = listId ? getOperation(listId) : undefined;
  if (!op) throw new CallError(`${product} names its client by GUID, which this server cannot check. Nothing was sent.`);
  const key = `${await loginKey(deps, Date.now() + 50_000)}|${guid}`;
  const hit = guids.get(key);
  if (hit && hit.day === day()) return hit.clientId;
  const r = await callOperation(op, {}, { ...deps, maxBodyChars: Math.max(deps.maxBodyChars ?? 0, 5_000_000) });
  if (r.status < 200 || r.status >= 300 || r.truncated) throw new CallError(`DATEV's client list could not be read (HTTP ${r.status}), so the client was not checked. Nothing was sent.`);
  const body = r.body as { clients?: unknown } | unknown[];
  const list = (Array.isArray(body) ? body : Array.isArray((body as { clients?: unknown })?.clients) ? ((body as { clients: unknown[] }).clients) : []) as Record<string, unknown>[];
  const c = list.find((x) => x && x.client_guid === guid);
  if (!c || num(c.consultant_number) === undefined || num(c.client_number) === undefined)
    throw new CallError(`The client ${guid} is not in this login's DATEV client list. Please check it, or ask your administrator whether the data service is switched on, see ${SETUP_LINK}. Nothing was sent.`);
  const clientId = `${num(c.consultant_number)}-${num(c.client_number)}`;
  guids.set(key, { day: day(), clientId });
  return clientId;
}

/** The gate datev_call and datev_upload_file run before a client-bound call of a gated product. */
export async function gateCall(op: Operation, pathParams: Record<string, unknown> | undefined, query: Record<string, unknown> | undefined, deps: CallDeps): Promise<CheckedClient | undefined> {
  const checkId = CLIENT_CHECK[op.product];
  if (!checkId || op.id === checkId) return undefined;
  const target = targetOf(op, pathParams);
  if (target.unknown !== undefined) throw new CallError(`${op.id} names its client as ${target.unknown}, which this server cannot check against DATEV's permission. Nothing was sent.`);
  const clientId = target.guid !== undefined ? await clientIdForGuid(op.product, target.guid, deps) : target.clientId;
  if (clientId === undefined) return undefined;
  if (!/^\d{4,7}-\d{1,5}$/.test(clientId)) throw new CallError(`"${clientId}" is not a consultant-client number such as 455148-1. Nothing was sent.`);
  const client = await checkClient(op.product, clientId, deps);
  if (target.guid !== undefined && client.guid !== undefined && client.guid !== target.guid)
    throw new CallError(`DATEV names a different GUID for client ${clientId} than ${target.guid}. Nothing was sent.`);
  // Payroll reports: DATEV lists per client which report types are granted; ask only for those, and fail closed.
  const wanted = query?.document_types;
  if (op.product === "hr-payrollreports" && wanted !== undefined) {
    const granted = client.access_granted ?? [];
    const asked = (Array.isArray(wanted) ? wanted : String(wanted).split(",")).map((x) => String(x).trim()).filter(Boolean);
    const denied = asked.filter((t) => !granted.includes(t));
    if (denied.length) throw new CallError(`This client does not grant the report types ${denied.join(", ")}. Granted: ${granted.join(", ") || "none"}. Nothing was requested.`);
  }
  return client;
}
