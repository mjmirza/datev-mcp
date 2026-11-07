import { createHash } from "node:crypto";
import { extname } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callOperation, CallError, type CallDeps } from "../api/client.js";
import { NeedsLoginError } from "../auth/session.js";
import { getOperation } from "./catalog.js";
import { checkConfirmToken, issueConfirmToken } from "./confirm.js";
import { FileError, readLocalFile } from "./files.js";

const MAX_DOC_BYTES = 20 * 1024 * 1024;
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ ...ok(m), isError: true });

// DATEV requires the part's content type to match the file. ZIP is refused by the spec.
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  gif: "image/gif",
  bmp: "image/bmp",
  xml: "application/xml",
  txt: "text/plain",
  csv: "text/csv",
};

export function mimeFor(name: string): string {
  const ext = extname(name).slice(1).toLowerCase();
  if (ext === "zip") throw new FileError("DATEV does not accept ZIP files for documents. Upload the files one by one.");
  const type = MIME[ext];
  if (!type) throw new FileError(`Unsupported file type ".${ext}". Use one of: ${Object.keys(MIME).join(", ")}.`);
  return type;
}

function errorText(e: unknown): string {
  if (e instanceof FileError || e instanceof CallError || e instanceof NeedsLoginError) return e.message;
  return `Failed: ${e instanceof Error ? e.message : String(e)}`;
}

export function buildDocumentForm(file: { name: string; bytes: Uint8Array }, metadata: Record<string, string>): FormData {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: mimeFor(file.name) }), file.name);
  if (Object.keys(metadata).length) form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  return form;
}

const level = z.string().min(1).max(30);

export function registerDocumentTools(server: McpServer, deps: (signal?: AbortSignal) => CallDeps): void {
  server.registerTool(
    "datev_upload_document",
    {
      title: "Upload a receipt or document to DATEV",
      description:
        "Upload a file (invoice, receipt, PDF, image) to a DATEV client's Belegbilderservice (accounting-documents). The first call returns a preview and a confirm_token. Show the preview to the user, then call again with confirm: true and that token.",
      inputSchema: {
        client_id: z.string().describe("DATEV client id, e.g. 455148-1"),
        file_path: z.string().describe("Absolute path to the file (PDF, JPG, PNG, TIFF, GIF, BMP, XML, TXT, CSV)"),
        document_type: z.string().max(30).optional().describe("DATEV document type, e.g. Rechnungseingang or Rechnungsausgang"),
        note: z.string().max(255).optional(),
        category: level.optional().describe("Repository level 1. category, folder and register go together"),
        folder: level.optional().describe("Repository level 2"),
        register: level.optional().describe("Repository level 3, e.g. 2026/03"),
        confirm: z.boolean().optional(),
        confirm_token: z.string().optional().describe("The token returned by the preview"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ client_id, file_path, document_type, note, category, folder, register, confirm, confirm_token }, extra) => {
      try {
        const levels = [category, folder, register].filter((x) => x !== undefined).length;
        if (levels !== 0 && levels !== 3) return err("DATEV needs category, folder and register together, or none of them.");
        const file = readLocalFile(file_path, MAX_DOC_BYTES);
        const contentType = mimeFor(file.name);
        const metadata: Record<string, string> = {};
        if (document_type) metadata.document_type = document_type;
        if (note) metadata.note = note;
        if (category && folder && register) Object.assign(metadata, { category, folder, register });
        const d = deps(extra.signal);
        const fingerprint = { tool: "datev_upload_document", env: d.env, client_id, file: file.path, name: file.name, content_type: contentType, sha256: createHash("sha256").update(file.bytes).digest("hex"), metadata };
        if (confirm !== true) {
          return ok({
            preview: true,
            note: `Nothing was sent. This uploads ${file.name} (${file.bytes.length} bytes, ${contentType}) to DATEV ${d.env} client ${client_id}. Ask the user, then call again with confirm: true and this confirm_token.`,
            file: file.path,
            content_type: contentType,
            metadata,
            confirm_token: issueConfirmToken(fingerprint),
          });
        }
        const refused = checkConfirmToken(confirm_token, fingerprint);
        if (refused) return err(refused);
        const op = getOperation("accounting-documents.post_clients_client_id_documents");
        if (!op) return err("Document upload operation missing from the index");
        const r = await callOperation(op, { pathParams: { "client-id": client_id }, rawBody: buildDocumentForm(file, metadata) }, d);
        const out = { uploaded: r.status >= 200 && r.status < 300, status: r.status, location: r.location, body: r.body, env: d.env };
        return out.uploaded ? ok(out) : { ...ok(out), isError: true };
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
