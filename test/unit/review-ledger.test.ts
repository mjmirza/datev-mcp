import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The review ledger is the loop breaker: every fixed finding names the test that guards it.
// If that test is renamed or deleted, the guard is gone and this test fails.
const root = join(import.meta.dirname, "..", "..");
const ledger = readFileSync(join(root, "docs", "REVIEW-LEDGER.md"), "utf8");
const testText = readdirSync(join(root, "test", "unit"))
  .filter((f) => f.endsWith(".test.ts") && f !== "review-ledger.test.ts")
  .map((f) => readFileSync(join(root, "test", "unit", f), "utf8"))
  .join("\n");

const rows = ledger
  .split("\n")
  .filter((l) => /^\| F\d{2,} \|/.test(l))
  .map((l) => {
    const c = l.split("|").map((x) => x.trim());
    return { id: c[1]!, status: c[5]!, fix: c[6]!, guard: c[7]! };
  });

test("the review ledger has unique ids and only known statuses", () => {
  assert.ok(rows.length > 0);
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate finding id");
  for (const r of rows) assert.ok(["open", "fixed", "rejected", "regressed"].includes(r.status), `${r.id}: ${r.status}`);
});

test("every fixed finding names its commit and a guarding test that exists", () => {
  for (const r of rows.filter((x) => x.status === "fixed")) {
    assert.ok(r.fix, `${r.id} has no fix commit`);
    assert.ok(r.guard, `${r.id} has no guarding test`);
    assert.ok(testText.includes(`test("${r.guard}`), `${r.id}: guarding test "${r.guard}" not found`);
  }
});

test("every rejected finding carries a reason", () => {
  for (const r of rows.filter((x) => x.status === "rejected")) assert.ok(r.guard.length > 20, `${r.id} has no reason`);
});
