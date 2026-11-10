import type { FetchLike } from "../../src/auth/token-client.js";
import { clearDataexchangeCache } from "../../src/api/dataexchange-guard.js";

// Answers the checks DATEV's Export rules put before every Datenservice Export call, so a test
// can focus on the call it is about. The permission and fiscal year answers can be overridden.
export interface Basics {
  services?: string[];
  fiscalYears?: string[];
  settings?: Record<string, unknown>;
  /** Let the test's own fake answer the fiscal year list. */
  passFiscalYears?: boolean;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function withDatevBasics(inner: FetchLike, b: Basics = {}): FetchLike {
  clearDataexchangeCache();
  const years = b.fiscalYears ?? ["20230101", "20230701", "20240701", "20260101", "20260102"];
  return async (u, init) => {
    const url = new URL(String(u));
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.hostname.startsWith("accounting-clients") && /\/clients\/[^/]+$/.test(url.pathname))
      return json(200, { name: "Muster GmbH", consultant_number: 455148, client_number: 1, services: (b.services ?? ["Datenservice Export Rechnungswesen"]).map((name) => ({ name })) });
    if (method === "GET" && /\/fiscal-years\/\d+$/.test(url.pathname))
      return json(200, b.settings ?? { yearBegin: "2023-07-01", yearEnd: "2024-06-30", accountLength: 4, accountSystem: 3, currencyCode: "EUR", nationalRight: "DE" });
    if (method === "GET" && url.pathname.endsWith("/fiscal-years") && !b.passFiscalYears) return json(200, years.map(Number));
    return inner(u, init);
  };
}
