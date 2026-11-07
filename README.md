# datev-mcp

Ask your AI assistant about your DATEV bookkeeping, payroll and documents in plain words, and let it act on them only after you have seen exactly what it will do.

![Status](https://img.shields.io/badge/status-private%20preview-orange)
![Node](https://img.shields.io/badge/node-%E2%89%A522-green)
![Operations](https://img.shields.io/badge/DATEV%20operations-209-green)
![Eval](https://img.shields.io/badge/eval%20scenarios-26%2C462%20passing-green)
![Tests](https://img.shields.io/badge/unit%20tests-92%20passing-green)

## What this is, in plain words

DATEV holds the books of most German small and medium businesses. Getting a number out of it, uploading a receipt, or checking a payroll export usually means logging in, clicking through several screens and copying values by hand.

datev-mcp connects an AI assistant (Claude, Cursor, VS Code Copilot or any client that speaks the Model Context Protocol) to the official DATEV APIs. You ask "what is the balance on account 1200 for client 455148-1 this year?" and the assistant fetches it from DATEV for you. When an action would change data, such as uploading a document or importing bookings, the assistant first shows you a preview and does nothing until you agree.

It is built for tax advisors, bookkeepers, and the developers who build tools for them.

## What you get

- **Answers without clicking.** Clients, fiscal years, sums and balances, account postings and the chart of accounts come straight from DATEV into the conversation.
- **Nothing changes behind your back.** Every write returns a preview first. The real call only runs with a one-time confirmation code that matches that exact preview, so the assistant cannot quietly swap the file or the target client.
- **Every DATEV operation, not a hand-picked few.** All 209 operations across 23 DATEV API specifications are reachable, with twelve focused tools for the everyday cases.
- **Your files stay yours.** The server refuses to send anything from hidden folders (where SSH keys and cloud logins live) or anything that looks like a key or credentials file.
- **Honest answers.** If DATEV returns an error, an incomplete page or a format the tool does not understand, you get told. You never get an empty list that looks like a real answer.

## From zero to your first answer

You need a DATEV developer account with an app registered for the sandbox, and Node.js 22 or newer. The full walkthrough, including the DATEV portal steps, is in [docs/SETUP.md](docs/SETUP.md).

1. Install and build.
   ```bash
   npm install
   npm run specs      # downloads DATEV's public API specs into specs/ (not committed)
   npm run build
   ```
2. Provide your DATEV client id and client secret through your password manager or environment as `DATEV_CLIENT_ID` and `DATEV_CLIENT_SECRET`. Never paste them into a chat.
3. Log in once. A browser window opens at DATEV.
   ```bash
   node dist/index.js login
   ```
4. Check that everything works.
   ```bash
   node dist/index.js doctor
   ```
5. Add the server to your AI client (example for Claude Code).
   ```bash
   claude mcp add datev -- node /absolute/path/to/datev-mcp/dist/index.js
   ```
6. Ask "list my DATEV clients". That is your first win.

## The tools

| Tool | What it does | Changes data |
|---|---|---|
| `datev_list_clients` | Lists the clients (Mandanten) your login can see | No |
| `datev_list_fiscal_years` | Lists a client's fiscal years | No |
| `datev_sums_and_balances` | Summen- und Saldenliste, filterable by account prefix | No |
| `datev_account_postings` | Posted bookings for a fiscal year, all pages, resumable | No |
| `datev_find_accounts` | Searches the client's real chart of accounts (SKR03, SKR04 or custom) | No |
| `datev_validate_extf` | Checks a DATEV EXTF booking file locally, before anything is sent | No |
| `datev_write_extf_batch` | Builds a valid EXTF booking file from rows you describe | No, writes a local file |
| `datev_upload_extf` | Imports an EXTF booking file into a client | Yes, preview first |
| `datev_upload_document` | Uploads a receipt or invoice to the Belegbilderservice | Yes, preview first |
| `datev_search_operations` | Finds any of the 209 DATEV operations by words | No |
| `datev_describe_operation` | Shows the parameters an operation needs | No |
| `datev_call` | Calls any DATEV operation by id, reads directly, writes with preview | Writes need confirmation |

## How well it is tested

Every number below comes from a real run on 2026-11-07. The method and how to reproduce each one is in [docs/VALIDATION.md](docs/VALIDATION.md).

| Check | Result |
|---|---|
| Offline scenarios across all 209 operations | 26,462 of 26,462 passing |
| Planted bugs the scenarios had to catch | 3 of 3 caught, 440 failing scenarios |
| Unit and integration tests | 92 of 92 passing |
| Live DATEV sandbox, read operations reached | 71, with 38 returning data |
| Independent review by a second AI model (Codex), three passes | 34 findings in the first two passes, all fixed. Third pass in [VALIDATION.md](docs/VALIDATION.md) |

Per operation results are in [docs/ENDPOINT-AUDIT.md](docs/ENDPOINT-AUDIT.md).

## Safety in one paragraph

The server only ever talks to DATEV's own hosts and never follows a redirect, so your credentials cannot be forwarded elsewhere. Logins use OAuth with PKCE and the session is stored on your machine with owner-only permissions. Writes need a preview-bound confirmation code. Calls have a time budget, can be cancelled by your AI client, and stop reading an answer once it grows too large. The full threat model is in [docs/SECURITY.md](docs/SECURITY.md).

## For developers

| Area | Choice |
|---|---|
| Language | TypeScript, strict mode, Node.js 22+ |
| Protocol | Model Context Protocol SDK 1.32, stdio transport |
| Validation | zod for tool inputs, DATEV's own schema for path values |
| DATEV auth | OpenID Connect authorization code flow with PKCE, refresh tokens rotated and never reused |
| EXTF files | `@seamless-engineering/datev-extf` (MIT) |
| Tests | Node test runner, fast-check property tests, a generated offline eval, a paced live sandbox sweep |

```
src/
  api/client.ts      builds, sends and reads every DATEV request
  auth/              OAuth login, token refresh, session file and its lock
  tools/             the twelve MCP tools
  setup/             login and doctor commands
scripts/             spec download, operation index, endpoint audit
test/unit/           unit and integration tests
test/evals/run.ts    the offline scenario generator
test/live-sweep.ts   the rate-limited live sandbox crawl
docs/                setup, security, validation, compliance and more
```

| Command | Does |
|---|---|
| `npm run typecheck` | Type checks without building |
| `npm test` | Unit and integration tests |
| `npm run eval` | The offline scenario run, writes a report to `test/reports/` |
| `npm run test:live` | A short live check against the DATEV sandbox |
| `npm run sweep` | The paced live crawl, resumes where it stopped |

## Before you use real client data

The sandbox may only hold test data. Using this with real clients needs DATEV's paid technical review (Technische Prüfung) for production access. Read [docs/COMPLIANCE.md](docs/COMPLIANCE.md) before that step.

## More documentation

- [Setup](docs/SETUP.md)
- [Security](docs/SECURITY.md)
- [Validation](docs/VALIDATION.md)
- [Endpoint audit](docs/ENDPOINT-AUDIT.md)
- [Compliance](docs/COMPLIANCE.md)
- [Accessibility](docs/ACCESSIBILITY.md)
- [Questions and answers](docs/FAQ.md)
- [Credits](docs/CREDITS.md)
- [Changelog](CHANGELOG.md)

## License

Private. All rights reserved. Not licensed for use, copying or redistribution without written consent.

DATEV is a registered trademark of DATEV eG. This project is independent and is not affiliated with, endorsed by, or sponsored by DATEV eG.
