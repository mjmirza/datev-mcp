import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, productKey, isSkippedSpec } from "../../src/spec/build.js";
import index from "../../src/data/operations.json" with { type: "json" };
import type { OperationIndex } from "../../src/spec/types.js";

const committed = index as OperationIndex;

test("should derive short product keys from spec file names", () => {
  assert.equal(productKey("accounting-clients__2.0__1.json"), "accounting-clients");
  assert.equal(productKey("hr-imports__2.0.0__hr-files.json"), "hr-files");
  assert.equal(productKey("b4value-net-smarttransfer-inbound__1.2__1.json"), "smarttransfer-inbound");
  assert.equal(productKey("my-tax-income-tax-documents-1__1__datev-my-tax-income-tax-documents.json"), "my-tax-income-tax-documents");
  assert.equal(productKey("eau-api__1.0.0__eau-api-v1.0.23.json"), "eau-api");
});

test("should skip the duplicate eau sandbox-only spec", () => {
  assert.equal(isSkippedSpec("eau-api__1.0.0__eau-api-v1.0.2-sandbox.json"), true);
  assert.equal(isSkippedSpec("eau-api__1.0.0__eau-api-v1.0.23.json"), false);
});

test("should map one operation per method, mark writes, and resolve shared params", () => {
  const out = buildIndex([
    {
      fileName: "demo__1__1.json",
      doc: {
        servers: [{ url: "https://x.api.datev.de/platform/v1" }, { url: "https://x.api.datev.de/platform-sandbox/v1/" }],
        security: [{ oauth: ["datev:demo"] }],
        paths: {
          "/clients/{id}": {
            parameters: [{ $ref: "#/components/parameters/Id" }],
            get: { operationId: "getClient" },
            post: { requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } } },
          },
        },
        components: { parameters: { Id: { name: "id", in: "path", schema: { type: "string" } } } },
      } as never,
    },
  ]);
  assert.equal(out.operations.length, 2);
  const [get, post] = out.operations;
  assert.equal(get.id, "demo.getclient");
  assert.equal(get.write, false);
  assert.equal(post.write, true);
  assert.equal(post.body?.required, true);
  assert.deepEqual(get.params.map((p) => [p.name, p.in, p.required]), [["id", "path", true]]);
  assert.deepEqual(get.scopes, ["datev:demo"]);
  assert.equal(get.servers.sandbox, "https://x.api.datev.de/platform-sandbox/v1");
  assert.equal(get.servers.production, "https://x.api.datev.de/platform/v1");
});

test("committed index: ids are unique and every op has a method, path and a server", () => {
  const ids = committed.operations.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const o of committed.operations) {
    assert.ok(o.method && o.path.startsWith("/"), o.id);
    assert.ok(o.servers.production || o.servers.sandbox, `${o.id} has no server`);
  }
});

test("committed index: covers all subscribed product families", () => {
  const products = new Set(committed.operations.map((o) => o.product));
  for (const p of [
    "accounting-clients", "accounting-dataexchange", "accounting-documents", "accounting-dxso-jobs", "accounting-extf-files",
    "cashregister", "hr-documents", "eau-api", "hr-exchange", "hr-exports", "hr-files", "hr-payrollreports",
    "master-data-master-clients", "my-tax-income-tax-documents", "property-tax-file-upload-api",
    "smarttransfer-inbound", "smarttransfer-outbound", "traffiqx-invoice",
  ]) assert.ok(products.has(p), `missing product ${p}`);
});
