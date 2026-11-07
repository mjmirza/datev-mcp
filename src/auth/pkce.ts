import { createHash, randomBytes } from "node:crypto";

const b64url = (buf: Buffer): string => buf.toString("base64url");

// RFC 7636: 43-128 chars. DATEV requires state and nonce of at least 20 chars.
export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

export function challengeFor(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function newPkce(): PkcePair {
  const verifier = randomToken(48);
  return { verifier, challenge: challengeFor(verifier) };
}
