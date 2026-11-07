import { closeSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export class FileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileError";
  }
}

export function expandPath(p: string): string {
  const withHome = p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p;
  if (!isAbsolute(withHome)) throw new FileError(`Use an absolute path (or ~/...), got "${p}"`);
  return resolve(withHome);
}

const SECRET_NAME = /^\.env|\.(pem|key|p12|pfx|kdbx|jks)$|^id_(rsa|ed25519|ecdsa|dsa)|^credentials(\.json)?$|^session-.*\.json$/i;

// Files a tool may send to DATEV: never hidden folders (the DATEV session, ~/.ssh, ~/.aws) and never key or secret files.
export function assertShareable(path: string): void {
  const segments = path.split(sep).filter(Boolean);
  if (segments.some((s) => s.startsWith("."))) throw new FileError(`Refusing ${path}: files inside hidden folders are never sent, they usually hold credentials`);
  if (SECRET_NAME.test(basename(path))) throw new FileError(`Refusing ${path}: this looks like a key or credentials file`);
}

export function readLocalFile(p: string, maxBytes: number): { path: string; name: string; bytes: Uint8Array } {
  const asked = expandPath(p);
  let path: string;
  try {
    path = realpathSync(asked); // a symlink is judged by where it really points
  } catch {
    throw new FileError(`File not found: ${asked}`);
  }
  assertShareable(asked);
  assertShareable(path);
  const st = statSync(path);
  if (!st.isFile()) throw new FileError(`Not a regular file: ${path}`);
  if (st.size === 0) throw new FileError(`File is empty: ${path}`);
  if (st.size > maxBytes) throw new FileError(`File is ${st.size} bytes, the limit is ${maxBytes}: ${path}`);
  return { path, name: basename(asked), bytes: new Uint8Array(readFileSync(path)) };
}

function exists(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

// Owner-only, never through a symlink: a new file is created exclusively, an overwrite goes through a temp file and rename.
export function writeLocalFile(p: string, bytes: Uint8Array, overwrite: boolean): string {
  const path = expandPath(p);
  const st = exists(path);
  if (st?.isSymbolicLink()) throw new FileError(`${path} is a symbolic link. Write to the real path instead.`);
  if (st && !overwrite) throw new FileError(`${path} already exists. Pass overwrite: true to replace it.`);
  if (st && !st.isFile()) throw new FileError(`${path} is not a regular file`);
  const target = st ? join(dirname(path), `.${basename(path)}.${process.pid}.tmp`) : path;
  let fd: number;
  try {
    fd = openSync(target, "wx", 0o600);
  } catch (e) {
    throw new FileError(`Cannot create ${target}: ${(e as Error).message}`);
  }
  try {
    writeSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
  if (target !== path) renameSync(target, path);
  return path;
}
