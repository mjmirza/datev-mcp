import { iso, redactHeaders, type HttpLogEntry } from "../api/http-log.js";
import type { TokenCallLog } from "../auth/token-client.js";

/** Turns a token, refresh or revoke call into a line of the HTTP log. Bodies are never logged: they carry codes and tokens. */
export const tokenLog =
  (write: (e: HttpLogEntry) => void) =>
  (e: TokenCallLog): void =>
    write({
      ts_request: iso(),
      ts_response: iso(),
      method: "POST",
      url: e.url,
      ...(e.status !== undefined ? { status: e.status, status_text: e.statusText, response_headers: redactHeaders(e.headers) } : {}),
      ...(e.error ? { error: e.error } : {}),
    });
