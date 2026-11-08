import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// A write runs only with the token from a preview of the exact same request, so confirm cannot skip the preview or swap the payload.
const KEY = randomBytes(32);
const TTL_MS = 15 * 60_000;
// Each token is spent on first acceptance, so one approval is accepted once. Bounded by MAX_SPENT and pruned on every check.
const spent = new Map<string, number>();
const MAX_SPENT = 10_000;
// Spent tokens are kept a day past expiry, so a clock set back by up to a day cannot revive a pruned one (unless a 10,000 burst forces early pruning).
const KEEP_SPENT_MS = TTL_MS + 24 * 60 * 60_000;
const FORMAT = /^([0-9a-z]{1,11})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  // Missing and null are different requests (no body versus a JSON null body), so they never share a token.
  if (v === undefined) return "~undefined";
  return JSON.stringify(v);
}

const sign = (payload: unknown, issued: number, nonce: string) => createHmac("sha256", KEY).update(`${issued}|${nonce}|${canonical(payload)}`).digest("base64url");

export function issueConfirmToken(payload: unknown, now = Date.now()): string {
  const nonce = randomBytes(12).toString("base64url");
  return `${now.toString(36)}.${nonce}.${sign(payload, now, nonce)}`;
}

export function checkConfirmToken(token: string | undefined, payload: unknown, now = Date.now()): string | undefined {
  for (const [t, issued] of spent) if (now - issued > KEEP_SPENT_MS) spent.delete(t);
  if (!token) return "Show the preview first: call without confirm, then call again with confirm: true and the confirm_token it returned.";
  const m = FORMAT.exec(token);
  const issued = m ? parseInt(m[1]!, 36) : NaN;
  // Only the one spelling issueConfirmToken produces is accepted, so a spent token cannot come back in another form.
  if (!m || !Number.isFinite(issued) || issued.toString(36) !== m[1]) return "The confirm_token is malformed. Request a new preview.";
  if (now - issued > TTL_MS) return "The confirm_token expired. Request a new preview.";
  const want = Buffer.from(sign(payload, issued, m[2]!));
  const got = Buffer.from(m[3]!);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "The confirm_token does not match this request. Something changed since the preview, so request a new one.";
  if (spent.has(token)) return "The confirm_token was already used. Request a new preview to send this again.";
  if (spent.size >= MAX_SPENT) for (const [t, at] of spent) if (now - at > TTL_MS) spent.delete(t); // expired ones count against nothing
  if (spent.size >= MAX_SPENT) return "Too many confirmations in the last 15 minutes. Wait and request a new preview.";
  spent.set(token, issued);
  return undefined;
}
