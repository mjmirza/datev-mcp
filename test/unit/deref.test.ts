import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { deref, resolvePointer, MAX_DEPTH } from "../../src/spec/deref.js";

test("should inline a local $ref when the target exists", () => {
  const root = { components: { schemas: { A: { type: "string" } } } };
  assert.deepEqual(deref({ $ref: "#/components/schemas/A" }, root), { type: "string" });
});

test("should cut a self-referencing cycle to a named $ref", () => {
  const root = { components: { schemas: { Node: { type: "object", properties: { next: { $ref: "#/components/schemas/Node" } } } } } };
  const out = deref({ $ref: "#/components/schemas/Node" }, root) as { properties: { next: unknown } };
  assert.deepEqual(out.properties.next, { $ref: "Node" });
});

test("should mark a dangling $ref as unresolved instead of throwing", () => {
  assert.deepEqual(deref({ $ref: "#/nope/X" }, {}), { $ref: "X", unresolved: true });
});

test("should decode ~1 and ~0 escapes in JSON pointers", () => {
  assert.equal(resolvePointer({ paths: { "/a/b": { "x~y": 1 } } }, "#/paths/~1a~1b/x~0y"), 1);
});

test("property: deref terminates with bounded output on random cyclic schema graphs", () => {
  const names = ["A", "B", "C", "D"];
  const node = fc.letrec((tie) => ({
    leaf: fc.oneof(fc.constant({ type: "string" }), fc.constantFrom(...names).map((n) => ({ $ref: `#/components/schemas/${n}` }))),
    obj: fc.dictionary(fc.constantFrom("a", "b", "c"), tie("tree"), { maxKeys: 3 }),
    tree: fc.oneof({ depthSize: "small" }, tie("leaf"), tie("obj")),
  }));
  fc.assert(
    fc.property(fc.tuple(node.tree, node.tree, node.tree, node.tree), fc.constantFrom(...names), (schemas, start) => {
      const root = { components: { schemas: Object.fromEntries(names.map((n, i) => [n, schemas[i]])) } };
      const out = deref({ $ref: `#/components/schemas/${start}` }, root);
      const text = JSON.stringify(out);
      assert.ok(text.length < 5_000_000);
      return MAX_DEPTH > 0;
    }),
    { numRuns: 300 },
  );
});

test("property: deref is idempotent on ref-free input", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (v) => {
      const once = deref(v, {});
      assert.deepEqual(deref(once, {}), once);
    }),
    { numRuns: 300 },
  );
});
