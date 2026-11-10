import { createHash, createPublicKey, verify, type webcrypto } from "node:crypto";
import { iso, redactHeaders, type HttpLogEntry } from "../api/http-log.js";
import type { FetchLike } from "./token-client.js";

class IdTokenError extends Error {
  constructor(message: string) {
    super(`The DATEV login answer failed the ID token check: ${message}`);
    this.name = "IdTokenError";
  }
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  azp?: string;
  [k: string]: unknown;
}

interface Expect {
  issuer: string;
  clientId: string;
  nonce: string;
  jwksUrl: string;
  fetch?: FetchLike;
  now?: () => number;
  /** The access token issued with the ID token. When the ID token carries at_hash, it must match it. */
  accessToken?: string;
  /** Every call to DATEV goes into the technical HTTP log, the signing-key request too. */
  log?: (e: HttpLogEntry) => void;
}

const SKEW_S = 300;

function part(segment: string | undefined, what: string): Record<string, unknown> {
  if (!segment) throw new IdTokenError(`the ${what} is missing`);
  try {
    const v = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch {
    throw new IdTokenError(`the ${what} is not valid JSON`);
  }
}

async function signingKey(jwksUrl: string, kid: string, doFetch: FetchLike, log?: (e: HttpLogEntry) => void): Promise<webcrypto.JsonWebKey> {
  const headers = { accept: "application/json" };
  const base = { ts_request: iso(), method: "GET", url: jwksUrl, request_headers: headers };
  let res: Response;
  try {
    res = await doFetch(jwksUrl, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    log?.({ ...base, ts_response: iso(), error: e instanceof Error ? e.message : String(e) });
    throw new IdTokenError(`DATEV's signing keys could not be loaded (${e instanceof Error ? e.message : String(e)})`);
  }
  log?.({ ...base, ts_response: iso(), status: res.status, status_text: res.statusText, response_headers: redactHeaders(res.headers) });
  if (!res.ok) throw new IdTokenError(`DATEV's signing keys answered HTTP ${res.status}`);
  const body = (await res.json().catch(() => undefined)) as { keys?: (webcrypto.JsonWebKey & { kid?: string; use?: string })[] } | undefined;
  const key = body?.keys?.find((k) => k.kid === kid && k.kty === "RSA" && (k.use === undefined || k.use === "sig"));
  if (!key) throw new IdTokenError(`no DATEV signing key with id "${kid}"`);
  return key;
}

// OpenID Connect Core 3.1.3.7: signature, issuer, audience, authorized party, expiry, issue time and nonce.
export async function verifyIdToken(idToken: string, want: Expect): Promise<IdTokenClaims> {
  const segs = idToken.split(".");
  if (segs.length !== 3) throw new IdTokenError("it is not a signed JWT");
  const header = part(segs[0], "header");
  const claims = part(segs[1], "payload") as Partial<IdTokenClaims>;
  if (header.alg !== "RS256") throw new IdTokenError(`unexpected signature algorithm "${String(header.alg)}"`);
  if (typeof header.kid !== "string" || header.kid === "") throw new IdTokenError("the header names no signing key");
  const jwk = await signingKey(want.jwksUrl, header.kid, want.fetch ?? fetch, want.log);
  const ok = verify("RSA-SHA256", Buffer.from(`${segs[0]}.${segs[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(segs[2]!, "base64url"));
  if (!ok) throw new IdTokenError("the signature does not match DATEV's key");
  if (claims.iss !== want.issuer) throw new IdTokenError(`issuer "${String(claims.iss)}" is not "${want.issuer}"`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(want.clientId)) throw new IdTokenError("the token was issued for a different app");
  // OIDC Core 3.1.3.7: azp is required with several audiences, and when present it must name this app.
  if ((aud.length > 1 || claims.azp !== undefined) && claims.azp !== want.clientId) throw new IdTokenError("the authorized party is a different app");
  // OIDC Core 3.3.2.11: at_hash is the left half of SHA-256 over the access token, base64url.
  const atHash = (claims as Record<string, unknown>).at_hash;
  if (typeof atHash === "string" && want.accessToken) {
    const digest = createHash("sha256").update(want.accessToken).digest();
    if (digest.subarray(0, digest.length / 2).toString("base64url") !== atHash) throw new IdTokenError("the access token does not belong to this ID token");
  }
  const now = Math.floor((want.now ?? Date.now)() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < now) throw new IdTokenError("it has expired");
  if (typeof claims.iat !== "number" || claims.iat - SKEW_S > now) throw new IdTokenError("it was issued in the future");
  if (typeof claims.nbf === "number" && claims.nbf - SKEW_S > now) throw new IdTokenError("it is not valid yet");
  if (claims.nonce !== want.nonce) throw new IdTokenError("the nonce does not match this login");
  if (typeof claims.sub !== "string" || claims.sub === "") throw new IdTokenError("it names no user");
  return claims as IdTokenClaims;
}
