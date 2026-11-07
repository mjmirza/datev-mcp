import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, statSync, existsSync } from "node:fs";
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
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }

  private owner(): { pid: number; token: string } | undefined {
    try {
      return JSON.parse(readFileSync(join(this.lockDir, "owner"), "utf8")) as { pid: number; token: string };
    } catch {
      return undefined;
    }
  }

  private tryLock(token: string, staleMs: number): boolean {
    try {
      mkdirSync(this.lockDir);
      writeFileSync(join(this.lockDir, "owner"), JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
      return true;
    } catch {
      // Stale only when the holder process is gone. A slow but live holder keeps its lock, so its refresh token is never spent twice.
      try {
        const o = this.owner();
        const old = Date.now() - statSync(this.lockDir).mtimeMs > staleMs;
        if (old && (!o || !pidAlive(o.pid))) rmSync(this.lockDir, { recursive: true, force: true });
      } catch {
        /* lock vanished between checks */
      }
      return false;
    }
  }

  // Cross-process mutex: several MCP clients (and login) share one session file. mkdir is atomic.
  async withLock<T>(fn: () => Promise<T>, opts: { staleMs?: number; waitMs?: number } = {}): Promise<T> {
    const staleMs = opts.staleMs ?? 30_000;
    const deadline = Date.now() + (opts.waitMs ?? 90_000);
    const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
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
