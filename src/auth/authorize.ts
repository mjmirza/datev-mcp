import type { Endpoints } from "./endpoints.js";

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  nonce: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl(ep: Endpoints, p: AuthorizeParams): string {
  if (p.state.length < 20 || p.nonce.length < 20) throw new Error("DATEV requires state and nonce of at least 20 characters");
  const scopes = p.scopes.includes("openid") ? p.scopes : ["openid", ...p.scopes];
  const url = new URL(ep.authorize);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: scopes.join(" "),
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    enableWindowsSso: "true",
  }).toString();
  return url.toString();
}
