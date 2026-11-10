import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, statSync, existsSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { storeDir } from "../paths.js";
import type { DatevEnv } from "./endpoints.js";
import { defaultKeyStore, loadOrCreateKey, type KeyStore } from "./session-key.js";
import type { TokenSet } from "./token-client.js";

export interface StoredSession {
  env: DatevEnv;
  clientId: string;
  tokens: TokenSet;
  /** Who signed in, from DATEV's userinfo, for the connection status DATEV requires. */
  identity?: { sub: string; name?: string };
  /** The data services chosen at login, and the scopes requested for them. */
  services?: string[];
  scopes?: string[];
  /** When the refresh token from this login stops working. DATEV does not extend it on refresh. */
  refreshExpiresAt?: number;
  /** Refresh tokens of earlier logins that DATEV has not confirmed as revoked yet. Retried until it does. */
  pendingRevoke?: string[];
  /** Set when the connection was ended for a missing permission but DATEV did not confirm every revoke.
   *  No token is handed out again; the access token keeps its real expiry so it is still revoked. */
  ended?: boolean;
  /** Access tokens of an earlier, ended login that DATEV has not confirmed as revoked, retried until they expire. */
  pendingAccessRevoke?: { token: string; expiresAt: number }[];
}

interface Sealed {
  v: 2;
  alg: "A256GCM";
  iv: string;
  tag: string;
  data: string;
}

const isSealed = (v: unknown): v is Sealed => !!v && typeof v === "object" && (v as Sealed).v === 2 && (v as Sealed).alg === "A256GCM";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A process's start time tells a live holder apart from an unrelated process that reused its pid.
function startedAt(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, TZ: "UTC", LC_ALL: "C" } }).trim() || undefined;
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
  private readonly keys: KeyStore;
  private key?: Buffer;

  constructor(
    readonly env: DatevEnv,
    dir = storeDir(),
    keys?: KeyStore,
  ) {
    this.file = join(dir, `session-${env}.json`);
    this.lockDir = join(dir, `session-${env}.lock`);
    this.keys = keys ?? defaultKeyStore(dir);
  }

  private aad = () => Buffer.from(`datev-mcp:${this.env}`);

  private seal(s: StoredSession): Sealed {
    return this.sealText(JSON.stringify(s));
  }

  private sealText(plain: string): Sealed {
    this.key ??= loadOrCreateKey(this.keys, dirname(this.file));
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(this.aad());
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return { v: 2, alg: "A256GCM", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
  }

  private open(sealed: Sealed): StoredSession {
    this.key ??= this.keys.get();
    if (!this.key) throw new Error(`The DATEV session is encrypted, but its key is missing from the ${this.keys.name}. Log in again.`);
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(sealed.iv, "base64"));
    d.setAAD(this.aad());
    d.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(sealed.data, "base64")), d.final()]).toString("utf8")) as StoredSession;
  }

  read(): StoredSession | undefined {
    if (!existsSync(this.file)) return undefined;
    // Encrypted or not, the file stays owner-only.
    if ((statSync(this.file).mode & 0o077) !== 0) chmodSync(this.file, 0o600);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
    } catch {
      return this.quarantine();
    }
    let s: StoredSession;
    try {
      s = isSealed(raw) ? this.open(raw) : (raw as StoredSession);
    } catch (e) {
      if ((e as Error).message.includes("key is missing")) throw e;
      return this.quarantine();
    }
    if (!s?.tokens?.accessToken || s.env !== this.env) return this.quarantine();
    // A session saved in plain text by an earlier version is encrypted the first time it is read.
    if (!isSealed(raw)) this.write(s);
    return s;
  }

  // Keep the unreadable file for inspection, then act as logged out. Plain text may hold live tokens,
  // so only an encrypted copy of it is kept.
  private quarantine(): undefined {
    const target = `${this.file}.corrupt-${Date.now()}`;
    let plain = "";
    let sealedOnDisk = false;
    try {
      plain = readFileSync(this.file, "utf8");
      sealedOnDisk = isSealed(JSON.parse(plain));
    } catch {
      // not JSON, so certainly not encrypted
    }
    if (sealedOnDisk) {
      renameSync(this.file, target);
      return undefined;
    }
    try {
      writeFileSync(target, JSON.stringify(this.sealText(plain)), { mode: 0o600 });
    } catch {
      // no key to encrypt with: nothing is kept rather than a plain text copy
    }
    rmSync(this.file, { force: true });
    return undefined;
  }

  write(s: StoredSession): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.seal(s)), { mode: 0o600 });
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
