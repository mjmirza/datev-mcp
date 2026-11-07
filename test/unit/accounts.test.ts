import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { clearAccountCache, loadAccounts, matchAccounts, type LedgerAccount } from "../../src/tools/accounts.js";
import type { CallDeps } from "../../src/api/client.js";
import type { FetchLike } from "../../src/auth/token-client.js";

const accounts: LedgerAccount[] = [
  { accountNumber: 1200, caption: "Bank" },
  { accountNumber: 1210, caption: "Bank 2" },
  { accountNumber: 1776, caption: "Umsatzsteuer 19 %" },
  { accountNumber: 4400, caption: "Erlöse 19 % USt" },
  { accountNumber: 8400, caption: "Erlöse Gebühren" },
];

const deps = (f: FetchLike): CallDeps => ({ env: "sandbox", creds: { clientId: "c", clientSecret: "s" }, token: async () => "T", fetch: f });

test("matches by number prefix and by all name words, umlaut-tolerant", () => {
  assert.deepEqual(matchAccounts(accounts, "12").map((a) => a.accountNumber), [1200, 1210]);
  assert.deepEqual(matchAccounts(accounts, "erloese 19").map((a) => a.accountNumber), [4400]);
  assert.deepEqual(matchAccounts(accounts, "ERLÖSE").map((a) => a.accountNumber), [4400, 8400]);
  assert.deepEqual(matchAccounts(accounts, "nothing like this"), []);
  assert.equal(matchAccounts(accounts, "", 2).length, 2);
});

test("property: every match really contains the query and respects the limit", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[0-9]{1,4}$/), fc.integer({ min: 1, max: 5 }), (q, limit) => {
      const out = matchAccounts(accounts, q, limit);
      assert.ok(out.length <= limit);
      for (const a of out) assert.ok(String(a.accountNumber).startsWith(q));
    }),
  );
});

test("reads a chart far larger than the generic 100k response cap and caches it", async () => {
  clearAccountCache();
  const big = Array.from({ length: 3000 }, (_, i) => ({ accountNumber: 1000000 + i, caption: `Konto Nummer ${i} mit einer langen Beschreibung` }));
  let calls = 0;
  const f: FetchLike = async () => (calls++, new Response(JSON.stringify(big), { status: 200, headers: { "content-type": "application/json" } }));
  assert.ok(JSON.stringify(big).length > 100_000);
  const got = await loadAccounts("455148-2", "20230701", deps(f), 0);
  assert.equal(got.length, 3000);
  await loadAccounts("455148-2", "20230701", deps(f), 1000);
  assert.equal(calls, 1, "second lookup within 10 minutes must use the cache");
  await loadAccounts("455148-2", "20230701", deps(f), 11 * 60_000);
  assert.equal(calls, 2, "cache expires after 10 minutes");
});

test("parses DATEV's one-object-per-line chart format (as returned by the live sandbox)", async () => {
  clearAccountCache();
  const ndjson = '{"accountNumber":6000000,"caption":"Anleihen, nicht konvertibel"}\n{"accountNumber":1200000,"caption":"Bank"}\n';
  const f: FetchLike = async () => new Response(ndjson, { status: 200, headers: { "content-type": "application/json" } });
  const got = await loadAccounts("a", "b", deps(f));
  assert.deepEqual(got.map((a) => a.accountNumber), [1200000, 6000000]);
});

test("property: parseJsonOrLines round-trips any list of JSON objects written one per line", async () => {
  const { parseJsonOrLines } = await import("../../src/api/client.js");
  fc.assert(
    fc.property(fc.array(fc.dictionary(fc.string(), fc.jsonValue()), { minLength: 1, maxLength: 20 }), (objs) => {
      const text = objs.map((o) => JSON.stringify(o)).join("\n");
      assert.deepEqual(parseJsonOrLines(text, true), JSON.parse(JSON.stringify(objs)));
    }),
  );
});

test("reports a DATEV error status instead of pretending the chart is empty", async () => {
  clearAccountCache();
  const f: FetchLike = async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  await assert.rejects(loadAccounts("x", "y", deps(f)), /HTTP 403/);
});
