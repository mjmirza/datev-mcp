// A short, redacted reason for a failed DATEV answer, kept in the live sweep ledger so failures can be explained later.

const MAX = 160;
const CODE_KEYS = ["error", "code", "errorCode", "title"];
const TEXT_KEYS = ["error_description", "message", "detail", "description", "errorMessage"];

const redact = (s: string) =>
  s
    .replace(/\bBearer\s+\S+/gi, "Bearer <token>")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<token>")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d{4,7}-\d{1,5}\b/g, "<client>")
    .replace(/(?<![A-Za-z#\d])\d{5,}/g, "<n>"); // keeps DATEV error codes such as #DCO01001

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function pick(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function fromObject(o: Record<string, unknown>): string | undefined {
  const code = pick(o, CODE_KEYS);
  const text = pick(o, TEXT_KEYS);
  if (code || text) return [code, text].filter(Boolean).join(": ");
  for (const k of ["errors", "error"]) {
    const v = o[k];
    const first = Array.isArray(v) ? v[0] : v;
    if (first && typeof first === "object" && !Array.isArray(first)) return fromObject(first as Record<string, unknown>);
  }
  return undefined;
}

export function errorReason(body: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof body === "string") raw = body;
  else if (body && typeof body === "object" && !Array.isArray(body)) raw = fromObject(body as Record<string, unknown>);
  if (!raw) return undefined;
  const r = oneLine(redact(oneLine(raw)));
  if (!r) return undefined;
  return r.length > MAX ? `${r.slice(0, MAX - 3)}...` : r;
}
