import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildUrl, callOperation, CallError, type CallDeps } from "../api/client.js";
import { NeedsLoginError } from "../auth/session.js";
import { describe, getOperation, products, searchOperations, summarize } from "./catalog.js";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ ...text(message), isError: true });

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export function registerGenericTools(server: McpServer, deps: () => CallDeps): void {
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
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, product, writes_only, limit }) => {
      const hits = searchOperations(query, { product, writesOnly: writes_only, limit });
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
        "Call any DATEV operation by id. Read operations run directly. Operations that change data return a preview first and only run when called again with confirm: true.",
      inputSchema: {
        operation_id: z.string(),
        path_params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        query: z.record(z.string(), z.union([scalar, z.array(z.union([z.string(), z.number()]))])).optional(),
        body: z.unknown().optional().describe("JSON body, or a string for text content types"),
        content_type: z.string().optional(),
        confirm: z.boolean().optional().describe("Must be true to run an operation that changes data"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ operation_id, path_params, query, body, content_type, confirm }) => {
      const op = getOperation(operation_id);
      if (!op) return fail(`Unknown operation "${operation_id}". Use datev_search_operations first.`);
      const input = { pathParams: path_params, query: query as Record<string, string>, body, contentType: content_type };
      const d = deps();
      try {
        if (op.write && confirm !== true) {
          const url = buildUrl(op, d.env, input);
          return text({
            preview: true,
            note: `This ${op.method.toUpperCase()} changes data in DATEV ${d.env}. Nothing was sent. Show this to the user and call again with confirm: true once they agree.`,
            method: op.method.toUpperCase(),
            url: url.toString(),
            body,
          });
        }
        const r = await callOperation(op, input, d);
        const out = { ...r, env: d.env };
        return r.status >= 400 ? { ...text(out), isError: true } : text(out);
      } catch (e) {
        if (e instanceof NeedsLoginError || e instanceof CallError) return fail(e.message);
        return fail(`DATEV call failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
