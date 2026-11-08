import { createHash } from "node:crypto";
import { extname } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildHeaders, buildUrl, callOperation, CallError, type CallDeps } from "../api/client.js";
import { NeedsLoginError } from "../auth/session.js";
import { localize } from "../i18n.js";
import type { Operation } from "../spec/types.js";
import { getOperation } from "./catalog.js";
import { checkConfirmToken, issueConfirmToken } from "./confirm.js";
import { FileError, readLocalFile } from "./files.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const TOOL = "datev_upload_file";

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ ...ok(localize(m)), isError: true });

const TYPES: Record<string, string> = {
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
};
const typeFor = (name: string) => TYPES[extname(name).slice(1).toLowerCase()] ?? "application/octet-stream";

interface Part {
  binary: boolean;
  list: boolean;
}

type Schema = { properties?: Record<string, Record<string, unknown>>; required?: string[] };

// Reads the multipart parts an operation declares. A part is a file part when its schema is a binary string or a list of them.
function partsOf(op: Operation): { parts: Map<string, Part>; required: string[] } {
  const schema = (op.body?.schema ?? {}) as Schema;
  const parts = new Map<string, Part>();
  for (const [name, s] of Object.entries(schema.properties ?? {})) {
    const items = s.items as Record<string, unknown> | undefined;
    const list = s.type === "array";
    parts.set(name, { binary: (list ? items?.format : s.format) === "binary", list });
  }
  return { parts, required: schema.required ?? [] };
}

class UploadError extends Error {}

function plan(operationId: string, files: Record<string, string | string[]>, fields: Record<string, unknown>) {
  const op = getOperation(operationId);
  if (!op) throw new UploadError(`Unknown operation "${operationId}". Use datev_search_operations first.`);
  if (op.id === "accounting-extf-files.importextffile") throw new UploadError("Use datev_upload_extf for EXTF files. It checks the file before sending it.");
  if (!op.body?.contentTypes.some((c) => c.split(";")[0].trim().toLowerCase() === "multipart/form-data"))
    throw new UploadError(`${op.id} does not take a file upload. Use datev_call for it.`);
  const { parts, required } = partsOf(op);
  for (const name of Object.keys(files)) {
    const part = parts.get(name);
    if (!part) throw new UploadError(`${op.id} has no part "${name}". Its parts are: ${[...parts.keys()].join(", ")}.`);
    if (!part.binary) throw new UploadError(`Part "${name}" of ${op.id} is not a file. Pass it in fields.`);
    if (Array.isArray(files[name]) && !part.list) throw new UploadError(`Part "${name}" of ${op.id} takes one file, not a list.`);
  }
  for (const name of Object.keys(fields)) {
    const part = parts.get(name);
    if (!part) throw new UploadError(`${op.id} has no part "${name}". Its parts are: ${[...parts.keys()].join(", ")}.`);
    if (part.binary) throw new UploadError(`Part "${name}" of ${op.id} is a file part. Pass a file path in files.`);
  }
  const given = new Set([...Object.keys(files), ...Object.keys(fields)]);
  const missing = required.filter((r) => !given.has(r));
  if (missing.length) throw new UploadError(`${op.id} needs the part(s) ${missing.join(", ")}.`);
  const fileParts = [...parts].filter(([, p]) => p.binary).map(([n]) => n);
  if (!Object.values(files).flat().length) throw new UploadError(`Pass at least one file. ${op.id} takes files in: ${fileParts.join(", ")}.`);
  return op;
}

function readAll(files: Record<string, string | string[]>) {
  let total = 0;
  const out: { part: string; path: string; name: string; bytes: Uint8Array; type: string; sha256: string }[] = [];
  for (const [part, value] of Object.entries(files)) {
    for (const p of Array.isArray(value) ? value : [value]) {
      const f = readLocalFile(p, MAX_FILE_BYTES);
      total += f.bytes.length;
      if (total > MAX_TOTAL_BYTES) throw new FileError(`The files are larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB together. Send them in smaller groups.`);
      out.push({ part, path: f.path, name: f.name, bytes: f.bytes, type: typeFor(f.name), sha256: createHash("sha256").update(f.bytes).digest("hex") });
    }
  }
  return out;
}

function buildForm(files: ReturnType<typeof readAll>, fields: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const f of files) form.append(f.part, new Blob([new Uint8Array(f.bytes)], { type: f.type }), f.name);
  for (const [name, v] of Object.entries(fields)) {
    if (typeof v === "string") form.append(name, v);
    else form.append(name, new Blob([JSON.stringify(v)], { type: "application/json" }));
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
        confirm: z.boolean().optional(),
        confirm_token: z.string().optional().describe("The token returned by the preview"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ operation_id, path_params, query, headers, files, fields, confirm, confirm_token }, extra) => {
      try {
        const op = plan(operation_id, files, fields ?? {});
        const read = readAll(files);
        const d = deps(extra.signal);
        // Path, query and header values are checked now, so a preview is never confirmed for a request that cannot be sent.
        const target = { pathParams: path_params, query, headers };
        const url = buildUrl(op, d.env, target);
        buildHeaders(op, target);
        const listed = read.map((f) => ({ part: f.part, file: f.path, bytes: f.bytes.length, content_type: f.type }));
        const fingerprint = {
          tool: TOOL,
          env: d.env,
          op: op.id,
          path_params: path_params ?? {},
          query: query ?? {},
          headers: headers ?? {},
          files: read.map((f) => ({ part: f.part, path: f.path, sha256: f.sha256, type: f.type })),
          fields: fields ?? {},
        };
        if (confirm !== true) {
          return ok({
            preview: true,
            note: `Nothing was sent. This sends ${read.length} file(s) to ${op.method.toUpperCase()} ${url} in DATEV ${d.env}. Ask the user, then call again with confirm: true and this confirm_token.`,
            operation: op.id,
            files: listed,
            fields: fields ?? {},
            confirm_token: issueConfirmToken(fingerprint),
          });
        }
        const refused = checkConfirmToken(confirm_token, fingerprint);
        if (refused) return err(refused);
        const r = await callOperation(op, { ...target, rawBody: buildForm(read, fields ?? {}) }, d);
        const out = { uploaded: r.status >= 200 && r.status < 300, status: r.status, location: r.location, body: r.body, truncated: r.truncated, env: d.env };
        return out.uploaded ? ok(out) : { ...ok(out), isError: true };
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
