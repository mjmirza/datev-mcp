<!-- freshness: 14d -->
# Validation

What was checked, how, the numbers from the last run, and how to repeat each check yourself. Every number here comes from a real run on 2026-11-07. Nothing is estimated.

## The five layers

| Layer | What it proves | Command | Last result |
|---|---|---|---|
| Type check | The code is consistent, strict mode | `npm run typecheck` | Clean |
| Unit and integration tests | Each behavior, including failure paths, through the real MCP protocol where it matters | `npm test` | 92 of 92 passing |
| Offline scenario run | Every one of the 209 operations against 59 scenario categories, with a fake DATEV | `npm run eval` | 26,462 of 26,462 passing |
| Planted bugs | The scenarios catch real defects | see below | 3 of 3 bugs caught |
| Live DATEV sandbox | The server works against the real DATEV gateway | `npm run test:live`, `npm run sweep` | 71 read operations reached, 38 returned data |

On top of that, a second AI model reviewed the code three times, described under "Independent review".

## Offline scenarios

`test/evals/run.ts` generates the scenarios from the operation index, so a new DATEV operation is covered the moment the specs are refreshed. Nothing reaches the network. Per operation it checks the following.

| Group | Categories | What a pass means |
|---|---|---|
| URL | 3 | The request goes to the right DATEV host for sandbox and production, with no placeholder left |
| Path values | 5 | `..`, `/`, empty values and values DATEV's schema forbids are refused. Odd but allowed values (umlauts, emoji, `#`, `?`, quotes) are encoded and cannot leak into the query |
| Query and headers | 6 | Required values are enforced, arrays repeat correctly, injected `&` or line breaks cannot split a value, server headers cannot be overridden |
| Wire request | 1 | The exact URL, body bytes and content type that leave the machine match the request, and no credential is in the URL |
| Auth | 1 | Bearer token, client id, client secret only where DATEV requires it, redirects never followed |
| Retries and network | 7 | Reads retry 429, 502, 503, 504 and network errors up to three attempts. Writes retry only 429 |
| Status codes | 10 | 400 to 500 come back as the real status, never retried, never hidden |
| Parsing | 10 | JSON, single and multi-line NDJSON, invalid JSON, plain text, empty bodies and truncation are each read correctly |
| Limits | 4 | Endless answers stop at the cap, binaries stay byte-exact, a cancelled call sends nothing, retries never run past the time budget |
| Body rules | 3 | A required body is enforced, an unexpected body is refused, a file upload cannot be sent as JSON |
| Writes | 1 | Through the real MCP protocol, a write without confirmation sends nothing and returns a preview |
| Search | 1 | Each operation is found by its own summary |
| Properties | 6 | Randomised inputs, 1,000 to 2,000 runs each, for encoding, header safety and parsing |

The report of every run is written to `test/reports/eval-<time>.md` and `.json`.

## Planted bugs

A scenario set that never fails proves nothing. Three bugs were put into the client on purpose and the full run repeated.

| Planted bug | Scenarios that failed |
|---|---|
| A space added to every JSON body on the wire | 30 `wire.request` |
| Binary answers treated as text | 205 `binary.byte-exact` |
| The cancel check before sending removed | 205 `cancel.no-request` |

440 scenarios failed in total, and the code was restored byte for byte afterwards. The report is kept as `test/reports/mutation-check-2026-11-07T182055.md`. The same was done for single unit tests during the fixes, for example the session lock takeover test fails when its fresh re-check is removed, and the folder symlink test fails against the earlier file code.

## Live sandbox

`npm run test:live` runs a short tour against the real DATEV sandbox. It lists clients, reads a fiscal year, looks up accounts, previews an EXTF import and checks that a confirm without its code is refused.

`npm run sweep` crawls every read operation slowly, three seconds apart, at most 150 calls a day, and stops on the first 429. It learns ids from list answers and uses them for the detail operations on later runs. Write operations are never swept live.

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

The 500 answers (smart transfer outbound and one master data health endpoint) carry DATEV's own message "Sandboxing policy error", which means the sandbox gateway refuses that product for this app. The 400 answers on the documents and HR export products come from DATEV's server before any request checking. Changing the accept header or adding the client secret header does not change them, so they point to products not yet enabled for this sandbox app rather than a defect here. The 401 answers are HR documents and four health endpoints (HR documents, HR exchange, HR files, income tax documents). The 404 answers are lookups where the sandbox test data has no such record. The per operation table is in [ENDPOINT-AUDIT.md](ENDPOINT-AUDIT.md).

The live numbers above were measured earlier on 2026-11-07, before the second round of fixes. Those fixes did not touch how requests are built, and the offline wire checks still pass, but the live sweep has not been repeated since.

## Independent review

OpenAI Codex was asked three times to find what is wrong with the code, with the instruction to assume the previous fixes were wrong until proven right.

| Pass | Findings | Outcome |
|---|---|---|
| 1 | 15, of which 7 high | All fixed, each with a test |
| 2 | 19, of which 3 high, on the fixed code | All fixed, each with a test except two that change memory use or the signed fields only (see below) |
| 3 | Pending at the time of writing | |

Two pass 2 fixes have no test that fails on the old code. Keeping only the requested number of postings rows changes memory use, not the answer. Binding the file name into the upload confirmation code is a one-line change to the signed fields.

## What is not proven

- Behavior with real client data in production. That needs DATEV's technical review first.
- Products the sandbox app is not enabled for. The 400, 401 and 500 answers above are DATEV's gateway, and those operations have only been checked offline.
- Write operations against DATEV. They are checked offline and through the MCP preview flow, and the EXTF preview is checked live, but no write was confirmed against the sandbox.
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
