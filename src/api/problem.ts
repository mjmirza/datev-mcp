import { localize } from "../i18n.js";

// DATEV's error answers (RFC 7807 problem details and older shapes), shared by API, token and userinfo calls.
export interface Problem {
  title?: string;
  detail?: string;
  /** DATEV's help page for this error. DATEV requires apps to show it for every 4xx answer. */
  help_url?: string;
  request_id?: string;
}

const PROBLEM_TEXT = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : undefined);

/** Reads DATEV's error answer (RFC 7807 problem details, or its older error shapes) without losing the help link. */
export function problemOf(body: unknown): Problem {
  // Some services (DXSO jobs, for example) answer with a list of problems. The first one carries the help link.
  if (Array.isArray(body)) {
    const firstObj = body.find((x) => x && typeof x === "object" && !Array.isArray(x));
    if (firstObj) return problemOf(firstObj);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const m = typeof body === "string" ? body.match(/https?:\/\/[^\s"'<>]*datev\.de\/[^\s"'<>]*/i) : null;
    return m ? { help_url: m[0] } : {};
  }
  const b = body as Record<string, unknown>;
  const first = Array.isArray(b.errors) && b.errors[0] && typeof b.errors[0] === "object" ? (b.errors[0] as Record<string, unknown>) : {};
  const urls = [b.type, b.help_url, b.helpUrl, b.error_uri, b.more_information, first.type, first.help_url, first.error_uri].map(PROBLEM_TEXT).filter((u): u is string => !!u && /^https?:\/\//i.test(u));
  const fromText = JSON.stringify(body).match(/https?:\/\/[^\s"'<>]*datev\.de\/[^\s"'<>]*/i)?.[0];
  return {
    title: PROBLEM_TEXT(b.title) ?? PROBLEM_TEXT(b.error) ?? PROBLEM_TEXT(first.title),
    detail: PROBLEM_TEXT(b.detail) ?? PROBLEM_TEXT(b.error_description) ?? PROBLEM_TEXT(b.message) ?? PROBLEM_TEXT(first.detail) ?? PROBLEM_TEXT(first.message),
    help_url: urls.find((u) => /datev\.de/i.test(u)) ?? fromText ?? urls[0],
    request_id: PROBLEM_TEXT(b.request_id) ?? PROBLEM_TEXT(b.requestId),
  };
}

/** The error part of a tool answer: the parsed problem plus one readable line that ends with DATEV's help link. */
export function problemFields(status: number, body: unknown, what: string): { problem: Problem; message: string } {
  return { problem: problemOf(body), message: localize(`DATEV returned HTTP ${status} for ${what}: ${problemText(status, body)}`) };
}

/** One readable line for a failed DATEV answer, always ending with the help link when DATEV gives one. */
export function problemText(status: number, body: unknown): string {
  const p = problemOf(body);
  const what = [p.title, p.detail].filter(Boolean).join(": ") || (typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body)?.slice(0, 300) ?? "no details");
  return `${what}${p.help_url ? `. Help: ${p.help_url}` : ""}${p.request_id ? ` (request id ${p.request_id})` : ""}`;
}
