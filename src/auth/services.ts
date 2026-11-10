import index from "../data/operations.json" with { type: "json" };
import type { OperationIndex } from "../spec/types.js";

// DATEV asks apps to name its data services the way DATEV does and to request only the scopes of the
// services the customer chose. Labels are the DATEV-Datenservice names from the Schnittstellenvorgaben page.
// Sources: datev.de/web/de/berufsgruppenuebergreifend/mydatev/datenservices (the DATEV-Datenservices list) and the
// developer portal product list. APIs that are no data service show the product and API name as DATEV writes them.
const SERVICES: Record<string, { label: string; group: "Rechnungswesen" | "Personalwirtschaft" | "Steuern" | "Sonstiges" }> = {
  "accounting-clients": { label: "accounting:clients (DATEV Rechnungswesen)", group: "Rechnungswesen" },
  "accounting-documents": { label: "Belegbilderservice Rechnungswesen", group: "Rechnungswesen" },
  "accounting-extf-files": { label: "Buchungsdatenservice und DATEV-Format", group: "Rechnungswesen" },
  "accounting-dxso-jobs": { label: "Rechnungsdatenservice 1.0 und DXSO-Format", group: "Rechnungswesen" },
  "accounting-dataexchange": { label: "Datenservice Export Rechnungswesen", group: "Rechnungswesen" },
  "traffiqx-invoice": { label: "TRAFFIQX® Invoice API für DATEV E-Rechnungsplattform", group: "Rechnungswesen" },
  "hr-files": { label: "Lohnimportdatenservice und ASCII-Format", group: "Personalwirtschaft" },
  "hr-payrollreports": { label: "Lohnauswertungsdatenservice", group: "Personalwirtschaft" },
  "hr-exports": { label: "Lohnergebnisdatenservice", group: "Personalwirtschaft" },
  "hr-exchange": { label: "Lohnaustauschdatenservice (hr:exchange)", group: "Personalwirtschaft" },
  "eau-api": { label: "Lohnaustauschdatenservice (hr:eau)", group: "Personalwirtschaft" },
  "hr-documents": { label: "Datenservice Dokumente Personalwirtschaft", group: "Personalwirtschaft" },
  "my-tax-income-tax-documents": { label: "Belegbilderservice Einkommensteuer", group: "Steuern" },
  "property-tax-file-upload-api": { label: "Dokumentenservice Grundsteuer", group: "Steuern" },
  "master-data-master-clients": { label: "DATEV Basisdaten online (master-data:master-clients)", group: "Sonstiges" },
  // No OAuth scope of their own, so only the choice at login keeps them out. Labels are DATEV's API titles.
  cashregister: { label: "cashregister:import", group: "Sonstiges" },
  "smarttransfer-inbound": { label: "smarttransfer:inbound", group: "Sonstiges" },
  "smarttransfer-outbound": { label: "smarttransfer:outbound", group: "Sonstiges" },
};

// Every accounting service works on a client the user must have access to, which DATEV says to check in the client list.
const NEEDS_CLIENT_LIST = new Set(["accounting-documents", "accounting-extf-files", "accounting-dxso-jobs", "accounting-dataexchange"]);

const ops = (index as OperationIndex).operations;

function scopesOf(product: string): string[] {
  const s = new Set<string>();
  for (const o of ops) if (o.product === product || o.product === `${product}-health`) for (const sc of o.scopes) if (sc !== "datev:all") s.add(sc);
  return [...s].sort();
}

export class ServiceSelectionError extends Error {}

/** Resolves a comma list of product ids into the chosen services and the exact scopes they need. */
export function selectServices(list: string): { services: string[]; scopes: string[]; added: string[] } {
  const asked = list.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (!asked.length) throw new ServiceSelectionError(`Choose at least one DATEV data service. ${serviceList()}`);
  const unknown = asked.filter((p) => !Object.hasOwn(SERVICES, p));
  if (unknown.length) throw new ServiceSelectionError(`Unknown data service ${unknown.map((u) => `"${u}"`).join(", ")}. ${serviceList()}`);
  const services = new Set(asked);
  if (asked.some((p) => NEEDS_CLIENT_LIST.has(p))) services.add("accounting-clients");
  const scopes = new Set<string>(["openid"]);
  for (const p of services) for (const sc of scopesOf(p)) scopes.add(sc);
  return { services: [...services].sort(), scopes: [...scopes].sort(), added: [...services].filter((p) => !asked.includes(p)) };
}

/** For an expert scope list: the services it holds any scope of. A service without scopes needs --services.
 *  Each operation's own scopes are still checked, so this only bounds what has no scope of its own. */
export function servicesForScopes(scopes: string[]): string[] {
  const have = new Set(scopes);
  // A scope several services share, like openid, says nothing about which service was chosen.
  const owners = new Map<string, number>();
  for (const p of Object.keys(SERVICES)) for (const sc of scopesOf(p)) owners.set(sc, (owners.get(sc) ?? 0) + 1);
  return Object.keys(SERVICES)
    .filter((p) => {
      const own = scopesOf(p).filter((sc) => owners.get(sc) === 1);
      return own.length ? own.some((sc) => have.has(sc)) : scopesOf(p).length > 0 && scopesOf(p).every((sc) => have.has(sc));
    })
    .sort();
}

/** The services a saved login covers: as chosen, or derived from its scopes. Unknown means none, so it fails closed. */
export function servicesOfSession(s: { services?: string[]; scopes?: string[]; tokens?: { scope?: string } } | undefined): string[] | undefined {
  if (!s) return undefined;
  if (s.services?.length) return s.services;
  const granted = s.scopes ?? s.tokens?.scope?.split(/\s+/).filter(Boolean);
  return granted ? servicesForScopes(granted) : [];
}

export function serviceList(): string {
  return `Available, as --services a,b,c: ${Object.entries(SERVICES)
    .map(([id, s]) => `${id} (${s.label})`)
    .join("; ")}.`;
}

export const serviceLabel = (id: string) => SERVICES[id]?.label ?? id;

// Health endpoints whose product id is not the service id with "-health" appended.
const HEALTH_OF: Record<string, string> = { "my-tax-mytax-income-tax-documents-health": "my-tax-income-tax-documents" };

/** The data service an operation's product belongs to, as chosen at login. */
export const serviceOfProduct = (product: string): string => HEALTH_OF[product] ?? product.replace(/-health$/, "");
