#!/usr/bin/env bash
# Downloads DATEV's public API docs into specs/ (gitignored), then rebuilds src/data/operations.json.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=specs; U="https://developer.datev.de/mediator"; mkdir -p "$DEST"
PRODUCTS="accounting-clients:2.0 accounting-dataexchange:1 accounting-documents:2.0 accounting-dxso-jobs:2.0
accounting-extf-files:2.0 cashregister:2.6.0 hr-documents:1 eau-api:1.0.0 hr-exchange:1.0.0 hr-exports:1.0.0
hr-imports:2.0.0 hr-payrollreports:2.0.0 master-data-master-clients:3 my-tax-income-tax-documents-1:1
datev-property-tax-file-upload-api:2.1.5 b4value-net-smarttransfer-inbound:1.2 b4value-net-smarttransfer-outbound:1.2
traffiqx-invoice:1.0.0"
for pv in $PRODUCTS; do
  slug=${pv%%:*}; ver=${pv#*:}
  # A product with one API is saved as "<product>__<version>__1.json" so its operation ids stay stable.
  curl -fsS --max-time 30 "$U/products/$slug/apis?version=$ver" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);for(const a of l)console.log(a.id+" "+(l.length===1?"1":a.name+"-v"+a.version))})' \
    | while read -r id name; do
        out="$DEST/${slug}__${ver}__${name}.json"
        curl -fsS --max-time 60 -o "$out" "$U/apis/$id/document"
        echo "fetched $out"
      done
done
for f in "$DEST"/cashregister__*.json; do
  if node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1])).swagger?0:1)' "$f"; then
    npx -y swagger2openapi@7.0.8 "$f" -o "$f.oas3" && mv "$f.oas3" "$f" && echo "converted $f to OpenAPI 3"
  fi
done
npx tsx scripts/build-spec-index.ts
