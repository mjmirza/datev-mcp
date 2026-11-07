// Builds src/data/operations.json from specs/*.json. --check fails if the committed index is stale.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/spec/build.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specDir = join(root, "specs");
const outFile = join(root, "src", "data", "operations.json");

if (!existsSync(specDir)) {
  console.error(`No specs/ directory at ${specDir}. Download the DATEV specs first.`);
  process.exit(1);
}
const files = readdirSync(specDir)
  .filter((f) => f.endsWith(".json"))
  .map((fileName) => ({ fileName, doc: JSON.parse(readFileSync(join(specDir, fileName), "utf8")) }));

const index = buildIndex(files);
const json = JSON.stringify(index, null, 1) + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  if (current !== json) {
    console.error("operations.json is stale. Run: npm run index");
    process.exit(1);
  }
  console.log("operations.json is current");
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, json);
}
const writes = index.operations.filter((o) => o.write).length;
const products = new Set(index.operations.map((o) => o.product)).size;
console.log(`specs=${index.generatedFrom} products=${products} operations=${index.operations.length} write=${writes}`);
