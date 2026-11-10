import data from "../compliance.json" with { type: "json" };
import { errorRate, httpLogProblem } from "../api/http-log.js";
import { serviceLabel } from "../auth/services.js";
import { TokenStore } from "../auth/token-store.js";
import type { Config } from "../config.js";
import type { MessageLang } from "../i18n.js";
import { setupWarnings } from "./status.js";

// What the person connecting can see about DATEV compliance: live checks of this installation, and the state of
// every DATEV interface requirement from docs/COMPLIANCE-CHECKLIST.md (rebuilt with "npm run compliance").

type Counts = Record<"met" | "partial" | "open" | "n/a" | "needs-owner", number>;
interface Section {
  title: string;
  counts: Counts;
  ids: string[];
}
interface Check {
  ok: boolean;
  text: string;
}

export interface ComplianceView {
  checks: Check[];
  sections: (Section & { connected: boolean })[];
  open_must: number;
}

const T = {
  en: {
    title: "DATEV compliance",
    live: "This installation",
    rules: "DATEV interface requirements (MUST, SHOULD, DONT)",
    legend: "met / partial / open / not applicable / app owner",
    yours: "your data service",
    openMust: "open or partial MUST items",
    more: "Full list with evidence: docs/COMPLIANCE-CHECKLIST.md",
    appType: (t: string) => `App type ${t}`,
    log: (p?: string) => (p ? `Technical HTTP log cannot be written (${p}), no DATEV call is sent` : "Technical HTTP log is written for every DATEV call and kept 30 days"),
    rate: (r: string) => `Error rate of the last 14 days ${r}, DATEV expects below 10 %`,
    noRate: "Error rate of the last 14 days, no calls yet",
    pending: (n: number) => (n ? `${n} old refresh token(s) not yet revoked at DATEV` : "Only one valid refresh token at DATEV"),
    session: (s?: string) => (s ? `Connected data services ${s}` : "No data services connected yet"),
  },
  de: {
    title: "DATEV-Konformität",
    live: "Diese Installation",
    rules: "DATEV-Schnittstellenvorgaben (MUST, SHOULD, DONT)",
    legend: "erfüllt / teilweise / offen / nicht zutreffend / App-Betreiber",
    yours: "Ihr Datenservice",
    openMust: "offene oder teilweise erfüllte MUST-Punkte",
    more: "Vollständige Liste mit Nachweisen: docs/COMPLIANCE-CHECKLIST.md",
    appType: (t: string) => `App-Typ ${t}`,
    log: (p?: string) => (p ? `Technisches HTTP-Log kann nicht geschrieben werden (${p}), es wird kein DATEV-Aufruf gesendet` : "Technisches HTTP-Log wird für jeden DATEV-Aufruf geschrieben und 30 Tage aufbewahrt"),
    rate: (r: string) => `Fehlerquote der letzten 14 Tage ${r}, DATEV erwartet unter 10 %`,
    noRate: "Fehlerquote der letzten 14 Tage, noch keine Aufrufe",
    pending: (n: number) => (n ? `${n} alte(s) Refresh-Token noch nicht bei DATEV widerrufen` : "Nur ein gültiges Refresh-Token bei DATEV"),
    session: (s?: string) => (s ? `Verbundene Datenservices ${s}` : "Noch keine Datenservices verbunden"),
  },
};

export function complianceView(cfg: Config, opts: { store?: TokenStore; lang?: MessageLang } = {}): ComplianceView {
  const t = T[opts.lang ?? "en"];
  const store = opts.store ?? new TokenStore(cfg.env);
  let session;
  try {
    session = store.read();
  } catch {
    session = undefined;
  }
  const labels = session?.services?.map(serviceLabel) ?? [];
  const rate = errorRate(14);
  const logProblem = httpLogProblem();
  const pending = session?.pendingRevoke?.length ?? 0;
  const checks: Check[] = [
    { ok: !setupWarnings(cfg).length, text: t.appType(cfg.creds.clientSecret ? "Confidential" : "Public") },
    ...setupWarnings(cfg).map((w) => ({ ok: false, text: w })),
    { ok: !logProblem, text: t.log(logProblem) },
    rate.requests ? { ok: rate.rate < 0.1, text: t.rate(`${(rate.rate * 100).toFixed(1)} % (${rate.errors}/${rate.requests})`) } : { ok: true, text: t.noRate },
    { ok: pending === 0, text: t.pending(pending) },
    { ok: labels.length > 0, text: t.session(labels.join(", ") || undefined) },
  ];
  const sections = (data.sections as Section[]).map((s) => ({ ...s, connected: labels.some((l) => s.title.includes(l)) }));
  return { checks, sections, open_must: data.open_must.length };
}

export function renderCompliance(v: ComplianceView, lang: MessageLang): string {
  const t = T[lang];
  const mark = (ok: boolean) => (ok ? "OK  " : "TODO");
  const lines = [`${t.title}`, "", `  ${t.live}`, ...v.checks.map((c) => `    ${mark(c.ok)} ${c.text}`), "", `  ${t.rules}`, `    ${t.legend}`];
  for (const s of v.sections) {
    const c = s.counts;
    const nums = [c.met, c.partial, c.open, c["n/a"], c["needs-owner"]].map((n) => String(n).padStart(3)).join(" ");
    lines.push(`    ${nums}  ${s.title}${s.connected ? `  <- ${t.yours}` : ""}`);
  }
  lines.push("", `  ${v.open_must} ${t.openMust}`, `  ${t.more}`);
  return lines.join("\n");
}
