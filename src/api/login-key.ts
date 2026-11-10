import { createHash } from "node:crypto";
import { bounded, type CallDeps } from "./client.js";

/** Who is asking, stable across token refreshes: DATEV's user id when known, else the current token. */
export async function loginKey(deps: CallDeps, deadline: number): Promise<string> {
  const sub = deps.identity?.();
  const who = sub ? `sub:${sub}` : `token:${await bounded(deps.token(), deadline, deps.signal, "while getting a DATEV access token")}`;
  return createHash("sha256").update(`${deps.env}|${deps.creds.clientId}|${who}`).digest("hex").slice(0, 16);
}
