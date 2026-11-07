import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
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
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    throw new FileError(`Cannot open ${path}: ${(e as Error).message}`);
  }
  try {
    const st = fstatSync(fd);
    // The file that was opened must still be the one that was checked, not a swapped-in link or file.
    const now = lstatSync(path);
    if (now.ino !== st.ino || now.dev !== st.dev || realpathSync(path) !== path) throw new FileError(`${path} changed while it was being opened`);
    if (!st.isFile()) throw new FileError(`Not a regular file: ${path}`);
    if (st.size === 0) throw new FileError(`File is empty: ${path}`);
    if (st.size > maxBytes) throw new FileError(`File is ${st.size} bytes, the limit is ${maxBytes}: ${path}`);
    // Read through the open descriptor and stop past the limit, even if the file grows meanwhile.
    const buf = Buffer.alloc(Math.min(maxBytes + 1, st.size + 1));
    let got = 0;
    for (;;) {
      const n = readSync(fd, buf, got, buf.length - got, null); // BESTPRACTICE_OK: sequential reads of one descriptor
      if (n === 0) break;
      got += n;
      if (got > maxBytes) throw new FileError(`File grew past the limit of ${maxBytes} bytes while reading: ${path}`);
      if (got === buf.length) break;
    }
    if (got === 0) throw new FileError(`File is empty: ${path}`);
    return { path, name: basename(asked), bytes: new Uint8Array(buf.subarray(0, got)) };
  } finally {
    closeSync(fd);
  }
}

function exists(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let off = 0;
  while (off < bytes.length) {
    const n = writeSync(fd, bytes, off, bytes.length - off); // BESTPRACTICE_OK: a short write continues where it stopped
    if (n <= 0) throw new FileError("The disk accepted no more bytes");
    off += n;
  }
}

// Owner-only, never through a symlink, never into a hidden or key path, also when a parent folder is a symlink.
export function writeLocalFile(p: string, bytes: Uint8Array, overwrite: boolean): string {
  const asked = expandPath(p);
  let dir: string;
  try {
    dir = realpathSync(dirname(asked));
  } catch {
    throw new FileError(`Folder does not exist: ${dirname(asked)}`);
  }
  const path = join(dir, basename(asked));
  assertShareable(asked);
  assertShareable(path);
  const st = exists(path);
  if (st?.isSymbolicLink()) throw new FileError(`${path} is a symbolic link. Write to the real path instead.`);
  if (st && !overwrite) throw new FileError(`${path} already exists. Pass overwrite: true to replace it.`);
  if (st && !st.isFile()) throw new FileError(`${path} is not a regular file`);
  const target = st ? join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`) : path;
  let fd: number;
  try {
    fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (e) {
    throw new FileError(`Cannot create ${target}: ${(e as Error).message}`);
  }
  try {
    if (realpathSync(dirname(asked)) !== dir) throw new FileError(`${dirname(asked)} changed while saving`);
    writeAll(fd, bytes);
    closeSync(fd);
    fd = -1;
    if (target !== path) renameSync(target, path);
  } catch (e) {
    if (fd >= 0) closeSync(fd);
    rmSync(target, { force: true }); // a failed attempt leaves nothing behind, so a retry can start clean
    throw e instanceof FileError ? e : new FileError(`Cannot save ${path}: ${(e as Error).message}`);
  }
  return path;
}
