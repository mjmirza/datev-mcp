import { ENDPOINTS, parseEnv, type DatevEnv, type Endpoints } from "./auth/endpoints.js";
import type { ClientCredentials } from "./auth/token-client.js";

export interface Config {
  env: DatevEnv;
  endpoints: Endpoints;
  creds: ClientCredentials;
  /** DATEV_MCP_SERVICES: the data services to connect, as product ids (see "datev-mcp services"). */
  services?: string;
  /** DATEV_SCOPES: explicit scopes for experts. Used only when no services are chosen. */
  scopes?: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ["DATEV_CLIENT_ID", "DATEV_CLIENT_SECRET"].filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing ${missing.join(" and ")}. Provide them via your secret manager or environment.`);
  const datevEnv = parseEnv(env.DATEV_ENV?.trim() || undefined);
  const scopes = env.DATEV_SCOPES?.trim() ? env.DATEV_SCOPES.split(/[\s+]+/).filter(Boolean) : undefined;
  return {
    env: datevEnv,
    endpoints: ENDPOINTS[datevEnv],
    creds: { clientId: (env.DATEV_CLIENT_ID as string).trim(), clientSecret: env.DATEV_CLIENT_SECRET as string },
    services: env.DATEV_MCP_SERVICES?.trim() || undefined,
    scopes,
  };
}
