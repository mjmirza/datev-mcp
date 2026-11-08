import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { errorReason } from "../sweep-reason.js";

test("picks DATEV's code and message from the usual error shapes", () => {
  assert.equal(errorReason({ error: "invalid_request", error_description: "Parameter missing" }), "invalid_request: Parameter missing");
  assert.equal(errorReason({ code: "#DCO01001", message: "Client not found" }), "#DCO01001: Client not found");
  assert.equal(errorReason({ errors: [{ code: "E1", detail: "Fiscal year closed" }] }), "E1: Fiscal year closed");
  assert.equal(errorReason({ title: "Bad Request", detail: "Date out of range" }), "Bad Request: Date out of range");
  assert.equal(errorReason("Internal Server Error"), "Internal Server Error");
  assert.equal(errorReason(undefined), undefined);
  assert.equal(errorReason({}), undefined);
});

test("redacts client ids, uuids, emails, tokens and long numbers", () => {
  const r = errorReason({ message: "Client 455148-1 job 3f2504e0-4f89-41d3-9a0c-0305e82c3301 for max@example.de Bearer eyJhbGciOiJIUzI1NiJ9.abc.def id 1234567" })!;
  for (const leak of ["455148-1", "3f2504e0", "max@example.de", "eyJhbGci", "1234567"]) assert.ok(!r.includes(leak), `${leak} leaked: ${r}`);
  assert.match(r, /<client>/);
  assert.match(r, /<uuid>/);
});

test("a reason is always short and single-line", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (body) => {
      const r = errorReason(body);
      if (r === undefined) return;
      assert.ok(r.length <= 160, r);
      assert.ok(!/[\r\n]/.test(r));
    }),
    { numRuns: 500 },
  );
});
