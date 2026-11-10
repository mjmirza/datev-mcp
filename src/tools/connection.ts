import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { messageLang } from "../i18n.js";
import { complianceView, renderCompliance } from "../setup/compliance.js";
import { connectionStatus, renderStatus } from "../setup/status.js";
import type { HttpLogEntry } from "../api/http-log.js";
import type { TokenStore } from "../auth/token-store.js";

export function registerConnectionTools(server: McpServer, cfg: Config, store: TokenStore, httpLog: (e: HttpLogEntry) => void): void {
  server.registerTool(
    "datev_connection_status",
    {
      description:
        'Shows the DATEV connection as DATEV asks apps to: active (AKTIV) or inactive (INAKTIV), the person who signed in, until when it is valid (TT.MM.JJJJ HH:MM), the connected data services, the error rate of the last 14 days and the link to manage connected apps at DATEV. Show the text part to the person as it is. Never returns a token. To connect run "datev-mcp login --services ..." in a terminal, to disconnect "datev-mcp disconnect".',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const st = await connectionStatus(cfg, { store, httpLog });
      return { content: [{ type: "text" as const, text: `${renderStatus(st, messageLang())}\n\n${JSON.stringify(st, null, 2)}` }] };
    },
  );
  server.registerTool(
    "datev_compliance",
    {
      description:
        "Shows how this installation meets DATEV's interface requirements: live checks (app type, technical HTTP log, error rate, refresh tokens, connected data services) and, for every DATEV requirement section, how many items are met, partial, open, not applicable or left to the app owner. Show it to the person as it is.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const lang = messageLang();
      return { content: [{ type: "text" as const, text: renderCompliance(complianceView(cfg, { store, lang }), lang) }] };
    },
  );
}
