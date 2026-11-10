import { randomUUID } from "node:crypto";
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
  /** sending: a send in progress. uncertain: DATEV's answer was lost or was a gateway error, so it may be imported. */
  status: "sending" | "uncertain" | "sent";
  /** Which send owns the entry, so a finished send never changes another one's record. */
  reservation?: string;
  /** The record a deliberate resend replaced, with its own earlier records, restored when DATEV refuses the resend. */
  previous?: SentEntry;
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
    if (isLedger(v)) return v;
  } catch {
    // reported below
  }
  throw new CallError(`The record of earlier sends at ${ledgerFile(env, vars)} is damaged. Nothing was sent. Check or move the file, then try again.`);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
// Every level must be an object and every entry carry a name and a status, or the record is treated as damaged.
const STATUSES = new Set(["sending", "uncertain", "sent"]);
// An entry, and every earlier entry behind it, needs a time, a name and a known status.
const isEntry = (e: unknown, depth = 0): boolean =>
  depth < 8 && isObject(e) && typeof e.at === "string" && typeof e.name === "string" && STATUSES.has(String(e.status)) && (e.previous === undefined || isEntry(e.previous, depth + 1));
const isLedger = (v: unknown): v is Ledger =>
  isObject(v) && Object.values(v).every((byClient) => isObject(byClient) && Object.values(byClient).every((byHash) => isObject(byHash) && Object.values(byHash).every((e) => isEntry(e))));

function save(env: string, all: Ledger, vars: NodeJS.ProcessEnv): void {
  mkdirSync(storeDir(vars), { recursive: true, mode: 0o700 });
  const target = ledgerFile(env, vars);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
  renameSync(tmp, target);
}

const locked = <T>(env: DatevEnv, vars: NodeJS.ProcessEnv, fn: () => T) => new TokenStore(env, storeDir(vars)).withLock(async () => fn());

/** A send whose process stopped mid-way leaves "sending"; after this long it counts as uncertain. */
const STALE_MS = 15 * 60_000;
const current = (e: SentEntry | undefined): SentEntry | undefined => (e?.status === "sending" && Date.now() - Date.parse(e.at) > STALE_MS ? { ...e, status: "uncertain" } : e);

function trimmed(e: SentEntry): SentEntry {
  const { previous, ...self } = e;
  const accepted = e.status === "sent" ? undefined : acceptedBefore(previous);
  return accepted ? { ...self, previous: { ...accepted, previous: undefined } } : self;
}

/** The newest earlier send of this file that DATEV accepted, if any, from the chain behind this record. */
export function acceptedBefore(e: SentEntry | undefined): SentEntry | undefined {
  for (let x = e; x; x = x.previous) if (x.status === "sent") return x;
  return undefined;
}

/** The earlier send of this file to this client, if any. Throws when the record cannot be read. */
export function sentBefore(kind: string, env: DatevEnv, clientId: string, sha256: string, vars: NodeJS.ProcessEnv = process.env): SentEntry | undefined {
  return current(load(env, vars)[kind]?.[clientId]?.[sha256]);
}

/** Reserves the send before the POST and returns its reservation id, or the earlier entry that blocks it. */
export function reserveSend(
  kind: string,
  env: DatevEnv,
  clientId: string,
  sha256: string,
  name: string,
  /** For a deliberate resend: the time of the record the person saw in the preview. Any newer send blocks it. */
  resend: false | { seen?: string },
  vars: NodeJS.ProcessEnv = process.env,
): Promise<{ reservation: string } | { blocked: SentEntry }> {
  return locked(env, vars, () => {
    const all = load(env, vars);
    const earlier = current(all[kind]?.[clientId]?.[sha256]);
    // A send in progress blocks even a deliberate resend; a finished or uncertain one only without resend.
    if (earlier && (earlier.status === "sending" || !resend || earlier.at !== resend.seen)) return { blocked: earlier };
    const reservation = randomUUID();
    // The earlier record is kept with the newest import DATEV accepted behind it, never the whole history,
    // so an accepted import is never forgotten and the record does not grow with every resend.
    ((all[kind] ??= {})[clientId] ??= {})[sha256] = { at: new Date().toISOString(), name, status: "sending", reservation, ...(earlier ? { previous: trimmed(earlier) } : {}) };
    save(env, all, vars);
    return { reservation };
  });
}

/** Records DATEV's answer for this reservation only. A refusal restores the earlier record, if any. */
export function finishSend(
  kind: string,
  env: DatevEnv,
  clientId: string,
  sha256: string,
  reservation: string,
  outcome: { status: "refused" } | { status: "uncertain" } | { status: "sent"; job_id?: string; result?: string },
  vars: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return locked(env, vars, () => {
    const all = load(env, vars);
    const entries = all[kind]?.[clientId];
    const entry = entries?.[sha256];
    if (!entries || !entry || entry.reservation !== reservation) return;
    if (outcome.status === "refused") {
      if (entry.previous) entries[sha256] = entry.previous;
      else delete entries[sha256];
    } else if (outcome.status === "uncertain") entries[sha256] = { ...entry, status: "uncertain" };
    else entries[sha256] = { ...entry, status: "sent", job_id: outcome.job_id ?? entry.job_id, result: outcome.result ?? entry.result };
    save(env, all, vars);
  });
}
