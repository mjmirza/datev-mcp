# Changelog

All notable changes to this project are recorded here, in the Keep a Changelog style. Each entry says what was there before, what it is now, and why.

## [Unreleased]

### Added
- Documentation set. Previously the README was three lines. Now there is a README for both business and technical readers, plus setup, security, validation, endpoint audit, compliance, accessibility, questions and credits pages under `docs/`, because the project needs to be understood and checked by people who did not build it.
- Per-call time budget and cancellation. Previously each attempt had its own 30 second timeout, so three retries could run past a minute and the AI client's cancel was ignored. Now a call has a 55 second budget, retries only run if they still fit, and a cancel from the MCP client aborts the request in flight.
- Byte-exact binary downloads. Previously a PDF or image answer was read as UTF-8 text and corrupted. Now binary answers keep their bytes, carry a SHA-256, and `datev_call` can save them with `save_to` or return them as base64.
- Offline eval checks for what actually goes on the wire (URL, body bytes, content type), byte-exact binaries, endless streams, cancellation and the time budget. The run now has 26,462 scenarios.
- Live sweep keeps the ids it learned between runs and retries operations that answered 401, 403 or 5xx on a later day, instead of treating them as finished.

### Changed
- Writes need a confirmation code. Previously `confirm: true` alone ran a write, so a preview could be skipped or the payload changed after it. Now the preview returns a code bound to the exact request, and confirm only works with it.
- The answer body is read as a stream with a hard 50 MB stop. Previously the whole body was buffered before any size check.
- Postings read every page. Previously only the first page was read. Now pages are read in order within the budget, a partial read says where to continue, and an earlier job can be resumed with `job_id`.
- Typed tools treat any non-2xx answer, a redirect, a truncated body or an unknown shape as an error. Previously some of these came back as an empty list that looked like a real answer.
- Document uploads send the correct file type, refuse ZIP, and check DATEV's length limits for metadata.
- The chart of accounts cache is tied to the login. Previously a different login could be served the previous user's cached chart.

### Fixed
- Refresh token reuse. Previously a refresh that failed could leave the spent token stored and try it again. Now a spent token is never written back.
- Session lock. Previously any process could remove a lock it judged stale, even while the owner was still working. Now the lock records its owner and is only taken over when it is old and the owner is gone.
- File safety. Previously any readable file could be uploaded and saves could follow a symlink. Now hidden folders and key-like files are refused, symlinks are resolved before the check, and new files are created exclusively with owner-only permissions.
- Redirects. Previously fetch could follow a redirect and send the client secret along. Now redirects are never followed.
- Writes retried after a gateway error. Previously a write could be retried after a 502 or 503 and run twice. Now writes retry only after a 429.
- Lock takeover race. Previously two processes that both judged a lock stale could remove each other's fresh lock. Now the takeover runs under its own short mutex and decides on fresh state, and a lock held past two minutes counts as stale even if its process id was reused.
- File read race. Previously a file could be swapped for a link to a key file between the check and the read. Now the file is opened once without following links and must be the one that was checked, and the size limit holds while reading.
- Saves through a symlinked folder. Previously `save_to` through a folder link into `~/.ssh` passed the check. Now the real parent folder is resolved and checked, writes continue after a short write, and a failed save leaves no temp file behind.
- A wrong client secret logged the user out. Now only a rejected refresh token ends the session.
- Time and cancel gaps. Previously the token wait and the retry backoff ignored the budget and the cancel, `Retry-After` was capped at ten seconds, and a body that broke off was not retried. All four now behave as documented.
- Binary downloads were cut at the text preview size of about 400 KB. Now binaries have their own budget up to 50 MB.
- Confirmation codes treated a missing body and a `null` body as the same request, and upload codes did not cover the file name. Both are now part of the signed request.
- Client lists stopped at DATEV's 100 per request. Now they page. Error-shaped HTTP 200 answers and rows of the wrong shape are rejected, and the postings tool shares one deadline across all its requests and keeps only the rows it returns.

## [0.0.1] - 2026-11-07

### Added
- MCP server over all 209 operations of 23 DATEV API specifications, with search, describe and call.
- DATEV login with OpenID Connect, PKCE and single-use refresh handling, plus a `doctor` check.
- Typed tools for clients, fiscal years, sums and balances, account postings and the chart of accounts.
- EXTF check, write and upload, and document upload.
- Path values checked against DATEV's own schema.
