import { createHash } from "node:crypto";
import { humanApproval } from "./approval.js";
import { extname } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loginKey } from "../api/login-key.js";
import { bounded, buildUrl, callOperation, CallError, problemFields, problemText, type CallDeps } from "../api/client.js";
import { describeClient } from "../api/client-gate.js";
import { requireClientService } from "../api/permission.js";
import { NeedsLoginError } from "../auth/session.js";
import { getOperation } from "./catalog.js";
import { checkConfirmToken, issueConfirmToken } from "./confirm.js";
import { FileError, readLocalFile } from "./files.js";
import { localize } from "../i18n.js";

const MAX_DOC_BYTES = 20 * 1024 * 1024;
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ ...ok(localize(m)), isError: true });

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
  const type = Object.hasOwn(MIME, ext) ? MIME[ext] : undefined;
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

/** RFC 4122 id from client, file hash and filing: the same filing sent again reaches the same DATEV document. */
export function documentGuid(clientId: string, sha256: string, filing: Record<string, string> = {}): string {
  // JSON keeps values apart, so no field value can imitate another field.
  const where = JSON.stringify(Object.keys(filing).sort().map((k) => [k, filing[k]]));
  const h = createHash("sha256").update(JSON.stringify([clientId, sha256, where])).digest().subarray(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

interface DocumentType {
  name: string;
  category?: string;
  debit_credit_identifier?: string;
}

/** DATEV asks apps to read a client's document types and send only those (accounting-documents rules). */
async function fetchDocumentTypes(clientId: string, d: CallDeps): Promise<DocumentType[]> {
  const op = getOperation("accounting-documents.get_clients_client_id_document_types");
  if (!op) throw new CallError("Document type operation missing from the index");
  const r = await callOperation(op, { pathParams: { "client-id": clientId } }, { ...d, maxBodyChars: Math.max(d.maxBodyChars ?? 0, 100_000) });
  if (r.status !== 200 || !Array.isArray(r.body)) throw new CallError(`DATEV returned HTTP ${r.status} for ${op.id}: ${problemText(r.status, r.body)}`);
  if (r.truncated) throw new CallError("DATEV's document type answer was cut off. Nothing was sent.");
  const types = (r.body as Record<string, unknown>[])
    .filter((t) => t && typeof t.name === "string")
    .map((t) => ({ name: t.name as string, category: typeof t.category === "string" ? t.category : undefined, debit_credit_identifier: typeof t.debit_credit_identifier === "string" ? t.debit_credit_identifier : undefined }));
  return types;
}

// DATEV: verify the types once per transfer day, never before every single document (DOCS-04, DOCS-06).
const typeCache = new Map<string, { day: string; types: DocumentType[] }>();
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

const inFlight = new Map<string, Promise<DocumentType[]>>();

/** One read per login, client and Berlin day; parallel callers share the read in flight. RENAME_OK: one cached path for both tools. */
export async function documentTypesToday(clientId: string, d: CallDeps): Promise<DocumentType[]> {
  const deadline = Date.now() + (d.deadlineMs ?? 55_000);
  const key = `${await loginKey(d, deadline)}|${clientId}`;
  const hit = typeCache.get(key);
  if (hit && hit.day === today()) return hit.types;
  let read = inFlight.get(key);
  if (!read) {
    // The shared read belongs to no single caller: one caller's cancel must not fail the others.
    read = fetchDocumentTypes(clientId, { ...d, signal: undefined })
      // An empty list is never kept: one empty answer must not refuse every document type for the rest of the day.
      .then((types) => (types.length && typeCache.set(key, { day: today(), types }), types))
      .finally(() => inFlight.delete(key));
    inFlight.set(key, read);
  }
  return bounded(read, deadline, d.signal, "while reading the client's document types");
}

const SERVICE = { belegbilderservice: "Belegbilderservice", buchungsdatenservice: "Buchungsdatenservice" } as const;

export function registerDocumentTools(server: McpServer, deps: (signal?: AbortSignal) => CallDeps): void {
  server.registerTool(
    "datev_document_types",
    {
      title: "Document types of a DATEV client",
      description: "List the document types (Belegtypen) a DATEV client accepts, for example Rechnungseingang. datev_upload_document accepts only these. Show them to the user as they are.",
      inputSchema: { client_id: z.string().describe("Technical client id from datev_list_clients. Never invent one.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client_id }, extra) => {
      try {
        return ok({ client_id, document_types: await documentTypesToday(client_id, deps(extra.signal)) });
      } catch (e) {
        return err(errorText(e));
      }
    },
  );

  server.registerTool(
    "datev_upload_document",
    {
      title: "Upload a receipt or document to DATEV",
      description:
        "Upload a file (invoice, receipt, PDF, image) to a DATEV client. service belegbilderservice (default) puts it in the document inbox (Belegbilderservice Rechnungswesen); buchungsdatenservice files it for a booking batch and then needs category, folder and register. document_type must be one of the client's types from datev_document_types. The server first checks at DATEV that the client switched the service on. The first call returns a preview and a confirm_token. Show the preview to the user, then call again with confirm: true and that token. Sending the same file to the same client again does not create a second copy.",
      inputSchema: {
        client_id: z.string().describe("Technical client id from datev_list_clients (format consultant-client, e.g. 12345-1). Never invent one."),
        file_path: z.string().describe("Absolute path to the file (PDF, JPG, PNG, TIFF, GIF, BMP, XML, TXT, CSV)"),
        service: z.enum(["belegbilderservice", "buchungsdatenservice"]).optional().describe("Default belegbilderservice"),
        document_type: z.string().min(1).max(30).optional().describe("One of the client's document types from datev_document_types, e.g. Rechnungseingang. Required for belegbilderservice; for buchungsdatenservice ask the user whether to send it."),
        note: z.string().max(255).optional(),
        category: level.optional().describe("buchungsdatenservice only, required there: the app or source of the document"),
        folder: level.optional().describe("buchungsdatenservice only, required there: the kind of document"),
        register: level.optional().describe("buchungsdatenservice only, required there: the period, e.g. 2026/03"),
        confirm: z.boolean().optional(),
        confirm_token: z.string().optional().describe("The token returned by the preview"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ client_id, file_path, service, document_type, note, category, folder, register, confirm, confirm_token }, extra) => {
      try {
        const svc = service ?? "belegbilderservice";
        const levels = [category, folder, register].filter((x) => x !== undefined).length;
        if (svc === "belegbilderservice" && levels) return err("Belegbilderservice does not take category, folder or register. Leave them out, or use service buchungsdatenservice.");
        if (svc === "buchungsdatenservice" && levels !== 3) return err("Buchungsdatenservice needs category, folder and register for every document.");
        if (svc === "belegbilderservice" && !document_type) return err("Belegbilderservice needs a document_type for every document. List them with datev_document_types.");
        const file = readLocalFile(file_path, MAX_DOC_BYTES);
        const contentType = mimeFor(file.name);
        const metadata: Record<string, string> = {};
        if (document_type) metadata.document_type = document_type;
        if (note) metadata.note = note;
        if (category && folder && register) Object.assign(metadata, { category, folder, register });
        const d = deps(extra.signal);
        // Permission before every transfer; document types only once per day, as DATEV asks.
        const client = await requireClientService(client_id, [SERVICE[svc]], d);
        if (document_type) {
          const types = await documentTypesToday(client_id, d);
          if (!types.some((t) => t.name === document_type))
            return err(`"${document_type}" is not a document type of this client. Available: ${types.map((t) => t.name).join(", ") || "none"}.`);
        }
        const op = getOperation("accounting-documents.put_clients_client_id_documents_document_id");
        if (!op) return err("Document upload operation missing from the index");
        const sha256 = createHash("sha256").update(file.bytes).digest("hex");
        // The note is not part of the id: the same filing with a changed note updates the one DATEV document.
        const { note: _note, ...filing } = metadata;
        const documentId = documentGuid(client_id, sha256, { service: svc, ...filing });
        const destination = buildUrl(op, d.env, { pathParams: { "client-id": client_id, "document-id": documentId } }).toString();
        const who = describeClient(client);
        const fingerprint = { tool: "datev_upload_document", env: d.env, client_id, service: svc, document_id: documentId, file: file.path, name: file.name, content_type: contentType, sha256, metadata };
        if (confirm !== true) {
          return ok({
            preview: true,
            note: localize(`Nothing was sent. This uploads ${file.name} (${file.bytes.length} bytes, ${contentType}) to ${SERVICE[svc]} of ${who} in DATEV ${d.env}. Ask the user, then call again with confirm: true and this confirm_token.`),
            client: { name: client.name, consultant_number: client.consultant_number, client_number: client.client_number },
            service: SERVICE[svc],
            destination,
            file: file.path,
            content_type: contentType,
            metadata,
            confirm_token: issueConfirmToken(fingerprint),
          });
        }
        const refused = checkConfirmToken(confirm_token, fingerprint);
        if (refused) return err(refused);
        const denied = await humanApproval(server, d.env, `Upload ${file.name} (${file.bytes.length} bytes${document_type ? `, ${document_type}` : ""}) to ${SERVICE[svc]} of ${who}\n${destination}`);
        if (denied) return err(denied);
        const r = await callOperation(op, { pathParams: { "client-id": client_id, "document-id": documentId }, rawBody: buildDocumentForm(file, metadata) }, d);
        const out = { uploaded: r.status >= 200 && r.status < 300, status: r.status, document_id: documentId, body: r.body, truncated: r.truncated, env: d.env, ...(r.status >= 400 ? problemFields(r.status, r.body, op.id) : {}) };
        return out.uploaded ? ok(out) : { ...ok(out), isError: true };
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
