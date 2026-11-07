import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, statSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { DatevEnv } from "./endpoints.js";
import type { TokenSet } from "./token-client.js";

export interface StoredSession {
  env: DatevEnv;
  clientId: string;
  tokens: TokenSet;
}

export function defaultStoreDir(): string {
  return process.env.DATEV_MCP_HOME ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "datev-mcp");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A process's start time tells a live holder apart from an unrelated process that reused its pid.
function startedAt(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}
let selfStarted: string | undefined | null = null;
const myStart = () => (selfStarted === null ? (selfStarted = startedAt(process.pid)) : selfStarted);

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class TokenStore {
  readonly file: string;
  private readonly lockDir: string;

  constructor(
    readonly env: DatevEnv,
    dir = defaultStoreDir(),
  ) {
    this.file = join(dir, `session-${env}.json`);
    this.lockDir = join(dir, `session-${env}.lock`);
  }

  read(): StoredSession | undefined {
    if (!existsSync(this.file)) return undefined;
    try {
      const s = JSON.parse(readFileSync(this.file, "utf8")) as StoredSession;
      if (!s?.tokens?.accessToken || s.env !== this.env) throw new Error("shape");
      return s;
    } catch {
      // Keep the unreadable file for inspection rather than deleting it, then act as logged out.
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      return undefined;
    }
  }

  write(s: StoredSession): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }

  private owner(dir = this.lockDir): { pid: number; token: string; started?: string } | undefined {
    try {
      return JSON.parse(readFileSync(join(dir, "owner"), "utf8")) as { pid: number; token: string; started?: string };
    } catch {
      return undefined;
    }
  }

  // Identifies one lock generation, so a takeover never removes a newer lock that reused the path.
  private generation(): string | undefined {
    try {
      const st = statSync(this.lockDir);
      return `${st.ino}:${st.birthtimeMs}:${this.owner()?.token ?? ""}`;
    } catch {
      return undefined;
    }
  }

  private isStale(staleMs: number): boolean {
    try {
      const age = Date.now() - statSync(this.lockDir).mtimeMs;
      const o = this.owner();
      // A young lock without an owner file is being born, not abandoned. A live holder is never evicted for age.
      if (age <= staleMs) return false;
      if (!o || !pidAlive(o.pid)) return true;
      const now = o.started ? startedAt(o.pid) : undefined;
      return now !== undefined && now !== o.started; // same pid, different process: the holder is gone
    } catch {
      return false;
    }
  }

  private takeOver(gen: string, staleMs: number): void {
    const mutex = `${this.lockDir}.takeover`;
    try {
      if (Date.now() - statSync(mutex).mtimeMs > 10_000) rmSync(mutex, { recursive: true, force: true });
    } catch {
      /* no leftover mutex */
    }
    try {
      mkdirSync(mutex);
    } catch {
      return; // someone else is deciding right now
    }
    try {
      // Decide again on fresh state: only remove the exact generation that was judged stale.
      if (this.generation() === gen && this.isStale(staleMs)) {
        const tomb = `${this.lockDir}.dead-${process.pid}-${randomBytes(4).toString("hex")}`;
        renameSync(this.lockDir, tomb);
        // If a new holder slipped in between the check and the rename, put its lock back instead of deleting it.
        const judged = gen.split(":").slice(2).join(":"); // the owner token of the generation that was judged stale
        if ((this.owner(tomb)?.token ?? "") !== judged) {
          try {
            renameSync(tomb, this.lockDir);
            return;
          } catch {
            /* the path was taken again meanwhile; the moved lock's owner will see it is gone and not release a foreign one */
          }
        }
        rmSync(tomb, { recursive: true, force: true });
      }
    } catch {
      /* lock vanished or changed meanwhile */
    } finally {
      rmSync(mutex, { recursive: true, force: true });
    }
  }

  private tryLock(token: string, staleMs: number): boolean {
    try {
      mkdirSync(this.lockDir);
    } catch {
      const gen = this.generation();
      if (gen && this.isStale(staleMs)) this.takeOver(gen, staleMs);
      return false;
    }
    // Published atomically, so a reader never sees half an owner record.
    const tmp = join(this.lockDir, `owner.${token}.tmp`);
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, token, started: myStart() }), { mode: 0o600 });
    renameSync(tmp, join(this.lockDir, "owner"));
    return true;
  }

  // Cross-process mutex: several MCP clients (and login) share one session file. mkdir is atomic.
  async withLock<T>(fn: () => Promise<T>, opts: { staleMs?: number; waitMs?: number } = {}): Promise<T> {
    const staleMs = opts.staleMs ?? 30_000;
    const deadline = Date.now() + (opts.waitMs ?? 90_000);
    const token = `${process.pid}-${randomBytes(8).toString("hex")}`;
    mkdirSync(dirname(this.lockDir), { recursive: true, mode: 0o700 });
    while (!this.tryLock(token, staleMs)) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the DATEV session lock at ${this.lockDir}`);
      await sleep(50); // BESTPRACTICE_OK: polling a lock is inherently sequential
    }
    try {
      return await fn();
    } finally {
      if (this.owner()?.token === token) rmSync(this.lockDir, { recursive: true, force: true });
    }
  }
}
