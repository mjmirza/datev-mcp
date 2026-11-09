import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { connectionStatus } from "../setup/status.js";
import type { HttpLogEntry } from "../api/http-log.js";
import type { TokenStore } from "../auth/token-store.js";

export function registerConnectionTools(server: McpServer, cfg: Config, store: TokenStore, httpLog: (e: HttpLogEntry) => void): void {
  server.registerTool(
    "datev_connection_status",
    {
      description:
        'Shows the DATEV connection: active or inactive, the person who signed in, until when it is valid (TT.MM.JJJJ HH:MM), the connected data services, the error rate of the last 14 days and the link to manage connected apps at DATEV. Never returns a token. To connect run "datev-mcp login --services ..." in a terminal, to disconnect "datev-mcp disconnect".',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => ({ content: [{ type: "text" as const, text: JSON.stringify(await connectionStatus(cfg, { store, httpLog }), null, 2) }] }),
  );
}
