import { clip, iso, keepResponseBody, redactHeaders, writeHttpLog, type HttpLogEntry } from "../api/http-log.js";
import { Session } from "../auth/session.js";
import type { FetchLike } from "../auth/token-client.js";
import { TokenStore } from "../auth/token-store.js";
import type { Config } from "../config.js";
import index from "../data/operations.json" with { type: "json" };
import type { OperationIndex } from "../spec/types.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface DoctorOpts {
  store?: TokenStore;
  fetch?: FetchLike;
  httpLog?: (e: HttpLogEntry) => void;
}

// Every DATEV call doctor makes goes into the technical HTTP log, like any other call.
async function get(url: string, token: string, cfg: Config, opts: DoctorOpts): Promise<{ status: number; body: unknown }> {
  const headers = { authorization: `Bearer ${token}`, "X-DATEV-Client-Id": cfg.creds.clientId, accept: "application/json" };
  const sentAt = Date.now();
  const base = { ts_request: iso(sentAt), method: "GET", url, request_headers: redactHeaders(headers) };
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(20_000), headers, redirect: "error" });
  } catch (e) {
    opts.httpLog?.({ ...base, ts_response: iso(), error: msg(e) });
    throw e;
  }
  const text = await res.text();
  opts.httpLog?.({
    ...base,
    ts_response: iso(),
    status: res.status,
    status_text: res.statusText,
    response_headers: redactHeaders(res.headers),
    ...(keepResponseBody(res.status, url) ? { response_body: clip(text) } : {}),
  });
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function doctor(cfg: Config, opts: DoctorOpts = {}): Promise<Check[]> {
  const o: DoctorOpts = { fetch: opts.fetch, httpLog: opts.httpLog ?? ((e: HttpLogEntry) => writeHttpLog(e)) };
  const checks: Check[] = [];
  const store = opts.store ?? new TokenStore(cfg.env);
  checks.push({ name: "credentials", ok: true, detail: `client id ${cfg.creds.clientId.slice(0, 6)}..., env ${cfg.env}` });
  const ops = (index as OperationIndex).operations;
  checks.push({ name: "operation index", ok: ops.length > 0, detail: `${ops.length} operations` });
  const s = store.read();
  checks.push({ name: "saved session", ok: Boolean(s), detail: s ? store.file : `none, run "datev-mcp login"` });
  if (!s) return checks;
  let token: string;
  try {
    token = await new Session(store, cfg.endpoints, cfg.creds, { fetch: o.fetch, log: o.httpLog }).accessToken();
    checks.push({ name: "access token", ok: true, detail: "valid (refreshed if needed)" });
  } catch (e) {
    checks.push({ name: "access token", ok: false, detail: msg(e) });
    return checks;
  }
  try {
    const u = await get(cfg.endpoints.userinfo, token, cfg, o);
    checks.push({ name: "userinfo", ok: u.status === 200, detail: `HTTP ${u.status}` });
  } catch (e) {
    checks.push({ name: "userinfo", ok: false, detail: msg(e) });
  }
  const clients = ops.find((o) => o.product === "accounting-clients" && o.path === "/clients" && o.method === "get");
  const base = clients && (cfg.env === "sandbox" ? clients.servers.sandbox : clients.servers.production);
  if (base) {
    try {
      const r = await get(`${base}/clients`, token, cfg, o);
      const n = Array.isArray(r.body) ? r.body.length : undefined;
      checks.push({ name: "accounting-clients API", ok: r.status === 200, detail: `HTTP ${r.status}${n !== undefined ? `, ${n} clients` : ""}` });
    } catch (e) {
      checks.push({ name: "accounting-clients API", ok: false, detail: msg(e) });
    }
  }
  return checks;
}
