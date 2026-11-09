import { iso, redactHeaders, type HttpLogEntry } from "../api/http-log.js";
import type { FetchLike } from "./token-client.js";

export interface UserInfo {
  sub?: string;
  name?: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** DATEV's userinfo answer, reduced to the user id and the full name DATEV asks apps to show in the connection status. */
export async function fetchUserInfo(
  url: string,
  accessToken: string,
  clientId: string,
  opts: { fetch?: FetchLike; log?: (e: HttpLogEntry) => void } = {},
): Promise<UserInfo> {
  const headers = { authorization: `Bearer ${accessToken}`, "X-DATEV-Client-Id": clientId, accept: "application/json" };
  const sentAt = Date.now();
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    opts.log?.({ ts_request: iso(sentAt), ts_response: iso(), method: "GET", url, request_headers: redactHeaders(headers), error: e instanceof Error ? e.message : String(e) });
    throw new Error(`DATEV's userinfo did not answer: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  opts.log?.({
    ts_request: iso(sentAt),
    ts_response: iso(),
    method: "GET",
    url,
    request_headers: redactHeaders(headers),
    status: res.status,
    status_text: res.statusText,
    response_headers: redactHeaders(res.headers),
    ...(res.ok ? {} : { response_body: text.slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`DATEV's userinfo answered HTTP ${res.status}`);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* no JSON: no name */
  }
  const parts = [str(body.given_name), str(body.family_name)].filter(Boolean).join(" ");
  return { sub: str(body.sub), name: str(body.name) ?? (parts || undefined) ?? str(body.preferred_username) };
}
