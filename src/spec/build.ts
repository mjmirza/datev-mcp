import { deref } from "./deref.js";
import type { HttpMethod, Operation, OperationIndex, OperationParam } from "./types.js";

const METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

type Obj = Record<string, unknown>;

interface RawParam {
  name?: string;
  in?: OperationParam["in"];
  required?: boolean;
  description?: string;
  schema?: unknown;
}

interface RawBody {
  required?: boolean;
  content?: Record<string, { schema?: unknown }>;
}

interface RawOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  security?: unknown;
}

export interface SpecDoc {
  info?: { title?: string };
  servers?: { url: string }[];
  security?: unknown;
  paths?: Record<string, Obj>;
}

export interface SpecFile {
  fileName: string;
  doc: SpecDoc;
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// File names look like "<product>__<version>__<api>.json"; "<api>" is "1" for single-API products.
export function productKey(fileName: string): string {
  const [product = "", , apiRaw = ""] = fileName.replace(/\.json$/, "").split("__");
  const api = apiRaw && apiRaw !== "1" ? apiRaw : product;
  return api
    .replace(/^datev-/, "")
    .replace(/^b4value-net-/, "")
    .replace(/-v\d.*$/, "")
    .replace(/-1$/, "");
}

export function isSkippedSpec(fileName: string): boolean {
  // eau-api ships a sandbox-only variant duplicating the main spec, which already lists the sandbox server.
  return /-sandbox\.json$/.test(fileName);
}

function slug(s: string): string {
  return s.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function scopesOf(security: unknown): string[] {
  const out = new Set<string>();
  if (!Array.isArray(security)) return [];
  for (const req of security) {
    if (isObj(req)) for (const s of Object.values(req)) if (Array.isArray(s)) s.forEach((x) => out.add(String(x)));
  }
  return [...out].sort();
}

function servers(doc: SpecDoc): Operation["servers"] {
  const urls = (doc.servers ?? []).map((s) => s.url.replace(/\/$/, ""));
  return {
    production: urls.find((u) => !/sandbox/i.test(u)),
    sandbox: urls.find((u) => /sandbox/i.test(u)),
  };
}

function toParam(raw: unknown, doc: SpecDoc): OperationParam | undefined {
  const p = deref(raw, doc) as RawParam;
  if (typeof p !== "object" || p === null || !p.name || !p.in) return undefined;
  return { name: p.name, in: p.in, required: Boolean(p.required || p.in === "path"), description: p.description, schema: p.schema };
}

function toBody(raw: unknown, doc: SpecDoc): Operation["body"] {
  if (raw === undefined) return undefined;
  const rb = deref(raw, doc) as RawBody;
  const content: NonNullable<RawBody["content"]> = typeof rb === "object" && rb !== null && rb.content ? rb.content : {};
  const first = Object.keys(content)[0];
  return { required: Boolean(rb.required), contentTypes: Object.keys(content), schema: first ? content[first]?.schema : undefined };
}

export function buildIndex(files: SpecFile[]): OperationIndex {
  const operations: Operation[] = [];
  const used = new Set<string>();
  let generatedFrom = 0;
  for (const { fileName, doc } of [...files].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    if (isSkippedSpec(fileName)) continue;
    generatedFrom++;
    const key = productKey(fileName);
    const srv = servers(doc);
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      const shared = Array.isArray(item.parameters) ? item.parameters : [];
      for (const method of METHODS) {
        const op = item[method] as RawOperation | undefined;
        if (typeof op !== "object" || op === null) continue;
        const base = `${key}.${slug(op.operationId ?? `${method}_${path}`)}`;
        let id = base;
        for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
        used.add(id);
        const params = [...shared, ...(op.parameters ?? [])]
          .map((p) => toParam(p, doc))
          .filter((p): p is OperationParam => p !== undefined);
        operations.push({
          id,
          product: key,
          api: doc.info?.title ?? key,
          method,
          path,
          summary: String(op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`).trim().slice(0, 200),
          description: op.description ? String(op.description).trim().slice(0, 600) : undefined,
          write: method !== "get",
          health: /health/.test(key) || /\/health/.test(path),
          scopes: scopesOf(op.security ?? doc.security),
          params,
          body: toBody(op.requestBody, doc),
          servers: srv,
        });
      }
    }
  }
  return { generatedFrom, operations };
}
