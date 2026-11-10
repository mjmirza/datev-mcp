import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallError, type CallDeps } from "../api/client.js";
import { checkClient, CLIENT_CHECK, SETUP_LINK } from "../api/client-gate.js";
import { NeedsLoginError } from "../auth/session.js";
import { localize } from "../i18n.js";

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ content: [{ type: "text" as const, text: localize(m) }], isError: true });

/** DATEV's data services that check a client by consultant and client number, keyed by the product id. */
const SERVICES = Object.keys(CLIENT_CHECK) as [string, ...string[]];

export function registerClientCheckTool(server: McpServer, deps: (signal?: AbortSignal) => CallDeps): void {
  server.registerTool(
    "datev_check_client",
    {
      title: "Check access to a DATEV client for a data service",
      description: `Check, with the consultant number and client number the person enters, that this login may use a DATEV data service for that client. Shows the company name and numbers on success, and a clear reason with DATEV's setup page (${SETUP_LINK}) on failure. Other tools run this check by themselves once a day.`,
      inputSchema: {
        data_service: z.enum(SERVICES).describe("The DATEV product, e.g. hr-exports or accounting-dxso-jobs"),
        consultant_number: z.number().int().min(1000).max(9_999_999).describe("Beraternummer, 4 to 7 digits"),
        client_number: z.number().int().min(1).max(99_999).describe("Mandantennummer, 1 to 5 digits"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ data_service, consultant_number, client_number }, extra) => {
      try {
        const client = await checkClient(data_service, `${consultant_number}-${client_number}`, deps(extra.signal), { fresh: true });
        return ok({ access: "granted", data_service, company: client.name, consultant_number: client.consultant_number ?? consultant_number, client_number: client.client_number ?? client_number, ...(client.access_granted ? { report_types_granted: client.access_granted } : {}) });
      } catch (e) {
        if (e instanceof CallError || e instanceof NeedsLoginError) return err(e.message);
        return err(`Failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
