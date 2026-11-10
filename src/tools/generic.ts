import { z } from "zod";
import { humanApproval } from "./approval.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildHeaders, buildUrl, callOperation, CallError, HARD_MAX_BYTES, problemFields, type CallDeps } from "../api/client.js";
import { gateCall } from "../api/client-gate.js";
import { dataexchangeGuard } from "../api/dataexchange-guard.js";
import { assertShareable, expandPath, FileError, writeLocalFile } from "./files.js";
import { NeedsLoginError } from "../auth/session.js";
import { checkConfirmToken, issueConfirmToken } from "./confirm.js";
import { localize } from "../i18n.js";
import { describe, getOperation, products, searchOperations, summarize } from "./catalog.js";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ ...text(localize(message)), isError: true });

const INLINE_BINARY_MAX = 256 * 1024;
const scalar = z.union([z.string(), z.number(), z.boolean()]);

export function registerGenericTools(server: McpServer, deps: (signal?: AbortSignal) => CallDeps): void {
  server.registerTool(
    "datev_search_operations",
    {
      title: "Search DATEV API operations",
      description:
        "Find DATEV API operations (accounting, payroll/HR, documents, master data, tax, invoices) by keywords. Returns operation ids to use with datev_describe_operation and datev_call.",
      inputSchema: {
        query: z.string().describe("Keywords, e.g. 'list clients', 'upload document', 'payroll report'"),
        product: z.string().optional().describe(`Limit to one product. One of: ${products().join(", ")}`),
        writes_only: z.boolean().optional().describe("Only operations that change data"),
        include_health: z.boolean().optional().describe("Also return the health check operations, left out by default"),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, product, writes_only, include_health, limit }) => {
      const hits = searchOperations(query, { product, writesOnly: writes_only, includeHealth: include_health, limit });
      return text(hits.length ? hits.map(summarize) : "No matching DATEV operations. Try other keywords or drop the product filter.");
    },
  );

  server.registerTool(
    "datev_describe_operation",
    {
      title: "Describe a DATEV API operation",
      description: "Show the parameters, request body schema, scopes and servers of one DATEV operation before calling it.",
      inputSchema: { operation_id: z.string().describe("Id from datev_search_operations") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ operation_id }) => {
      const op = getOperation(operation_id);
      return op ? text(describe(op)) : fail(`Unknown operation "${operation_id}". Use datev_search_operations first.`);
    },
  );

  server.registerTool(
    "datev_call",
    {
      title: "Call a DATEV API operation",
      description:
        "Call a DATEV operation by id. Operations that need a file upload are refused; use datev_upload_file (or datev_upload_extf for EXTF). Read operations run directly. Operations that change data return a preview and a confirm_token first, and only run when called again with confirm: true and that token.",
      inputSchema: {
        operation_id: z.string(),
        path_params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        query: z.record(z.string(), z.union([scalar, z.array(z.union([z.string(), z.number()]))])).optional(),
        headers: z.record(z.string(), z.string()).optional().describe("Header parameters the operation declares, e.g. Filename"),
        body: z.unknown().optional().describe("JSON body, or a string for text content types"),
        content_type: z.string().optional(),
        save_to: z.string().optional().describe("Absolute path to save a binary answer (PDF, image) to, byte for byte"),
        overwrite: z.boolean().optional().describe("Allow save_to to replace an existing file"),
        confirm: z.boolean().optional().describe("Must be true to run an operation that changes data"),
        confirm_token: z.string().optional().describe("The token returned by the preview of this exact call"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ operation_id, path_params, query, headers, body, content_type, save_to, overwrite, confirm, confirm_token }, extra) => {
      const op = getOperation(operation_id);
      if (!op) return fail(`Unknown operation "${operation_id}". Use datev_search_operations first.`);
      const input = { pathParams: path_params, query: query as Record<string, string>, headers, body, contentType: content_type };
      const d = deps(extra.signal);
      const fingerprint = { tool: "datev_call", env: d.env, operation_id, path_params, query, headers, body, content_type };
      try {
        if (save_to) assertShareable(expandPath(save_to)); // never into ~/.ssh, a dotfile or a key file
        // DATEV's permission checks run before any data moves, also through this generic tool.
        const pp = (path_params ?? {}) as Record<string, string | number>;
        if (op.product === "accounting-dataexchange" && pp.clientId !== undefined && op.id !== "accounting-dataexchange.getfiscalyears")
          await dataexchangeGuard(String(pp.clientId), pp.fiscalYearId === undefined ? undefined : String(pp.fiscalYearId), d);
        const client = await gateCall(op, path_params, query as Record<string, unknown> | undefined, d);
        if (op.write && confirm !== true) {
          const url = buildUrl(op, d.env, input);
          const sentHeaders = buildHeaders(op, input);
          return text({
            preview: true,
            note: `This ${op.method.toUpperCase()} changes data in DATEV ${d.env}. Nothing was sent. Show this to the user and call again with confirm: true and the confirm_token once they agree.`,
            method: op.method.toUpperCase(),
            url: url.toString(),
            ...(client ? { client } : {}),
            // Every header the caller set, because some decide where DATEV delivers the result (Target-System, Notify-Url).
            ...(Object.keys(sentHeaders).length ? { headers: sentHeaders } : {}),
            body,
            confirm_token: issueConfirmToken(fingerprint),
          });
        }
        if (op.write) {
          const refused = checkConfirmToken(confirm_token, fingerprint);
          if (refused) return fail(refused);
          const summary = [`${op.method.toUpperCase()} ${op.id}`, buildUrl(op, d.env, input).toString(), path_params && `ids: ${JSON.stringify(path_params)}`, query && `query: ${JSON.stringify(query)}`, headers && `headers: ${JSON.stringify(headers)}`, body !== undefined && `body: ${JSON.stringify(body).slice(0, 1500)}`].filter(Boolean).join("\n");
          const denied = await humanApproval(server, d.env, summary);
          if (denied) return fail(denied);
        }
        const { bytes, ...r } = await callOperation(op, input, d);
        const out: Record<string, unknown> = { ...r, env: d.env, ...(r.status >= 400 ? problemFields(r.status, r.body, op.id) : {}) };
        // Binary answers are kept byte-exact: saved to a file, or returned as base64 when small.
        if (bytes) {
          if (save_to && r.status < 400 && !r.truncated) out.saved_to = writeLocalFile(save_to, bytes, overwrite === true);
          else if (bytes.length <= INLINE_BINARY_MAX && !r.truncated) out.base64 = Buffer.from(bytes).toString("base64");
          else out.note = r.truncated ? `The file is larger than ${(r.body as { cut_at_bytes?: number }).cut_at_bytes ?? HARD_MAX_BYTES} bytes and was not read completely. Nothing was saved.` : "Binary answer too large to show. Call again with save_to to store it as a file.";
        }
        return r.status >= 400 ? { ...text(out), isError: true } : text(out);
      } catch (e) {
        if (e instanceof NeedsLoginError || e instanceof CallError || e instanceof FileError) return fail(e.message);
        return fail(`DATEV call failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
