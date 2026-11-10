import { problemOf } from "../api/problem.js";
// DATEV token calls. Client auth is HTTP Basic. Never retried: codes and refresh tokens are
// single-use, and a retried refresh that already reached DATEV invalidates the whole session.

export type FetchLike = typeof fetch;

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  expiresAt: number;
  obtainedAt: number;
  /** When DATEV says the refresh token stops working, if it said so. */
  refreshExpiresAt?: number;
}

export class TokenError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TokenError";
  }
}

export interface ClientCredentials {
  clientId: string;
  /** Absent for a DATEV "Public" client: a local app that cannot keep a secret signs in with PKCE alone. */
  clientSecret?: string;
}

/** How the app identifies itself to the token and revoke endpoints: HTTP Basic for a Confidential client, client_id in the form for a Public one. */
function clientAuth(creds: ClientCredentials, form: Record<string, string>): { headers: Record<string, string>; form: Record<string, string> } {
  if (!creds.clientSecret) return { headers: {}, form: { ...form, client_id: creds.clientId } };
  const basic = Buffer.from(`${encodeURIComponent(creds.clientId)}:${encodeURIComponent(creds.clientSecret)}`).toString("base64");
  return { headers: { authorization: `Basic ${basic}` }, form };
}

interface RawToken {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  scope?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** One line for the technical HTTP log. Never contains a token, a code or the client secret. */
export interface TokenCallLog {
  url: string;
  /** When the request left, so the log shows request and answer time separately. */
  sentAt?: number;
  /** Request headers. The Basic authorization header is removed before it is written. */
  requestHeaders?: Record<string, string>;
  status?: number;
  statusText?: string;
  headers?: Headers;
  error?: string;
}

export interface TokenCallOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
  log?: (entry: TokenCallLog) => void;
}

export async function postToken(url: string, form: Record<string, string>, creds: ClientCredentials, opts: TokenCallOptions = {}): Promise<TokenSet> {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const auth = clientAuth(creds, form);
  const headers = { ...auth.headers, "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const call = { url, sentAt: Date.now(), requestHeaders: headers };
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers,
      body: new URLSearchParams(auth.form).toString(),
      // A redirect would carry the client secret and the code or refresh token to another host.
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    opts.log?.({ ...call, error: e instanceof Error ? e.message : String(e) });
    if (name === "TimeoutError" || name === "AbortError") throw new TokenError("timeout", "DATEV token endpoint did not answer in time");
    throw new TokenError("network", `Could not reach the DATEV token endpoint: ${e instanceof Error ? e.message : String(e)}`);
  }
  let body: RawToken;
  try {
    const parsed = (await res.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as RawToken;
  } catch {
    opts.log?.({ ...call, status: res.status, statusText: res.statusText, headers: res.headers, error: "non-JSON answer" });
    throw new TokenError("bad_response", `DATEV token endpoint returned HTTP ${res.status} with a non-JSON body`, res.status);
  }
  opts.log?.({ ...call, status: res.status, statusText: res.statusText, headers: res.headers, error: str(body.error) });
  if (!res.ok || str(body.error)) {
    const code = str(body.error) ?? `http_${res.status}`;
    const detail = str(body.error_description);
    const help = problemOf(body).help_url;
    throw new TokenError(code, `DATEV rejected the token request: ${code}${detail ? ` (${detail})` : ""}${help ? `. Help: ${help}` : ""}`, res.status);
  }
  const accessToken = str(body.access_token);
  if (!accessToken) throw new TokenError("bad_response", "DATEV token response has no access_token", res.status);
  const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 900;
  const refreshIn = typeof body.refresh_expires_in === "number" && body.refresh_expires_in > 0 ? body.refresh_expires_in : undefined;
  const t = now();
  return {
    accessToken,
    refreshToken: str(body.refresh_token),
    idToken: str(body.id_token),
    scope: str(body.scope),
    expiresAt: t + expiresIn * 1000,
    obtainedAt: t,
    ...(refreshIn ? { refreshExpiresAt: t + refreshIn * 1000 } : {}),
  };
}

export function exchangeCode(
  tokenUrl: string,
  args: { code: string; redirectUri: string; codeVerifier: string },
  creds: ClientCredentials,
  opts?: TokenCallOptions,
): Promise<TokenSet> {
  return postToken(tokenUrl, { grant_type: "authorization_code", code: args.code, redirect_uri: args.redirectUri, code_verifier: args.codeVerifier }, creds, opts);
}

export function refreshTokens(tokenUrl: string, refreshToken: string, creds: ClientCredentials, opts?: TokenCallOptions): Promise<TokenSet> {
  return postToken(tokenUrl, { grant_type: "refresh_token", refresh_token: refreshToken }, creds, opts);
}

// RFC 7009. DATEV answers 200 for a token it does not know, so a 200 means the token is no longer valid.
export async function revokeToken(
  revokeUrl: string,
  token: string,
  hint: "refresh_token" | "access_token",
  creds: ClientCredentials,
  opts: TokenCallOptions = {},
): Promise<void> {
  const auth = clientAuth(creds, { token, token_type_hint: hint });
  const headers = { ...auth.headers, "content-type": "application/x-www-form-urlencoded" };
  const call = { url: revokeUrl, sentAt: Date.now(), requestHeaders: headers };
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(revokeUrl, {
      method: "POST",
      headers,
      body: new URLSearchParams(auth.form).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    opts.log?.({ ...call, error: e instanceof Error ? e.message : String(e) });
    throw new TokenError("network", `Could not reach DATEV to revoke the ${hint === "refresh_token" ? "refresh" : "access"} token: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = res.ok ? (await res.body?.cancel(), "") : await res.text().catch(() => "");
  opts.log?.({ ...call, status: res.status, statusText: res.statusText, headers: res.headers });
  if (!res.ok) {
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    const help = problemOf(parsed).help_url;
    throw new TokenError(`http_${res.status}`, `DATEV refused to revoke the ${hint === "refresh_token" ? "refresh" : "access"} token (HTTP ${res.status})${help ? `. Help: ${help}` : ""}`, res.status);
  }
}
