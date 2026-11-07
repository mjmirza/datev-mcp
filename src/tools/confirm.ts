import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// A write runs only with the token from a preview of the exact same request, so confirm cannot skip the preview or swap the payload.
const KEY = randomBytes(32);
const TTL_MS = 15 * 60_000;

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  // Missing and null are different requests (no body versus a JSON null body), so they never share a token.
  if (v === undefined) return "~undefined";
  return JSON.stringify(v);
}

const sign = (payload: unknown, issued: number) => createHmac("sha256", KEY).update(`${issued}|${canonical(payload)}`).digest("base64url");

export function issueConfirmToken(payload: unknown, now = Date.now()): string {
  return `${now.toString(36)}.${sign(payload, now)}`;
}

export function checkConfirmToken(token: string | undefined, payload: unknown, now = Date.now()): string | undefined {
  if (!token) return "Show the preview first: call without confirm, then call again with confirm: true and the confirm_token it returned.";
  const [stamp, mac] = token.split(".");
  const issued = parseInt(stamp ?? "", 36);
  if (!Number.isFinite(issued) || !mac) return "The confirm_token is malformed. Request a new preview.";
  if (now - issued > TTL_MS) return "The confirm_token expired. Request a new preview.";
  const want = Buffer.from(sign(payload, issued));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "The confirm_token does not match this request. Something changed since the preview, so request a new one.";
  return undefined;
}
