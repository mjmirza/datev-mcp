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
  // DATEV_CLIENT_SECRET is set for a Confidential client and left out for a Public one. In production a local
  // app with an http://localhost redirect must be a Public client: DATEV blocks localhost redirects for Confidential ones.
  if (!env.DATEV_CLIENT_ID?.trim()) throw new Error("Missing DATEV_CLIENT_ID. Provide it via your secret manager or environment.");
  const secret = env.DATEV_CLIENT_SECRET?.trim() || undefined;
  const datevEnv = parseEnv(env.DATEV_ENV?.trim() || undefined);
  const scopes = env.DATEV_SCOPES?.trim() ? env.DATEV_SCOPES.split(/[\s+]+/).filter(Boolean) : undefined;
  return {
    env: datevEnv,
    endpoints: ENDPOINTS[datevEnv],
    creds: { clientId: (env.DATEV_CLIENT_ID as string).trim(), ...(secret ? { clientSecret: secret } : {}) },
    services: env.DATEV_MCP_SERVICES?.trim() || undefined,
    scopes,
  };
}
