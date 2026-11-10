import { test } from "node:test";
import assert from "node:assert/strict";
import type { FetchLike } from "../../src/auth/token-client.js";
import { callOperation, type CallDeps } from "../../src/api/client.js";
import { getOperation } from "../../src/tools/catalog.js";

// Guards for the error scan as a streaming tokenizer (ledger F102, F113).
process.env.DATEV_MCP_SESSION_KEY ??= "33".repeat(32);

const enc = new TextEncoder();
const B = String.fromCharCode(92);
const KEYS = ["title", "type", "detail", "help_url", "error", "error_description", "error_uri", "request_id", "requestId"];
const streamed = (chunks: Iterable<Uint8Array>) => {
  const it = chunks[Symbol.iterator]();
  return new Response(new ReadableStream<Uint8Array>({ pull(c) { const n = it.next(); if (n.done) c.close(); else c.enqueue(n.value); } }), { status: 403, headers: { "content-type": "application/json" } });
};
const deps = (f: FetchLike): CallDeps => ({ env: "sandbox", creds: { clientId: "c" }, token: async () => "T", fetch: f, sleep: async () => undefined, maxBodyChars: 1000 });
const fields = async (chunks: Iterable<Uint8Array>) => {
  const body = (await callOperation(getOperation("accounting-clients.getclients")!, {}, deps(async () => streamed(chunks)))).body as Record<string, unknown>;
  return Object.fromEntries(KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
};

test("a nested title and help link do not hide the top-level ones (F102)", async () => {
  const text = `{"errors":[{"title":"INNER","help_url":"x"}],"detail":"${"d".repeat(6000)}","title":"OUTER","help_url":"y"}`;
  const f = await fields([enc.encode(text)]);
  assert.equal(f.title, "OUTER");
  assert.equal(f.help_url, "y");
});

test("a key separated from its value by more whitespace than any window is read (F113)", async () => {
  const text = `{"detail":"${"d".repeat(6000)}","title":"T","help_url":${" ".repeat(70_000)}"https://help.datev.de/far"}`;
  const bytes = enc.encode(text);
  function* body() {
    for (let i = 0; i < bytes.length; i += 4096) yield bytes.subarray(i, i + 4096);
  }
  assert.equal((await fields(body())).help_url, "https://help.datev.de/far");
});

test("a top-level key that repeats keeps its first value, and escapes are decoded", async () => {
  const text = `{"detail":"${"d".repeat(6000)}","title":"A${B}u00fc${B}n${B}"q${B}"","title":"B"}`;
  assert.equal((await fields([enc.encode(text)])).title, 'Aü\n"q"');
});

// Seeded generator, so a failure replays exactly.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("property: the scanned fields equal the top-level fields of the parsed answer", async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!;
    const ws = () => pick(["", " ", "\n\t", " ".repeat(Math.floor(r() * 9000))]);
    const str = () => pick(["plain", "Prüfung ü", `q${B}"x`, `line${B}nbreak`, `${B}u00e4${B}u20ac`, "x".repeat(Math.floor(r() * 1500))]);
    const nested = (depth: number): string => {
      const k = pick(KEYS);
      const v = depth > 2 || r() < 0.5 ? `"${str()}"` : r() < 0.5 ? `[${nested(depth + 1)},1,null]` : nested(depth + 1);
      return `{${ws()}"${k}"${ws()}:${ws()}${v}${ws()}}`;
    };
    const members: string[] = [`"pad":"${"p".repeat(5000 + Math.floor(r() * 80_000))}"`];
    for (const k of KEYS) if (r() < 0.7) members.push(`"${k}"${ws()}:${ws()}${k === "request_id" && r() < 0.5 ? String(Math.floor(r() * 1e9)) : `"${str()}"`}`);
    for (let n = Math.floor(r() * 4); n > 0; n--) members.push(`"n${n}":${nested(0)}`);
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [members[i], members[j]] = [members[j]!, members[i]!];
    }
    const text = `{${ws()}${members.join(`${ws()},${ws()}`)}${ws()}}`;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const want = Object.fromEntries(KEYS.filter((k) => parsed[k] !== undefined).map((k) => [k, String(parsed[k])]));
    const bytes = enc.encode(text);
    const cuts = [0];
    while (cuts[cuts.length - 1]! < bytes.length) cuts.push(cuts[cuts.length - 1]! + 1 + Math.floor(r() * 20_000));
    const got = await fields(cuts.slice(0, -1).map((c, i) => bytes.subarray(c, cuts[i + 1])));
    assert.deepEqual(got, want, `seed ${seed}`);
  }
});
