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
  clientSecret: string;
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
  const basic = Buffer.from(`${encodeURIComponent(creds.clientId)}:${encodeURIComponent(creds.clientSecret)}`).toString("base64");
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      // A redirect would carry the client secret and the code or refresh token to another host.
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new TokenError("timeout", "DATEV token endpoint did not answer in time");
    opts.log?.({ url, status: undefined, error: e instanceof Error ? e.message : String(e) });
    throw new TokenError("network", `Could not reach the DATEV token endpoint: ${e instanceof Error ? e.message : String(e)}`);
  }
  let body: RawToken;
  try {
    body = (await res.json()) as RawToken;
    opts.log?.({ url, status: res.status, statusText: res.statusText, headers: res.headers, error: str(body.error) });
  } catch {
    throw new TokenError("bad_response", `DATEV token endpoint returned HTTP ${res.status} with a non-JSON body`, res.status);
  }
  if (!res.ok || str(body.error)) {
    const code = str(body.error) ?? `http_${res.status}`;
    const detail = str(body.error_description);
    throw new TokenError(code, `DATEV rejected the token request: ${code}${detail ? ` (${detail})` : ""}`, res.status);
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
  const basic = Buffer.from(`${encodeURIComponent(creds.clientId)}:${encodeURIComponent(creds.clientSecret)}`).toString("base64");
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(revokeUrl, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: hint }).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    opts.log?.({ url: revokeUrl, error: e instanceof Error ? e.message : String(e) });
    throw new TokenError("network", `Could not reach DATEV to revoke the ${hint === "refresh_token" ? "refresh" : "access"} token: ${e instanceof Error ? e.message : String(e)}`);
  }
  await res.body?.cancel();
  opts.log?.({ url: revokeUrl, status: res.status, statusText: res.statusText, headers: res.headers });
  if (!res.ok) throw new TokenError(`http_${res.status}`, `DATEV refused to revoke the ${hint === "refresh_token" ? "refresh" : "access"} token (HTTP ${res.status})`, res.status);
}
