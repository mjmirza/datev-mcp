# Changelog

All notable changes to this project are recorded here, in the Keep a Changelog style. Each entry says what was there before, what it is now, and why.

## [Unreleased]

### Added
- Bounded token wait in the account search. Previously `datev_find_accounts` fetched its token before the 55 second budget started and could wait up to 90 seconds for the session lock. Now the token wait counts against the budget.
- Searchable health checks. Previously `datev_search_operations` always left out the 6 health check operations, so 5 health-only products could only be reached by id. Now `include_health: true` returns them too.
- Questions and answers. Previously docs/FAQ.md had a short list. Now `docs/qa/` holds 2,000+ answered questions, from curated pages for setup, safety and troubleshooting plus generated pages for every product and operation built by `npm run qa` from the operation index, the live sweep ledger and the eval report. Every answer was checked against the code by a second model before publishing, and false claims it found were corrected.
- Community. The README links Discussions, the project board and the Q&A, and the issue form offers Discussions for questions and private reports for security problems.
- Documentation set. Previously the README was three lines. Now there is a README for both business and technical readers, plus setup, security, validation, endpoint audit, compliance, accessibility, questions and credits pages under `docs/`, because the project needs to be understood and checked by people who did not build it.
- Per-call time budget and cancellation. Previously each attempt had its own 30 second timeout, so three retries could run past a minute and the AI client's cancel was ignored. Now a call has a 55 second budget, retries only run if they still fit, and a cancel from the MCP client aborts the request in flight.
- Byte-exact binary downloads. Previously a PDF or image answer was read as UTF-8 text and corrupted. Now binary answers keep their bytes, carry a SHA-256, and `datev_call` can save them with `save_to` or return them as base64.
- Offline eval checks for what actually goes on the wire (URL, body bytes, content type), byte-exact binaries, endless streams, cancellation and the time budget. The run now has 28,462 scenarios.
- Live sweep keeps the ids it learned between runs and retries operations that answered 401, 403 or 5xx on a later day, instead of treating them as finished.

### Changed
- `datev_call` checks the body's content type. Previously a caller could pick any `content_type`, or set a `Content-Type` header, and slip a body past the operation's declared types, including a file-only one. Now the content type must match one the operation declares (wildcards such as `application/*+json` included), and the body headers are reserved for the server. A caller's `Accept` header is now sent as given instead of being merged with the default, which the PDF payroll report needs. Only the media type itself decides how a body is encoded, so a parameter such as `; profile=json` can no longer turn an XML body into a JSON string. The same holds for answers: a PDF whose content type carries such a parameter stays binary instead of being decoded as text.
- The upload tools pass DATEV's truncation flag through. Previously `datev_upload_document` and `datev_upload_extf` dropped it, so a cut answer looked complete. Now their result carries `truncated`.
- A confirmation code works once. Previously a valid code could be reused within its 15 minutes, so one approval could send the same write twice. Now the first use spends it and a second use is refused with a request for a new preview. Each code also carries a random nonce, so two identical previews never share a code, and only the exact spelling the preview produced is accepted, so a spent code cannot be replayed in another form. Spent codes are remembered for a day past their expiry, so setting the system clock back by up to a day cannot bring one back, unless more than 10,000 codes were accepted within 15 minutes, which forces early pruning. At most 10,000 codes are accepted within 15 minutes.
- Writes need a confirmation code. Previously `confirm: true` alone ran a write, so a preview could be skipped or the payload changed after it. Now the preview returns a code bound to the exact request, and confirm only works with it.
- The answer body is read as a stream with a hard 50 MB stop. Previously the whole body was buffered before any size check.
- Postings read every page. Previously only the first page was read. Now pages are read in order within the budget, a partial read says where to continue, and an earlier job can be resumed with `job_id`.
- The typed accounting tools treat any non-2xx answer, a redirect, a truncated body or an unknown answer shape as an error. Single malformed rows inside a list are skipped by the account search and the postings account filter. The upload tools report a cut answer with `truncated: true` instead. Previously some of these came back as an empty list that looked like a real answer.
- Document uploads send the correct file type, refuse ZIP, and check DATEV's length limits for metadata.
- The chart of accounts cache is tied to the login. Previously a different login could be served the previous user's cached chart.

### Fixed
- Refresh token reuse. Previously a refresh that failed could leave the spent token stored and try it again. Now a spent token is never written back.
- Session lock. Previously any process could remove a lock it judged stale, even while the owner was still working. Now the lock records its owner and is only taken over when it is old and the owner is gone.
- File safety. Previously any readable file could be uploaded and saves could follow a symlink. Now hidden folders and key-like files are refused, symlinks are resolved before the check, and new files are created exclusively with owner-only permissions.
- Redirects. Previously fetch could follow a redirect and send the client secret along. Now operation calls never follow redirects. The login token request and `doctor` still use fetch defaults.
- Writes retried after a gateway error. Previously a write could be retried after a 502 or 503 and run twice. Now writes retry only after a 429.
- Lock takeover race. Previously two processes that both judged a lock stale could remove each other's fresh lock. Now the takeover runs under its own short mutex and decides on fresh state, and a lock held past two minutes counts as stale even if its process id was reused.
- File read race. Previously a file could be swapped for a link to a key file between the check and the read. Now the file is opened once without following links and must be the one that was checked, and the size limit holds while reading.
- Saves through a symlinked folder. Previously `save_to` through a folder link into `~/.ssh` passed the check. Now the real parent folder is resolved and checked, writes continue after a short write, and a failed save leaves no temp file behind.
- A wrong client secret logged the user out. Now only a rejected refresh token ends the session.
- Time and cancel gaps. Previously the token wait and the retry backoff ignored the budget and the cancel, `Retry-After` was capped at ten seconds, and a body that broke off was not retried. All four now behave as documented.
- Binary downloads were cut at the text preview size of about 400 KB. Now binaries have their own budget up to 50 MB.
- Confirmation codes treated a missing body and a `null` body as the same request, and upload codes did not cover the file name. Both are now part of the signed request.
- Client lists stopped at DATEV's 100 per request. Now they page. Error-shaped HTTP 200 answers and rows of the wrong shape are rejected, and the postings tool shares one deadline across all its requests and keeps only the rows it returns.
- Regressions from the fixes above, found by later review passes. A two minute lock age could evict a live holder; it is gone, and a reused process id is now told apart by process start time read in UTC. A refresh that lost a race could delete the newer session; the session file is now never deleted on a rejected refresh, and a recovered session must belong to the same app. A named pipe could hang a file read, a file that grew while being read was cut short, and a failed new save could remove a file of the same name; all three are fixed. Bare fiscal year ids are accepted again but must be real eight digit ids, empty posting rows are refused, long file names and drives without hard links work, and a postings call that runs out of time while reading keeps the rows it already has.

## [0.0.1] - 2026-11-07

### Added
- MCP server over all 209 operations of 23 DATEV API specifications, with search, describe and call.
- DATEV login with OpenID Connect, PKCE and single-use refresh handling, plus a `doctor` check.
- Typed tools for clients, fiscal years, sums and balances, account postings and the chart of accounts.
- EXTF check, write and upload, and document upload.
- Path values checked against DATEV's own schema.
