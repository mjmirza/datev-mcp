import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// R18: sentinel choice stays linear, and an exhausted sentinel space never leaks the id.
const gate = fileURLToPath(new URL("../../src/api/client-gate.ts", import.meta.url));
const SETUP = `const range = (a, b) => { let s = ""; for (let c = a; c <= b; c++) s += String.fromCodePoint(c); return s; };
  const all = range(0xe000, 0xf8ff) + range(0xf0000, 0xffffd) + range(0x100000, 0x10fffd);
  const bmpRead = range(0xe000, 0xf8ff) + range(0xfdd0, 0xfdef) + range(0xfffe, 0xffff);
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };`;
function run(body: string, timeout = 10_000): { out: unknown; ms: number } {
  const code = `import(${JSON.stringify(gate)}).then((m) => { ${SETUP} const t = Date.now(); const out = ${body}; process.stdout.write(JSON.stringify({ out, ms: Date.now() - t })); })`;
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", code], { encoding: "utf8", timeout });
  assert.equal(r.error, undefined, `did not return within ${timeout}ms (hang)`);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const leaks = (expr: string) => `(() => { const r = ${expr}; return [r, dec(r), dec(dec(r))].some((x) => x.includes("455148-1")); })()`;

test("every private-use character in all three ranges returns in under 2 s", { timeout: 20_000 }, () => {
  const { ms } = run(`m.hideClientId(all, ["455148-1"]).length`);
  assert.ok(ms < 2000, `took ${ms}ms`);
});

test("every private-use character plus the id still hides the id, quickly", { timeout: 20_000 }, () => {
  const { out, ms } = run(leaks(`m.hideClientId("https://x/c/455148-1?q=" + all, ["455148-1"])`));
  assert.equal(out, false);
  assert.ok(ms < 2000, `took ${ms}ms`);
});

test("exhausted READ forms never leak an escaped id in any decoding", { timeout: 20_000 }, () => {
  const { out } = run(leaks(`m.hideClientId("https://x/455148-1%34%35%35%31%34%38%2d%31?q=" + bmpRead, ["455148-1"])`));
  assert.equal(out, false);
});

test("exhausted READ forms keep the authority", { timeout: 20_000 }, () => {
  const { out } = run(`m.hideClientId("https://x/455148-1%34%35%35%31%34%38%2d%31?q=" + bmpRead, ["455148-1"]).startsWith("https://x/")`);
  assert.equal(out, true);
});

test("exhausted sentinels with no id anywhere leave the value as sent", { timeout: 20_000 }, () => {
  const { out } = run(`m.hideClientId("https://x/a?q=" + bmpRead, ["455148-1"]) === "https://x/a?q=" + bmpRead`);
  assert.equal(out, true);
});
