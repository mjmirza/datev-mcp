import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Claims a reviewer found false. Each one stays banned so a regenerated or edited page cannot bring it back.
const root = join(import.meta.dirname, "..", "..");
const BANNED: [RegExp, string][] = [
  [/except after a 429|writes? (?:retry|are retried) only (?:a |for )?429|for writes only 429/i, "writes are never retried (F14)"],
  [/use fetch defaults and would follow a redirect/i, "token and doctor requests refuse redirects (F14)"],
  [/Tokens and secret stored encrypted/i, "the client secret is never stored by the app (F28)"],
  [/Default `human` in production, `token` in the sandbox/i, "production always asks a person (F10)"],
  [/Online-API (?:accounting|master|property)|Einkommenssteuer/, "DATEV's own data service names (F02)"],
  [/Ask DATEV to enable/i, "people using the app are never sent to DATEV for an integration problem (GEN-15)"],
  [/every scope the operation index knows|`DATEV_SCOPES` leaves (?:it|them) out|overriding the service choice/i, "only the chosen services' scopes, DATEV_SCOPES only without a service choice (F13)"],
  [/Can I log out\?[^\n]*\n*[^\n]*Delete the session file/i, "logging out is datev-mcp disconnect, never deleting the file (F09)"],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".md") || p.endsWith(".ts") ? [p] : [];
  });
}

test("docs, Q&A sources and code never repeat a claim a reviewer proved false", () => {
  const scan = [join(root, "README.md"), ...files(join(root, "docs")), ...files(join(root, "scripts")), ...files(join(root, "src"))].filter(
    (p) => !p.endsWith("REVIEW-LEDGER.md"),
  );
  const hits: string[] = [];
  for (const p of scan) {
    const text = readFileSync(p, "utf8");
    for (const [re, why] of BANNED) if (re.test(text)) hits.push(`${p.slice(root.length + 1)}: ${why}`);
  }
  assert.deepEqual(hits, []);
});
