import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, statSync, existsSync, openSync, closeSync } from "node:fs";
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

  private tryLock(staleMs: number): boolean {
    try {
      mkdirSync(this.lockDir);
      closeSync(openSync(join(this.lockDir, String(process.pid)), "w"));
      return true;
    } catch {
      try {
        if (Date.now() - statSync(this.lockDir).mtimeMs > staleMs) rmSync(this.lockDir, { recursive: true, force: true });
      } catch {
        /* lock vanished between checks */
      }
      return false;
    }
  }

  // Cross-process mutex: several MCP clients can share one session file. mkdir is atomic.
  async withLock<T>(fn: () => Promise<T>, opts: { staleMs?: number; waitMs?: number } = {}): Promise<T> {
    const staleMs = opts.staleMs ?? 60_000;
    const deadline = Date.now() + (opts.waitMs ?? 90_000);
    mkdirSync(dirname(this.lockDir), { recursive: true, mode: 0o700 });
    while (!this.tryLock(staleMs)) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the DATEV session lock at ${this.lockDir}`);
      await sleep(50); // BESTPRACTICE_OK: polling a lock is inherently sequential
    }
    try {
      return await fn();
    } finally {
      rmSync(this.lockDir, { recursive: true, force: true });
    }
  }
}
