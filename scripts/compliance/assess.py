import re, sys
from collections import OrderedDict

SRC = sys.argv[1]
OUT = sys.argv[2]

M, P, O, NA, NO = "met", "partial", "open", "n/a", "needs-owner"
NOOFF = "app never requests offline_access (no long-term token; scopes come from services.ts:31-35, none is offline_access or datev:iam:client)"
GEN_ONLY = "only reachable through the generic datev_call/datev_upload_file; the app has no service-specific logic for this"

A = {
    # 1 General
    "GEN-01": (
        NO,
        "Owner books and passes the DATEV approval; prep in docs/DATEV-REVIEW.md:2-6",
    ),
    "GEN-02": (
        NO,
        "Owner books the sandbox and production appointments (docs/DATEV-REVIEW.md:52)",
    ),
    "GEN-03": (
        NO,
        "Owner must pass the production review within 3 months of sandbox approval",
    ),
    "GEN-04": (
        NO,
        "Owner prepares production test, file-format acceptance and test datasets",
    ),
    "GEN-05": (
        NO,
        "Owner must use test data only; stated in docs/DATEV-REVIEW.md:63 and docs/COMPLIANCE.md:11",
    ),
    "GEN-06": (
        NO,
        "Owner runs the screen-share demo; checklist in docs/DATEV-REVIEW.md:57-63",
    ),
    "GEN-07": (NO, "Outcome of the production review"),
    "GEN-08": (
        M,
        "Every DATEV call is triggered by a user/assistant request; no background calls except retrying pending revokes at server start (src/server.ts:37)",
    ),
    "GEN-09": (
        P,
        "Error rate is measured and shown (src/api/http-log.ts:90-121, src/setup/status.ts:59) but nothing alerts or throttles when it passes 10 %; assistant-driven datev_call can generate many 4xx",
    ),
    "GEN-10": (
        P,
        "All gateway calls logged (src/api/client.ts:376-405, src/setup/token-log.ts) and rate computed, but a failed log write is reported once and traffic continues unlogged (src/api/http-log.ts:76-78, ledger F21)",
    ),
    "GEN-11": (
        M,
        "No scheduled polling; the only loop is the bounded postings job poll inside one tool call (src/tools/accounting.ts:228-231)",
    ),
    "GEN-12": (
        P,
        "First-level help exists (README.md:200-201 Discussions Q&A, docs/qa/, docs/SETUP.md:105-117) but no defined support channel or commitment for end users of a production deployment",
    ),
    "GEN-13": (
        M,
        "Every 4xx/5xx tool answer carries DATEV's help URL via problemFields/problemText (src/api/problem.ts:38-47; src/tools/generic.ts:103); test 'every DATEV error answer keeps its help link'",
    ),
    "GEN-14": (NO, "Owner uses DATEV's ticket system and cooperates"),
    "GEN-15": (
        M,
        "Sandbox gateway refusals are raised by the app owner through DATEV's ticket system; the docs and Q&A no longer send people to DATEV for an integration problem, guarded by doc-claims.test.ts",
    ),
    "GEN-16": (
        M,
        "HTTP log covers every API, token, revoke, userinfo, JWKS, status and doctor call (src/api/http-log.ts, src/api/client.ts, src/auth/token-client.ts, src/setup/doctor.ts); calls are refused while the log cannot be written (ledger F31, F32, F33)",
    ),
    "GEN-17": (M, "Retention 30 days (src/api/http-log.ts:8, prune at :55-67)"),
    "GEN-18": (
        M,
        "Timestamp, method, full URL with query and headers without Authorization are logged; text bodies up to 8000 characters inline, larger ones in logs/bodies/<sha>.txt for retrieval on demand (src/api/http-log.ts bodyFingerprint; ledger F33)",
    ),
    "GEN-19": (
        M,
        "Response timestamp, status + status text, all response headers incl. X-Global-Transaction-ID/V-Cap-Request-ID, body only for errors and job/status URLs (src/api/client.ts:384,405; http-log.ts:46-48)",
    ),
    "GEN-20": (M, "Authorization Code flow with PKCE (src/auth/authorize.ts:17)"),
    "GEN-21": (
        M,
        "Connecting is a separate CLI command (src/index.ts:13-15, src/setup/login.ts); MCP tools only exchange data",
    ),
    "GEN-22": (
        M,
        "Dedicated 'datev-mcp login' command, labelled 'Mit DATEV verbinden' (src/index.ts:13)",
    ),
    "GEN-23": (
        M,
        "Green/red light plus AKTIV/INAKTIV (src/setup/status.ts:114, :78-79, :92-93); also datev_connection_status tool (src/tools/connection.ts)",
    ),
    "GEN-24": (
        M,
        "'datev-mcp disconnect' revokes at /revoke then deletes the local session (src/setup/disconnect.ts:36-50); test 'disconnect revokes at DATEV and deletes the session'",
    ),
    "GEN-25": (
        M,
        "Expiry shown as TT.MM.JJJJ HH:MM in German time (src/setup/status.ts:15-18, :53-57)",
    ),
    "GEN-26": (
        M,
        "Login fails, saves nothing and revokes its tokens when userinfo gives no full name (src/setup/login.ts, test: a login without the full user name saves nothing; ledger F17)",
    ),
    "GEN-27": (
        M,
        "https://apps.datev.de/tokrevui in status and disconnect messages (src/setup/status.ts:13, :128; disconnect.ts:24,32)",
    ),
    "GEN-28": (
        M,
        "Logout is 'disconnect' (alias 'logout', src/index.ts:38), which revokes the refresh token",
    ),
    "GEN-29": (
        M,
        "A new login revokes the previous refresh token and keeps unconfirmed ones encrypted and retried (src/auth/pending-revoke.ts); a failed login revokes the tokens it received (ledger F05, F30)",
    ),
    "GEN-30": (
        O,
        "Access token is not revoked after a data exchange; it lives until expiry (src/auth/session.ts:36)",
    ),
    "GEN-31": (NA, NOOFF),
    "GEN-32": (NA, NOOFF),
    "GEN-33": (NA, NOOFF),
    "GEN-34": (NA, NOOFF),
    "GEN-35": (
        M,
        "Fresh state, nonce and PKCE verifier per login (src/setup/login.ts:50-52, src/auth/pkce.ts:6-22); test in auth.test.ts",
    ),
    "GEN-36": (
        M,
        "Tokens AES-256-GCM encrypted with the key in the OS credential store; the app never stores the client secret, and a Public client has none (src/config.ts, docs/SETUP.md; ledger F28, F43)",
    ),
    "GEN-37": (
        M,
        "Secret headers stripped from logs (src/api/http-log.ts:9,28-34); status never returns a token (src/tools/connection.ts:12)",
    ),
    "GEN-38": (
        M,
        "User must choose data services; only their scopes are requested and other operations refused (src/auth/services.ts:40-50, src/setup/login.ts:39-44, src/api/client.ts:112-117). accounting-clients scope auto-added for the permission check (services.ts:46, ledger F35)",
    ),
    "GEN-39": (
        NO,
        "Owner explains entity and token handling in the appointment; mapping table prepared in docs/DATEV-REVIEW.md:21-26",
    ),
    "GEN-40": (
        M,
        "One install per person, one session per DATEV user, stored in that user's OS credential store (docs/DATEV-REVIEW.md:19, src/auth/session-key.ts); production writes need human approval (src/tools/approval.ts:10-11)",
    ),
    "GEN-41": (
        M,
        "No DATEV logo or artwork used (docs/TRADEMARKS.md:4-8); signed terms not verified here",
    ),
    "GEN-42": (
        M,
        "DATEV in capitals, data-service names as DATEV writes them (src/auth/services.ts:8-24); no logo",
    ),
    "GEN-43": (
        NO,
        "Owner presents architecture; diagram prepared in docs/DATEV-REVIEW.md:10-19",
    ),
    "GEN-44": (
        P,
        "Each user registers their own DATEV app and supplies its credentials (README.md:30, src/config.ts:15); there is no concept for distributing one vendor production API client securely to all users",
    ),
    # 2 Auth
    "AUTH-01": (
        M,
        "state is 32 random bytes (43 chars) and checked >= 20 (src/auth/pkce.ts:6-8, src/auth/authorize.ts:13)",
    ),
    "AUTH-02": (
        M,
        "code_challenge_method S256 (src/auth/authorize.ts:24, src/auth/pkce.ts:10-12)",
    ),
    "AUTH-03": (
        M,
        "openid always included, scopes space-separated (src/auth/authorize.ts:14,20)",
    ),
    "AUTH-04": (
        M,
        "Refresh under a cross-process lock with shared in-process promise; spent token never kept (src/auth/session.ts:37-55)",
    ),
    "AUTH-05": (
        M,
        "HTTP Basic client auth (src/auth/token-client.ts:70-71); will change for the Public client (F43)",
    ),
    "AUTH-06": (
        M,
        "Separate revoke for refresh and access token with token_type_hint (src/setup/disconnect.ts:36-42, src/auth/token-client.ts:150)",
    ),
    "AUTH-07": (
        M,
        "Authorization Code flow, response_type=code (src/auth/authorize.ts:17)",
    ),
    "AUTH-08": (M, "enableWindowsSso=true sent (src/auth/authorize.ts:25)"),
    "AUTH-09": (NA, NOOFF),
    "AUTH-10": (NA, NOOFF),
    "AUTH-11": (
        M,
        "Revocation implemented anyway (src/setup/disconnect.ts); offline token itself not used",
    ),
    "AUTH-12": (
        M,
        "tokrevui link in status and disconnect output (src/setup/status.ts:13,128)",
    ),
    "AUTH-13": (
        NO,
        "Code supports a Public client without a secret (ledger F43, commit 8a3374d). The owner must run the production app as a Public client: ask DATEV to switch it, then remove DATEV_CLIENT_SECRET",
    ),
    "AUTH-14": (
        M,
        "Redirect is http://localhost, never an IP or https://localhost (src/auth/callback-server.ts); Public client supported (ledger F43)",
    ),
    "AUTH-15": (
        NO,
        "Owner keeps the portal app configuration (redirect URLs, name) valid",
    ),
    "AUTH-16": (
        NA,
        "Not a web application: local CLI/stdio process, no browser session (docs/DATEV-REVIEW.md:10-19)",
    ),
    "AUTH-17": (
        NO,
        "Code supports Public clients (ledger F43). The owner picks Public and a recognisable app name in the developer portal",
    ),
    "AUTH-18": (
        M,
        "Bearer header on API and userinfo calls (src/api/client.ts:361, src/auth/userinfo.ts:19)",
    ),
    # 3 Redirect
    "REDIR-01": (
        NO,
        "Code supports Public clients (ledger F43). The owner must make sure no invalid redirect URL stays registered on the production app",
    ),
    "REDIR-02": (
        NO,
        "Owner removes the localhost URL from the Confidential app or asks DATEV by email to switch the app to Public (code side tracked as F43)",
    ),
    # 4 Errors
    "ERR-01": (
        M,
        "problem+json title/detail parsed, also list-shaped and legacy shapes (src/api/problem.ts:15-35)",
    ),
    "ERR-02": (
        M,
        "401/403/404 causes explained to users (docs/qa/http-status-codes.md:48-60, docs/SETUP.md:110)",
    ),
    # 5 Docs
    "DOC-01": (
        M,
        "Data-service names as DATEV writes them in CLI and tool output (src/auth/services.ts:8-24); some labels add the API id in brackets",
    ),
    "DOC-02": (
        M,
        "datev-mcp services, datev_check_client and every permission refusal show the steps before first use with http://go.datev.de/datenservices-einrichten (src/index.ts, src/api/client-gate.ts, src/api/permission.ts)",
    ),
    "DOC-03": (
        M,
        "docs/DATA-SERVICES.md bundles everything a client, tax advisor and the person setting up datev-mcp needs per data service",
    ),
    "DOC-04": (
        M,
        "docs/DATA-SERVICES.md names each data service, the DATEV-side steps with the setup link, and the datev-mcp steps and settings",
    ),
    "DOC-05": (
        NO,
        "Own media exists (docs/, README); a DATEV-Marktplatz link or sending the document to DATEV is the owner's decision",
    ),
    # 6 Workflow
    "WF-01": (NO, "Owner orders the onboarding package and books appointments"),
    "WF-02": (
        NO,
        "Owner books the separate file-format review for EXTF (and DXSO/ASCII if offered)",
    ),
    "WF-03": (NO, "Owner schedules production review within 3 months"),
    "FAQ-01": (NO, "Same onboarding applies even for internal use; owner decision"),
    "FAQ-02": (
        NO,
        "Owner subscribes all needed API products before upgrading to production",
    ),
    "FAQ-03": (
        M,
        "Hosts by DNS name only (src/auth/endpoints.ts:13-30; API hosts from specs, src/api/client.ts:173-184)",
    ),
    "FAQ-04": (NO, "Owner pays onboarding and running costs"),
    "CS-01": (
        NA,
        "Applies only to components hosted in DATEVasp/SmartIT/DATEVnet; the app runs on the user's machine",
    ),
    "LOGO-01": (M, "Label/logo not used (docs/TRADEMARKS.md:8)"),
    # 7 clients
    "CLI-01": (
        P,
        "accounting-clients is added and used by datev_list_clients (src/auth/services.ts:46, src/tools/accounting.ts:117-141), but uploads/imports do not run it as a permission check before sending (ledger F37)",
    ),
    # 8 documents
    "DOCS-01": (
        M,
        "Upload is one PUT plus one permission GET; document types are read at most once a day (src/tools/documents.ts)",
    ),
    "DOCS-02": (
        M,
        "Every upload first calls accounting-clients GET /clients/{client-id} and refuses with DATEV's setup link when Belegbilderservice is missing; the preview shows client name, consultant and client number (src/api/permission.ts, src/tools/documents.ts)",
    ),
    "DOCS-03": (NA, "Long-term-token note; " + NOOFF),
    "DOCS-04": (
        M,
        "datev_document_types shows the client's types; uploads accept only those, re-checked once per transfer day (src/tools/documents.ts documentTypesToday)",
    ),
    "DOCS-05": (
        NO,
        "Owner explains document-type mapping in the review; the app has no own document types (open together with DOCS-04)",
    ),
    "DOCS-06": (
        M,
        "Document types are cached per client for the day, not fetched before each document (src/tools/documents.ts)",
    ),
    "DOCS-07": (
        M,
        "document_type is required for every Belegbilderservice document and checked against the client's types; the two-type demo is the owner's",
    ),
    "DOCS-08": (
        O,
        "No compression or readability handling; files are sent as-is up to 20 MB (src/tools/documents.ts:13,78)",
    ),
    "DOCS-09": (M, "note sent in metadata (src/tools/documents.ts:65,82)"),
    "DOCS-10": (
        M,
        "No document type is hard-coded; caller supplies it (src/tools/documents.ts:64)",
    ),
    "DOCS-11": (
        M,
        "Belegbilderservice uploads refuse category, folder and register (src/tools/documents.ts); test 'documents use only the client's document types'",
    ),
    "DOCS-12": (
        M,
        "20 MB per document enforced (src/tools/documents.ts:13); stapled upload reachable via datev_upload_file (src/tools/upload.ts:127-153)",
    ),
    # 9 EXTF
    "EXTF-01": (
        M,
        "One import POST, one permission GET and at most 6 job queries (src/tools/extf.ts)",
    ),
    "EXTF-02": (
        M,
        "datev_upload_extf and Buchungsdatenservice documents call GET /clients/{client-id} first (src/api/permission.ts)",
    ),
    "EXTF-03": (
        M,
        "Uploads are refused unless the client's services include Buchungsdatenservice, with DATEV's setup link (src/api/permission.ts); test 'an EXTF import counts only when DATEV's job succeeded'",
    ),
    "EXTF-04": (
        M,
        "Typed tools use accounting-clients only (src/tools/accounting.ts:124)",
    ),
    "EXTF-05": (
        M,
        "Typed tools never use dxso-jobs/clients (src/tools/accounting.ts:124)",
    ),
    "EXTF-06": (
        M,
        "Documents use PUT /documents/{guid} with an RFC 4122 id derived from client and file hash (src/tools/documents.ts documentGuid)",
    ),
    "EXTF-07": (
        M,
        "document_type is optional for Buchungsdatenservice documents; the tool tells the assistant to ask the user",
    ),
    "EXTF-08": (
        M,
        "Buchungsdatenservice documents require category, folder and register (src/tools/documents.ts)",
    ),
    "EXTF-09": (
        NO,
        "Owner demonstrates one document upload in sandbox (tool: datev_upload_document)",
    ),
    "EXTF-10": (
        O,
        "datev_write_extf_batch has no Beleglink (column 20) field (src/tools/extf.ts:83-95)",
    ),
    "EXTF-11": (
        M,
        "A sent file is remembered per client by hash; a second send is refused unless resend: true is passed for a support case (src/tools/sent-ledger.ts, src/tools/extf.ts)",
    ),
    "EXTF-12": (
        M,
        "After the 202 the job is polled; success only when result is succeeded, otherwise DATEV's validation messages are shown (src/tools/extf.ts jobAnswer); new tool datev_extf_job",
    ),
    "EXTF-13": (
        M,
        "The first job query waits the Retry-After seconds from the POST (1 to 20 s)",
    ),
    "EXTF-14": (
        NO,
        "Owner transmits a booking file in sandbox (tools exist: src/tools/extf.ts)",
    ),
    "EXTF-15": (
        NO,
        "Owner prepares productive DATEV Rechnungswesen/Unternehmen online test client",
    ),
    "EXTF-16": (NO, "Owner demonstrates two documents from different months"),
    "EXTF-17": (O, "No compression; same gap as DOCS-08"),
    "EXTF-18": (NO, "Owner sends booking data for two months"),
    "EXTF-19": (
        P,
        "Debitoren/Kreditoren files can be validated (src/tools/extf.ts:99-120) and uploaded if supplied, but the app cannot generate them",
    ),
    "EXTF-20": (NO, "Owner verifies error-free import in DATEV Rechnungswesen"),
    "EXTF-21": (O, "Needs Beleglink support (EXTF-10)"),
    "EXTF-22": (
        P,
        "Validation, local size limits and help links handle some challenges; resend protection (EXTF-11) and permission filtering (EXTF-03) are missing",
    ),
    # 10 EXTF file
    "EXTFF-01": (
        P,
        "Buchungsstapel written in Formatversion 13 (src/tools/extf.ts:127, via @seamless-engineering/datev-extf); Debitoren/Kreditoren (v5) only validated, not generated",
    ),
    "EXTFF-02": (
        P,
        "Files are validated before write and upload (src/tools/extf.ts:151-152,178-179); running DATEV's own check program on samples is the owner's",
    ),
    "EXTFF-03": (NO, "Owner test-imports into a test dataset"),
    "EXTFF-04": (NO, "Owner submits sample files and justifications by email"),
    "EXTFF-05": (
        P,
        "Batch rows carry amount, S/H, account, contra, date, Belegfeld 1, text, BU key, KOST (src/tools/extf.ts:83-95); missing Belegfeld 2, Beleglink, currency, discount, OSS, order no., delivery date, Generalumkehr",
    ),
    "EXTFF-06": (NO, "Owner creates sample files per use case"),
    "EXTFF-07": (NO, "Owner creates cash/payment sample files"),
    "EXTFF-08": (
        NO,
        "Owner creates special-case sample files (several cases need fields the writer lacks, see EXTFF-05)",
    ),
    "EXTFF-09": (O, "No Debitoren/Kreditoren writer"),
    "EXTFF-10": (
        NO,
        "Owner creates a business-partner sample file (no writer in the app, EXTFF-09)",
    ),
    "EXTFF-11": (
        NO,
        "Owner creates a GL account label sample file (no writer in the app)",
    ),
    # 11 DXSO
    "DXSO-01": (
        P,
        "Files are passed through datev_upload_file as supplied (src/tools/upload.ts); the app does not produce or check ledger XML",
    ),
    "DXSO-02": (M, "No automatic job polling"),
    "DXSO-03": (
        M,
        "Before any client-bound accounting-dxso-jobs call, datev_call and datev_upload_file read GET /clients/{client-id} of that service and show company name and numbers in the preview (src/api/client-gate.ts); datev_check_client lets the person enter the numbers",
    ),
    "DXSO-04": (
        M,
        "The permission read is repeated each transfer day (src/api/client-gate.ts, test 'the permission is read once per transfer day')",
    ),
    "DXSO-05": (
        M,
        "A denied client gives a clear refusal with a hint to check the numbers or ask the administrator, DATEV's setup page and help link (src/api/client-gate.ts)",
    ),
    "DXSO-06": (
        O,
        "Status 'connected' relies on userinfo (src/setup/status.ts:66-69), not on GET clients/{client-id}",
    ),
    "DXSO-07": (
        O,
        "Dataset prerequisites (Erweitert, fiscal year, account length, ledgers) not checked",
    ),
    "DXSO-08": (
        O,
        "No configuration validation via GET /clients/{client-id} before transfer",
    ),
    "DXSO-09": (O, "No reaction to configuration changes"),
    "DXSO-10": (O, "ledger_folder_names not read or applied"),
    "DXSO-11": (
        M,
        "Single file <= 20 MB and total <= 50 MB per upload (src/tools/upload.ts:15-16), within DATEV's 20/150 MB",
    ),
    "DXSO-12": (
        P,
        "File names with control characters, quotes and Windows-reserved characters refused (src/tools/upload.ts:30-35), but non-ASCII names are allowed",
    ),
    "DXSO-13": (O, "No bundling of same-ledger/month data; " + GEN_ONLY),
    "DXSO-14": (
        O,
        "Job status and protocol-entries not fetched or shown automatically; "
        + GEN_ONLY,
    ),
    "DXSO-15": (
        O,
        "HTTP log keeps job bodies 30 days only (src/api/http-log.ts:8); no 1-year processing protocol store",
    ),
    "DXSO-16": (
        NO,
        "Owner needs a real authentication medium and an 'Erweitert' Belege online dataset",
    ),
    # 12 DXSO file
    "DXSOF-01": (
        O,
        "App does not generate DXSO XML; it uploads whatever file it is given",
    ),
    "DXSOF-02": (O, "No XSD validation of XML files before upload"),
    "DXSOF-03": (NO, "Owner test-imports XML into a test dataset"),
    "DXSOF-04": (
        O,
        "No XML generation, so base data depends entirely on the supplied file",
    ),
    "DXSOF-05": (NO, "Owner produces sample ZIPs"),
    "DXSOF-06": (NO, "Owner produces correction sample"),
    "DXSOF-07": (O, "No XML generation (see DXSOF-04)"),
    "DXSOF-08": (NO, "Owner produces daily cash report sample"),
    "DXSOF-09": (NO, "Owner produces single-transaction sample"),
    # 13 dataexchange
    "DX-01": (
        M,
        "Every Datenservice Export call first reads the client with accounting-clients GET /clients/{client-id} and requires 'Datenservice Export Rechnungswesen' (src/api/dataexchange-guard.ts, also for datev_call)",
    ),
    "DX-02": (
        M,
        "Without the service the connection is ended (both tokens revoked through disconnect) and DATEV's order page is linked (src/api/permission.ts, src/server.ts); test 'a missing permission ends the connection'",
    ),
    "DX-03": (
        NO,
        "Owner explains implemented use cases (fiscal years, accounts, sums, postings)",
    ),
    "DX-04": (
        M,
        "The fiscal year list is read before any accounting data and an unknown year is refused (src/api/dataexchange-guard.ts)",
    ),
    "DX-05": (
        M,
        "GET fiscal-years/{id} is read before data; the fields used and why are listed in docs/DATEV-REVIEW.md and returned as fiscal_year with balances and postings",
    ),
    "DX-06": (
        M,
        "datev_find_accounts calls general-ledger-accounts (src/tools/accounts.ts:68)",
    ),
    "DX-07": (
        NO,
        "Owner explains purpose if sequences/terms-of-payment are used (only via datev_call)",
    ),
    "DX-08": (
        M,
        "POST job, poll state, read paged results (src/tools/accounting.ts:217-271)",
    ),
    "DX-09": (
        M,
        "datev_account_postings retrieves postings (src/tools/accounting.ts:191-294); demo by owner",
    ),
    "DX-10": (
        M,
        "datev_sums_and_balances (src/tools/accounting.ts:166-189); owner explains purpose",
    ),
    "DX-11": (NA, "No typed tool uses SKR14 endpoints"),
    "DX-12": (
        NO,
        "Owner subscribes via 'Kostenpflichtig abonnieren' and pays from 2027",
    ),
    # 14 TRAFFIQX
    "TQ-01": (O, "No place to enter TRAFFIQX provider/ID; " + GEN_ONLY),
    "TQ-02": (O, GEN_ONLY),
    "TQ-03": (O, "No connection check after login for traffiqx-invoice"),
    "TQ-04": (O, "No per-use-case connection check"),
    "TQ-05": (
        O,
        "Status 'connected' does not depend on a TRAFFIQX 200 (src/setup/status.ts:66-69)",
    ),
    "TQ-06": (O, "No revoke on connection-check failure"),
    "TQ-07": (
        P,
        "Required X-App-Display-Name header is enforced (src/api/client.ts:37-40) but its value comes from the caller, not pinned to the portal app name",
    ),
    "TQ-08": (
        P,
        "Errors carry DATEV's help link (src/api/problem.ts); no further self-help offered",
    ),
    "TQ-09": (O, "No inbox sync; " + GEN_ONLY),
    "TQ-10": (
        P,
        "document_id is returned in tool answers but not kept across the lifecycle",
    ),
    "TQ-11": (O, "Validation status not highlighted"),
    "TQ-12": (O, "No notice for invalid e-invoices"),
    "TQ-13": (
        O,
        "ZIP not extracted or archived; binary only saved or base64-returned (src/tools/generic.ts:105-109)",
    ),
    "TQ-14": (O, "No GoBD archiving statement"),
    "TQ-15": (
        P,
        "Upload paths reachable via datev_upload_file (src/tools/upload.ts); 'sent' proof by owner",
    ),
    "TQ-16": (O, GEN_ONLY),
    "TQ-17": (O, "document_id not stored"),
    "TQ-18": (O, "Status values not interpreted"),
    "TQ-19": (
        P,
        "App never polls on its own; nothing limits an assistant polling via datev_call",
    ),
    "TQ-20": (O, "No ordering of download after 'sent'"),
    "TQ-21": (O, "No GoBD archiving statement"),
    "TQ-22": (O, "No ordering of metadata fetch after 'sent'"),
    "TQ-23": (O, "Delivery channel not checked or shown"),
    "TQ-24": (NO, "Owner demonstrates per-channel sends and an error case"),
    "TQ-25": (NO, "Owner contacts b4value; customer needs a provider contract"),
    "TQ-26": (
        P,
        "ProblemDetails parsed with help link (src/api/problem.ts); error objects inside HTTP 200 are not detected by datev_call (src/tools/generic.ts:110)",
    ),
    # 15 HR imports
    "HRIMP-01": (M, "Upload sends one POST, no automatic GETs"),
    "HRIMP-02": (
        M,
        "hr-files calls read GET /v1/clients/{client-id} first; datev_check_client shows success and reproduces the refusal for numbers without permission",
    ),
    "HRIMP-03": (
        O,
        "Status 'connected' not tied to GET clients (src/setup/status.ts:66-69)",
    ),
    "HRIMP-04": (
        NO,
        "Owner demonstrates upload; tool supports hr-files with its 3 MB and 50-char limits (src/tools/upload.ts:21,26)",
    ),
    "HRIMP-05": (P, "Job status only via datev_call, not shown automatically"),
    "HRIMP-06": (NO, "Owner tests from a dedicated test system"),
    "HRIMP-07": (NO, "Owner demonstrates import into DATEV payroll"),
    "HRIMP-08": (P, "Job status only reachable via datev_call"),
    # 16 ASCII
    "HRIMPF-01": (
        NO,
        "App does not generate ASCII files; owner follows LODAS/Lohn und Gehalt descriptions",
    ),
    "HRIMPF-02": (NO, "Owner follows Standard.ini layout"),
    "HRIMPF-03": (NO, "Owner prepares examples for both products"),
    "HRIMPF-04": (NO, "Owner names samples per scenario"),
    "HRIMPF-05": (NO, "Owner uses sample data only"),
    "HRIMPF-06": (NO, "Owner prepares imports"),
    # 17 payrollreports
    "HRPAY-01": (
        M,
        "Every call is a manual trigger by the person through the assistant; no schedule",
    ),
    "HRPAY-02": (M, "No background calls"),
    "HRPAY-03": (
        M,
        "hr-payrollreports reads GET /clients/{client-id} first and requests only report types listed in access_granted (src/api/client-gate.ts gateCall)",
    ),
    "HRPAY-04": (NA, "Long-term-token note; " + NOOFF),
    "HRPAY-05": (
        M,
        "Invalid numbers give 'Please check the consultant and client number, or ask your administrator' with DATEV's help link (src/api/client-gate.ts)",
    ),
    "HRPAY-06": (
        M,
        "datev_check_client takes consultant and client number and shows the granted report types or the refusal",
    ),
    "HRPAY-07": (P, GEN_ONLY),
    "HRPAY-08": (P, GEN_ONLY),
    "HRPAY-09": (
        NA,
        "App keeps no employee or payroll records of its own; reports go straight to the person's AI conversation",
    ),
    "HRPAY-10": (NA, "Same as HRPAY-09"),
    "HRPAY-11": (NA, "Same as HRPAY-09"),
    "HRPAY-12": (NO, "Owner tests from a dedicated test system"),
    "HRPAY-13": (O, "No paged HR client list with numbers and company name"),
    "HRPAY-14": (NA, "Descriptive note, no obligation"),
    # 18 exports
    "HREXP-01": (M, "Manual trigger only"),
    "HREXP-02": (M, "No background calls"),
    "HREXP-03": (
        M,
        "hr-exports reads GET /clients/{client-id} first; datev_check_client is where the person enters the numbers",
    ),
    "HREXP-04": (O, "Status 'connected' not tied to GET clients"),
    "HREXP-05": (
        M,
        "Same understandable refusal with hint as HRPAY-05 (src/api/client-gate.ts)",
    ),
    "HREXP-06": (
        NO,
        "Owner demonstrates master-data query and assignment (only via datev_call)",
    ),
    "HREXP-07": (
        M,
        "All retrieved data is returned to the person (src/tools/generic.ts:102-110)",
    ),
    "HREXP-08": (NO, "Owner tests from a dedicated test system"),
    "HREXP-09": (O, "Nothing prevents both filters in one call"),
    # 19 exchange
    "HREX-01": (NO, "Owner names the use cases at the review"),
    "HREX-02": (O, "No counter-booking logic; " + GEN_ONLY),
    "HREX-03": (
        M,
        "hr-exchange reads GET /clients/{client-id} first and datev_check_client shows whether it succeeded",
    ),
    "HREX-04": (
        P,
        "Jobs can be created through datev_call with preview and approval (src/tools/generic.ts:81-101)",
    ),
    "HREX-05": (O, "No forced full read before create/change"),
    "HREX-06": (O, "No 1-minute wait before status queries"),
    "HREX-07": (O, "No once-per-minute polling limit"),
    "HREX-08": (O, "No 15-minute stop rule"),
    "HREX-09": (O, "No initial sync"),
    "HREX-10": (O, "No local store to reconcile"),
    "HREX-11": (
        P,
        "Calls and job bodies logged 30 days (src/api/http-log.ts); results not stored as a user-facing log",
    ),
    "HREX-12": (O, GEN_ONLY),
    "HREX-13": (O, GEN_ONLY),
    "HREX-14": (O, "No check that IDs come from a prior read"),
    "HREX-15": (O, GEN_ONLY),
    "HREX-16": (O, "No read-before-write for employees"),
    "HREX-17": (O, GEN_ONLY),
    "HREX-18": (
        O,
        "Request bodies are not validated against the schema's required fields (src/api/client.ts:215-238)",
    ),
    "HREX-19": (O, "Duplicate personnel numbers not caught"),
    "HREX-20": (O, GEN_ONLY),
    "HREX-21": (NA, "COULD option, nothing required"),
    "HREX-22": (O, "No full read of absences before writing"),
    "HREX-23": (O, GEN_ONLY),
    "HREX-24": (O, GEN_ONLY),
    "HREX-25": (O, GEN_ONLY),
    "HREX-26": (O, "No existence check for month records"),
    "HREX-27": (O, GEN_ONLY),
    "HREX-28": (O, GEN_ONLY),
    "HREX-29": (NO, "Owner tests from a dedicated test system"),
    "HREX-30": (O, "No automatic GET job after changes"),
    "HREX-31": (O, "No duplicate handling"),
    "HREX-32": (O, "No validation GET after PUT"),
    "HREX-33": (
        P,
        "Changes traceable only through the 30-day HTTP log (src/api/http-log.ts:8)",
    ),
    # 20 eAU
    "EAU-01": (M, "Manual trigger only, no automatic GETs"),
    "EAU-02": (
        M,
        "eau-api reads GET /clients/{consultantNumber}-{clientNumber} first; datev_check_client shows success and refusal (test 'eAU reads the client through its own consultant and client number path')",
    ),
    "EAU-03": (NO, "Owner demonstrates a request"),
    "EAU-04": (P, "Feedback data is returned in the tool answer; no dedicated display"),
    "EAU-05": (NO, "Owner demonstrates DELETE (reachable via datev_call with preview)"),
    "EAU-06": (O, "No warning about § 5 (1) EntgFG or the 4th-day rule"),
    # 21 hr documents
    "HRDOCS-01": (
        M,
        "hr-documents reads GET /clients/{consultantnumber-clientnumber} before client-bound calls (src/api/client-gate.ts)",
    ),
    "HRDOCS-02": (NA, "Hint about long-term token use; " + NOOFF),
    "HRDOCS-03": (NA, "Descriptive hint"),
    # 22 mytax
    "MYTAX-01": (M, "Uploads send one POST, no automatic GETs"),
    "MYTAX-02": (
        M,
        "my-tax-income-tax-documents reads GET /clients/{client-id} first; datev_check_client is where the person enters the numbers",
    ),
    "MYTAX-03": (O, "Status 'connected' not tied to GET clients"),
    "MYTAX-04": (O, "tax-years not checked per transfer day"),
    "MYTAX-05": (NO, "Owner explains tax-year mapping"),
    "MYTAX-06": (M, "No per-document check"),
    "MYTAX-07": (O, "Folders not checked per transfer day"),
    "MYTAX-08": (NO, "Owner explains folder mapping"),
    "MYTAX-09": (M, "No per-document check"),
    "MYTAX-10": (O, "No automatic tax-year creation"),
    "MYTAX-11": (NO, "Owner demonstrates two uploads (via datev_upload_file)"),
    "MYTAX-12": (O, "No compression"),
    # 23
    "PT-01": (NA, "No service-specific requirements exist"),
    # 24
    "MD-01": (NO, "Owner signs the supplementary agreement and consultation"),
    "MD-02": (NO, "Owner bears per-call costs; expand is a caller parameter"),
    "MD-03": (P, GEN_ONLY),
    "MD-04": (O, "No ETag storage or conditional requests"),
    "MD-05": (NO, "Owner books data areas; rights admin unlocks clients"),
    # 25
    "CR-01": (O, "No device registration/init-file flow; " + GEN_ONLY),
    "CR-02": (NA, "App is not a cash register and owns no register serial"),
    "CR-03": (
        P,
        "Metadata part capped at 10 kB and parts checked against the spec (src/tools/upload.ts:20-23,127-153); JSON pattern checks partial",
    ),
    "CR-04": (
        P,
        "Bearer sent on every request (src/api/client.ts:361); Request-Id header must come from the caller",
    ),
    "CR-05": (
        O,
        "App supports only the Authorization Code flow (src/auth/authorize.ts:17); cashregister also has no scopes (ledger F12)",
    ),
    # 26
    "ST-01": (NO, "Owner requests pilot portal access"),
    "ST-02": (NO, "Owner passes the pilot review"),
    "ST-03": (
        P,
        "X-API-Key injected server-side from DATEV_SMARTTRANSFER_API_KEY, never via the assistant (src/api/client.ts:96-108); customer contract is the owner's",
    ),
    # 27
    "LOGIN-01": (
        NA,
        "App does not use the 'Login mit DATEV' product (no account_id/profile scopes, services.ts)",
    ),
    "LOGIN-02": (NA, "Same as LOGIN-01"),
    "LOGIN-03": (NA, "Same as LOGIN-01"),
    "LOGIN-04": (M, "enableWindowsSso=true sent anyway (src/auth/authorize.ts:25)"),
    "LOGIN-05": (NA, "No login button logo used"),
    "LOGIN-06": (NA, "No own user accounts to map"),
    "LOGIN-07": (
        NA,
        "Same as LOGIN-01; disconnect with /revoke exists anyway (src/setup/disconnect.ts)",
    ),
    "LOGIN-08": (NA, "Same as LOGIN-01"),
    "LOGIN-09": (NA, "Same as LOGIN-01"),
}

ORDER = [M, P, O, NA, NO]

with open(SRC, encoding="utf-8") as fh:
    lines = fh.read().split("\n")
sections = OrderedDict()
cur = None
row = re.compile(r"^\| ([A-Z]+-\d+) \| (.*?) \| (.*) \| (https?://\S+) \|$")
for ln in lines:
    if ln.startswith("## ") and re.match(r"## \d+\.", ln):
        cur = ln[3:].strip()
        sections[cur] = []
        continue
    if ln.startswith("## "):
        cur = None
        continue
    m = row.match(ln)
    if m and cur:
        sections[cur].append(m.groups())

missing = []
out = [
    "# DATEV interface requirements: compliance assessment of datev-mcp",
    "",
    "Every requirement of DATEV's published interface rules (Schnittstellenvorgaben), checked against the code, not against doc claims. Requirements are short English paraphrases in our own words with a link to DATEV's page, never DATEV's text. Rebuild with npm run compliance after a status changes in scripts/compliance/assess.py.",
    "",
    "Status: **met** (code or docs satisfy it, evidence given), **partial** (gap named), **open** (not satisfied), **n/a** (does not apply to a local stdio MCP server, reason given), **needs-owner** (only the app owner can do it outside the code). The app's UI is the CLI output plus the text tools return to the AI client.",
    "",
    "Scope note: sections 8-27 bind only for the data services the owner submits for review. datev-mcp offers most of them only through the generic datev_call / datev_upload_file, so their service-specific flows are mostly open. F43 (Public client for the localhost redirect) is being added and is treated as open.",
    "",
]
summary = []
for sec, rows in sections.items():
    out.append(f"## {sec}")
    out.append("")
    out.append("| Id | Level | Requirement | Status | Evidence or gap | Source |")
    out.append("|---|---|---|---|---|---|")
    cnt = {k: 0 for k in ORDER}
    for rid, lvl, req, src in rows:
        if rid not in A:
            missing.append(rid)
            continue
        st, ev = A[rid]
        cnt[st] += 1
        r = req if len(req) <= 160 else req[:157].rsplit(" ", 1)[0] + "..."
        out.append(
            f"| {rid} | {lvl} | {r.replace('|', '/')} | {st} | {ev.replace('|', '/')} | {src} |"
        )
    out.append("")
    summary.append((sec, cnt, rows))
extra = set(A) - {r[0] for rs in sections.values() for r in rs}
out.append("## Summary per section")
out.append("")
out.append("| Section | met | partial | open | n/a | needs-owner | total |")
out.append("|---|---|---|---|---|---|---|")
tot = {k: 0 for k in ORDER}
for sec, cnt, rows in summary:
    for k in ORDER:
        tot[k] += cnt[k]
    out.append(
        f"| {sec} | "
        + " | ".join(str(cnt[k]) for k in ORDER)
        + f" | {sum(cnt.values())} |"
    )
out.append(
    "| **Total** | "
    + " | ".join(f"**{tot[k]}**" for k in ORDER)
    + f" | **{sum(tot.values())}** |"
)
out.append("")

IMPACT = [
    (
        "REDIR-01",
        "Confidential app with http://localhost redirect is blocked from the production gateway (F43)",
    ),
    (
        "AUTH-13",
        "Production Confidential client cannot register the localhost redirect (F43)",
    ),
    ("EXTF-12", "EXTF import reports success on 202 without polling the job result"),
    ("EXTF-03", "Uploads do not refuse clients lacking Buchungsdatenservice (F37)"),
    (
        "EXTF-08",
        "Buchungsdatenservice documents do not require category/folder/register",
    ),
    ("DOCS-04", "Document types never fetched, shown or checked"),
    ("DOCS-11", "Belegbilderservice uploads may send category/folder/register"),
    ("DOCS-08", "No compression / readability handling for documents"),
    ("EXTF-17", "No compression for documents in production"),
    (
        "EXTF-21",
        "Linked document cannot be shown in Rechnungswesen without Beleglink support",
    ),
    ("GEN-16", "HTTP log keeps request bodies only as a hash"),
    ("GEN-09", "Error rate only measured, not kept under 10 %"),
    ("DOCS-02", "No permission check via clients before document upload (F37)"),
    ("DOCS-07", "document_type not sent for every document"),
    ("EXTF-02", "Client permission check not run before EXTF upload (F37)"),
    (
        "DX-02",
        "Missing dataexchange permission does not revoke tokens or link to the order page",
    ),
    ("DX-01", "No check that the client has the dataexchange service before calls"),
    ("DX-04", "Fiscal years not checked first by the dataexchange tools"),
    ("DX-05", "Fiscal-year configuration GET fiscal-years/{id} unused"),
    ("EXTFF-01", "Debitoren/Kreditoren format not generated"),
    ("EXTFF-02", "DATEV check program not run on samples (owner)"),
    (
        "EXTFF-05",
        "Batch writer lacks Belegfeld 2, Beleglink, currency, discount, OSS and other base fields",
    ),
    ("EXTFF-09", "No Debitoren/Kreditoren writer"),
]


def is_must(lvl):
    return (
        lvl.startswith("MUST")
        or re.search(r"\((required|must|mandatory)", lvl) is not None
    )


open_must = []
for sec, cnt, rows in summary:
    for rid, lvl, req, src in rows:
        st, ev = A[rid]
        if st in (O, P) and is_must(lvl):
            open_must.append((rid, st, ev))
ranked = [i for i, _ in IMPACT]
open_must.sort(key=lambda x: ranked.index(x[0]) if x[0] in ranked else 999)
out.append("## Open MUST items, ordered by impact")
out.append("")
out.append(
    "Rows marked MUST / MUST (MUSS), or DATEV prose 'must / required / mandatory', whose status is open or partial. The rest block the review of the data service they belong to; HR, DXSO, TRAFFIQX and other generic-only services follow after the accounting core."
)
out.append("")
out.append("| # | Id | Status | Gap |")
out.append("|---|---|---|---|")
imp = dict(IMPACT)
for i, (rid, st, ev) in enumerate(open_must, 1):
    out.append(f"| {i} | {rid} | {st} | {imp.get(rid, ev).replace('|', '/')} |")
out.append("")
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(out))
# Machine-readable summary for "datev-mcp compliance": per section counts and the open MUST ids.
import json

JSON_OUT = sys.argv[3] if len(sys.argv) > 3 else None
if JSON_OUT:
    data = {
        "sections": [],
        "open_must": [{"id": rid, "status": st} for rid, st, _ in open_must],
    }
    for sec, cnt, rows in summary:
        c = {M: 0, P: 0, O: 0, NA: 0, NO: 0}
        for rid, lvl, req, src in rows:
            c[A[rid][0]] += 1
        data["sections"].append(
            {"title": sec, "counts": c, "ids": [r[0] for r in rows]}
        )
    with open(JSON_OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
print(
    "rows",
    sum(len(r) for r in sections.values()),
    "missing",
    missing,
    "extra",
    sorted(extra),
)
print(tot)
print(
    "open_must",
    len(open_must),
    "open",
    sum(1 for x in open_must if x[1] == O),
    "partial",
    sum(1 for x in open_must if x[1] == P),
)
for i, (rid, st, ev) in enumerate(open_must, 1):
    print(i, rid, st)
