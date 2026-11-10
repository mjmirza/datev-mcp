import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CallError } from "../api/client.js";
import { TokenStore } from "../auth/token-store.js";
import type { DatevEnv } from "../auth/endpoints.js";
import { storeDir } from "../paths.js";

// CODE_DELETE_OK: recordSent is replaced by reserveSend + finishSend (Codex R4-4..6); its only caller, extf.ts, moves in the same change.
// DATEV: booking data goes out once. The record keeps hash, name and job only, changed under the session lock.

export interface SentEntry {
  at: string;
  name: string;
  /** sending: reserved before the POST; it stays when DATEV's answer is lost, so the outcome is treated as sent. */
  status: "sending" | "sent";
  job_id?: string;
  result?: string;
}

type Ledger = Record<string, Record<string, Record<string, SentEntry>>>;

const ledgerFile = (env: string, vars: NodeJS.ProcessEnv) => join(storeDir(vars), `sent-${env}.json`);

function load(env: string, vars: NodeJS.ProcessEnv): Ledger {
  let text: string;
  try {
    text = readFileSync(ledgerFile(env, vars), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new CallError(`The record of earlier sends cannot be read (${(e as Error).message}). Nothing was sent, so booking data cannot go out twice by accident.`);
  }
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Ledger;
  } catch {
    // reported below
  }
  throw new CallError(`The record of earlier sends at ${ledgerFile(env, vars)} is damaged. Nothing was sent. Check or move the file, then try again.`);
}

function save(env: string, all: Ledger, vars: NodeJS.ProcessEnv): void {
  mkdirSync(storeDir(vars), { recursive: true, mode: 0o700 });
  const target = ledgerFile(env, vars);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
  renameSync(tmp, target);
}

const locked = <T>(env: DatevEnv, vars: NodeJS.ProcessEnv, fn: () => T) => new TokenStore(env, storeDir(vars)).withLock(async () => fn());

/** The earlier send of this file to this client, if any. Throws when the record cannot be read. */
export function sentBefore(kind: string, env: DatevEnv, clientId: string, sha256: string, vars: NodeJS.ProcessEnv = process.env): SentEntry | undefined {
  return load(env, vars)[kind]?.[clientId]?.[sha256];
}

/** Reserves the send before the POST. Returns the earlier entry instead when it exists and resend is not set. */
export function reserveSend(kind: string, env: DatevEnv, clientId: string, sha256: string, name: string, resend: boolean, vars: NodeJS.ProcessEnv = process.env): Promise<SentEntry | undefined> {
  return locked(env, vars, () => {
    const all = load(env, vars);
    const earlier = all[kind]?.[clientId]?.[sha256];
    if (earlier && !resend) return earlier;
    ((all[kind] ??= {})[clientId] ??= {})[sha256] = { at: new Date().toISOString(), name, status: "sending" };
    save(env, all, vars);
    return undefined;
  });
}

/** Records DATEV's answer. A definite refusal releases the reservation, an accepted file is kept as sent. */
export function finishSend(
  kind: string,
  env: DatevEnv,
  clientId: string,
  sha256: string,
  outcome: { accepted: false } | { accepted: true; job_id?: string; result?: string },
  vars: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return locked(env, vars, () => {
    const all = load(env, vars);
    const entries = all[kind]?.[clientId];
    const entry = entries?.[sha256];
    if (!entries || !entry) return;
    if (!outcome.accepted) delete entries[sha256];
    else entries[sha256] = { ...entry, status: "sent", job_id: outcome.job_id ?? entry.job_id, result: outcome.result ?? entry.result };
    save(env, all, vars);
  });
}
