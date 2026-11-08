<!-- freshness: 14d -->
# Validation

What was checked, how, the numbers from the last run, and how to repeat each check yourself. Every number here comes from a real run on 2026-11-07. Nothing is estimated.

## The five layers

| Layer | What it proves | Command | Last result |
|---|---|---|---|
| Type check | The code is consistent, strict mode | `npm run typecheck` | Clean |
| Unit and integration tests | Each behavior, including failure paths, through the real MCP protocol where it matters | `npm test` | 137 of 137 passing |
| Offline scenario run | Every one of the 209 operations against 62 scenario categories, with a fake DATEV | `npm run eval` | 28,494 of 28,494 passing |
| Planted bugs | The scenarios catch real defects | see below | 4 of 4 bugs caught |
| Live DATEV sandbox | The server works against the real DATEV gateway | `npm run test:live`, `npm run sweep` | 71 read operations reached, 38 returned data |

On top of that, a second AI model reviewed the code four times, described under "Independent review".

## Offline scenarios

`test/evals/run.ts` generates the scenarios from the operation index, so a new DATEV operation is covered the moment the specs are refreshed. Nothing reaches the network. Per operation it checks the following.

| Group | Categories | What a pass means |
|---|---|---|
| URL | 3 | The request goes to the right DATEV host for sandbox and production, with no placeholder left |
| Path values | 5 | `..`, `/`, empty values and values DATEV's schema forbids are refused. Odd but allowed values (umlauts, emoji, `#`, `?`, quotes) are encoded and cannot leak into the query |
| Query and headers | 6 | Required values are enforced, arrays repeat correctly, injected `&` or line breaks cannot split a value, server headers cannot be overridden |
| Wire request | 1 | The exact URL, body bytes and content type that leave the machine match the request, and no credential is in the URL |
| Auth | 1 | Bearer token, client id, client secret only where DATEV requires it, redirects never followed for operation calls |
| Retries and network | 7 | Reads retry 429, 502, 503, 504 and network errors up to three attempts. Writes retry only 429 |
| Status codes | 10 | 400 to 500 come back as the real status, never retried, never hidden |
| Parsing | 10 | JSON, single and multi-line NDJSON, invalid JSON, plain text, empty bodies and truncation are each read correctly |
| Limits | 4 | Endless answers stop at the cap, binaries stay byte-exact, a cancelled call sends nothing, retries never run past the time budget |
| Body rules | 3 | A required body is enforced, an unexpected body is refused, a file upload cannot be sent as JSON |
| Writes | 1 | Through the real MCP protocol, a write without confirmation sends nothing and returns a preview |
| Uploads | 2 | For every multipart operation with a sandbox server, `datev_upload_file` previews without sending, and after confirmation each declared file and field part is on the wire, list parts with every file |
| Search | 1 | Each operation is found by its own summary |
| Properties | 7 | Randomised inputs, 1,000 to 2,000 runs each, for NDJSON parsing, fiscal year id shapes, job phases, account prefixes, path encoding and EXTF batches |

The report of every run is written to `test/reports/eval-<time>.md` and `.json`.

## Planted bugs

A scenario set that never fails proves nothing. Four bugs were put into the code on purpose and the full run repeated.

| Planted bug | Scenarios that failed |
|---|---|
| A space added to every JSON body on the wire | 30 `wire.request` |
| Binary answers treated as text | 205 `binary.byte-exact` |
| The cancel check before sending removed | 205 `cancel.no-request` |
| Upload list parts cut to their first file (2026-11-08) | 3 `upload.parts-on-wire` |

440 scenarios failed in total, and the code was restored byte for byte afterwards. The report is kept as [docs/evidence/mutation-check-2026-11-07T182055.md](evidence/mutation-check-2026-11-07T182055.md). The same was done for single unit tests during the fixes, for example the session lock takeover test fails when its fresh re-check is removed, and the folder symlink test fails against the earlier file code.

## Live sandbox

`npm run test:live` runs a short tour against the real DATEV sandbox. It lists clients, reads a fiscal year, looks up accounts, previews an EXTF import and checks that a confirm without its code is refused.

`npm run sweep` crawls every read operation slowly, three seconds apart, at most 150 operations a day, and stops the run when an operation still answers 429 after its retries. Each read can itself retry up to three times, so the number of HTTP requests can be higher than the operation count. It learns ids from list answers and uses them for the detail operations on later runs. Write operations are never swept live.

| Live result (latest per operation) | Operations |
|---|---|
| 200 with data | 38 |
| 301 | 1 |
| 400 | 13 |
| 401 | 6 |
| 404 | 3 |
| 500 | 9 |
| 501 | 1 |
| Not called, needs an id or API key the sandbox does not provide | 55 |

The 500 answers (smart transfer outbound and one master data health endpoint) carry DATEV's own message "Sandboxing policy error", which means the sandbox gateway refuses that product for this app. The sweep recorded the 400 answers on the documents and HR export products by status and body hash only, so their cause is not proven. Changing the accept header or adding the client secret header did not change them, which fits a product not enabled for this sandbox app, but that is not confirmed. The 401 answers are HR documents and four health endpoints (HR documents, HR exchange, HR files, income tax documents). The 404 answers are lookups where the sandbox test data has no such record. The per operation table is in [ENDPOINT-AUDIT.md](ENDPOINT-AUDIT.md).

The sweep was run twice on 2026-11-07, the second time on the final code after all four review passes, with 142 real calls in total. Both runs gave the same result per operation. The live tour on the final code passed all 11 of its checks, including a real EXTF import into the sandbox that DATEV accepted with HTTP 202. Its output is kept as [docs/evidence/live-tour-2026-11-07.txt](evidence/live-tour-2026-11-07.txt), next to the [sweep report](evidence/live-sweep-2026-11-07.md) and the [final eval report](evidence/eval-2026-11-07.md).

## Independent review

OpenAI Codex was asked four times to find what is wrong with the code, with the instruction to assume the previous fixes were wrong until proven right.

| Pass | Findings | Outcome |
|---|---|---|
| 1 | 15, of which 7 high | All fixed, each with a test |
| 2 | 19, of which 3 high, on the fixed code | All fixed, each with a test except two that change memory use or the signed fields only (see below) |
| 3 | 9, of which 4 high, including 4 regressions from pass 2 | 7 fixed with tests, 2 reduced to the known limits below |
| 4 | 5 new, of which 1 high, plus 3 pass 3 fixes that only partly held | All fixed with tests, apart from the known limits |

Two pass 2 fixes have no test that fails on the old code. Keeping only the requested number of postings rows changes memory use, not the answer. Binding the file name into the upload confirmation code is a one-line change to the signed fields.

## Known limits

Two findings cannot be closed in Node.js and are documented rather than hidden.

- **A parent folder swapped during a file read.** Node.js has no `openat`, so a file cannot be opened relative to a folder that was already checked. A second process running as the same user could swap a parent folder for a link between the check and the open. Such a process could read the file directly anyway, so this adds no new access, but it is a gap.
- **The session lock is advisory.** Two processes can, in rare timing, both believe they hold it. The damage is now limited: a refresh that loses the race never deletes the session file and uses the newer session if another process saved one. The worst case left is one refused refresh and a request to log in again.

## What is not proven

- Behavior with real client data in production. That needs DATEV's technical review first.
- Operations that answered 400, 401 or 500 in the sweep. Their cause was not recorded (see above), and those operations have only been checked offline.
- Write operations other than the EXTF import and the postings export job. The EXTF import was confirmed live (HTTP 202) and the postings job ran to completion live. The other writes are checked offline only. The preview step is checked for the 79 writes that have a sandbox server. The 2 cashregister writes have none and are refused in the sandbox.
- DATEV's rate limit. DATEV publishes no number, so the sweep paces itself conservatively.

## Repeat it yourself

```bash
npm install && npm run specs && npm run build
npm run typecheck
npm test
npm run eval                 # writes test/reports/eval-<time>.md
npm run test:live            # needs DATEV credentials and a login
npm run sweep                # resumable, run it on several days
npx tsx scripts/endpoint-audit.ts   # regenerates docs/ENDPOINT-AUDIT.md
```
