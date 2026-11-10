<!-- freshness: 30d -->
# Security

This server holds a login to a tax advisor's DATEV account and lets an AI assistant act on it. That is a lot of trust. This page lists what can go wrong, what the server does about it, and how each defense is tested.

## Reporting a problem

Report a suspected vulnerability privately through this repository's Security tab ("Report a vulnerability"). Please do not open a public issue for it. You get an answer within five working days.

## What is protected

| Asset | Where it lives |
|---|---|
| DATEV client id and client secret | Only in the environment of the running process, injected from a password manager |
| Access and refresh tokens | `~/.config/datev-mcp/session-<env>.json`, encrypted with AES-256-GCM, key in the OS credential store, owner-only (mode 600), never logged |
| Technical HTTP log | `~/.config/datev-mcp/logs/`, owner-only, 30 days. Authorization headers, secrets and API keys removed, response bodies only for errors and job status |
| Client data from DATEV | In the AI conversation that asked for it. The server keeps charts of accounts in memory while it runs, reused for 10 minutes and replaced or dropped when the server stops. Files you save with `save_to` stay on your disk |
| Local files | Read only when a tool is told a path, and only after the checks below |

## Threats and defenses

| Threat | Defense | Proof |
|---|---|---|
| Credentials sent to the wrong host | Base URLs come only from DATEV's own specs. Every path value is checked against DATEV's schema and may not contain `/`, `..` or a separator that would shift the request | Eval categories `url.*`, `path.*`, `wire.request` |
| A redirect forwards the client secret | Operation calls never follow redirects (`redirect: "manual"`). Token, revoke, userinfo, signing-key and `doctor` requests refuse any redirect (`redirect: "error"`). A typed tool treats any non-2xx answer, a redirect included, as an error | `auth.headers` eval, accounting unit test |
| Header injection | Server-set headers cannot be overridden, and any header value with a line break is refused | `header.reserved`, `header.crlf` |
| The assistant changes data without the user seeing it | Every write through `datev_call`, `datev_upload_extf` and `datev_upload_document` first returns a preview and a confirmation code. The code is an HMAC over the exact request (tool, environment, operation, parameters, body, and for files their SHA-256), valid for 15 minutes and for one use only, with a key that never leaves the process. `datev_account_postings` starts the read-only postings export job without a preview | `write.preview-no-send` eval, confirm token unit tests |
| A write is sent twice | Writes are never retried, not even after a 429, because without an idempotency key no answer proves DATEV did not apply it | `retry.*` evals per operation |
| A refresh token is used twice | DATEV refresh tokens are single-use. Refresh runs under a file lock, re-reads the session inside the lock, and after a successful refresh the spent token is replaced, never written back. A refused refresh (`invalid_grant`) leaves the saved session untouched until the next login, so a retry can send the same refused token again | Auth unit tests |
| Two processes fight over the session | The lock records its owner (process id plus a random token). A stale lock is taken over only when it is old and its owner is gone. Only the owner may release it | Auth unit tests for live holder, dead holder and wrong owner |
| One login served another login's cached data | The account cache key includes the environment, the client id and a hash of the access token | Accounts unit test |
| The assistant is tricked into uploading a key file | Paths inside hidden folders and names that look like keys or credentials (`.env`, `*.pem`, `*.ppk`, `id_rsa`, SSH host keys, `credentials.json`, session files) are refused, and so are files with more than one hard link. A symlink is judged by where it points, the file is opened once without following links, and the opened file must be the one that was checked | File unit tests |
| A download overwrites something important | Saves resolve the real parent folder first, never follow a symlink, never land in a hidden folder or on a key-like name, create new files exclusively with owner-only permissions, and replace existing files only with `overwrite: true`, through a temporary file and a rename | File and binary unit tests |
| A huge or endless answer fills memory | Operation answers are read as a stream and reading stops at the cap. Even the "read everything" tools stop at 50 MB. The small login token and `doctor` answers are read without this cap. A cut answer is marked as truncated. The typed accounting tools refuse to show it, and the upload tools return it with `truncated: true` | `cap.endless-stream` eval |
| A call hangs and the assistant gives up | Each DATEV call has a 55 second budget, retries only happen if they still fit, and the MCP client's cancel aborts the request in flight | `deadline.*`, `cancel.*` evals |
| A PDF or image gets corrupted | Binary answers are never turned into text. They are saved byte for byte or returned as base64 with their SHA-256 | `binary.byte-exact` eval |
| A garbled answer looks like an empty result | In the typed accounting tools, an unknown answer shape or a truncated page is an error with a reason. `datev_find_accounts` counts unreadable account rows in `skipped_rows` and refuses a chart where no row is readable. `datev_account_postings` counts posting rows without an account number in `rows_without_account`. Limit: `datev_call` passes unreadable JSON through as text with DATEV's status | Accounting unit tests |
| Postings silently cut to the first page | The postings tool reads every page in order within its budget and says plainly when it stopped early, with a `from_page` to continue | Accounting unit tests |

## What the server does not protect against

- A compromised machine. Anyone who can read your files can read the session file.
- An AI assistant that you allow to confirm writes without reading the preview. The preview is only useful if a person looks at it.
- DATEV itself. The server trusts that answers from DATEV's hosts are DATEV's.
- Scope visibility. DATEV does not report which scopes were granted, so a missing product only shows up as a 401 or 403 on first use.
- A second process, running as you, that swaps a parent folder for a link while a file is being read. Node.js cannot open a file relative to an already checked folder. That process could read the file directly anyway.
- The session lock is advisory. If two processes ever both hold it, the loser of the refresh never deletes the session and adopts the newer one. The worst case is one request to log in again.

## Independent review

A second AI model (OpenAI Codex) was asked to attack the code, not to review it, on 2026-11-07. Four passes reported 15, 19, 9 and 5 findings, 15 of them high severity. Later passes also caught regressions introduced by earlier fixes. 46 are fixed with tests. Two are known limits, listed below. The groups were auth races and refresh token reuse, tool answers that could look empty when they were not, file and upload safety, client limits (time, size, binary, Retry-After), and gaps in the test tooling itself. The per pass details are in [VALIDATION.md](VALIDATION.md).

## Dependencies

Runtime dependencies are the MCP SDK, zod and the MIT-licensed `@seamless-engineering/datev-extf`. Run `npm audit` before every release.
