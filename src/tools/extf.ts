import { createHash } from "node:crypto";
import { humanApproval } from "./approval.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BUCHUNGSSTAPEL_COLUMNS,
  decodeBytes,
  encodeCp1252,
  formatFinding,
  parseCsv,
  quote,
  validateExtf,
  writeBuchungsstapel,
  type BatchHeader,
  type BatchRow,
  type Report,
} from "@seamless-engineering/datev-extf";
import { buildHeaders, buildUrl, callOperation, CallError, UncertainSendError, problemFields, problemText, type CallDeps } from "../api/client.js";
import { describeClient, hideClientId } from "../api/client-gate.js";
import { requireClientService } from "../api/permission.js";
import { acceptedBefore, finishSend, reserveSend, sentBefore, type SentEntry } from "./sent-ledger.js";
import { NeedsLoginError } from "../auth/session.js";
import { getOperation } from "./catalog.js";
import { checkConfirmToken, issueConfirmToken } from "./confirm.js";
import { localize } from "../i18n.js";
import { FileError, readLocalFile, writeLocalFile } from "./files.js";

// EXTF validation and writing use @seamless-engineering/datev-extf (MIT). See CREDITS.md.

const MAX_EXTF_BYTES = 50 * 1024 * 1024;
const MAX_FINDINGS = 100;

type Lang = "de" | "en";
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ ...ok(localize(m)), isError: true });

function errorText(e: unknown): string {
  if (e instanceof FileError || e instanceof CallError || e instanceof NeedsLoginError) return e.message;
  return `Failed: ${e instanceof Error ? e.message : String(e)}`;
}

export function summarizeReport(report: Report, lang: Lang) {
  const errors = report.findings.filter((f) => f.severity === "error").length;
  return {
    valid: errors === 0,
    errors,
    warnings: report.findings.length - errors,
    rows: report.rows,
    encoding: report.encoding,
    header: report.header,
    findings: report.findings.slice(0, MAX_FINDINGS).map((f) => ({
      severity: f.severity,
      code: f.code,
      line: f.line,
      field: f.fieldName ?? f.field,
      message: formatFinding(f, lang),
    })),
    more_findings: Math.max(0, report.findings.length - MAX_FINDINGS),
  };
}

export function validateBytes(bytes: Uint8Array): Report {
  return validateExtf(decodeBytes(bytes));
}

const KOST1 = BUCHUNGSSTAPEL_COLUMNS.indexOf("KOST1 - Kostenstelle");
const KOST2 = BUCHUNGSSTAPEL_COLUMNS.indexOf("KOST2 - Kostenstelle");
const KOST_PATTERN = /^[A-Za-z0-9_ ]{1,36}$/;
const CRLF = "\r\n";

// The library writer has no cost centre fields, so KOST1 and KOST2 are set on each data row here.
export function writeBatch(header: BatchHeader, rows: (BatchRow & { kost1?: string; kost2?: string })[]): string {
  const csv = writeBuchungsstapel(header, rows);
  if (!rows.some((r) => r.kost1 || r.kost2)) return csv;
  const lines = csv.split(CRLF);
  rows.forEach((r, i) => {
    if (!r.kost1 && !r.kost2) return;
    const cells = parseCsv(lines[i + 2], ";").rows[0].cells;
    if (r.kost1) cells[KOST1] = { value: r.kost1, quoted: true };
    if (r.kost2) cells[KOST2] = { value: r.kost2, quoted: true };
    lines[i + 2] = cells.map((c) => (c.quoted ? quote(c.value) : c.value)).join(";");
  });
  return lines.join(CRLF);
}

const batchRow = z.object({
  amount_cents: z.number().int().positive().describe("Unsigned amount in cents, e.g. 11900 for 119,00 EUR"),
  side: z.enum(["S", "H"]).describe("S = Soll (debit), H = Haben (credit)"),
  account: z.string(),
  contra_account: z.string(),
  bu_key: z.string().optional().describe("BU-Schlüssel, leave empty for automatic accounts"),
  day: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12),
  beleg1: z.string().optional().describe("Belegfeld 1, e.g. invoice number"),
  text: z.string().optional().describe("Buchungstext"),
  kost1: z.string().regex(KOST_PATTERN).optional().describe("KOST1 cost centre, up to 36 letters, digits, spaces or underscores"),
  kost2: z.string().regex(KOST_PATTERN).optional().describe("KOST2 cost centre, same format as kost1"),
});

export function registerExtfTools(server: McpServer, deps: (signal?: AbortSignal) => CallDeps): void {
  server.registerTool(
    "datev_validate_extf",
    {
      title: "Check a DATEV EXTF file",
      description:
        "Check an EXTF file (Buchungsstapel, Debitoren/Kreditoren) before importing it into DATEV. Explains each problem with line, field and a plain-language fix, in German or English, up to 100 findings, and says how many more there are. Runs locally, nothing is sent to DATEV.",
      inputSchema: {
        file_path: z.string().optional().describe("Absolute path to the .csv file"),
        content: z.string().optional().describe("File content, if no path is given"),
        lang: z.enum(["de", "en"]).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ file_path, content, lang }) => {
      try {
        if (!file_path && content === undefined) return err("Pass file_path or content.");
        const bytes = file_path ? readLocalFile(file_path, MAX_EXTF_BYTES).bytes : new TextEncoder().encode(content);
        return ok(summarizeReport(validateBytes(bytes), lang ?? "de"));
      } catch (e) {
        return err(errorText(e));
      }
    },
  );

  server.registerTool(
    "datev_write_extf_batch",
    {
      title: "Write a DATEV Buchungsstapel file",
      description:
        "Create an EXTF Buchungsstapel (booking batch) file in Windows-1252, Formatversion 13. The file is checked with the validator before it is written. Runs locally.",
      inputSchema: {
        output_path: z.string().describe("Absolute path for the new .csv file"),
        overwrite: z.boolean().optional(),
        berater: z.string().describe("Beraternummer"),
        mandant: z.string().describe("Mandantennummer"),
        wj_start: z.string().regex(/^\d{8}$/).describe("Fiscal year start, YYYYMMDD"),
        account_length: z.number().int().min(4).max(9).describe("Sachkontenlänge, e.g. 4 (or 8 for long account numbers)"),
        from: z.string().regex(/^\d{8}$/).describe("Batch period start, YYYYMMDD"),
        to: z.string().regex(/^\d{8}$/).describe("Batch period end, YYYYMMDD"),
        label: z.string().max(30).describe("Bezeichnung of the batch"),
        skr: z.enum(["03", "04", ""]).optional(),
        rows: z.array(batchRow).min(1).max(99_999),
        lang: z.enum(["de", "en"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (a) => {
      try {
        const csv = writeBatch(
          { berater: a.berater, mandant: a.mandant, wjStart: a.wj_start, skl: a.account_length, from: a.from, to: a.to, label: a.label, skr: a.skr ?? "", created: new Date() },
          a.rows.map((r) => ({ amount: r.amount_cents, side: r.side, account: r.account, contra: r.contra_account, key: r.bu_key, day: r.day, month: r.month, beleg1: r.beleg1, text: r.text, kost1: r.kost1?.trim(), kost2: r.kost2?.trim() })),
        );
        const bytes = encodeCp1252(csv);
        const summary = summarizeReport(validateBytes(bytes), a.lang ?? "de");
        if (!summary.valid) return { ...ok({ written: false, reason: "The generated batch does not pass the EXTF check", ...summary }), isError: true };
        const path = writeLocalFile(a.output_path, bytes, a.overwrite ?? false);
        return ok({ written: true, path, bytes: bytes.length, ...summary });
      } catch (e) {
        return err(errorText(e));
      }
    },
  );

  // DATEV: an EXTF import answers 202 even for a broken or infected file, so only the job result counts.
  const jobOf = async (clientId: string, jobId: string, d: CallDeps): Promise<{ result: string; job: Record<string, unknown> }> => {
    const op = getOperation("accounting-extf-files.getjob");
    if (!op) throw new CallError("EXTF job operation missing from the index");
    const r = await callOperation(op, { pathParams: { "client-id": clientId, "job-id": jobId } }, d);
    if (r.status !== 200 || !r.body || typeof r.body !== "object") throw new CallError(`DATEV returned HTTP ${r.status} for ${op.id}: ${problemText(r.status, r.body)}`);
    const job = r.body as Record<string, unknown>;
    return { result: typeof job.result === "string" ? job.result : "pending", job };
  };
  const alreadySent = (e: SentEntry) => {
    const accepted = e.status === "sent" ? undefined : acceptedBefore(e.previous);
    const earlierImport = accepted ? ` DATEV already accepted it on ${accepted.at}${accepted.job_id ? ` (job ${accepted.job_id})` : ""}.` : "";
    return e.status === "sending"
      ? `This file is being sent to this client right now (started ${e.at}). Wait for that send to finish.${earlierImport}`
      : e.status === "uncertain"
        ? `This file was being sent to this client on ${e.at} (${e.name}) and DATEV's answer was lost or was a server error, so it may already be imported.${earlierImport} Check the batch in DATEV Rechnungswesen; to send it again on purpose, call with resend: true.`
        : `This file was already sent to this client on ${e.at} (${e.name}${e.job_id ? `, job ${e.job_id}` : ""}). DATEV requires booking data to be sent only once. To send it again on purpose, call with resend: true.`;
  };

  const jobAnswer = (clientId: string, jobId: string, result: string, job: Record<string, unknown>, env: string, extraFields: Record<string, unknown> = {}) => {
    const base = { job_id: jobId, result, records: job.number_of_accounting_records, file: job.filename, env, ...extraFields };
    if (result === "succeeded") return ok({ imported: true, ...base });
    if (result === "failed") return { ...ok({ imported: false, ...base, validation_details: job.validation_details, note: "DATEV did not import the file. Fix the reasons in validation_details, then send it again with resend: true." }), isError: true };
    return ok({ imported: false, ...base, note: `DATEV is still processing the file. Check again with datev_extf_job (client_id ${clientId}, job_id ${jobId}). Do not send it again.` });
  };

  server.registerTool(
    "datev_upload_extf",
    {
      title: "Upload an EXTF file to DATEV",
      description:
        "Send a checked EXTF file to a DATEV client's accounting (Buchungsdatenservice). The file is validated first and refused if it has errors, the server checks at DATEV that the client switched Buchungsdatenservice on, and a file that was already sent to this client is refused unless resend is true (for a deliberate support case). The first call returns a preview and a confirm_token. Show it to the user, then call again with confirm: true and that token. After sending, the server waits for DATEV's import job and reports imported only when DATEV confirms it.",
      inputSchema: {
        client_id: z.string().describe("Technical client id from datev_list_clients (format consultant-client, e.g. 12345-1). Never invent one."),
        file_path: z.string(),
        resend: z.boolean().optional().describe("Send a file again that was already sent to this client. Only for a deliberate support case"),
        confirm: z.boolean().optional(),
        confirm_token: z.string().optional().describe("The token returned by the preview"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ client_id, file_path, resend, confirm, confirm_token }, extra) => {
      try {
        const file = readLocalFile(file_path, MAX_EXTF_BYTES);
        const summary = summarizeReport(validateBytes(file.bytes), "de");
        if (!summary.valid) return { ...ok({ uploaded: false, reason: "Fix the EXTF errors before uploading", ...summary }), isError: true };
        const op = getOperation("accounting-extf-files.importextffile");
        if (!op) return err("EXTF import operation missing from the index");
        // DATEV requires the name pattern EXTF_*.csv; checked here so a preview is never confirmed for a file DATEV refuses.
        buildHeaders(op, { headers: { Filename: file.name } });
        const d = deps(extra.signal);
        const sha256 = createHash("sha256").update(file.bytes).digest("hex");
        // The permission comes first: an earlier send is only shown to a login that may see this client.
        const client = await requireClientService(client_id, ["Buchungsdatenservice"], d);
        const earlier = sentBefore("extf", d.env, client_id, sha256);
        if (earlier && resend !== true) return err(alreadySent(earlier));
        const who = describeClient(client);
        // A resend is bound to the earlier send the person saw, so a newer send in between needs a new preview.
        const fingerprint = { tool: "datev_upload_extf", env: d.env, client_id, file: file.path, name: file.name, sha256, resend: resend === true, earlier_at: earlier?.at ?? null };
        if (confirm !== true) {
          return ok({
            preview: true,
            note: localize(`Nothing was sent. This imports ${summary.rows} rows into Buchungsdatenservice of ${who} in DATEV ${d.env}${earlier ? ", AGAIN although it was sent before" : ""}. Ask the user, then call again with confirm: true and this confirm_token.`),
            client: { name: client.name, consultant_number: client.consultant_number, client_number: client.client_number },
            destination: buildUrl(op, d.env, { pathParams: { "client-id": client_id } }).toString(),
            file: file.path,
            header: summary.header,
            warnings: summary.warnings,
            confirm_token: issueConfirmToken(fingerprint),
          });
        }
        const refused = checkConfirmToken(confirm_token, fingerprint);
        if (refused) return err(refused);
        const denied = await humanApproval(server, d.env, `Import ${summary.rows} booking rows from ${file.name} into Buchungsdatenservice of ${who}${earlier ? " (sent again)" : ""}\n${hideClientId(String(buildUrl(op, d.env, { pathParams: { "client-id": client_id } })), [client_id])}`);
        if (denied) return err(denied);
        // Reserved under the lock before the POST: two confirmations racing cannot both send the file.
        const held = await reserveSend("extf", d.env, client_id, sha256, file.name, resend === true ? { seen: earlier?.at } : false);
        if ("blocked" in held) return err(alreadySent(held.blocked));
        const finish = (outcome: Parameters<typeof finishSend>[5]) => finishSend("extf", d.env, client_id, sha256, held.reservation, outcome);
        // A lost answer leaves the reservation in place, so the file counts as sent until DATEV shows otherwise.
        let r;
        try {
          r = await callOperation(op, { pathParams: { "client-id": client_id }, headers: { Filename: file.name }, rawBody: file.bytes }, d);
        } catch (e) {
          // Refused before DATEV was asked: release. Unknown outcome: the reservation stays.
          await finish(e instanceof UncertainSendError ? { status: "uncertain" } : { status: "refused" }).catch(() => undefined);
          throw e;
        }
        if (r.status < 200 || r.status >= 300) {
          // Only a clear 4xx is DATEV refusing the file. A 5xx, a 408 timeout or a redirect says nothing about
          // whether DATEV took it, so the send stays uncertain and the file is never sent again by accident.
          await finish(r.status >= 400 && r.status < 500 && r.status !== 408 ? { status: "refused" } : { status: "uncertain" });
          const out = { uploaded: false, status: r.status, body: r.body, truncated: r.truncated, env: d.env, ...(r.status >= 400 ? problemFields(r.status, r.body, op.id) : {}) };
          return { ...ok(out), isError: true };
        }
        const jobId = r.location?.split("?")[0]?.split("/").filter(Boolean).pop();
        const recorded = await finish({ status: "sent", job_id: jobId }).then(
          () => undefined,
          (e: Error) => `The file was accepted, but the send record could not be updated (${e.message}); it still counts as sent.`,
        );
        if (!jobId) return { ...ok({ uploaded: true, imported: false, note: "DATEV accepted the file but named no job, so the import cannot be confirmed. Check the batch in DATEV Rechnungswesen.", env: d.env, ...(recorded ? { record: recorded } : {}) }), isError: true };
        // DATEV: wait at least the Retry-After seconds. A longer wait than this call allows is left to datev_extf_job.
        const sleep = d.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
        const retryAfter = Math.max(Number(r.retryAfter) || 5, 1);
        if (retryAfter > 20)
          return ok({ uploaded: true, imported: false, job_id: jobId, env: d.env, note: `DATEV asked to wait ${retryAfter} seconds before asking for the result. Check then with datev_extf_job (client_id ${client_id}, job_id ${jobId}). Do not send the file again.` });
        // The file is with DATEV now: whatever happens while asking for the result, the job id is returned.
        try {
          await sleep(retryAfter * 1000);
          let state = await jobOf(client_id, jobId, d);
          // At most 6 job queries with growing waits, far below DATEV's 30-GETs-per-upload limit. RENAME_OK: the time bound became a count bound.
          for (const wait of [3000, 5000, 8000, 10_000, 12_000]) {
            if (state.result !== "pending") break;
            await sleep(wait); // BESTPRACTICE_OK: polling a job is sequential by nature
            state = await jobOf(client_id, jobId, d); // BESTPRACTICE_OK: same poll
          }
          await finish({ status: "sent", job_id: jobId, result: state.result }).catch(() => undefined);
          return jobAnswer(client_id, jobId, state.result, state.job, d.env, { uploaded: true, truncated: r.truncated, ...(recorded ? { record: recorded } : {}) });
        } catch (e) {
          return { ...ok({ uploaded: true, imported: false, job_id: jobId, env: d.env, note: `DATEV accepted the file, but asking for the result stopped (${errorText(e)}). Check with datev_extf_job (client_id ${client_id}, job_id ${jobId}). Do not send the file again.` }), isError: true };
        }
      } catch (e) {
        return err(errorText(e));
      }
    },
  );

  server.registerTool(
    "datev_extf_job",
    {
      title: "Result of an EXTF import at DATEV",
      description: "Check whether DATEV imported an EXTF file sent earlier with datev_upload_extf, by its job_id.",
      inputSchema: { client_id: z.string(), job_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client_id, job_id }, extra) => {
      try {
        const d = deps(extra.signal);
        const state = await jobOf(client_id, job_id, d);
        return jobAnswer(client_id, job_id, state.result, state.job, d.env);
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
