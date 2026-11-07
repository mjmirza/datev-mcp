import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extname } from "node:path";
import { callOperation, CallError, type CallDeps } from "../api/client.js";
import { NeedsLoginError } from "../auth/session.js";
import { getOperation } from "./catalog.js";
import { FileError, readLocalFile } from "./files.js";

const MAX_DOC_BYTES = 20 * 1024 * 1024;
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ ...ok(m), isError: true });

function errorText(e: unknown): string {
  if (e instanceof FileError || e instanceof CallError || e instanceof NeedsLoginError) return e.message;
  return `Failed: ${e instanceof Error ? e.message : String(e)}`;
}

export function buildDocumentForm(file: { name: string; bytes: Uint8Array }, metadata: Record<string, string>): FormData {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)]), file.name);
  if (Object.keys(metadata).length) form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  return form;
}

export function registerDocumentTools(server: McpServer, deps: () => CallDeps): void {
  server.registerTool(
    "datev_upload_document",
    {
      title: "Upload a receipt or document to DATEV",
      description:
        "Upload a file (invoice, receipt, PDF, image) to a DATEV client's Belegbilderservice (accounting-documents). Returns a preview unless confirm is true.",
      inputSchema: {
        client_id: z.string().describe("DATEV client id, e.g. 455148-2"),
        file_path: z.string().describe("Absolute path to the file"),
        document_type: z.string().optional().describe("DATEV document type, e.g. Rechnungseingang or Rechnungsausgang"),
        note: z.string().max(500).optional(),
        folder: z.string().optional(),
        register: z.string().optional().describe("e.g. 2026/03"),
        confirm: z.boolean().optional(),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ client_id, file_path, document_type, note, folder, register, confirm }) => {
      try {
        const file = readLocalFile(file_path, MAX_DOC_BYTES);
        const metadata: Record<string, string> = {};
        if (document_type) metadata.document_type = document_type;
        if (note) metadata.note = note;
        if (folder) metadata.folder = folder;
        if (register) metadata.register = register;
        const d = deps();
        if (confirm !== true) {
          return ok({
            preview: true,
            note: `Nothing was sent. This uploads ${file.name} (${file.bytes.length} bytes) to DATEV ${d.env} client ${client_id}. Ask the user, then call again with confirm: true.`,
            file: file.path,
            extension: extname(file.name).slice(1).toLowerCase(),
            metadata,
          });
        }
        const op = getOperation("accounting-documents.post_clients_client_id_documents");
        if (!op) return err("Document upload operation missing from the index");
        const r = await callOperation(op, { pathParams: { "client-id": client_id }, rawBody: buildDocumentForm(file, metadata) }, d);
        const out = { uploaded: r.status < 300, status: r.status, location: r.location, body: r.body, env: d.env };
        return r.status >= 400 ? { ...ok(out), isError: true } : ok(out);
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
