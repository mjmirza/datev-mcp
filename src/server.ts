import { servicesOfSession } from "./auth/services.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { revokePending } from "./auth/pending-revoke.js";
import { clearDataexchangeCache } from "./api/dataexchange-guard.js";
import { clearClientGate } from "./api/client-gate.js";
import { endForMissingPermission } from "./setup/disconnect.js";
import { tokenLog } from "./setup/token-log.js";
import { writeHttpLog, type HttpLogEntry } from "./api/http-log.js";
import { Session } from "./auth/session.js";
import { TokenStore } from "./auth/token-store.js";
import type { Config } from "./config.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerAccountingTools } from "./tools/accounting.js";
import { registerClientCheckTool } from "./tools/client-check.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerExtfTools } from "./tools/extf.js";
import { registerGenericTools } from "./tools/generic.js";
import { registerUploadTools } from "./tools/upload.js";

const VERSION = "0.0.1";

function chosenServices(store: TokenStore): ReadonlySet<string> | undefined {
  try {
    const s = servicesOfSession(store.read());
    return s ? new Set(s) : undefined;
  } catch {
    return undefined; // the token lookup reports the real problem
  }
}

// The scopes DATEV actually granted to the saved login, or the ones requested if DATEV did not say.
function grantedScopes(store: TokenStore): ReadonlySet<string> | undefined {
  try {
    const s = store.read();
    const list = s?.tokens.scope?.split(/\s+/).filter(Boolean) ?? s?.scopes;
    return list ? new Set(list) : undefined;
  } catch {
    return undefined; // the token lookup reports the real problem
  }
}

function createServer(cfg: Config): McpServer {
  const server = new McpServer({ name: "datev-mcp", version: VERSION });
  const store = new TokenStore(cfg.env);
  const httpLog = (e: HttpLogEntry) => writeHttpLog(e);
  const session = new Session(store, cfg.endpoints, cfg.creds, { log: httpLog });
  // DATEV's Export rules: a missing permission revokes both tokens at once.
  const onMissingPermission = async () => {
    clearDataexchangeCache();
    clearClientGate();
    return endForMissingPermission(cfg, { store, httpLog });
  };
  const identity = () => {
    try {
      return store.read()?.identity?.sub;
    } catch {
      return undefined;
    }
  };
  const deps = (signal?: AbortSignal) => ({ env: cfg.env, creds: cfg.creds, token: () => session.accessToken(), signal, httpLog, grantedScopes: grantedScopes(store), chosenServices: chosenServices(store), onMissingPermission, identity });
  // A refresh token an earlier login could not revoke is retried in the background: DATEV allows only one.
  void revokePending(store, cfg.endpoints, cfg.creds, { log: tokenLog(httpLog) }).catch(() => undefined);
  registerConnectionTools(server, cfg, store, httpLog);
  registerGenericTools(server, deps);
  registerAccountTools(server, deps);
  registerAccountingTools(server, deps);
  registerExtfTools(server, deps);
  registerDocumentTools(server, deps);
  registerUploadTools(server, deps);
  registerClientCheckTool(server, deps);
  return server;
}

export async function runStdio(cfg: Config): Promise<void> {
  await createServer(cfg).connect(new StdioServerTransport());
}
