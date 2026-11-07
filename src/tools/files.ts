import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

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

export function readLocalFile(p: string, maxBytes: number): { path: string; name: string; bytes: Uint8Array } {
  const path = expandPath(p);
  let st;
  try {
    st = statSync(path);
  } catch {
    throw new FileError(`File not found: ${path}`);
  }
  if (!st.isFile()) throw new FileError(`Not a regular file: ${path}`);
  if (st.size === 0) throw new FileError(`File is empty: ${path}`);
  if (st.size > maxBytes) throw new FileError(`File is ${st.size} bytes, the limit is ${maxBytes}: ${path}`);
  return { path, name: basename(path), bytes: new Uint8Array(readFileSync(path)) };
}

export function writeLocalFile(p: string, bytes: Uint8Array, overwrite: boolean): string {
  const path = expandPath(p);
  if (existsSync(path) && !overwrite) throw new FileError(`${path} already exists. Pass overwrite: true to replace it.`);
  writeFileSync(path, bytes);
  return path;
}
