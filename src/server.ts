import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Session } from "./auth/session.js";
import { TokenStore } from "./auth/token-store.js";
import type { Config } from "./config.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerAccountingTools } from "./tools/accounting.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerExtfTools } from "./tools/extf.js";
import { registerGenericTools } from "./tools/generic.js";

export const VERSION = "0.0.1";

export function createServer(cfg: Config): McpServer {
  const server = new McpServer({ name: "datev-mcp", version: VERSION });
  const session = new Session(new TokenStore(cfg.env), cfg.endpoints, cfg.creds);
  const deps = () => ({ env: cfg.env, creds: cfg.creds, token: () => session.accessToken() });
  registerGenericTools(server, deps);
  registerAccountTools(server, deps);
  registerAccountingTools(server, deps);
  registerExtfTools(server, deps);
  registerDocumentTools(server, deps);
  return server;
}

export async function runStdio(cfg: Config): Promise<void> {
  await createServer(cfg).connect(new StdioServerTransport());
}
