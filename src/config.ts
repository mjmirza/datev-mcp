import { ENDPOINTS, parseEnv, type DatevEnv, type Endpoints } from "./auth/endpoints.js";
import type { ClientCredentials } from "./auth/token-client.js";
import index from "./data/operations.json" with { type: "json" };
import type { OperationIndex } from "./spec/types.js";

export interface Config {
  env: DatevEnv;
  endpoints: Endpoints;
  creds: ClientCredentials;
  scopes: string[];
}

function allIndexScopes(): string[] {
  const s = new Set<string>(["openid"]);
  for (const op of (index as OperationIndex).operations) for (const sc of op.scopes) if (sc !== "datev:all") s.add(sc);
  return [...s].sort();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ["DATEV_CLIENT_ID", "DATEV_CLIENT_SECRET"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(" and ")}. Provide them via your secret manager or environment.`);
  const datevEnv = parseEnv(env.DATEV_ENV);
  const scopes = env.DATEV_SCOPES ? env.DATEV_SCOPES.split(/[\s+]+/).filter(Boolean) : allIndexScopes();
  return {
    env: datevEnv,
    endpoints: ENDPOINTS[datevEnv],
    creds: { clientId: env.DATEV_CLIENT_ID as string, clientSecret: env.DATEV_CLIENT_SECRET as string },
    scopes,
  };
}
