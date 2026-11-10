import { createHash } from "node:crypto";
import { humanApproval } from "./approval.js";
import { extname } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildHeaders, buildUrl, callOperation, CallError, checkAgainstSchema, MAY_BE_APPLIED, mediaMatches, problemFields, UncertainSendError, type CallDeps } from "../api/client.js";
import { describeClient, gateCall, hideClientId, shownClient } from "../api/client-gate.js";
import { requireClientService } from "../api/permission.js";
import { NeedsLoginError } from "../auth/session.js";
import { localize } from "../i18n.js";
import type { Operation } from "../spec/types.js";
import { getOperation } from "./catalog.js";
import { checkConfirmToken, issueConfirmToken } from "./confirm.js";
import { documentTypesToday, mimeFor } from "./documents.js";
import { FileError, readLocalFile } from "./files.js";
import { finishSend, reserveSend, sentBefore } from "./sent-ledger.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const TOOL = "datev_upload_file";

// Smaller limits DATEV documents for single parts: the HR import file (3 MB) and the cash register metadata (10 kb).
const PART_LIMITS: Record<string, Record<string, number>> = {
  "hr-files.post_v1_clients_client_id_files": { file: 3_000_000 },
  "cashregister.importfile": { metadata: 10_000 },
};

// Limits DATEV states only in prose: the HR import file name and provider (50 characters each).
const NAME_LIMITS: Record<string, number> = { "hr-files.post_v1_clients_client_id_files": 50 };
const TEXT_LIMITS: Record<string, Record<string, number>> = { "hr-files.post_v1_clients_client_id_files": { file_provider: 50 } };

// A file name goes into the multipart header as is, so characters that break it or Windows paths are refused.
const BAD_NAME = /[\u0000-\u001f\u007f"\\<>:|?*\u201c\u201d]/;
function checkName(op: Operation, name: string): void {
  if (BAD_NAME.test(name)) throw new UploadError(`The file name "${name}" contains a character DATEV refuses (control characters, quotes, backslash, < > : | ? *). Rename the file first.`);
  const max = NAME_LIMITS[op.id];
  if (max !== undefined && name.length > max) throw new UploadError(`${op.id} accepts file names of at most ${max} characters, "${name}" has ${name.length}.`);
}

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ ...ok(localize(m)), isError: true });

const TYPES = new Map(
  Object.entries({
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    tif: "image/tiff",
    tiff: "image/tiff",
    gif: "image/gif",
    bmp: "image/bmp",
    xml: "application/xml",
    json: "application/json",
    txt: "text/plain",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
    zip: "application/zip",
  }),
);
const guessType = (name: string) => TYPES.get(extname(name).slice(1).toLowerCase()) ?? "application/octet-stream";

type Schema = { type?: string; format?: string; enum?: unknown[]; required?: string[]; properties?: Record<string, Schema>; items?: Schema; allOf?: Schema[] };

// Folds allOf into one schema, which is how the DATEV specs declare most object parts.
function flat(s: Schema | undefined): Schema {
  if (!s) return {};
  if (!s.allOf) return s;
  return s.allOf.map(flat).reduce<Schema>(
    (a, b) => ({ ...a, ...b, required: [...(a.required ?? []), ...(b.required ?? [])], properties: { ...a.properties, ...b.properties } }),
    { ...s, allOf: undefined },
  );
}

interface Part {
  binary: boolean;
  list: boolean;
  schema: Schema;
}

function partsOf(op: Operation): { parts: Map<string, Part>; required: string[] } {
  const schema = flat(op.body?.schema as Schema | undefined);
  const parts = new Map<string, Part>();
  for (const [name, raw] of Object.entries(schema.properties ?? {})) {
    const s = flat(raw);
    const list = s.type === "array";
    parts.set(name, { binary: (list ? s.items?.format : s.format) === "binary", list, schema: s });
  }
  return { parts, required: schema.required ?? [] };
}

class UploadError extends Error {}

function checkField(op: Operation, name: string, value: unknown, schema: Schema, declared: string | undefined): void {
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  const wantsObject = schema.type === "object" || !!schema.properties || (declared !== undefined && mediaMatches(declared, "application/json"));
  if (wantsObject && !isObject) throw new UploadError(`Part "${name}" of ${op.id} must be a JSON object.`);
  if (schema.type === "string" && typeof value !== "string") throw new UploadError(`Part "${name}" of ${op.id} must be text.`);
  if (typeof value === "string") {
    const textMax = TEXT_LIMITS[op.id]?.[name];
    if (textMax !== undefined && value.length > textMax) throw new UploadError(`Part "${name}" of ${op.id} must be at most ${textMax} characters.`);
    if (schema.enum && !schema.enum.includes(value)) throw new UploadError(`Part "${name}" of ${op.id} must be one of: ${schema.enum.join(", ")}.`);
    try {
      checkAgainstSchema(name, value, schema);
    } catch (e) {
      throw new UploadError((e as Error).message);
    }
  }
  if (isObject) {
    const obj = value as Record<string, unknown>;
    const missing = (schema.required ?? []).filter((k) => !Object.hasOwn(obj, k));
    if (missing.length) throw new UploadError(`Part "${name}" of ${op.id} needs ${missing.join(", ")}.`);
    for (const [k, v] of Object.entries(obj)) {
      const ps = schema.properties && Object.hasOwn(schema.properties, k) ? flat(schema.properties[k]) : undefined;
      if (!ps) continue;
      if (ps.type === "string" && typeof v !== "string") throw new UploadError(`"${name}.${k}" of ${op.id} must be text.`);
      if (ps.enum && !ps.enum.includes(v)) throw new UploadError(`"${name}.${k}" of ${op.id} must be one of: ${ps.enum.join(", ")}.`);
      if (typeof v === "string") {
        try {
          checkAgainstSchema(`${name}.${k}`, v, ps);
        } catch (e) {
          throw new UploadError((e as Error).message);
        }
      }
    }
  }
}

/** The filing a stapled upload names, independent of key order and of the note, which changes no filing. */
function filingOf(raw: unknown): [string, unknown][] {
  let meta: unknown = raw;
  if (typeof raw === "string") {
    try {
      meta = JSON.parse(raw);
    } catch {
      return [["raw", raw]];
    }
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  return Object.entries(meta as Record<string, unknown>)
    .filter(([k]) => k !== "note")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

async function checkStapled(clientId: string, raw: unknown, d: CallDeps): Promise<void> {
  let meta: Record<string, unknown>;
  try {
    meta = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : ((raw ?? {}) as Record<string, unknown>);
  } catch {
    throw new UploadError("The metadata field is not valid JSON.");
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new UploadError("The metadata field must be a JSON object.");
  const levels = ["category", "folder", "register"].filter((k) => meta[k] !== undefined).length;
  if (levels && levels !== 3) throw new UploadError("Buchungsdatenservice needs category, folder and register together.");
  const service = levels ? "Buchungsdatenservice" : "Belegbilderservice";
  if (!levels && typeof meta.document_type !== "string") throw new UploadError("Belegbilderservice needs a document_type in metadata. List them with datev_document_types.");
  await requireClientService(clientId, [service], d);
  if (typeof meta.document_type === "string") {
    const types = await documentTypesToday(clientId, d);
    if (!types.some((t) => t.name === meta.document_type))
      throw new UploadError(`"${meta.document_type}" is not a document type of this client. Available: ${types.map((t) => t.name).join(", ") || "none"}.`);
  }
}

function plan(operationId: string, files: Record<string, string | string[]>, fields: Record<string, unknown>) {
  const op = getOperation(operationId);
  if (!op) throw new UploadError(`Unknown operation "${operationId}". Use datev_search_operations first.`);
  if (op.id === "accounting-extf-files.importextffile") throw new UploadError("Use datev_upload_extf for EXTF files. It checks the file before sending it.");
  // Single documents follow DATEV's document rules (service, document type, filing fields) only in datev_upload_document.
  if (op.id === "accounting-documents.post_clients_client_id_documents" || op.id === "accounting-documents.put_clients_client_id_documents_document_id")
    throw new UploadError("Use datev_upload_document for a single document. It checks the client's data service and document types first.");
  if (!op.body?.contentTypes.some((c) => c.split(";")[0].trim().toLowerCase() === "multipart/form-data"))
    throw new UploadError(`${op.id} does not take a file upload. Use datev_call for it.`);
  const { parts, required } = partsOf(op);
  const names = [...parts.keys()].join(", ");
  for (const name of Object.keys(files)) {
    const part = parts.get(name);
    if (!part) throw new UploadError(`${op.id} has no part "${name}". Its parts are: ${names}.`);
    if (!part.binary) throw new UploadError(`Part "${name}" of ${op.id} is not a file. Pass it in fields.`);
    if (Array.isArray(files[name]) && !part.list) throw new UploadError(`Part "${name}" of ${op.id} takes one file, not a list.`);
  }
  for (const [name, value] of Object.entries(fields)) {
    const part = parts.get(name);
    if (!part) throw new UploadError(`${op.id} has no part "${name}". Its parts are: ${names}.`);
    if (part.binary) throw new UploadError(`Part "${name}" of ${op.id} is a file part. Pass a file path in files.`);
    checkField(op, name, value, part.schema, op.body.partTypes?.[name]);
  }
  const given = new Set([...Object.keys(files), ...Object.keys(fields)]);
  const missing = required.filter((r) => !given.has(r));
  if (missing.length) throw new UploadError(`${op.id} needs the part(s) ${missing.join(", ")}.`);
  const fileParts = [...parts].filter(([, p]) => p.binary).map(([n]) => n);
  if (!Object.values(files).flat().length) throw new UploadError(`Pass at least one file. ${op.id} takes files in: ${fileParts.join(", ")}.`);
  // Parts go out in the order the spec lists them, because some services reject another order.
  return { op, order: [...parts.keys()] };
}

function typeFor(op: Operation, part: string, name: string): string {
  // The document service refuses ZIP and accepts a fixed list of types, the same rule as datev_upload_document.
  if (op.product === "accounting-documents") return mimeFor(name);
  const type = guessType(name);
  const declared = op.body?.partTypes?.[part];
  if (declared && !declared.split(",").some((d) => mediaMatches(d.trim(), type)))
    throw new UploadError(`Part "${part}" of ${op.id} must be ${declared}, but ${name} looks like ${type}.`);
  return type;
}

function readAll(op: Operation, order: string[], files: Record<string, string | string[]>, fieldBytes: number) {
  let total = fieldBytes;
  const out: { part: string; path: string; name: string; bytes: Uint8Array; type: string; sha256: string }[] = [];
  for (const part of order.filter((p) => Object.hasOwn(files, p))) {
    const value = files[part];
    for (const p of Array.isArray(value) ? value : [value]) {
      const limit = Math.min(MAX_FILE_BYTES, PART_LIMITS[op.id]?.[part] ?? MAX_FILE_BYTES);
      const f = readLocalFile(p, limit);
      checkName(op, f.name);
      total += f.bytes.length;
      if (total > MAX_TOTAL_BYTES) throw new FileError(`The upload is larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB together. Send the files in smaller groups.`);
      out.push({ part, path: f.path, name: f.name, bytes: f.bytes, type: typeFor(op, part, f.name), sha256: createHash("sha256").update(f.bytes).digest("hex") });
    }
  }
  return out;
}

const fieldText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function buildForm(order: string[], files: ReturnType<typeof readAll>, fields: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const part of order) {
    for (const f of files.filter((x) => x.part === part)) form.append(part, new Blob([new Uint8Array(f.bytes)], { type: f.type }), f.name);
    if (!Object.hasOwn(fields, part)) continue;
    const v = fields[part];
    if (typeof v === "string") form.append(part, v);
    else form.append(part, new Blob([JSON.stringify(v)], { type: "application/json" }));
  }
  return form;
}

function errorText(e: unknown): string {
  if (e instanceof UploadError || e instanceof FileError || e instanceof CallError || e instanceof NeedsLoginError) return e.message;
  return `Upload failed: ${e instanceof Error ? e.message : String(e)}`;
}

export function registerUploadTools(server: McpServer, deps: (signal?: AbortSignal) => CallDeps): void {
  server.registerTool(
    TOOL,
    {
      title: "Upload files to a DATEV operation",
      description:
        "Send local files to any DATEV operation that takes a multipart upload (HR documents, smart transfer, DXSO, cash register, property tax, income tax documents, traffiqx invoices and more). Use datev_describe_operation to see the part names. files maps a file part to an absolute path (or a list where the part takes several). fields maps other parts to text or a JSON object. The first call returns a preview and a confirm_token. Show it to the user, then call again with confirm: true and that token. For EXTF use datev_upload_extf.",
      inputSchema: {
        operation_id: z.string(),
        path_params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        headers: z.record(z.string(), z.string()).optional().describe("Header parameters the operation declares, e.g. X-API-Key"),
        files: z.record(z.string(), z.union([z.string(), z.array(z.string()).min(1).max(50)])).describe("Part name to absolute file path, or a list of paths"),
        fields: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.unknown())])).optional().describe("Other parts, as text or a JSON object"),
        resend: z.boolean().optional().describe("Stapled documents only: send files to this client again on purpose although they were sent before"),
        confirm: z.boolean().optional(),
        confirm_token: z.string().optional().describe("The token returned by the preview"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ operation_id, path_params, query, headers, files, fields, resend, confirm, confirm_token }, extra) => {
      try {
        const f = fields ?? {};
        const { op, order } = plan(operation_id, files, f);
        const fieldBytes = Object.values(f).reduce<number>((n, v) => n + Buffer.byteLength(fieldText(v)), 0);
        if (fieldBytes > MAX_TOTAL_BYTES) throw new UploadError(`The fields are larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`);
        const d = deps(extra.signal);
        // Path, query and header values are checked now, so a preview is never confirmed for a request that cannot be sent.
        const target = { pathParams: path_params, query, headers };
        const url = buildUrl(op, d.env, target);
        buildHeaders(op, target);
        const read = readAll(op, order, files, fieldBytes);
        // Local checks first, then DATEV's permission reads.
        const client = await gateCall(op, path_params, query as Record<string, unknown> | undefined, d);
        // Stapled documents follow the same rules as datev_upload_document: service, document type, filing fields.
        const stapledClient = op.product === "accounting-documents" ? String(path_params?.["client-id"] ?? "") : undefined;
        if (stapledClient !== undefined) await checkStapled(stapledClient, f.metadata, d);
        // DATEV's stapled upload takes no document id, so it cannot recognise a repeat: the send record does.
        const stapledKey = stapledClient !== undefined ? createHash("sha256").update(JSON.stringify([read.map((x) => x.sha256).sort(), filingOf(f.metadata)])).digest("hex") : undefined;
        const earlier = stapledKey ? sentBefore("stapled", d.env, stapledClient!, stapledKey) : undefined;
        if (earlier && resend !== true) return err(`These files were already sent to this client on ${earlier.at} (${earlier.name}, ${earlier.status}). DATEV cannot tell a repeat of a stapled upload apart, so it would keep two copies. To send them again on purpose, call with resend: true.`);
        const listed = read.map((x) => ({ part: x.part, file: x.path, sent_as: x.name, bytes: x.bytes.length, content_type: x.type }));
        const fingerprint = {
          tool: TOOL,
          env: d.env,
          op: op.id,
          path_params: path_params ?? {},
          query: query ?? {},
          headers: headers ?? {},
          files: read.map((x) => ({ part: x.part, path: x.path, name: x.name, sha256: x.sha256, type: x.type })),
          fields: f,
          ...(earlier ? { resend: true, earlier_at: earlier.at } : {}),
        };
        if (confirm !== true) {
          return ok({
            preview: true,
            note: localize(`Nothing was sent. This sends ${read.length} file(s) to ${op.method.toUpperCase()} ${client ? hideClientId(String(url), [client.client_id, client.guid]) : url} in DATEV ${d.env}. Ask the user, then call again with confirm: true and this confirm_token.`),
            operation: op.id,
            ...(client ? { client: shownClient(client) } : {}),
            files: listed,
            fields: f,
            ...(headers && Object.keys(headers).length ? { headers } : {}),
            confirm_token: issueConfirmToken(fingerprint),
          });
        }
        const refused = checkConfirmToken(confirm_token, fingerprint);
        if (refused) return err(refused);
        const shownUrl = client ? hideClientId(String(url), [client.client_id, client.guid]) : String(url);
        const summary = [client ? `Client: ${describeClient(client)}` : "", ...[`${op.method.toUpperCase()} ${op.id}`, shownUrl, ...read.map((x) => `file ${x.part}: ${x.name} (${x.bytes.length} bytes, ${x.type})`), Object.keys(f).length ? `fields: ${JSON.stringify(f).slice(0, 1000)}` : "", headers && Object.keys(headers).length ? `headers: ${JSON.stringify(headers)}` : ""].filter(Boolean)].filter(Boolean).join("\n");
        const denied = await humanApproval(server, d.env, summary);
        if (denied) return err(denied);
        const held = stapledKey ? await reserveSend("stapled", d.env, stapledClient!, stapledKey, read.map((x) => x.name).join(", "), earlier ? { seen: earlier.at } : false) : undefined;
        if (held && "blocked" in held) return err(`These files are being sent or were just sent to this client (${held.blocked.at}, ${held.blocked.status}). Nothing was sent again.`);
        const finish = (status: "refused" | "uncertain" | "sent") => (held ? finishSend("stapled", d.env, stapledClient!, stapledKey!, held.reservation, { status }).catch(() => undefined) : Promise.resolve());
        let r;
        try {
          r = await callOperation(op, { ...target, rawBody: buildForm(order, read, f) }, d);
        } catch (e) {
          await finish(e instanceof UncertainSendError ? "uncertain" : "refused");
          throw e;
        }
        // Only a clear 4xx means DATEV did not take the files; a 5xx, 408 or redirect may hide a stored upload.
        await finish(r.status >= 200 && r.status < 300 ? "sent" : r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429 ? "refused" : "uncertain");
        const out = { uploaded: r.status >= 200 && r.status < 300, status: r.status, location: r.location, body: r.body, truncated: r.truncated, env: d.env, ...(r.status >= 400 ? problemFields(r.status, r.body, op.id) : {}), ...(r.status >= 500 || r.status === 408 ? { note: localize(MAY_BE_APPLIED) } : {}) };
        return out.uploaded ? ok(out) : { ...ok(out), isError: true };
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
