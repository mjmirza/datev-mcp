import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

// DATEV classes access and refresh tokens as "highest protection need" and requires them to be encrypted.
// The session file is encrypted with a random 256-bit key that lives in the operating system's credential store.

export interface KeyStore {
  readonly name: string;
  get(): Buffer | undefined;
  set(key: Buffer): void;
}

const SERVICE = "datev-mcp";
const ACCOUNT = "session-key";

const run = (cmd: string, args: string[], input?: string) =>
  execFileSync(cmd, args, { encoding: "utf8", input, timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] }).trim();

function parseKey(text: string | undefined, where: string): Buffer | undefined {
  const v = text?.trim();
  if (!v) return undefined;
  const key = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  if (key.length !== 32) throw new Error(`The session key in ${where} is not 32 bytes (64 hex characters or base64)`);
  return key;
}

/** DATEV_MCP_SESSION_KEY, for servers without a desktop credential store. Read-only: the operator provides it. */
export const envKeyStore = (env: NodeJS.ProcessEnv = process.env): KeyStore => ({
  name: "DATEV_MCP_SESSION_KEY",
  get: () => parseKey(env.DATEV_MCP_SESSION_KEY, "DATEV_MCP_SESSION_KEY"),
  set: () => {
    throw new Error("DATEV_MCP_SESSION_KEY is set but empty or invalid");
  },
});

// macOS Keychain. The key is written through "security -i", which reads the command from stdin, so it never shows in the process list.
const macKeychain: KeyStore = {
  name: "macOS Keychain",
  get() {
    try {
      return parseKey(run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]), "the macOS Keychain");
    } catch {
      return undefined;
    }
  },
  set(key) {
    run("security", ["-i"], `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -l "datev-mcp session key" -w ${key.toString("hex")}\n`);
  },
};

// Linux Secret Service (GNOME Keyring, KWallet) via secret-tool, which reads the secret from stdin.
const secretService: KeyStore = {
  name: "Secret Service (secret-tool)",
  get() {
    try {
      return parseKey(run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]), "the Secret Service");
    } catch {
      return undefined;
    }
  },
  set(key) {
    run("secret-tool", ["store", "--label=datev-mcp session key", "service", SERVICE, "account", ACCOUNT], key.toString("hex"));
  },
};

// Windows DPAPI: the key file can only be decrypted by the same Windows user on the same machine.
function dpapiFile(dir: string): KeyStore {
  const file = join(dir, "session-key.dpapi");
  const ps = (script: string, input: string) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.Security; ${script}`], input);
  return {
    name: "Windows DPAPI",
    get() {
      if (!existsSync(file)) return undefined;
      const hex = ps(
        "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [BitConverter]::ToString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser')).Replace('-','')",
        readFileSync(file, "utf8"),
      );
      return parseKey(hex, "the DPAPI key file");
    },
    set(key) {
      const b64 = ps(
        "$h=[Console]::In.ReadToEnd().Trim(); $b=[byte[]]::new($h.Length/2); for($i=0;$i -lt $b.Length;$i++){$b[$i]=[Convert]::ToByte($h.Substring($i*2,2),16)}; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))",
        key.toString("hex"),
      );
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, b64, { mode: 0o600 });
      renameSync(tmp, file);
    },
  };
}

function hasCommand(cmd: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** The key store for this machine: DATEV_MCP_SESSION_KEY if set, else the platform's credential store. */
export function defaultKeyStore(dir: string, env: NodeJS.ProcessEnv = process.env): KeyStore {
  if (env.DATEV_MCP_SESSION_KEY?.trim()) return envKeyStore(env);
  if (process.platform === "darwin") return macKeychain;
  if (process.platform === "win32") return dpapiFile(dir);
  if (hasCommand("secret-tool")) return secretService;
  return {
    name: "none",
    get: () => undefined,
    set: () => {
      throw new Error(
        "No credential store found to protect the DATEV session. Install secret-tool (package libsecret-tools), or set DATEV_MCP_SESSION_KEY to 64 random hex characters from your secret manager (openssl rand -hex 32).",
      );
    },
  };
}

/** Returns the existing key, or creates and stores a new one. */
export function loadOrCreateKey(store: KeyStore): Buffer {
  const have = store.get();
  if (have) return have;
  const key = randomBytes(32);
  store.set(key);
  const back = store.get();
  if (!back || !back.equals(key)) throw new Error(`The session key could not be stored in the ${store.name}`);
  return key;
}
