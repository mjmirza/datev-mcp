// Writes docs/qa/: the curated questions plus questions generated from the operation index, the live ledger and the eval report.
// Uses operation ids, scopes and measured results only, never DATEV's own descriptions (their terms forbid redistributing API docs).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { OPERATIONS } from "../src/tools/catalog.js";
import { CURATED, type QA, type Section } from "./qa/curated.js";

interface Entry { op: string; status: number | "skipped" | "error"; ts: string; ms?: number; items?: number; shape?: string; note?: string }
const OUT = "docs/qa";
const ledger = new Map<string, Entry>();
if (existsSync("test/reports/live-ledger.jsonl")) for (const l of readFileSync("test/reports/live-ledger.jsonl", "utf8").split("\n").filter(Boolean)) {
  const e = JSON.parse(l) as Entry;
  ledger.set(e.op, e);
}
const evalFile = readdirSync("test/reports").filter((f) => /^eval-.*\.json$/.test(f)).sort().pop();
if (!evalFile) throw new Error("Run npm run eval first: no eval report in test/reports/");
const evalRun = JSON.parse(readFileSync(`test/reports/${evalFile}`, "utf8")) as { generatedAt: string; total: number; passed: number; failed: number; categories: Record<string, { pass: number; fail: number }>; failures: { op: string }[] };
const tourFile = readdirSync("test/reports").filter((f) => /^live-tour-.*\.txt$/.test(f)).sort().pop();
const tour = tourFile ? readFileSync(`test/reports/${tourFile}`, "utf8") : "";
const tourDay = tourFile?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
// Writes the live tour sent through a typed tool, with the line in the tour log that proves it.
const TOUR_WRITES: Record<string, RegExp> = {
  "accounting-extf-files.importextffile": /^OK +upload EXTF to sandbox \(confirm\) +HTTP (\d{3})/m,
  "accounting-dataexchange.postaccountpostingsjob": /^OK +account postings \(async job\) +ready=true/m,
};
const sandboxWrites = OPERATIONS.filter((o) => o.write && o.servers.sandbox).length;
const allWrites = OPERATIONS.filter((o) => o.write).length;
const failedOps = new Set(evalRun.failures.map((f) => f.op));
const evalDay = evalRun.generatedAt.slice(0, 10);

const TYPED: Record<string, string> = {
  "accounting-clients.getclients": "datev_list_clients",
  "accounting-dataexchange.getfiscalyears": "datev_list_fiscal_years",
  "accounting-dataexchange.getsumsandbalances": "datev_sums_and_balances",
  "accounting-dataexchange.postaccountpostingsjob": "datev_account_postings",
  "accounting-dataexchange.getjobstate": "datev_account_postings",
  "accounting-dataexchange.getaccountpostingsjob": "datev_account_postings",
  "accounting-dataexchange.getgeneralledgeraccounts": "datev_find_accounts",
  "accounting-extf-files.importextffile": "datev_upload_extf",
  "accounting-documents.post_clients_client_id_documents": "datev_upload_document",
};
const FAMILY: [RegExp, string][] = [
  [/^accounting-/, "accounting (Rechnungswesen)"], [/^hr-/, "payroll and HR (Lohn)"], [/^master-data-/, "master data (Stammdaten)"],
  [/^my-tax-/, "income tax documents"], [/^smarttransfer-/, "smart transfer"], [/^cashregister/, "cash register (Kasse)"],
  [/^eau-api/, "electronic sick notes (eAU)"], [/^property-tax/, "property tax files (Grundsteuer)"], [/^traffiqx/, "invoice exchange (TRAFFIQX)"],
];
const family = (p: string) => FAMILY.find(([r]) => r.test(p))?.[1] ?? "DATEV";
const code = (s: string) => `\`${s}\``;
type Op = (typeof OPERATIONS)[number];

function statusMeaning(status: number): string {
  if (status >= 300 && status < 400) return "That is a redirect, not a refusal. The server never follows redirects for operations and returns the target in the answer's `location` field.";
  if (status === 400) return "DATEV rejected the request. The sweep recorded only the status, not DATEV's reason, so the cause is not known. Call it again and read the answer body.";
  if (status === 401) return "The app is not subscribed to the product or the scope was not granted.";
  if (status === 403) return "Access to that resource is refused for the app or user.";
  if (status === 404) return "The test data has no such record.";
  if (status === 500) return "DATEV answered with a server error. The sweep recorded only the status, so read the answer body for DATEV's reason.";
  return "DATEV refused the request. The answer body has the reason.";
}

function liveAnswer(o: Op): string {
  if (o.write) {
    const m = TOUR_WRITES[o.id] && tour.match(TOUR_WRITES[o.id]);
    if (m) return `The live tour of ${tourDay} sent it to the DATEV sandbox through ${code(TYPED[o.id] ?? "datev_call")}${m[1] ? ` and DATEV answered HTTP ${m[1]}` : " and the job finished"}.`;
    return o.servers.sandbox
      ? `It was not called live, because it changes data. The offline scenarios check that a call without confirmation sends nothing, for all ${sandboxWrites} writes that have a sandbox server.`
      : "It was not called live, and it has no sandbox server, so the server refuses it in the sandbox.";
  }
  const e = ledger.get(o.id);
  if (!e) return "It has not been called live yet.";
  if (e.status === "skipped") return `The live sweep skipped it: ${e.note ?? "no usable input yet"}.`;
  if (e.status === "error") return "The live sweep could not build a request for it locally.";
  const when = e.ts.slice(0, 10);
  const extra = [e.ms !== undefined ? `in ${e.ms} ms` : "", e.items !== undefined ? `with ${e.items} items` : ""].filter(Boolean).join(" ");
  if (e.status < 300) return `The DATEV sandbox answered HTTP ${e.status} on ${when}${extra ? ` ${extra}` : ""}.`;
  return `The DATEV sandbox answered HTTP ${e.status} on ${when}. ${statusMeaning(e.status)}`;
}

function opQuestions(o: Op): QA[] {
  const typed = TYPED[o.id];
  const kind = o.write ? "changes data" : "only reads data";
  const reqHeaders = o.params.filter((p) => p.in === "header" && p.required).map((p) => p.name);
  const headerNote = reqHeaders.length ? ` It also needs ${code(`headers: {${reqHeaders.map((h) => `"${h}": "..."`).join(", ")}}`)}.` : "";
  const fileOnly = !!o.body && !o.body.contentTypes.some((c) => /json|text/i.test(c));
  const multipart = fileOnly && o.body!.contentTypes.some((c) => /^multipart\/form-data/i.test(c));
  const props = Object.entries(((o.body?.schema ?? {}) as { properties?: Record<string, { type?: string; format?: string; items?: { format?: string } }> }).properties ?? {});
  const fileParts = props.filter(([, s]) => (s.type === "array" ? s.items?.format : s.format) === "binary").map(([n]) => n);
  const otherParts = props.filter(([n]) => !fileParts.includes(n)).map(([n]) => n);
  const uploadHow = `Use ${code("datev_upload_file")} with ${code(`operation_id: "${o.id}"`)} and ${code("files")} mapping ${fileParts.length > 1 ? `the parts ${fileParts.map(code).join(", ")}` : `the part ${code(fileParts[0] ?? "file")}`} to local file paths${otherParts.length ? `, plus ${code("fields")} for ${otherParts.map(code).join(", ")} where needed` : ""}. The first call returns a preview and a confirmation code. Nothing is sent until the assistant calls again with ${code("confirm: true")} and that code.${headerNote}`;
  const call = multipart
    ? `${uploadHow}${o.body!.required ? "" : ` ${code("datev_call")} can also call it without a file.`}`
    : fileOnly && !o.body!.required
    ? `${code("datev_call")} can call it without a body, but cannot send the file it takes (${o.body!.contentTypes.join(", ")}), because the generic tool sends JSON or text only.${typed ? "" : " No typed tool sends the file yet."}`
    : fileOnly
    ? `${code("datev_call")} cannot send it, because it needs a file upload (${o.body!.contentTypes.join(", ")}) and the generic tool sends JSON or text only.${typed ? "" : " No typed tool covers it yet."}`
    : o.write
    ? `Use ${code("datev_call")} with ${code(`operation_id: "${o.id}"`)}. The first call returns a preview and a confirmation code. Nothing is sent until the assistant calls again with ${code("confirm: true")} and that code.`
    : `Use ${code("datev_call")} with ${code(`operation_id: "${o.id}"`)} and the path and query values it needs.${headerNote}`;
  const callFull = o.write && !fileOnly ? call + headerNote : call;
  const uploadWrite = `Yes. ${typed ? `${code("datev_upload_file")} and ${code(typed)} send it` : `${code("datev_upload_file")} sends it`} only after the preview and confirmation code, and it is never retried except after a 429.`;
  const optional = o.scopes.filter((x) => x !== "openid");
  const scopes = o.scopes.length
    ? `${o.scopes.map(code).join(" and ")}.${optional.length ? ` The server requests ${optional.length > 1 ? "them" : "it"} at login unless ${code("DATEV_SCOPES")} leaves ${optional.length > 1 ? "them" : "it"} out.` : ""}${o.scopes.includes("openid") ? ` ${code("openid")} is always requested.` : ""}`
    : "DATEV's spec names no scope for it. Access depends on the app's product subscription.";
  const live = ledger.get(o.id);
  const failing = !o.write && live !== undefined && typeof live.status === "number" && live.status >= 300;
  return [
    { q: `What is ${code(o.id)}?`, a: `An operation of the ${code(o.product)} product in the ${family(o.product)} area. It uses HTTP ${o.method.toUpperCase()} and ${kind}.${o.health ? " It is a health check that tells you whether the service is up." : ""}` },
    { q: `How do I call ${code(o.id)}?`, a: `${typed ? `The typed tool ${code(typed)} uses it for you and checks the answer. ` : ""}${callFull}` },
    { q: `Does ${code(o.id)} change data in DATEV?`, a: o.write ? (multipart ? uploadWrite : fileOnly && !typed && !o.body!.required ? `Yes. ${code("datev_call")} can call it without a file, with the preview and confirmation code, but cannot attach the file. It is never retried except after a 429.` : fileOnly && !typed ? `Yes, but ${code("datev_call")} cannot send it yet because it needs a file upload. No tool sends it today.` : o.id === "accounting-dataexchange.postaccountpostingsjob" ? `Not your bookings. It starts an export job on DATEV's side. ${code("datev_account_postings")} starts it directly without a preview, ${code("datev_call")} asks for a confirmation code first. It is never retried except after a 429.` : `Yes. Through ${fileOnly ? code(typed!) : `${code("datev_call")}${typed ? ` and ${code(typed)}` : ""}`} it goes through the preview and confirmation code, and it is never retried except after a 429.`) : "No. It only reads, so it runs directly and is retried on 429, 502, 503, 504 and network errors." },
    { q: `Which scope does ${code(o.id)} need?`, a: scopes },
    { q: `What did ${code(o.id)} return in the DATEV sandbox?`, a: liveAnswer(o) },
    { q: `Is ${code(o.id)} covered by the offline tests?`, a: failedOps.has(o.id) ? `Not fully. Some scenarios failed for it in the run of ${evalDay}. See the eval report.` : `Yes. Every scenario that applies to it passed in the run of ${evalDay}, part of ${evalRun.total.toLocaleString("en")} scenarios over ${OPERATIONS.length} operations.` },
    { q: `How do I see the parameters of ${code(o.id)}?`, a: `Ask for ${code("datev_describe_operation")} with ${code(o.id)}. It shows the parameters, body schema, scopes and servers from the operation index that ${code("npm run specs")} built on your machine.` },
    { q: `What should I check if ${code(o.id)} fails?`, a: failing ? `${liveAnswer(o)} Check the product subscription in the DATEV portal, log in again, and confirm the client has the matching data service switched on.` : `Read the HTTP status in the answer. 401 or 403 means a missing subscription or scope, 404 an unknown id, 429 the rate limit${o.write ? ", and a refused confirmation code means it was missing, expired, already used, or the request changed after the preview" : ""}. The troubleshooting page explains each one.` },
  ];
}

function productQuestions(p: string): QA[] {
  const ops = OPERATIONS.filter((o) => o.product === p);
  const reads = ops.filter((o) => !o.write);
  const writes = ops.filter((o) => o.write);
  const statusOf = (o: Op) => ledger.get(o.id)?.status;
  const reached = reads.filter((o) => typeof statusOf(o) === "number");
  const ok = reached.filter((o) => (statusOf(o) as number) < 300);
  const scopes = [...new Set(ops.flatMap((o) => o.scopes))];
  const withSandbox = ops.filter((o) => o.servers.sandbox).length;
  const sandbox = withSandbox === ops.length ? "every operation has" : withSandbox === 0 ? "no operation has" : `${withSandbox} of ${ops.length} operations have`;
  return [
    { q: `What is the ${code(p)} product?`, a: `A DATEV API product in the ${family(p)} area with ${ops.length} operations, ${reads.length} that read and ${writes.length} that change data.` },
    { q: `Which operations of ${code(p)} only read?`, a: reads.length ? reads.map((o) => code(o.id)).join(", ") + "." : "None." },
    { q: `Which operations of ${code(p)} change data?`, a: writes.length ? `${writes.map((o) => code(o.id)).join(", ")}.${writes.some((o) => o.id === "accounting-dataexchange.postaccountpostingsjob") ? ` Through ${code("datev_call")} each goes through the preview and confirmation code. ${code("datev_account_postings")} starts the postings export job directly.` : " Through `datev_call` each goes through the preview and confirmation code, unless it needs a file upload, which `datev_call` cannot send."}` : "None. Every operation only reads." },
    { q: `How did ${code(p)} do in the DATEV sandbox?`, a: reads.length ? `${reached.length} of ${reads.length} read operations reached DATEV in the live sweep, and ${ok.length} answered with 2xx. The sweep recorded only status codes, so the reason for other answers is not known.` : "It has no read operations, so it was not swept live." },
    { q: `Which scopes does ${code(p)} use?`, a: scopes.length ? scopes.map(code).join(", ") + "." : "DATEV's spec names no scopes for it. Access depends on the product subscription." },
    { q: `Does ${code(p)} work in the sandbox?`, a: `In DATEV's spec ${sandbox} a sandbox server. Your app also has to be subscribed to the product.` },
    { q: `How do I find the right ${code(p)} operation?`, a: ops.every((o) => o.health) ? `It only has health checks. ${code("datev_search_operations")} leaves them out unless you pass ${code("include_health: true")}. You can also ask for ${code("datev_describe_operation")} with ${ops.map((o) => code(o.id)).join(" or ")}.` : `Ask for ${code("datev_search_operations")} with ${code(`product: "${p}"`)} and a few words about the task.` },
    { q: `Is ${code(p)} fully tested offline?`, a: ops.some((o) => failedOps.has(o.id)) ? "Some scenarios failed for it. See the eval report." : `Yes. All its operations passed every scenario that applies in the run of ${evalDay}.` },
  ];
}

const CATEGORY: [RegExp, string][] = [
  [/^search\./, "Searching the operation index by an operation's own summary finds that operation in the top 50 results."],
  [/^url\.sandbox-no-server/, "An operation without a sandbox server is refused in the sandbox instead of being sent to production."],
  [/^url\./, "Each operation is sent to the DATEV host its spec names for that environment and nowhere else."],
  [/^query\.array/, "Array query values are encoded as repeated parameters."],
  [/^query\.injection/, "Characters like &, = and # in a query value are encoded and cannot add parameters."],
  [/^query\.missing/, "A missing required query parameter is refused before anything is sent."],
  [/^header\.reserved/, "Headers the server sets, such as Authorization or the client id, cannot be overridden by the caller."],
  [/^header\.crlf/, "A header value with a line break is refused, so no header can be injected."],
  [/^header\.missing/, "A missing required header parameter is refused before anything is sent."],
  [/^path\.traversal/, "Path values like `..`, `/` or a backslash are refused."],
  [/^path\.encoding/, "Unusual path values (umlauts, spaces, emoji, ?, #) are percent-encoded correctly."],
  [/^path\.missing/, "A missing path parameter is refused before anything is sent."],
  [/^path\.schema/, "Path values that break DATEV's schema for that parameter are refused."],
  [/^path\.segment/, "Values that could shift a shared path segment are refused."],
  [/^body\.unexpected/, "An operation that takes no body refuses one."],
  [/^body\.required/, "An operation that needs a body refuses a call without one."],
  [/^body\.file-as-json/, "A file upload operation refuses a JSON body."],
  [/^cancel\./, "A call cancelled before it starts sends nothing to DATEV."],
  [/^network\./, "Network errors are reported clearly and retried only for reads, three attempts at most."],
  [/^auth\./, "Every request carries the bearer token and the DATEV client headers, and nothing else is trusted."],
  [/^wire\./, "What goes on the wire, URL, method, body bytes and content type, matches the request exactly."],
  [/^binary\./, "Binary answers such as PDFs come back byte for byte."],
  [/^deadline\./, "A retry that cannot finish inside the call budget is not started."],
  [/^status\./, "DATEV's error status is passed through after one call, never turned into a success."],
  [/^parse\.truncated/, "An answer cut at the size cap is marked as truncated."],
  [/^parse\./, "Answers in this format are read correctly, including NDJSON, plain text, empty bodies and German umlauts."],
  [/^retry\.exhausted/, "After the last retry the final status is returned, with three attempts for reads and one for writes."],
  [/^retry\./, "Reads retry this status and succeed when DATEV recovers. Writes are not retried, except 429."],
  [/^cap\./, "An endless answer stream is stopped at the cap instead of filling memory."],
  [/^write\./, "A write without confirmation returns a preview and sends nothing."],
  [/^prop\.ndjson/, "Property test: every generated list written as NDJSON reads back as the same list."],
  [/^prop\.fiscal-year-ids-refuse/, "Property test: strings without the eight digit fiscal year shape are refused. The check is the shape only, it does not test whether the date exists."],
  [/^prop\.fiscal-year-ids/, "Property test: real eight digit fiscal year ids are accepted in every shape DATEV sends."],
  [/^prop\.job-phase/, "Property test: every generated job state is read as done, failed or running."],
  [/^prop\.account-prefix/, "Property test: an account prefix search returns only accounts with that prefix, within the limit."],
  [/^prop\.path-encoding/, "Property test: each generated path value without separators is encoded and decodes back to itself."],
  [/^prop\.extf/, "Property test: every batch the writer produces passes the EXTF check."],
];

function categoryQuestions(): QA[] {
  return Object.entries(evalRun.categories).flatMap(([name, r]) => [
    { q: `What does the ${code(name)} check prove?`, a: CATEGORY.find(([re]) => re.test(name))?.[1] ?? "A generated check from the offline scenario run." },
    { q: `Did the ${code(name)} check pass?`, a: `${r.pass.toLocaleString("en")} passed and ${r.fail} failed in the run of ${evalDay}.` },
  ]);
}

const STATUSES: [number, string][] = [
  [200, "Success. Typed tools still check the shape before showing it."], [201, "Created. A write succeeded."], [202, "Accepted. DATEV will process it as a job, for example an EXTF import."],
  [204, "Success without a body."], [400, statusMeaning(400)], [401, statusMeaning(401)], [403, statusMeaning(403)], [404, statusMeaning(404)],
  [405, "The method is not allowed for that path. Check the operation id."], [406, "DATEV cannot answer in the requested format."], [409, "A conflict, for example the record changed or already exists."],
  [415, "The content type was not accepted. Check `content_type` or the file type."], [422, "DATEV understood the request but the content breaks its rules. The body explains which."],
  [429, "DATEV's rate limit. Reads retry with Retry-After, writes are retried only for this status."], [500, statusMeaning(500)],
  [502, "Gateway error. Reads retry it."], [503, "Service unavailable. Reads retry it."], [504, "Gateway timeout. Reads retry it."],
];
function statusQuestions(): QA[] {
  return STATUSES.flatMap(([n, m]) => [
    { q: `What does HTTP ${n} from DATEV mean?`, a: m },
    { q: `Does the server retry HTTP ${n}?`, a: n === 429 ? "Yes, for reads and writes, as long as the wait fits the call budget." : [502, 503, 504].includes(n) ? "Yes, for reads only, up to three attempts within the call budget." : "No. The answer is returned as it is." },
  ]);
}

function render(title: string, intro: string, items: QA[], extra = ""): string {
  const head = ["<!-- freshness: 30d -->", `# ${title}`, "", intro, "", ...(extra ? [extra, ""] : []), `${items.length} questions. Generated by \`npx tsx scripts/build-qa.ts\`. Do not edit by hand.`, ""];
  return [...head, ...items.flatMap(({ q, a }) => [`### ${q}`, "", a, ""])].join("\n");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/operations`, { recursive: true });
const index: { file: string; title: string; count: number }[] = [];
const emit = (file: string, title: string, intro: string, items: QA[], extra = "") => {
  writeFileSync(`${OUT}/${file}`, render(title, intro, items, extra));
  index.push({ file, title, count: items.length });
};
for (const sec of CURATED as Section[]) emit(`${sec.slug}.md`, sec.title, sec.intro, sec.items);
emit("http-status-codes.md", "HTTP status codes", "What each status from DATEV means and whether it is retried.", statusQuestions());
emit("test-coverage.md", "Offline test coverage", `What each scenario category of the offline run proves. The run of ${evalDay} had ${evalRun.total.toLocaleString("en")} scenarios, ${evalRun.failed} failed.`, categoryQuestions());
const products = [...new Set(OPERATIONS.map((o) => o.product))].sort();
emit("products.md", "DATEV API products", `The ${products.length} API products the server covers, from the operation index and the live sweep.`, products.flatMap(productQuestions));
for (const p of products) {
  emit(`operations/${p}.md`, `Operations of ${p}`, `Every operation of the ${p} product in the ${family(p)} area, with its measured results.`, OPERATIONS.filter((o) => o.product === p).flatMap(opQuestions), "Back to the [Q&A index](../README.md).");
}
const total = index.reduce((n, s) => n + s.count, 0);
writeFileSync(`${OUT}/README.md`, [
  "<!-- freshness: 30d -->", "# Questions and answers", "",
  `${total.toLocaleString("en")} answered questions about datev-mcp and the DATEV APIs it covers. Can't find yours? Ask in the repository's Discussions under Q&A.`, "",
  "The hand-written sections cover setup, login, safety, compliance, the tools, EXTF files, documents, troubleshooting and the questions people ask about the DATEV API in DATEV's community, on Reddit and in YouTube walkthroughs. The generated sections come from the operation index, the live sandbox ledger and the offline test report, so every number is measured, not written by hand.", "",
  "It names DATEV operation ids and scopes only. DATEV's own descriptions stay out, because their terms do not allow passing their API documentation on.", "",
  "| Section | Questions |", "|---|---|", ...index.map((s) => `| [${s.title}](${s.file}) | ${s.count} |`), `| **Total** | **${total.toLocaleString("en")}** |`, "",
  "Regenerate with `npm run eval` and then `npx tsx scripts/build-qa.ts`.", "",
].join("\n"));
console.log(`docs/qa: ${index.length} files, ${total} questions`);
