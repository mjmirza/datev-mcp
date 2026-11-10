import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// R16: an id that is part of "{client}" must not loop forever. A sync hang blocks the event loop,
// so each call runs in a child process with a hard timeout.
const gate = fileURLToPath(new URL("../../src/api/client-gate.ts", import.meta.url));
function run(fn: string, args: unknown[]): unknown {
  const code = `import(${JSON.stringify(gate)}).then((m) => process.stdout.write(JSON.stringify(m.${fn}(...${JSON.stringify(args)}))))`;
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", code], { encoding: "utf8", timeout: 5000 });
  assert.equal(r.error, undefined, `${fn} did not return within 5s (hang)`);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

for (const id of ["client", "c", "lien", "{client}", "nt}", "{", "}"]) {
  test(`hideClientId returns and hides a standalone id ${JSON.stringify(id)}`, { timeout: 10_000 }, () => {
    assert.equal(run("hideClientId", [`https://x/clients/${id}/docs?q=${id}`, [id]]), "https://x/clients/{client}/docs?q={client}");
  });
}

test("the placeholder itself is never rewritten, and a longer word stays as sent", { timeout: 10_000 }, () => {
  assert.equal(run("hideClientId", ["https://x/a/client/b/clients", ["client"]]), "https://x/a/{client}/b/clients");
  assert.equal(run("hideClientId", ["https://x/a/c/b", ["c"]]), "https://x/a/{client}/b");
});

test("hideClientValues returns for an id inside the placeholder", { timeout: 10_000 }, () => {
  assert.deepEqual(run("hideClientValues", [{ a: "client", b: ["c", "x"], n: 5 }, ["client", "c"]]), { a: "{client}", b: ["{client}", "x"], n: 5 });
});

test("hideClientParams returns for an id inside the placeholder", { timeout: 10_000 }, () => {
  assert.deepEqual(run("hideClientParams", [{ "client-id": "client", other: "lien" }, ["client"]]), { "client-id": "{client}", other: "lien" });
});

test("a URL that already carries a private-use character keeps it as sent", { timeout: 10_000 }, () => {
  assert.equal(run("hideClientId", ["https://x/a//client", ["client"]]), "https://x/a//{client}");
});
