import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { logDir } from "../paths.js";

// DATEV requires a technical log of every request to its API gateway, kept at least 14 days,
// with the X-Global-Transaction-ID and V-Cap-Request-ID of each answer. Tokens and secrets never enter it.
const RETENTION_DAYS = 30;
const SECRET_HEADERS = /^(authorization|x-datev-client-secret|x-api-key|cookie|set-cookie|proxy-authorization)$/i;
const MAX_BODY_CHARS = 8_000;

export interface HttpLogEntry {
  ts_request: string;
  ts_response?: string;
  method: string;
  url: string;
  request_headers?: Record<string, string>;
  request_body?: { bytes: number; sha256: string };
  status?: number;
  status_text?: string;
  response_headers?: Record<string, string>;
  response_body?: string;
  error?: string;
}

export const iso = (t = Date.now()) => new Date(t).toISOString();

export function redactHeaders(h: Headers | Record<string, string> | undefined): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  const entries = h instanceof Headers ? [...h.entries()] : Object.entries(h);
  for (const [k, v] of entries) if (!SECRET_HEADERS.test(k)) out[k.toLowerCase()] = v;
  return out;
}

export function bodyFingerprint(body: unknown): { bytes: number; sha256: string } | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array) {
    const buf = typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
    return { bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  }
  return undefined; // multipart bodies are fingerprinted per file in the confirm code, not here
}

// Error answers and job status answers are kept, answers carrying business data are not.
export function keepResponseBody(status: number, url: string): boolean {
  return status >= 400 || /\/(jobs?|status|state)(\/|\?|$)/i.test(new URL(url).pathname);
}

export const clip = (s: string) => (s.length > MAX_BODY_CHARS ? `${s.slice(0, MAX_BODY_CHARS)}... [cut]` : s);

let warned = false;
let pruned = "";

function prune(dir: string, now: number): void {
  const day = iso(now).slice(0, 10);
  if (pruned === day) return;
  pruned = day;
  for (const f of readdirSync(dir)) {
    if (!/^http-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
    try {
      if (now - statSync(join(dir, f)).mtimeMs > RETENTION_DAYS * 86_400_000) rmSync(join(dir, f), { force: true });
    } catch {
      /* removed meanwhile */
    }
  }
}

/** Appends one line. A full disk or a read-only folder never breaks a DATEV call, it is reported once on stderr. */
export function writeHttpLog(entry: HttpLogEntry, env: NodeJS.ProcessEnv = process.env, now = Date.now()): void {
  try {
    const dir = logDir(env);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, `http-${iso(now).slice(0, 10)}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    prune(dir, now);
  } catch (e) {
    if (!warned) process.stderr.write(`datev-mcp: the HTTP log could not be written (${e instanceof Error ? e.message : String(e)})\n`);
    warned = true;
  }
}

export interface ErrorRate {
  requests: number;
  errors: number;
  rate: number;
  since: string;
}

/** Share of answers with HTTP 4xx or 5xx in the last `days` days. DATEV expects less than 10 % after go-live. */
export function errorRate(days = 14, env: NodeJS.ProcessEnv = process.env, now = Date.now()): ErrorRate {
  const since = now - days * 86_400_000;
  let requests = 0;
  let errors = 0;
  let files: string[] = [];
  try {
    files = readdirSync(logDir(env)).filter((f) => /^http-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
  } catch {
    /* no log yet */
  }
  for (const f of files) {
    let text = "";
    try {
      text = readFileSync(join(logDir(env), f), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      let e: HttpLogEntry;
      try {
        e = JSON.parse(line) as HttpLogEntry;
      } catch {
        continue;
      }
      if (typeof e.status !== "number" || Date.parse(e.ts_request) < since) continue;
      requests++;
      if (e.status >= 400) errors++;
    }
  }
  return { requests, errors, rate: requests ? errors / requests : 0, since: iso(since) };
}
