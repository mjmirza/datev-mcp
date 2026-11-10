import { callOperation, CallError, problemText, type CallDeps } from "./client.js";
import { getOperation } from "../tools/catalog.js";

/** DATEV's page where a customer orders and switches on a data service. DATEV asks apps to show it. */
const DATEV_SETUP_LINK = "http://go.datev.de/datenservices-einrichten";
/** DATEV's order page for Datenservice Export Rechnungswesen, named in that service's rules. */
const DX_ORDER_LINK = "https://www.datev.de/web/de/shop/produkt-details/datev-datenservice-export-rechnungswesen-92913";

/** Service names as DATEV's accounting-clients API writes them in a client's "services" array. */
export type ClientService = "Belegbilderservice" | "Buchungsdatenservice" | "Rechnungsdatenservice 1.0" | "Datenservice Export Rechnungswesen";

export interface PermittedClient {
  name?: string;
  consultant_number?: number;
  client_number?: number;
  services: string[];
}

class PermissionError extends CallError {}

/** Before any transfer DATEV requires checking that the client switched the data service on (GET /clients/{client-id}). */
// Without it the call is refused with DATEV's setup link; for the Export service DATEV also requires revoking both tokens.
export async function requireClientService(
  clientId: string,
  anyOf: ClientService[],
  deps: CallDeps,
  deadline?: number,
): Promise<PermittedClient> {
  const op = getOperation("accounting-clients.getclient");
  if (!op) throw new CallError("The accounting-clients operation index is missing. Run npm run specs.");
  // The check reads the whole answer whatever the caller's display limit; a cut answer proves nothing.
  const checkDeps = { ...deps, maxBodyChars: Math.max(deps.maxBodyChars ?? 0, 100_000), ...(deadline ? { deadlineMs: Math.max(1000, deadline - Date.now()) } : {}) };
  const r = await callOperation(op, { pathParams: { "client-id": clientId } }, checkDeps);
  if (r.truncated) throw new CallError("DATEV's client answer was cut off, so the data service permission could not be checked. Nothing was sent.");
  const body = r.body && typeof r.body === "object" && !Array.isArray(r.body) ? (r.body as Record<string, unknown>) : undefined;
  const services = Array.isArray(body?.services) ? (body.services as { name?: unknown }[]).map((s) => (typeof s.name === "string" ? s.name : "")).filter(Boolean) : [];
  // Only a 403 or a 200 without the service says the permission is missing. Any other answer (a server error,
  // a timeout, a bad token, an unknown client) is reported and never ends the connection.
  if (r.status !== 403 && (r.status < 200 || r.status >= 300))
    throw new CallError(`DATEV could not confirm the client's data services right now (HTTP ${r.status}). Nothing was sent. Try again later.${r.status >= 400 ? ` ${problemText(r.status, r.body)}` : ""}`);
  const ok = r.status >= 200 && r.status < 300 && anyOf.some((s) => services.includes(s));
  if (!ok) {
    const dx = anyOf.includes("Datenservice Export Rechnungswesen");
    // DX-02: a 403 or a 200 without the service is a missing permission, and both tokens are revoked at once.
    const ended = dx && deps.onMissingPermission ? await deps.onMissingPermission().catch((e: Error) => ` Ending the connection failed (${e.message}).`) : "";
    const who = body?.name ? `"${String(body.name)}"` : "This client";
    const why = r.status >= 400 ? `DATEV answered HTTP ${r.status} for this client` : `${who} has not switched on ${anyOf.join(" or ")}`;
    throw new PermissionError(
      `${why}. Nothing was sent. The client or their tax advisor switches the data service on at DATEV, see ${dx ? DX_ORDER_LINK : DATEV_SETUP_LINK}.${ended}`,
    );
  }
  return {
    name: typeof body?.name === "string" ? body.name : undefined,
    consultant_number: typeof body?.consultant_number === "number" ? body.consultant_number : undefined,
    client_number: typeof body?.client_number === "number" ? body.client_number : undefined,
    services,
  };
}
