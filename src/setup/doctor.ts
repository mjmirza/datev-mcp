import { Session } from "../auth/session.js";
import { TokenStore } from "../auth/token-store.js";
import type { Config } from "../config.js";
import index from "../data/operations.json" with { type: "json" };
import type { OperationIndex } from "../spec/types.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function get(url: string, token: string, cfg: Config): Promise<{ status: number; body: unknown }> {
  const headers = { authorization: `Bearer ${token}`, "X-DATEV-Client-Id": cfg.creds.clientId, accept: "application/json" };
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function doctor(cfg: Config): Promise<Check[]> {
  const checks: Check[] = [];
  const store = new TokenStore(cfg.env);
  checks.push({ name: "credentials", ok: true, detail: `client id ${cfg.creds.clientId.slice(0, 6)}..., env ${cfg.env}` });
  const ops = (index as OperationIndex).operations;
  checks.push({ name: "operation index", ok: ops.length > 0, detail: `${ops.length} operations` });
  const s = store.read();
  checks.push({ name: "saved session", ok: Boolean(s), detail: s ? store.file : `none, run "datev-mcp login"` });
  if (!s) return checks;
  let token: string;
  try {
    token = await new Session(store, cfg.endpoints, cfg.creds).accessToken();
    checks.push({ name: "access token", ok: true, detail: "valid (refreshed if needed)" });
  } catch (e) {
    checks.push({ name: "access token", ok: false, detail: msg(e) });
    return checks;
  }
  try {
    const u = await get(cfg.endpoints.userinfo, token, cfg);
    checks.push({ name: "userinfo", ok: u.status === 200, detail: `HTTP ${u.status}` });
  } catch (e) {
    checks.push({ name: "userinfo", ok: false, detail: msg(e) });
  }
  const clients = ops.find((o) => o.product === "accounting-clients" && o.path === "/clients" && o.method === "get");
  const base = clients && (cfg.env === "sandbox" ? clients.servers.sandbox : clients.servers.production);
  if (base) {
    try {
      const r = await get(`${base}/clients`, token, cfg);
      const n = Array.isArray(r.body) ? r.body.length : undefined;
      checks.push({ name: "accounting-clients API", ok: r.status === 200, detail: `HTTP ${r.status}${n !== undefined ? `, ${n} clients` : ""}` });
    } catch (e) {
      checks.push({ name: "accounting-clients API", ok: false, detail: msg(e) });
    }
  }
  return checks;
}
