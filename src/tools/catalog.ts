import index from "../data/operations.json" with { type: "json" };
import type { Operation, OperationIndex } from "../spec/types.js";

export const OPERATIONS: readonly Operation[] = (index as OperationIndex).operations;
const BY_ID = new Map(OPERATIONS.map((o) => [o.id, o]));

export function getOperation(id: string): Operation | undefined {
  return BY_ID.get(id);
}

export function products(): string[] {
  return [...new Set(OPERATIONS.map((o) => o.product))].sort();
}

const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((t) => t.length > 1);

export interface SearchOptions {
  product?: string;
  writesOnly?: boolean;
  includeHealth?: boolean;
  limit?: number;
}

// Plain keyword scoring: id and summary weigh more than path and description.
export function searchOperations(query: string, opts: SearchOptions = {}): Operation[] {
  const terms = tokenize(query);
  const pool = OPERATIONS.filter(
    (o) => (!opts.product || o.product === opts.product) && (opts.includeHealth || !o.health) && (!opts.writesOnly || o.write),
  );
  const scored = pool.map((o) => {
    const fields: [string, number][] = [
      [o.id, 3],
      [o.summary, 3],
      [o.product, 2],
      [o.path, 2],
      [o.description ?? "", 1],
    ];
    let score = 0;
    for (const t of terms) for (const [text, w] of fields) if (text.toLowerCase().includes(t)) score += w;
    return { o, score };
  });
  const hits = terms.length ? scored.filter((s) => s.score > 0) : scored;
  return hits.sort((a, b) => b.score - a.score || a.o.id.localeCompare(b.o.id)).slice(0, opts.limit ?? 15).map((s) => s.o);
}

// DATEV's terms forbid passing on its API documentation. Its prose (summaries, descriptions, examples) stays inside
// the server for search and validation; tool answers carry only structure: names, types, formats and constraints.
const PROSE = new Set(["description", "summary", "title", "example", "examples", "externalDocs", "x-example", "x-examples"]);

export function structureOnly(v: unknown, fieldNames = false): unknown {
  if (Array.isArray(v)) return v.map((x) => structureOnly(x));
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    // Under "properties" the keys are field names, so a field called "description" is a field, not prose.
    if (!fieldNames && PROSE.has(k)) continue;
    out[k] = structureOnly(val, !fieldNames && (k === "properties" || k === "patternProperties"));
  }
  return out;
}

export function summarize(o: Operation) {
  return { id: o.id, product: o.product, method: o.method.toUpperCase(), path: o.path, write: o.write };
}

export function describe(o: Operation, maxSchemaChars = 20_000) {
  const bodySchema = o.body?.schema === undefined ? undefined : structureOnly(o.body.schema);
  const schema = bodySchema === undefined ? undefined : JSON.stringify(bodySchema);
  return {
    ...summarize(o),
    api: o.api,
    scopes: o.scopes,
    params: o.params.map((p) => ({ name: p.name, in: p.in, required: p.required, schema: structureOnly(p.schema) })),
    body: o.body && {
      required: o.body.required,
      contentTypes: o.body.contentTypes,
      schema: schema && schema.length > maxSchemaChars ? `${schema.slice(0, maxSchemaChars)}... [truncated]` : bodySchema,
    },
    servers: o.servers,
  };
}
