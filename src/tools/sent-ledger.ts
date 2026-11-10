import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storeDir } from "../paths.js";

// DATEV requires that booking data is sent only once, with a deliberate resend for support cases.
// This ledger remembers what was sent, by file hash and name only, never the content.

export interface SentEntry {
  at: string;
  name: string;
  job_id?: string;
  result?: string;
}

type Ledger = Record<string, Record<string, Record<string, SentEntry>>>;

function file(env: string, vars: NodeJS.ProcessEnv): string {
  return join(storeDir(vars), `sent-${env}.json`);
}

function load(env: string, vars: NodeJS.ProcessEnv): Ledger {
  try {
    const v = JSON.parse(readFileSync(file(env, vars), "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Ledger) : {};
  } catch {
    return {};
  }
}

export function sentBefore(kind: string, env: string, clientId: string, sha256: string, vars: NodeJS.ProcessEnv = process.env): SentEntry | undefined {
  return load(env, vars)[kind]?.[clientId]?.[sha256];
}

export function recordSent(kind: string, env: string, clientId: string, sha256: string, entry: SentEntry, vars: NodeJS.ProcessEnv = process.env): void {
  const all = load(env, vars);
  ((all[kind] ??= {})[clientId] ??= {})[sha256] = entry;
  mkdirSync(storeDir(vars), { recursive: true, mode: 0o700 });
  const target = file(env, vars);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
  renameSync(tmp, target);
}
