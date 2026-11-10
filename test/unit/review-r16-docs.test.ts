import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The architecture doc must describe what the code does; each claim is pinned to the code it describes.
const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const arch = read("docs/ARCHITECTURE.md");

test("the architecture doc states the sandbox confirm-code approval the code allows", () => {
  assert.match(read("src/tools/approval.ts"), /DATEV_MCP_CONFIRM/);
  assert.match(arch, /DATEV_MCP_CONFIRM=human/);
  assert.doesNotMatch(arch, /Without approval nothing is sent\./);
});

test("the architecture doc names the Windows key file the code writes next to the session", () => {
  assert.match(read("src/auth/session-key.ts"), /session-key\.dpapi/);
  assert.match(arch, /DPAPI-protected file next to the session/);
  assert.doesNotMatch(arch, /not next to the file/);
});

test("the architecture doc names the start-up revoke retry and the HTTP log the code keeps", () => {
  assert.match(read("src/server.ts"), /void revokePending\(/);
  assert.match(arch, /once at start-up to retry revoking/);
  assert.match(read("src/api/http-log.ts"), /status >= 400/);
  assert.match(arch, /answer body of failed requests/);
  assert.doesNotMatch(arch, /DATEV is called only when a tool is used/);
});

test("the ledger check reads finding ids of three or more digits", () => {
  const re = /\/\^\\\| F(\\d[^ ]*) \\\|\//.exec(read("test/unit/review-ledger.test.ts"));
  assert.ok(re, "ledger row pattern not found");
  const rowRe = new RegExp(`^\\| F${re[1]} \\|`);
  assert.ok(rowRe.test("| F133 | LOW |") && rowRe.test("| F07 | LOW |"), `pattern F${re[1]} misses an id`);
});

test("the architecture doc names the EXTF sent ledger the code keeps", () => {
  assert.match(read("src/tools/sent-ledger.ts"), /sent-\$\{env\}\.json/);
  assert.match(arch, /sent-sandbox\.json/);
  assert.doesNotMatch(arch, /The one thing kept/);
});
