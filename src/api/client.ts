import type { DatevEnv } from "../auth/endpoints.js";
import type { ClientCredentials, FetchLike } from "../auth/token-client.js";
import type { Operation } from "../spec/types.js";

export interface CallInput {
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | (string | number)[]>;
  headers?: Record<string, string>;
  body?: unknown;
  // Files: raw bytes (octet-stream) or a FormData (multipart, fetch sets the boundary).
  rawBody?: Uint8Array | FormData;
  contentType?: string;
}

const RESERVED_HEADERS = /^(authorization|x-datev-client-id|x-datev-client-secret|host|content-length|cookie)$/i;

export function buildHeaders(op: Operation, input: CallInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    if (RESERVED_HEADERS.test(k)) throw new CallError(`Header "${k}" is set by the server and cannot be overridden`);
    if (/[\r\n]/.test(v)) throw new CallError(`Header "${k}" contains a line break`);
    out[k] = v;
  }
  for (const p of op.params.filter((x) => x.in === "header" && x.required)) {
    const has = Object.keys(out).some((k) => k.toLowerCase() === p.name.toLowerCase());
    if (!has) throw new CallError(`Missing required header "${p.name}"`);
  }
  return out;
}

export interface CallResult {
  status: number;
  url: string;
  contentType?: string;
  location?: string;
  body: unknown;
  truncated: boolean;
  attempts: number;
}

export interface CallDeps {
  env: DatevEnv;
  creds: ClientCredentials;
  token: () => Promise<string>;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxBodyChars?: number;
}

export class CallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallError";
  }
}

const RETRYABLE = new Set([429, 502, 503, 504]);
export const MAX_ATTEMPTS = 3;

function encodePathValue(name: string, raw: string | number): string {
  const v = String(raw);
  if (v === "" || v === "." || v === ".." || /[/\\]/.test(v)) throw new CallError(`Path parameter "${name}" has an invalid value`);
  return encodeURIComponent(v);
}

export function buildUrl(op: Operation, env: DatevEnv, input: CallInput): URL {
  const base = env === "sandbox" ? op.servers.sandbox : op.servers.production;
  if (!base) throw new CallError(`${op.id} has no ${env} server in the DATEV spec`);
  const path = op.path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const v = input.pathParams?.[name];
    if (v === undefined) throw new CallError(`Missing path parameter "${name}"`);
    return encodePathValue(name, v);
  });
  const url = new URL(base.replace(/\/$/, "") + path);
  const baseUrl = new URL(base);
  // Pin every call to the host and base path DATEV publishes for this operation.
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname.replace(/\/$/, ""))) throw new CallError("Refusing a URL outside the operation's DATEV server");
  for (const p of op.params.filter((x) => x.in === "query" && x.required)) {
    if (input.query?.[p.name] === undefined) throw new CallError(`Missing required query parameter "${p.name}"`);
  }
  for (const [k, v] of Object.entries(input.query ?? {})) {
    for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item));
  }
  return url;
}

function encodeBody(op: Operation, input: CallInput): { body?: string | Uint8Array | FormData; contentType?: string } {
  if (input.rawBody !== undefined) {
    if (!op.body) throw new CallError(`${op.id} does not take a request body`);
    if (input.rawBody instanceof FormData) return { body: input.rawBody };
    return { body: input.rawBody, contentType: input.contentType ?? op.body.contentTypes[0] ?? "application/octet-stream" };
  }
  if (input.body === undefined) {
    if (op.body?.required) throw new CallError(`${op.id} requires a request body`);
    return {};
  }
  if (!op.body) throw new CallError(`${op.id} does not take a request body`);
  const ct = input.contentType ?? op.body.contentTypes[0] ?? "application/json";
  if (/multipart\/form-data|octet-stream/i.test(ct)) throw new CallError(`${op.id} needs a file upload (${ct}); the generic tool sends JSON or text only`);
  if (/json/i.test(ct)) return { body: JSON.stringify(input.body), contentType: ct };
  if (typeof input.body === "string") return { body: input.body, contentType: ct };
  throw new CallError(`Body for ${ct} must be a string`);
}

export function retryDelay(attempt: number, retryAfter: string | null): number {
  const secs = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 10_000);
  return Math.min(500 * 2 ** attempt, 4_000) * (0.5 + Math.random() / 2);
}

// Some DATEV endpoints (e.g. general ledger accounts) answer with one JSON object per line.
// An x-ndjson body is always a list, even with one line ("20230701\n" is one fiscal year id).
export function parseJsonOrLines(text: string, ndjson = false): unknown {
  const asLines = () => text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as unknown);
  if (ndjson) return asLines();
  try {
    return JSON.parse(text);
  } catch {
    const lines = asLines();
    if (lines.length === 0) throw new SyntaxError("empty body");
    return lines;
  }
}

async function readBody(res: Response, maxChars: number): Promise<{ body: unknown; truncated: boolean }> {
  const text = await res.text();
  const truncated = text.length > maxChars;
  const slice = truncated ? text.slice(0, maxChars) : text;
  const ct = res.headers.get("content-type") ?? "";
  if (!truncated && /json/i.test(ct)) {
    try {
      return { body: parseJsonOrLines(slice, /ndjson/i.test(ct)), truncated };
    } catch {
      /* fall through to text */
    }
  }
  return { body: slice, truncated };
}

interface Prepared {
  op: Operation;
  url: URL;
  body?: string | Uint8Array | FormData;
  contentType?: string;
  extraHeaders: Record<string, string>;
  deps: CallDeps;
}

async function attempt(p: Prepared, n: number): Promise<CallResult> {
  const { op, url, deps } = p;
  const headers: Record<string, string> = {
    ...p.extraHeaders,
    authorization: `Bearer ${await deps.token()}`,
    "X-DATEV-Client-Id": deps.creds.clientId,
    accept: "application/json, */*;q=0.5",
  };
  if (op.clientSecretHeader) headers["X-DATEV-Client-Secret"] = deps.creds.clientSecret;
  if (p.contentType) headers["content-type"] = p.contentType;
  let res: Response | undefined;
  let netErr: unknown;
  try {
    res = await (deps.fetch ?? fetch)(url, { method: op.method.toUpperCase(), headers, body: p.body, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    netErr = e;
  }
  // Only reads are retried: a write that timed out may already have been applied by DATEV.
  const retryable = op.method === "get" && n < MAX_ATTEMPTS && (netErr !== undefined || (res !== undefined && RETRYABLE.has(res.status)));
  if (retryable) {
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(retryDelay(n - 1, res?.headers.get("retry-after") ?? null));
    return attempt(p, n + 1);
  }
  if (!res) throw new CallError(`DATEV did not answer: ${netErr instanceof Error ? netErr.message : String(netErr)}`);
  const { body, truncated } = await readBody(res, deps.maxBodyChars ?? 100_000);
  return {
    status: res.status,
    url: url.toString(),
    contentType: res.headers.get("content-type") ?? undefined,
    location: res.headers.get("location") ?? undefined,
    body,
    truncated,
    attempts: n,
  };
}

// async so validation errors surface as a rejected promise, never a synchronous throw.
export async function callOperation(op: Operation, input: CallInput, deps: CallDeps): Promise<CallResult> {
  const url = buildUrl(op, deps.env, input);
  return attempt({ op, url, deps, extraHeaders: buildHeaders(op, input), ...encodeBody(op, input) }, 1);
}
