import index from "../data/operations.json" with { type: "json" };
import type { OperationIndex } from "../spec/types.js";

// DATEV asks apps to name its data services the way DATEV does and to request only the scopes of the
// services the customer chose. Labels are DATEV's published service names; APIs without one show their API name.
const SERVICES: Record<string, { label: string; group: "Rechnungswesen" | "Personalwirtschaft" | "Steuern" | "Sonstiges" }> = {
  "accounting-clients": { label: "Online-API accounting-clients", group: "Rechnungswesen" },
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
  "my-tax-income-tax-documents": { label: "Belegbilderservice Einkommenssteuer", group: "Steuern" },
  "property-tax-file-upload-api": { label: "Online-API property-tax-file-upload", group: "Steuern" },
  "master-data-master-clients": { label: "Online-API master-data-master-clients", group: "Sonstiges" },
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
export function selectServices(list: string): { services: string[]; scopes: string[] } {
  const asked = list.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (!asked.length) throw new ServiceSelectionError(`Choose at least one DATEV data service. ${serviceList()}`);
  const unknown = asked.filter((p) => !Object.hasOwn(SERVICES, p));
  if (unknown.length) throw new ServiceSelectionError(`Unknown data service ${unknown.map((u) => `"${u}"`).join(", ")}. ${serviceList()}`);
  const services = new Set(asked);
  if (asked.some((p) => NEEDS_CLIENT_LIST.has(p))) services.add("accounting-clients");
  const scopes = new Set<string>(["openid"]);
  for (const p of services) for (const sc of scopesOf(p)) scopes.add(sc);
  return { services: [...services].sort(), scopes: [...scopes].sort() };
}

export function serviceList(): string {
  return `Available, as --services a,b,c: ${Object.entries(SERVICES)
    .map(([id, s]) => `${id} (${s.label})`)
    .join("; ")}.`;
}

export const serviceLabel = (id: string) => SERVICES[id]?.label ?? id;
