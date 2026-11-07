import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { decodeBytes, encodeCp1252, formatFinding, validateExtf, writeBuchungsstapel, type Report } from "@seamless-engineering/datev-extf";
import { callOperation, CallError, type CallDeps } from "../api/client.js";
import { NeedsLoginError } from "../auth/session.js";
import { getOperation } from "./catalog.js";
import { checkConfirmToken, issueConfirmToken } from "./confirm.js";
import { FileError, readLocalFile, writeLocalFile } from "./files.js";

// EXTF validation and writing use @seamless-engineering/datev-extf (MIT). See CREDITS.md.

const MAX_EXTF_BYTES = 50 * 1024 * 1024;
const MAX_FINDINGS = 100;

type Lang = "de" | "en";
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const err = (m: string) => ({ ...ok(m), isError: true });

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
});

export function registerExtfTools(server: McpServer, deps: (signal?: AbortSignal) => CallDeps): void {
  server.registerTool(
    "datev_validate_extf",
    {
      title: "Check a DATEV EXTF file",
      description:
        "Check an EXTF file (Buchungsstapel, Debitoren/Kreditoren) before importing it into DATEV. Explains every problem with line, field and a plain-language fix, in German or English. Runs locally, nothing is sent to DATEV.",
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
        const csv = writeBuchungsstapel(
          { berater: a.berater, mandant: a.mandant, wjStart: a.wj_start, skl: a.account_length, from: a.from, to: a.to, label: a.label, skr: a.skr ?? "", created: new Date() },
          a.rows.map((r) => ({ amount: r.amount_cents, side: r.side, account: r.account, contra: r.contra_account, key: r.bu_key, day: r.day, month: r.month, beleg1: r.beleg1, text: r.text })),
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

  server.registerTool(
    "datev_upload_extf",
    {
      title: "Upload an EXTF file to DATEV",
      description:
        "Send a checked EXTF file to a DATEV client's accounting (extf-files import). The file is validated first and refused if it has errors. The first call returns a preview and a confirm_token. Show it to the user, then call again with confirm: true and that token.",
      inputSchema: {
        client_id: z.string().describe("DATEV client id, e.g. 455148-1"),
        file_path: z.string(),
        confirm: z.boolean().optional(),
        confirm_token: z.string().optional().describe("The token returned by the preview"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ client_id, file_path, confirm, confirm_token }, extra) => {
      try {
        const file = readLocalFile(file_path, MAX_EXTF_BYTES);
        const summary = summarizeReport(validateBytes(file.bytes), "de");
        if (!summary.valid) return { ...ok({ uploaded: false, reason: "Fix the EXTF errors before uploading", ...summary }), isError: true };
        const d = deps(extra.signal);
        const fingerprint = { tool: "datev_upload_extf", env: d.env, client_id, file: file.path, sha256: createHash("sha256").update(file.bytes).digest("hex") };
        if (confirm !== true) {
          return ok({
            preview: true,
            note: `Nothing was sent. This imports ${summary.rows} rows into DATEV ${d.env} client ${client_id}. Ask the user, then call again with confirm: true and this confirm_token.`,
            file: file.path,
            header: summary.header,
            warnings: summary.warnings,
            confirm_token: issueConfirmToken(fingerprint),
          });
        }
        const refused = checkConfirmToken(confirm_token, fingerprint);
        if (refused) return err(refused);
        const op = getOperation("accounting-extf-files.importextffile");
        if (!op) return err("EXTF import operation missing from the index");
        const r = await callOperation(op, { pathParams: { "client-id": client_id }, headers: { Filename: file.name }, rawBody: file.bytes }, d);
        const out = { uploaded: r.status >= 200 && r.status < 300, status: r.status, job_location: r.location, body: r.body, env: d.env };
        return out.uploaded ? ok(out) : { ...ok(out), isError: true };
      } catch (e) {
        return err(errorText(e));
      }
    },
  );
}
