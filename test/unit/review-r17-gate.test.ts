import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// R17: a value holding every BMP private-use character must come back unchanged, and must not hang.
const gate = fileURLToPath(new URL("../../src/api/client-gate.ts", import.meta.url));
function run(body: string): unknown {
  const code = `import(${JSON.stringify(gate)}).then((m) => { const pua = Array.from({ length: 6400 }, (_, i) => String.fromCharCode(0xe000 + i)).join(""); process.stdout.write(JSON.stringify(${body})); })`;
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", code], { encoding: "utf8", timeout: 10_000 });
  assert.equal(r.error, undefined, "did not return within 10s (hang)");
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("every BMP private-use character with no id stays exactly as sent", { timeout: 20_000 }, () => {
  assert.equal(run(`m.hideClientValues({ q: pua }, ["455148-1"]).q === pua`), true);
});

test("an id next to every BMP private-use character is still hidden, the rest kept", { timeout: 20_000 }, () => {
  assert.equal(run(`m.hideClientId("https://x/c/455148-1?q=" + pua, ["455148-1"]) === "https://x/c/{client}?q=" + pua`), true);
});

test("an id equal to U+FFFD with every BMP private-use character present returns", { timeout: 20_000 }, () => {
  assert.equal(run(`m.hideClientId("https://x/a/\\uFFFD?q=" + pua, ["\\uFFFD"]) === "https://x/a/{client}?q=" + pua`), true);
});
