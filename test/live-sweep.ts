// Live sweep of every DATEV read operation through the real MCP server, paced for DATEV's rate limits and resumable across days.
// Run: npm run build && npm run sweep   (env: DATEV_SWEEP_MAX=150 per day, DATEV_SWEEP_GAP_MS=3000, DATEV_SWEEP_ALL=1 to redo done ops)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { checkAgainstSchema } from "../src/api/client.js";
import type { Operation } from "../src/spec/types.js";
import { OPERATIONS } from "../src/tools/catalog.js";

const MAX_PER_DAY = Number(process.env.DATEV_SWEEP_MAX ?? 150);
const GAP_MS = Number(process.env.DATEV_SWEEP_GAP_MS ?? 3000);
const REDO = process.env.DATEV_SWEEP_ALL === "1";
const LEDGER = "test/reports/live-ledger.jsonl";
const DEFAULT_CLIENT = process.env.DATEV_LIVE_CLIENT ?? "455148-1";

interface Entry { ts: string; day: string; op: string; product: string; status: number | "skipped" | "error"; ms: number; attempts?: number; items?: number; shape?: string; bodyHash?: string; note?: string }
const today = new Date().toISOString().slice(0, 10);
mkdirSync("test/reports", { recursive: true });
const ledger: Entry[] = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry) : [];
// Settled: a real answer (2xx) or a confirmed absence (404). 401, 403, 5xx and errors are retried on a later day,
// because they usually mean a product is not yet enabled for the sandbox app, not that the operation is finished.
const settled = (e: Entry) => typeof e.status === "number" && (e.status < 300 || e.status === 404);
const done = new Set(ledger.filter((e) => settled(e) || (e.day === today && e.status !== "skipped")).map((e) => e.op));
let usedToday = ledger.filter((e) => e.day === today && typeof e.status === "number").length;
const write = (e: Entry) => {
  ledger.push(e);
  appendFileSync(LEDGER, JSON.stringify(e) + "\n");
};

const launcher = process.env.DATEV_MCP_LAUNCHER;
const transport = new StdioClientTransport(
  launcher ? { command: launcher, args: [], env: process.env as Record<string, string> } : { command: process.execPath, args: ["dist/index.js"], env: process.env as Record<string, string> },
);
const client = new Client({ name: "datev-mcp-sweep", version: "0" });
await client.connect(transport, { timeout: 300_000 });

const reads = OPERATIONS.filter((o) => o.method === "get" && o.servers.sandbox);
const pathNames = (o: Operation) => [...o.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const KNOWN = "test/reports/live-known.json";
// `${api}|${param}` -> value harvested from a live list response, kept across runs so later days can reach child operations.
const known = new Map<string, string>(existsSync(KNOWN) ? Object.entries(JSON.parse(readFileSync(KNOWN, "utf8")) as Record<string, string>) : []);
const saveKnown = () => writeFileSync(KNOWN, JSON.stringify(Object.fromEntries(known), null, 2));
const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, "");

function fits(o: Operation, name: string, v: string): boolean {
  try {
    checkAgainstSchema(name, v, o.params.find((p) => p.in === "path" && p.name === name)?.schema);
    return true;
  } catch {
    return false;
  }
}

function resolve(o: Operation): { pathParams: Record<string, string>; headers: Record<string, string>; query: Record<string, string> } | string {
  const pathParams: Record<string, string> = {};
  for (const n of pathNames(o)) {
    const tries = [known.get(`${o.api}|${n}`), /^clients?-?id$|^masterclientid$/.test(norm(n)) ? DEFAULT_CLIENT : undefined];
    if (norm(n) === "consultantnumber") tries.push(DEFAULT_CLIENT.split("-")[0]);
    if (norm(n) === "clientnumber") tries.push(DEFAULT_CLIENT.split("-")[1]);
    if (norm(n) === "consultantnumberclientnumber") tries.push(DEFAULT_CLIENT);
    if (norm(n) === "fiscalyearid") tries.push(known.get("fiscalYear"));
    const v = tries.find((t): t is string => !!t && fits(o, n, t));
    if (!v) return `needs a real "${n}" that no list call has returned yet`;
    pathParams[n] = v;
  }
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  for (const p of o.params.filter((x) => x.required && x.in !== "path")) {
    if (p.in === "header" && /api-key/i.test(p.name)) return `needs a separate "${p.name}" product key, not part of this OAuth app`;
    if (p.in === "header") headers[p.name] = /display-name/i.test(p.name) ? "datev-mcp" : /language/i.test(p.name) ? "de" : "application/json";
    else if (p.in === "query" && p.name === "page") query.page = "1";
    else return `needs a value for required ${p.in} "${p.name}"`;
  }
  return { pathParams, headers, query };
}

// Learn ids from a list response so the child operations ("/x" -> "/x/{id}") can be called with real values.
function harvest(o: Operation, body: unknown) {
  const first = Array.isArray(body) ? body[0] : body && typeof body === "object" ? (Object.values(body).find(Array.isArray) as unknown[] | undefined)?.[0] : undefined;
  if (first === undefined) return;
  if (o.id === "accounting-dataexchange.getfiscalyears") known.set("fiscalYear", String(typeof first === "object" ? (first as { id: unknown }).id : first));
  const childPath = new RegExp(`^${o.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\{[^}/]+\\}$`);
  for (const child of reads.filter((c) => c.api === o.api && childPath.test(c.path))) {
    const name = pathNames(child).at(-1)!;
    const obj = typeof first === "object" && first ? (first as Record<string, unknown>) : {};
    const hit = Object.entries(obj).find(([k]) => norm(k) === norm(name))?.[1] ?? obj.id ?? (typeof first !== "object" ? first : undefined);
    if (hit !== undefined && hit !== null && !known.has(`${child.api}|${name}`)) known.set(`${child.api}|${name}`, String(hit));
  }
}

const shapeOf = (b: unknown) => (Array.isArray(b) ? `array(${b.length})` : b && typeof b === "object" ? `object{${Object.keys(b).slice(0, 6).join(",")}}` : typeof b);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let stopReason = "";

async function callOne(o: Operation): Promise<boolean> {
  const plan = resolve(o);
  if (typeof plan === "string") return false;
  const t0 = Date.now();
  const r = (await client.callTool({ name: "datev_call", arguments: { operation_id: o.id, path_params: plan.pathParams, headers: plan.headers, query: plan.query } }, undefined, { timeout: 120_000 })) as { content: { text: string }[] };
  const ms = Date.now() - t0;
  const text = r.content[0]?.text ?? "";
  let parsed: { status?: number; body?: unknown; attempts?: number } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    if (text.startsWith("DATEV login needed")) {
      stopReason = `${text} The sweep resumes from here once you are logged in again`;
      return false;
    }
    write({ ts: new Date().toISOString(), day: today, op: o.id, product: o.product, status: "error", ms, note: text.slice(0, 200) });
    return true;
  }
  const status = parsed.status ?? 0;
  const body = parsed.body;
  usedToday++;
  write({ ts: new Date().toISOString(), day: today, op: o.id, product: o.product, status, ms, attempts: parsed.attempts, items: Array.isArray(body) ? body.length : undefined, shape: shapeOf(body), bodyHash: createHash("sha256").update(JSON.stringify(body ?? "")).digest("hex").slice(0, 12) });
  if (status >= 200 && status < 300) {
    harvest(o, body);
    saveKnown();
  }
  if (status === 429) stopReason = "DATEV answered 429 Too Many Requests; stopping here so the next run resumes without hammering the API";
  return true;
}

// Sequential on purpose: the sweep paces itself to stay under DATEV's rate limit, and later calls use ids learned from earlier ones.
let progress = true;
while (progress && !stopReason) {
  progress = false;
  for (const o of reads.filter((x) => REDO || !done.has(x.id)).sort((a, b) => pathNames(a).length - pathNames(b).length)) {
    if (done.has(o.id) || stopReason) continue;
    if (usedToday >= MAX_PER_DAY) {
      stopReason = `daily cap of ${MAX_PER_DAY} calls reached; run again tomorrow to continue`;
      break;
    }
    const called = await callOne(o); // BESTPRACTICE_OK: rate-limited, ordered crawl
    if (called) {
      done.add(o.id);
      progress = true;
      await sleep(GAP_MS); // BESTPRACTICE_OK: deliberate pacing between live calls
    }
  }
}
for (const o of reads.filter((x) => !done.has(x.id))) {
  const plan = resolve(o);
  if (typeof plan === "string" && !ledger.some((e) => e.op === o.id && e.day === today)) write({ ts: new Date().toISOString(), day: today, op: o.id, product: o.product, status: "skipped", ms: 0, note: plan });
}
await client.close();

// Latest entry per operation is the current verdict; the full history stays in the ledger as evidence.
const latest = new Map<string, Entry>();
for (const e of ledger) latest.set(e.op, e);
const rows = reads.map((o) => latest.get(o.id) ?? { op: o.id, product: o.product, status: "skipped" as const, ms: 0, note: "not reached yet", ts: "", day: "" });
const bucket = (e: Entry) => (typeof e.status !== "number" ? String(e.status) : e.status < 300 ? "2xx ok" : e.status === 403 || e.status === 401 ? "401/403 not permitted for this sandbox app" : e.status === 404 ? "404 no such resource" : `${e.status}`);
const counts = new Map<string, number>();
rows.forEach((e) => counts.set(bucket(e), (counts.get(bucket(e)) ?? 0) + 1));
const calls = ledger.filter((e) => typeof e.status === "number");
const days = [...new Set(calls.map((e) => e.day))];
const md = [
  `# DATEV MCP live sweep, sandbox, as of ${new Date().toISOString()}`,
  "",
  `${reads.length} read operations. ${calls.length} real HTTP calls recorded over ${days.length} day(s): ${days.join(", ")}.`,
  stopReason ? `\nStopped: ${stopReason}.` : "\nSweep complete for everything resolvable.",
  "",
  "| Outcome | Operations |",
  "|---|---|",
  ...[...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "| Operation | Status | ms | Shape | When | Note |",
  "|---|---|---|---|---|---|",
  ...rows.map((e) => `| ${e.op} | ${e.status} | ${e.ms || ""} | ${e.shape ?? ""} | ${e.ts.slice(0, 16)} | ${(e.note ?? "").replace(/\|/g, "/")} |`),
].join("\n");
writeFileSync(`test/reports/live-sweep-${today}.md`, md);
console.log(md.split("\n").slice(0, 12 + counts.size).join("\n"));
console.log(`\nreport: test/reports/live-sweep-${today}.md   ledger: ${LEDGER}`);
