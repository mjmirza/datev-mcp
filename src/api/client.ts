import { serviceOfProduct } from "../auth/services.js";
import { createHash } from "node:crypto";
import { problemOf, problemText, type Problem } from "./problem.js";
export { problemFields, problemOf, problemText } from "./problem.js";
import { bodyFingerprint, clip, httpLogProblem, iso, keepResponseBody, redactHeaders, type HttpLogEntry } from "./http-log.js";
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

const RESERVED_HEADERS = /^(authorization|x-datev-client-id|x-datev-client-secret|x-api-key|host|content-length|content-type|content-encoding|transfer-encoding|cookie)$/i;

export function buildHeaders(op: Operation, input: CallInput): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    if (RESERVED_HEADERS.test(k)) throw new CallError(`Header "${k}" is set by the server and cannot be overridden`);
    if (/[\r\n]/.test(v)) throw new CallError(`Header "${k}" contains a line break`);
    // Names differing only in case would merge in an order the confirm code cannot see.
    if (seen.has(k.toLowerCase())) throw new CallError(`Header "${k}" is given twice`);
    seen.add(k.toLowerCase());
    try {
      new Headers([[k, v]]);
    } catch {
      throw new CallError(`Header "${k}" is not a valid HTTP header`);
    }
    out[k] = v;
  }
  for (const p of op.params.filter((x) => x.in === "header" && x.required && !SERVER_HEADERS.has(x.name.toLowerCase()))) {
    const has = Object.keys(out).some((k) => k.toLowerCase() === p.name.toLowerCase());
    if (!has) throw new CallError(`Missing required header "${p.name}"`);
  }
  // Declared headers are checked against their schema like any other parameter.
  for (const p of op.params.filter((x) => x.in === "header")) {
    const key = Object.keys(out).find((k) => k.toLowerCase() === p.name.toLowerCase());
    if (key !== undefined) checkAgainstSchema(p.name, out[key], p.schema);
  }
  return out;
}

export interface CallResult {
  status: number;
  /** DATEV's Retry-After for a job, in seconds as sent. */
  retryAfter?: string;
  url: string;
  contentType?: string;
  location?: string;
  /** Pagination headers DATEV sends (x-total-pages, x-total-count, x-current-page, x-page-size, link). */
  paging?: Record<string, string>;
  body: unknown;
  truncated: boolean;
  attempts: number;
  /** Raw bytes of a binary answer (PDF, image, archive), never decoded as text. */
  bytes?: Uint8Array;
}

const PAGING_HEADERS = ["x-total-pages", "x-total-count", "x-current-page", "x-page-size", "link"];

function pagingOf(h: Headers): Record<string, string> | undefined {
  const out = Object.fromEntries(PAGING_HEADERS.map((k) => [k, h.get(k)]).filter((e): e is [string, string] => e[1] !== null));
  return Object.keys(out).length ? out : undefined;
}

export interface CallDeps {
  env: DatevEnv;
  creds: ClientCredentials;
  token: () => Promise<string>;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxBodyChars?: number;
  /** Cancels the call, e.g. the MCP request's signal when the client gives up. */
  signal?: AbortSignal;
  /** Budget for the whole call, retries and waits included. Default 55 s, under the usual 60 s MCP client timeout. */
  deadlineMs?: number;
  /** Byte budget for a binary answer (PDF, image). Default and maximum 50 MB. */
  maxBinaryBytes?: number;
  /** Scopes of the saved login. An operation outside them is refused before DATEV is asked. */
  grantedScopes?: ReadonlySet<string>;
  /** The data services chosen at login. Unset for sessions from before services could be chosen. */
  chosenServices?: ReadonlySet<string>;
  /** Writes one line of the technical HTTP log DATEV requires. Tests leave it out. */
  httpLog?: (entry: HttpLogEntry) => void;
  /** Reports why the HTTP log cannot be written. Defaults to the file log's own check. */
  httpLogProblem?: () => string | undefined;
  /** Service keys the server adds itself, by header name, so the model never sees them (SmartTransfer's X-API-Key). */
  serviceKeys?: Record<string, string | undefined>;
  /** Per host: until when DATEV asked us to wait. Shared across calls, so a long Retry-After is honored by the next call too. */
  cooldowns?: Map<string, number>;
  /** Ends the connection when DATEV says the client lacks Datenservice Export Rechnungswesen, as that service's rules require. */
  onMissingPermission?: () => Promise<string>;
  /** DATEV's user id of the saved login, so caches survive token refreshes but never a login change. */
  identity?: () => string | undefined;
}

const defaultCooldowns = new Map<string, number>();

// Headers the server sets from its own configuration. The model can neither pass nor see them.
const SERVER_HEADERS = new Set(["x-api-key"]);

const SERVICE_KEY_ENV: Record<string, string> = { "x-api-key": "DATEV_SMARTTRANSFER_API_KEY" };

function serverHeadersOf(op: Operation): string[] {
  return op.params.filter((p) => p.in === "header" && SERVER_HEADERS.has(p.name.toLowerCase())).map((p) => p.name);
}

function serviceKey(name: string, deps: CallDeps): string | undefined {
  const key = name.toLowerCase();
  const v = deps.serviceKeys ? deps.serviceKeys[key] : process.env[SERVICE_KEY_ENV[key] ?? ""];
  return v?.trim() ? v.trim() : undefined;
}


/** Refuses an operation whose scopes the saved login does not hold. openid is part of every login. */
function checkGranted(op: Operation, granted: ReadonlySet<string> | undefined, chosen?: ReadonlySet<string>): void {
  // An operation with no scope of its own is bounded by the data services chosen at login instead.
  const product = serviceOfProduct(op.product);
  if (chosen && !op.scopes.some((s) => s !== "openid") && !chosen.has(product))
    throw new CallError(`${op.id} belongs to ${product}, which is not part of the connected data services. Run "datev-mcp login --services ..." with ${product} added.`);
  if (!granted) return;
  const missing = op.scopes.filter((s) => s !== "openid" && !granted.has(s));
  if (missing.length)
    throw new CallError(`${op.id} needs the scope ${missing.join(", ")}, which is not part of the connected data services. Run "datev-mcp login --services ..." with the data service it belongs to.`);
}

export class CallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallError";
  }
}

/** The request may have reached DATEV before this failed, so a write's outcome is unknown. */
export class UncertainSendError extends CallError {}

const RETRYABLE = new Set([429, 502, 503, 504]);
export const MAX_ATTEMPTS = 3;

interface ParamSchema { type?: string; pattern?: string; format?: string; minimum?: number; maximum?: number; maxLength?: number; minLength?: number }

// Checks a value against the constraints DATEV's spec declares, so a bad id fails here instead of costing a rate-limited call.
export function checkAgainstSchema(name: string, v: string, schema: unknown): void {
  if (!schema || typeof schema !== "object") return;
  const s = schema as ParamSchema;
  const bad = (why: string) => new CallError(`Parameter "${name}" ${why}`);
  if (s.type === "integer") {
    if (!/^-?\d+$/.test(v)) throw bad("must be a whole number");
    const n = Number(v);
    if (s.minimum !== undefined && n < s.minimum) throw bad(`must be at least ${s.minimum}`);
    if (s.maximum !== undefined && n > s.maximum) throw bad(`must be at most ${s.maximum}`);
  }
  if (s.maxLength !== undefined && v.length > s.maxLength) throw bad(`must be at most ${s.maxLength} characters`);
  if (s.minLength !== undefined && v.length < s.minLength) throw bad(`must be at least ${s.minLength} characters`);
  if (s.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw bad("must be a UUID");
  if (s.pattern) {
    let re: RegExp | undefined;
    try {
      re = new RegExp(s.pattern, "u");
    } catch {
      re = undefined; // a pattern JavaScript cannot compile is left to DATEV to enforce
    }
    if (re && !re.test(v)) throw bad(`does not match the format DATEV expects (${s.pattern})`);
  }
}

function encodePathValue(name: string, raw: string | number, separators: string, schema: unknown): string {
  const v = String(raw);
  if (v === "" || v === "." || v === ".." || /[/\\]/.test(v)) throw new CallError(`Path parameter "${name}" has an invalid value`);
  // Two parameters in one segment ("{a}-{b}"): a value holding the separator would make the URL ambiguous.
  if ([...separators].some((c) => v.includes(c))) throw new CallError(`Path parameter "${name}" must not contain "${separators}"`);
  checkAgainstSchema(name, v, schema);
  return encodeURIComponent(v);
}

// Literal characters that share a path segment with the placeholder, e.g. "-" in "{consultant}-{client}".
function segmentSeparators(path: string, name: string): string {
  const seg = path.split("/").find((s) => s.includes(`{${name}}`)) ?? "";
  if ((seg.match(/\{/g) ?? []).length < 2) return "";
  return [...new Set(seg.replace(/\{[^}]+\}/g, ""))].join("");
}

export function buildUrl(op: Operation, env: DatevEnv, input: CallInput): URL {
  const base = env === "sandbox" ? op.servers.sandbox : op.servers.production;
  if (!base) throw new CallError(`${op.id} has no ${env} server in the DATEV spec`);
  const path = op.path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const v = input.pathParams?.[name];
    if (v === undefined) throw new CallError(`Missing path parameter "${name}"`);
    const schema = op.params.find((p) => p.in === "path" && p.name === name)?.schema;
    return encodePathValue(name, v, segmentSeparators(op.path, name), schema);
  });
  const url = new URL(base.replace(/\/$/, "") + path);
  const baseUrl = new URL(base);
  // Pin every call to the host and base path DATEV publishes for this operation.
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname.replace(/\/$/, ""))) throw new CallError("Refusing a URL outside the operation's DATEV server");
  for (const p of op.params.filter((x) => x.in === "query" && x.required)) {
    if (input.query?.[p.name] === undefined) throw new CallError(`Missing required query parameter "${p.name}"`);
  }
  for (const [k, v] of Object.entries(input.query ?? {})) {
    const declared = op.params.find((p) => p.in === "query" && p.name === k);
    const items = Array.isArray(v) ? v : [v];
    const itemSchema = (declared?.schema as { type?: string; items?: unknown } | undefined)?.type === "array" ? (declared!.schema as { items?: unknown }).items : declared?.schema;
    for (const item of items) {
      checkAgainstSchema(k, String(item), itemSchema);
      url.searchParams.append(k, String(item));
    }
  }
  return url;
}

// A declared media type may use wildcards: */*, type/*, or a suffix pattern like application/*+json.
export function mediaMatches(declared: string, actual: string): boolean {
  const TYPE = /^[a-z0-9!#$&^_.+*-]+\/[a-z0-9!#$&^_.+*-]+$/;
  const norm = (c: string) => c.split(";")[0]!.trim().toLowerCase();
  if (!/^[!-~][ -~]*$/.test(actual) || actual !== actual.trim()) return false; // printable ASCII, no outer whitespace
  if (!TYPE.test(norm(declared)) || !TYPE.test(norm(actual))) return false; // exactly one slash, token characters only
  const [dt, ds] = norm(declared).split("/");
  const [at, as] = norm(actual).split("/");
  if (!dt || !ds || !at || !as) return false;
  if (dt !== "*" && dt !== at) return false;
  if (ds === "*") return true;
  if (ds.startsWith("*+")) return as.endsWith(ds.slice(1));
  return ds === as;
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
  const declared = op.body.contentTypes;
  // Only the media type decides the encoding; parameters such as "; profile=json" never do.
  const media = (c: string) => c.split(";")[0]!.trim().toLowerCase();
  const isFile = (c: string) => /^(multipart\/form-data|application\/octet-stream)$/.test(media(c));
  const isJson = (c: string) => /^[^/]+\/([^/]+\+)?json$/.test(media(c));
  if (declared.length && declared.every(isFile)) throw new CallError(`${op.id} needs a file upload (${declared.join(", ")}); the generic tool sends JSON or text only`);
  const ct = input.contentType ?? declared[0] ?? "application/json";
  if (input.contentType !== undefined && declared.length && !declared.some((d) => mediaMatches(d, ct))) throw new CallError(`${op.id} does not accept content type "${ct}"; it accepts ${declared.join(", ")}`);
  if (isFile(ct)) throw new CallError(`${op.id} needs a file upload (${ct}); the generic tool sends JSON or text only`);
  if (isJson(ct)) return { body: JSON.stringify(input.body), contentType: ct };
  if (typeof input.body === "string") return { body: input.body, contentType: ct };
  throw new CallError(`Body for ${ct} must be a string`);
}

// Retry-After may be seconds or an HTTP date. It is honored as given; a wait that does not fit the budget means no retry.
export function retryDelay(attempt: number, retryAfter: string | null, now = Date.now()): number {
  const v = retryAfter?.trim();
  if (v && /^\d+$/.test(v)) return Number(v) * 1000;
  const at = v ? Date.parse(v) : NaN;
  if (!Number.isNaN(at)) return Math.max(0, at - now);
  return Math.min(500 * 2 ** attempt, 4_000) * (0.5 + Math.random() / 2);
}

// Waits for a promise, but gives up at the deadline or on cancel. The promise itself (a shared token refresh) keeps running.
export async function bounded<T>(work: Promise<T>, deadline: number, signal: AbortSignal | undefined, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CallError(`Ran out of time ${what}. Try again, or narrow the request.`)), Math.max(0, deadline - Date.now()));
    onAbort = () => reject(new CallError("The call was cancelled"));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, stop]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

const discard = (res: Response | undefined) =>
  res?.body ? Promise.race([res.body.cancel().catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]) : Promise.resolve();

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

// Even an "uncapped" read stops here, so a runaway answer cannot exhaust memory.
export const HARD_MAX_BYTES = 50 * 1024 * 1024;
const TEXTUAL = /json|xml|text\/|csv|javascript|html|x-www-form-urlencoded/i;

const join = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// A cut JSON error answer still carries DATEV's title and help link further on, so the rest is scanned for them.
// It is scanned in batches up to the hard limit, through one decoder, so no field is skipped and the cost stays linear.
const SCAN_BATCH = 64 * 1024;
const SCAN_OVERLAP = 4096;
const PROBLEM_KEYS = ["title", "type", "detail", "help_url", "error", "error_description", "error_uri", "request_id", "requestId"];

function scanFields(text: string, found: Record<string, unknown>): void {
  for (const k of PROBLEM_KEYS) {
    if (found[k] !== undefined) continue;
    const num = k === "request_id" || k === "requestId" ? `|(-?\\d{1,40})(?=\\s*[,}\\]])` : "";
    const m = text.match(new RegExp(`"${k}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.){0,2000})"${num})`));
    if (!m) continue;
    // A numeric id only counts once a delimiter follows it, so a number cut at a window edge is read whole later.
    if (m[1] === undefined) {
      found[k] = m[2];
      continue;
    }
    try {
      found[k] = JSON.parse(`"${m[1]}"`) as string;
    } catch {
      found[k] = m[1];
    }
  }
}

const SCAN_IDLE_MS = 2000;
// The whole scan past the cap ends here too, so an answer that keeps dribbling cannot hold the call open.
const SCAN_TOTAL_MS = 5000;

async function idleRead(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>> | "idle"> {
  let timer: NodeJS.Timeout | undefined;
  const idle = new Promise<"idle">((r) => {
    timer = setTimeout(() => r("idle"), ms);
  });
  try {
    return await Promise.race([reader.read(), idle]);
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, cap: number, scan = false): Promise<{ bytes: Uint8Array; overflow: boolean; fields?: Record<string, unknown> }> {
  if (!res.body) return { bytes: new Uint8Array(), overflow: false };
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let overflow = false;
  const fields: Record<string, unknown> = {};
  const decoder = new TextDecoder("utf-8");
  let carry = "";
  let pending: Uint8Array[] = [];
  let pendingSize = 0;
  let read = 0;
  const flush = (last: boolean) => {
    const window = carry + decoder.decode(join(pending), { stream: !last });
    scanFields(window, fields);
    carry = window.slice(-SCAN_OVERLAP);
    pending = [];
    pendingSize = 0;
  };
  const queue = (chunk: Uint8Array) => {
    // Never past the hard limit, whatever size the chunks come in.
    const room = HARD_MAX_BYTES - read;
    const take = chunk.length > room ? chunk.subarray(0, room) : chunk;
    read += take.length;
    pending.push(take);
    pendingSize += take.length;
    if (pendingSize >= SCAN_BATCH) flush(false);
  };
  let scanEnd = 0;
  for (;;) {
    // Past the cap only the error fields are wanted, so an answer that goes quiet or keeps dribbling is not waited for.
    let next: Awaited<ReturnType<typeof idleRead>>;
    if (overflow) {
      const left = scanEnd - Date.now();
      if (left <= 0) break;
      try {
        next = await idleRead(reader, Math.min(SCAN_IDLE_MS, left)); // BESTPRACTICE_OK: a stream is read chunk by chunk in order
      } catch {
        break; // a break past the cap keeps the head and the fields found so far
      }
    } else if (size >= cap) {
      // A head exactly at the cap that then goes quiet counts as cut off, not as a stall.
      next = await idleRead(reader, SCAN_IDLE_MS); // BESTPRACTICE_OK: a stream is read chunk by chunk in order
      if (next === "idle") overflow = true;
    } else next = await reader.read(); // BESTPRACTICE_OK: a stream is read chunk by chunk in order
    if (next === "idle" || next.done) break;
    const { value } = next;
    if (overflow) {
      queue(value);
      if (read >= HARD_MAX_BYTES) break;
      continue;
    }
    if (size + value.length > cap) {
      parts.push(value.subarray(0, cap - size));
      overflow = true;
      if (!scan) break;
      scanEnd = Date.now() + SCAN_TOTAL_MS;
      // The decoder starts just before the cap, so a character or field cut there is read whole.
      const head = join(parts);
      read = cap;
      queue(head.subarray(Math.max(0, cap - SCAN_OVERLAP)));
      read = cap;
      queue(value.subarray(cap - size));
      size = cap;
      if (read >= HARD_MAX_BYTES) break;
      continue;
    }
    parts.push(value);
    size += value.length;
  }
  if (overflow && scan) flush(true);
  if (overflow) await reader.cancel().catch(() => undefined); // BESTPRACTICE_OK: stop the download once done
  return { bytes: join(parts), overflow, ...(overflow && scan ? { fields } : {}) };
}

async function readBody(res: Response, maxChars: number, maxBinary: number): Promise<{ body: unknown; truncated: boolean; bytes?: Uint8Array }> {
  const ct = res.headers.get("content-type") ?? "";
  // Only the bare media type counts, so a parameter like "; profile=json" cannot turn a PDF into text.
  const media = ct.split(";")[0]!.trim();
  // A declared binary type gets its own byte budget; the text cap is about what fits in a conversation.
  const declaredBinary = media !== "" && !TEXTUAL.test(media);
  const byteCap = Math.min(HARD_MAX_BYTES, declaredBinary ? maxBinary : maxChars >= HARD_MAX_BYTES ? HARD_MAX_BYTES : maxChars * 4 + 4);
  // Only a JSON error answer is scanned past the cap, for the fields DATEV puts after a long detail.
  const scan = res.status >= 400 && /json/i.test(media);
  const { bytes, overflow, fields } = await readCapped(res, byteCap, scan);
  const binary = media !== "" ? !TEXTUAL.test(media) : bytes.includes(0);
  if (binary) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { body: { binary: true, content_type: ct || undefined, size: bytes.length, sha256, ...(overflow ? { cut_at_bytes: byteCap } : {}) }, truncated: overflow, bytes };
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  const truncated = overflow || text.length > maxChars;
  const slice = text.length > maxChars ? text.slice(0, maxChars) : text;
  // A cut error answer keeps DATEV's title, help link and request id from wherever they appeared.
  if (truncated && scan) {
    const found: Record<string, unknown> = {};
    scanFields(text, found);
    return { body: { cut_off: true, ...found, ...Object.fromEntries(Object.entries(fields ?? {}).filter(([k]) => found[k] === undefined)), text: slice }, truncated };
  }
  if (!truncated && /json/i.test(media)) {
    try {
      return { body: parseJsonOrLines(slice, /ndjson/i.test(media)), truncated };
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
  deadline: number;
}

async function attempt(p: Prepared, n: number): Promise<CallResult> {
  const { op, url, deps } = p;
  if (deps.signal?.aborted) throw new CallError("The call was cancelled before DATEV was asked");
  if (p.deadline - Date.now() <= 0) throw new CallError("Ran out of time before DATEV answered. Try again, or narrow the request.");
  const token = await bounded(deps.token(), p.deadline, deps.signal, "while getting a DATEV access token");
  const left = p.deadline - Date.now();
  if (left <= 0) throw new CallError("Ran out of time before DATEV answered. Try again, or narrow the request.");
  const headers: Record<string, string> = {
    ...p.extraHeaders,
    authorization: `Bearer ${token}`,
    "X-DATEV-Client-Id": deps.creds.clientId,
  };
  // The caller's Accept wins, e.g. application/pdf for a PDF report. Otherwise ask for JSON first.
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "accept")) headers.accept = "application/json, */*;q=0.5";
  if (op.clientSecretHeader) {
    if (!deps.creds.clientSecret) throw new CallError(`${op.id} needs the app's client secret, which a DATEV Public client does not have. This API is available to Confidential clients only.`);
    headers["X-DATEV-Client-Secret"] = deps.creds.clientSecret;
  }
  for (const name of serverHeadersOf(op)) headers[name] = serviceKey(name, deps)!;
  if (p.contentType) headers["content-type"] = p.contentType;
  const cooldowns = deps.cooldowns ?? defaultCooldowns;
  const waitUntil = cooldowns.get(url.host) ?? 0;
  if (waitUntil > Date.now()) throw new CallError(`DATEV asked to pause requests to this service until ${new Date(waitUntil).toISOString().slice(11, 19)} UTC. Try again after that.`);
  let res: Response | undefined;
  let netErr: unknown;
  let read: Awaited<ReturnType<typeof readBody>> | undefined;
  let cutOff: string | undefined;
  // DATEV requires a log line for every call: no call goes out while the log cannot be written.
  const logProblem = deps.httpLog && (deps.httpLogProblem ?? httpLogProblem)();
  if (logProblem) throw new CallError(`The technical HTTP log cannot be written (${logProblem}). DATEV requires it, so nothing was sent. Free disk space or fix DATEV_MCP_LOG_DIR, then try again.`);
  const sentAt = Date.now();
  const logLine = (extra: Partial<HttpLogEntry>) =>
    deps.httpLog?.({
      ts_request: iso(sentAt),
      ts_response: iso(),
      method: op.method.toUpperCase(),
      url: url.toString(),
      request_headers: redactHeaders(headers),
      request_body: bodyFingerprint(p.body),
      ...(res ? { status: res.status, status_text: res.statusText, response_headers: redactHeaders(res.headers) } : {}),
      ...extra,
    });
  // A cancel that arrived while the token was fetched stops the call here, provably before anything left.
  if (deps.signal?.aborted) throw new CallError("The call was cancelled before DATEV was asked");
  try {
    // redirect "manual": fetch would forward X-DATEV-Client-Secret to whatever host a redirect names.
    res = await (deps.fetch ?? fetch)(url, { method: op.method.toUpperCase(), headers, body: p.body, redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(Math.min(30_000, left)), ...(deps.signal ? [deps.signal] : [])]) });
  } catch (e) {
    netErr = e;
  }
  // Only reads are retried. A write is never sent twice: without an idempotency key, even a 429 is no proof it was not applied.
  const statusRetry = res !== undefined && op.method === "get" && RETRYABLE.has(res.status);
  // The answer is read even when it will be retried, so the log keeps DATEV's error body for every attempt.
  if (res) {
    try {
      read = await readBody(res, deps.maxBodyChars ?? 100_000, deps.maxBinaryBytes ?? HARD_MAX_BYTES);
    } catch (e) {
      netErr = e; // the answer broke off while it was being read
      if (op.method !== "get" && res.status >= 200 && res.status < 300) {
        // DATEV took the write: its status and headers (Location, job id) arrived, only the body broke off.
        // The one log line below records the break.
        cutOff = e instanceof Error ? e.message : String(e);
        read = { body: { cut_off: true, reason: cutOff }, truncated: true };
        netErr = undefined;
      } else if (op.method !== "get" || deps.signal?.aborted) {
        // A write may have reached DATEV: its headers and the break are logged before giving up.
        logLine({ error: `answer broke off: ${e instanceof Error ? e.message : String(e)}` });
        throw new UncertainSendError(`DATEV's answer broke off: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (!res) logLine({ error: netErr instanceof Error ? netErr.message : String(netErr) });
  else if (!read) logLine(netErr !== undefined ? { error: `answer broke off: ${netErr instanceof Error ? netErr.message : String(netErr)}` } : {});
  else
    logLine({
      ...(cutOff !== undefined ? { error: `answer broke off: ${cutOff}` } : {}),
      ...(keepResponseBody(res.status, url.toString()) ? { response_body: clip(typeof read.body === "string" ? read.body : JSON.stringify(read.body)) } : {}),
    });
  const retryAfter = res?.headers.get("retry-after") ?? null;
  if (res && retryAfter && (res.status === 429 || res.status === 503)) {
    const until = Date.now() + retryDelay(0, retryAfter);
    if (until > (cooldowns.get(url.host) ?? 0)) cooldowns.set(url.host, until);
  }
  const retryable = n < MAX_ATTEMPTS && (statusRetry || (op.method === "get" && netErr !== undefined));
  const delay = retryDelay(n - 1, retryAfter);
  // A retry only makes sense if it can still finish inside the budget, and never after a cancel.
  if (retryable && !deps.signal?.aborted && Date.now() + delay + 1000 < p.deadline) {
    if (retryAfter) cooldowns.delete(url.host); // this call honors the wait itself
    if (!read) await discard(res);
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await bounded(sleep(delay), p.deadline, deps.signal, "while waiting to retry");
    return attempt(p, n + 1);
  }
  // An answer DATEV already gave is kept even if the call was cancelled meanwhile: dropping it loses a job id.
  if (deps.signal?.aborted && !res) throw new UncertainSendError("The call was cancelled");
  if (!res) {
    // A request cut off by the call budget is a timeout, so callers can keep partial work and resume.
    if ((netErr as Error | undefined)?.name === "TimeoutError" || Date.now() >= p.deadline - 100)
      throw new UncertainSendError("Ran out of time while waiting for DATEV to answer. Try again, or narrow the request.");
    throw new UncertainSendError(`DATEV did not answer: ${netErr instanceof Error ? netErr.message : String(netErr)}`);
  }
  if (!read) {
    if (netErr !== undefined) {
      if ((netErr as Error).name === "TimeoutError" || Date.now() >= p.deadline - 100) throw new UncertainSendError("Ran out of time while reading DATEV's answer. Try again, or narrow the request.");
      throw new UncertainSendError(`DATEV's answer broke off: ${netErr instanceof Error ? netErr.message : String(netErr)}`);
    }
    read = await readBody(res, deps.maxBodyChars ?? 100_000, deps.maxBinaryBytes ?? HARD_MAX_BYTES);
  }
  const { body, truncated, bytes } = read;
  return {
    status: res.status,
    url: url.toString(),
    contentType: res.headers.get("content-type") ?? undefined,
    location: res.headers.get("location") ?? undefined,
    retryAfter: res.headers.get("retry-after") ?? undefined,
    paging: pagingOf(res.headers),
    body,
    truncated,
    attempts: n,
    ...(bytes ? { bytes } : {}),
  };
}

// async so validation errors surface as a rejected promise, never a synchronous throw.
export async function callOperation(op: Operation, input: CallInput, deps: CallDeps): Promise<CallResult> {
  checkGranted(op, deps.grantedScopes, deps.chosenServices);
  for (const name of serverHeadersOf(op))
    if (!serviceKey(name, deps)) throw new CallError(`${op.id} needs the ${name} header. Set ${SERVICE_KEY_ENV[name.toLowerCase()] ?? name} in the server's environment; it is never passed through the assistant.`);
  const url = buildUrl(op, deps.env, input);
  return attempt({ op, url, deps, deadline: Date.now() + (deps.deadlineMs ?? 55_000), extraHeaders: buildHeaders(op, input), ...encodeBody(op, input) }, 1);
}
