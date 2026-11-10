# Review ledger

Every finding from every review round, in one place, with one id. This page stops the review loop. A finding is
never fixed twice, never silently reopened, and a fix that breaks an earlier one is caught by that earlier finding's test.

## Rules

1. **One id per defect.** A new review round first maps each of its findings to an existing id. Only a defect that matches no row gets a new id.
2. **Fixed means guarded.** A row is `fixed` only with the commit and the name of the test that fails without the fix. `test/unit/review-ledger.test.ts` checks that every named test exists, so a deleted guard turns the build red.
3. **A reappearing finding is a regression, not a new finding.** Reopen the row as `regressed`, find the commit that broke it, and fix both together.
4. **Rejected needs evidence.** A finding we do not adopt carries the reason and the source. Reviewers who disagree are settled by DATEV's own pages, never by the louder reviewer.
5. **Conflicting fixes are decided once.** When two findings pull in opposite directions (log more against log less), the decision is written here and both findings point at it.

R1 is the Grok review of 2026-11-09. R2 is the Codex review of 2026-11-10, which read commit 33c2205. R3 is the reading of DATEV's published Schnittstellenvorgaben on 2026-11-10, see [COMPLIANCE-CHECKLIST.md](COMPLIANCE-CHECKLIST.md). R4 is the Codex attack on commits e3ad92a..bc6085f, 2026-11-10. R5 is the Codex check of the R4 fixes in e9b7706, the same day. R6 is the Grok attack on the branch up to c87f2a0, the same day. R7 is the Codex check of c87f2a0..17c0e70, which reopened ten rows. R8 is the Codex check of 6f29796, which reopened ten rows and found three more. Finding numbers are the reviewer's own.

## Findings

| Id | Sev | Defect | From | Status | Fix | Guarding test |
|---|---|---|---|---|---|---|
| F01 | BLOCKER | `status` and `doctor` called DATEV without writing the HTTP log | R1-1 | fixed | 33c2205 | status and doctor put every DATEV call they make into the HTTP log |
| F02 | BLOCKER | Data service labels invented ("Online-API ...") or misspelled ("Einkommenssteuer") | R1-2, R2-17 | fixed | 33c2205 and the next commit | data services carry DATEV's own names |
| F03 | HIGH | Token calls logged answer time as request time, no request headers, timeouts not logged | R1-3 | fixed | 9a35247 | token calls are logged with the real request time |
| F04 | HIGH | Help link lost for list-shaped errors and `error_uri`, tool answers had no readable help line | R1-4 | fixed | 9a35247 | DATEV's help link survives list-shaped errors |
| F05 | BLOCKER | New login saved before revoking and only warned when revoke failed, leaving two valid refresh tokens | R1-5, R2-1 | fixed | b671e68 | an old refresh token DATEV did not revoke is kept encrypted |
| F06 | MEDIUM | A refresh token DATEV rejected was sent again on every call | R1-5, R2-25 | fixed | b671e68 | a refresh token DATEV rejected is dropped |
| F07 | - | Keep the previous refresh token when a refresh returns none | R1-5 | rejected | - | DATEV refresh tokens are single-use, so the old one is spent and resending it is the defect F06 removes |
| F08 | HIGH | Disconnect reports "revoked" when the access-token revoke failed or no 2xx came | R1-6, R2-11 | fixed | 2472968 | disconnect never reports success when a usable token was not revoked |
| F09 | HIGH | Q&A tells users to delete the config folder instead of running `disconnect` | R1-6, R2-12 | fixed | 2472968 | docs, Q&A sources and code never repeat a claim a reviewer proved false |
| F10 | BLOCKER | `DATEV_MCP_CONFIRM=token` lets production writes through without a human | R1-7, R2-4 | fixed | 134c625 | a production write is never sent on a confirm code alone |
| F11 | HIGH | Postings export job (a POST) created without approval | R1-7, R2-19 | rejected | - | The postings export job is a read export that changes no bookings, so it is outside the write approval by decision. datev_call still asks for a confirm code for the same operation |
| F12 | HIGH | cashregister and SmartTransfer have no scopes, so the chosen-service boundary does not apply | R1-8, R2-15, R7, R8, R9 | fixed | 958645b | a saved login known only by DATEV's granted scopes is bounded by them, and an unknown one fails closed |
| F13 | LOW | `DATEV_SCOPES` precedence and "all scopes by default" documented wrongly | R1-8, R2-31, R2-32 | fixed | 4e66d5f | docs, Q&A sources and code never repeat a claim a reviewer proved false |
| F14 | HIGH | Docs claim write retries, redirects followed, nothing saved on a failed check | R1-9, R2-30 | fixed | 134c625 | docs, Q&A sources and code never repeat a claim a reviewer proved false |
| F15 | HIGH | German mode leaves login, services, doctor, previews and approvals in English | R1-10, R2-21, R7 | fixed | 6f29796 | the services command reads in German |
| F16 | HIGH | A quarantined corrupt session file stays in plaintext | R1-11 | fixed | b3996d8 | a corrupt plain text session is kept only as an encrypted copy |
| F17 | HIGH | Login completes without the full user name DATEV requires | R1-12, R2-13 | fixed | 15dcb51 | a login without the full user name saves nothing |
| F18 | MEDIUM | `azp` checked only for multiple audiences, `at_hash` never | R1-13, R2-23 | fixed | 3edd7c4 | the ID token check rejects a foreign authorized party |
| F19 | MEDIUM | Client secret not trimmed | R1-14 | fixed | 8a3374d | a DATEV Public client signs in with PKCE and client_id alone |
| F20 | MEDIUM | Log keeps job and status bodies and full query strings (business data), while R2-10 asks for more body logging | R1-15, R2-10 | rejected | - | DATEV minimum log scope (GEN-18, GEN-19) requires the full URL with query and the bodies of status answers, so they stay. Request bodies are added, see F33 |
| F21 | HIGH | A failed log write is reported once, then DATEV traffic continues unlogged | R1-16, R2-8 | fixed | 6a099df | no call goes out while the technical HTTP log cannot be written |
| F22 | MEDIUM | `datev_call` treats 3xx as success | R1-17 | fixed | b3996d8 | datev_call reports a DATEV redirect as an error and never saves its body |
| F23 | MEDIUM | DATEV's technical client id shown to people in tool text and approval dialogs | R1-18, R2-28, R7, R8, R9, R10, R11, Grok R12, Codex R13 | fixed | 0151f5c | a write's approval and preview hide the client id in the query and in header values |
| F24 | MEDIUM | Shipped `dist/data/operations.json` carries DATEV description text | R1-19 | rejected | | Nothing ships: the package is private and dist plus the built index are git-ignored, so each developer builds the index from their own downloaded specs. The guard pins those facts, which already held. |
| F25 | MEDIUM | Requirement tests miss several MUSTs | R1-20, R7, R8, R9, R11 | fixed | 881f64b | a permission refusal far larger than the permission check's read limit keeps the title and link at its end |
| F26 | LOW | Connection tool says true or false instead of AKTIV or INAKTIV, disconnect without a session lacks the tokrevui link | R1-21 | fixed | 0324e85 | the connection status tool answers with AKTIV or INAKTIV text the person can read |
| F27 | BLOCKER | JWKS (signing key) requests not in the HTTP log | R2-2 | fixed | 3edd7c4 | the ID token check rejects a foreign authorized party |
| F28 | BLOCKER | Quick start keeps the client secret in a plaintext file while docs claim it is stored encrypted | R2-3 | fixed | 134c625 | docs, Q&A sources and code never repeat a claim a reviewer proved false |
| F29 | BLOCKER | Token, userinfo and revoke errors drop DATEV's help link | R2-5 | fixed | 3edd7c4 | token, userinfo and revoke errors keep DATEV's help link |
| F30 | HIGH | Tokens issued before the identity check are abandoned, not revoked, when a later login step fails | R2-6 | fixed | 15dcb51 | a login without the full user name saves nothing |
| F31 | HIGH | A body that breaks off is thrown before the call is logged | R2-7 | fixed | 6a099df | a write whose answer breaks off is still logged |
| F32 | HIGH | A retried GET error answer is logged without its body | R2-9 | fixed | 6a099df | a write whose answer breaks off is still logged |
| F33 | HIGH | Request bodies kept only as a hash | R2-10 | fixed | b49460d | request bodies are logged as DATEV's minimum scope asks |
| F34 | HIGH | Status reports ACTIVE without checking userinfo's shape and that `sub` matches the saved identity | R2-14 | fixed | 15dcb51 | the status is ACTIVE only for a valid userinfo answer about the same person |
| F35 | HIGH | Choosing accounting services silently adds the accounting-clients scope | R2-16 | fixed | 4e66d5f | login checks the ID token, saves the name and chosen services, and revokes the previous refresh token |
| F36 | HIGH | Upload approval does not show the destination client, query and resolved URL | R2-18 | fixed | 6182745 | documents use only the client's document types and the field rules of the chosen service |
| F37 | HIGH | Uploads do not check the client list and the service before sending | R2-20 | fixed | 6182745 | a document is refused before sending when the client has not switched the service on, with DATEV's setup link |
| F38 | MEDIUM | A `null` token answer crashes before it is logged | R2-22 | fixed | 3edd7c4 | token, userinfo and revoke errors keep DATEV's help link |
| F39 | MEDIUM | Session key creation not serialised across environments | R2-24, R7, R8 | fixed | 6ce813c | the session key of a per-user credential store is created under one lock for every home folder |
| F40 | MEDIUM | Status shows an invented 11-hour validity when no expiry is stored | R2-26 | fixed | 15dcb51 | the status is ACTIVE only for a valid userinfo answer about the same person |
| F41 | MEDIUM | `doctor` calls accounting-clients even when that service is not connected | R2-27, R7, R8, R9 | fixed | 958645b | a saved login known only by DATEV's granted scopes is bounded by them, and an unknown one fails closed |
| F42 | MEDIUM | Setup walkthrough grants too few scopes for its own example questions | R2-29 | fixed | 4e66d5f | the setup and README login examples grant the service their first questions need |
| F43 | BLOCKER | The login uses a localhost redirect with a client secret (Confidential client), which DATEV blocks in production since 01.03.2026 | R3 DATEV requirements AUTH-13, REDIR-01 | fixed | 8a3374d | a DATEV Public client signs in with PKCE and client_id alone |
| F44 | HIGH | The client gate checks the first client alias it finds, not the client the URL actually targets | R4-1 | fixed | e9b7706 | the permission check reads the client the URL targets, never a surplus parameter |
| F45 | HIGH | hr-documents uploads by `client_guid` skip the client check | R4-2 | fixed | e9b7706 | an hr-documents upload by GUID is checked through DATEV's client list |
| F46 | HIGH | `datev_upload_file` reaches accounting-documents without the service check and the document rules | R4-3, R5 | fixed | 2f0afb4 | a stapled upload follows the document rules of datev_upload_document |
| F47 | HIGH | Two concurrent EXTF sends both pass the duplicate check, and parallel ledger writes lose entries | R4-4, R5 | fixed | 2f0afb4 | two deliberate resends at once reach DATEV only once |
| F48 | HIGH | An unreadable send ledger counts as never sent, and a failed ledger write forgets an accepted file | R4-5, R5 | fixed | 2f0afb4 | a refused resend keeps the record of the earlier accepted send |
| F49 | HIGH | An EXTF POST whose answer is lost is not recorded, so a fresh confirmation sends it again | R4-6, R5 | fixed | 2f0afb4 | a gateway error after the POST keeps the file counted as sent |
| F50 | HIGH | A missing Export permission says the connection ended even when a token revocation failed | R4-7 | fixed | e9b7706 | a missing Export permission revokes both tokens, and an unconfirmed revocation is retried with no token left in use |
| F51 | HIGH | A DATEV 5xx during the Export permission check logs the person out | R4-8 | fixed | e9b7706 | a DATEV server error during the permission check never ends the connection |
| F52 | MEDIUM | `datev_call` of getfiscalyears skips the Export guard | R4-9 | fixed | e9b7706 | datev_call of the fiscal year list runs the Export permission check |
| F53 | MEDIUM | Payroll report types are requested when DATEV's answer lacks access_granted | R4-10 | fixed | e9b7706 | payroll report types are refused when DATEV lists no granted types |
| F54 | MEDIUM | The document id ignores service and filing, so the same bytes cannot be filed differently | R4-11, R5 | fixed | 2f0afb4 | no field value can imitate another in the document id |
| F55 | MEDIUM | Retry-After above 20 seconds is shortened | R4-12 | fixed | e9b7706 | a Retry-After longer than the call is honored, not shortened |
| F56 | MEDIUM | The document type cache is shared across logins | R4-13 | fixed | e9b7706 | document types read by one login are not reused for another |
| F57 | MEDIUM | Document types can be read more than once per day (explicit tool, parallel uploads) | R4-14, R5 | fixed | 2f0afb4 | a token refresh keeps the daily document type read, a new login does not |
| F58 | MEDIUM | An earlier transfer's name, time and job id are shown before the current permission is checked | R4-15 | fixed | e9b7706 | an earlier send is not shown to a login without permission for the client |
| F59 | LOW | Some accounting-rules tests pass without proving their claim (revocation, daily cache, repeated PUT) | R4-16, R5 | fixed | 2f0afb4 | the same filing uploaded twice reaches the same DATEV document id |
| F60 | HIGH | The hr-documents GUID mapping is cached across logins and DATEV's answer is not checked against the GUID | R5-3 | fixed | 2f0afb4 | an hr-documents GUID mapping is never reused by another login |
| F61 | MEDIUM | After a partial revocation the session still hands out the revoked access token | R5-5 | fixed | 2f0afb4 | a partly revoked connection never hands out the revoked access token again |
| F62 | MEDIUM | The new document id differs from the one before the upgrade, so a retried earlier upload makes a copy | R5-6 | rejected |  | The earlier id scheme came in with 6182745 on this same unmerged branch and never shipped, so no upload carries an id from it |
| F63 | MEDIUM | A cancel after the token but before the request leaves keeps a false uncertain reservation | R5-7 | fixed | 2f0afb4 | a send cancelled before it left releases its reservation |
| F64 | MEDIUM | The document type cache waits for the token without the call's cancel and budget | R5-8 | fixed | 2f0afb4 | a cancelled document type read does not wait for a token that never comes |
| F65 | MEDIUM | Cancelling one caller of a shared document type read fails the other callers | R5-9 | fixed | 2f0afb4 | one caller cancelling a shared document type read does not fail the others |
| F66 | BLOCKER | An EXTF answer of 408 or a redirect deleted the send record, so the same file could be posted again | R6-1 | fixed | c575391 | an EXTF send answered with a timeout or a redirect still counts as sent |
| F67 | BLOCKER | Any 4xx except 429 from the Export permission check revoked the whole login | R6-2 | fixed | c575391 | only a 403 or a missing service ends the connection, never a timeout, a bad token or an unknown client |
| F68 | HIGH | A cancel after DATEV answered threw the answer away and lost the job id | R6-3, R7 | fixed | 6f29796 | an EXTF file DATEV accepted returns its job id even when asking for the result fails |
| F69 | HIGH | A lost revoke answer left the revoked access or refresh token in use | R6-4, R7, R8 | fixed | 6ce813c | a disconnect whose revoke answer is lost never uses the refresh token again |
| F70 | HIGH | An uncertain resend hid an accepted import, and the next resend dropped its job id | R6-5 | fixed | c575391 | a resend that is lost after an accepted import still names the accepted job |
| F71 | HIGH | The send, permission, client gate and document refusals stayed English in German mode | R6-6, R7, R8, R9 | fixed | 958645b | an EXTF note whose bracket holds several sentences reads fully in German |
| F72 | MEDIUM | A changed note minted a new document id, and stapled uploads could repeat unnoticed | R6-7, R7, R8 | fixed | 6ce813c | a stapled upload answered 429 counts as possibly stored, not as refused |
| F73 | MEDIUM | An empty document type answer was cached for the rest of the Berlin day | R6-8 | fixed | c575391 | an empty document type answer is not kept for the rest of the day |
| F74 | HIGH | After a partly failed end, a later disconnect skipped the unrevoked access token | R7-1, R8, R9, R11 | fixed | 881f64b | a second disconnect still revokes an access token DATEV did not confirm the first time |
| F75 | HIGH | A redirect answer to a write claimed that nothing changed | R7-2 | fixed | 6f29796 | a write answered with a redirect never claims that nothing changed |
| F76 | LOW | The income tax health check was refused although its service was chosen | R7-3 | fixed | 6f29796 | the income tax health check stays reachable when its service was chosen |
| F77 | LOW | German approvals rewrote client and consultant inside company names | R7-4, R8, R9, R10 | fixed | 3e0f865 | German keeps a client name that starts with unnamed client, and translates every sentence after an open bracket |
| F78 | LOW | The send record grew with every resend | R7-5 | fixed | 6f29796 | a send record keeps the accepted import but does not grow with every resend |
| F79 | HIGH | The eval run wrote stapled send records into the person's real config folder | own check, R7 | fixed | 6f29796 | tests and evals always keep their records in temporary folders, never the person's own |
| F80 | MEDIUM | The approval redaction replaced any body value equal to the client id, hiding real payroll data | R8-1, R9 | fixed | 958645b | a write's approval dialog shows the body exactly as it is sent, even a value equal to the client id |
| F81 | LOW | A partial expert scope set lost the health check of the service it touched | R8-2 | fixed | 6ce813c | a partial expert scope set keeps the health check of the service it touches |
| F82 | LOW | A damaged earlier entry in the send record was accepted as an accepted send | R8-3, R9, R11 | fixed | 881f64b | a damaged entry deep in a send record's history counts as damaged |
| F83 | MEDIUM | The send-record check rejected a valid long history written by an earlier version, blocking every send | R9-1 | fixed | 958645b | a send record whose status is not a plain text counts as damaged, and a long history from an older version is still read |
| F84 | LOW | openid, shared by every service, connected unrelated services when deriving them from scopes | R9-2 | fixed | 958645b | a scope every service shares, like openid, never connects a service on its own |
| F85 | HIGH | A cut error answer sent in tiny pieces stalled the reader for tens of seconds | R10-1, R11 | fixed | 881f64b | the error scan costs the same per byte however small the pieces are |
| F86 | MEDIUM | A non-JSON error answer was read up to 50 MB past the read limit | R10-2 | fixed | 3e0f865 | a non-JSON error answer is not read past the read limit |
| F87 | MEDIUM | A title between the read limit and the kept tail of an error answer was lost | R10-3, R11 | fixed | 881f64b | a permission refusal far larger than the permission check's read limit keeps the title and link at its end |
| F88 | MEDIUM | A new login dropped an ended login's unconfirmed access token, and a refused call never retried it | R10-4, R11 | fixed | 881f64b | many refused calls on an ended connection send one revoke, not one each |
| F89 | MEDIUM | The client id stayed in query strings of result, location and paging addresses | R10-5, R11, Grok R12, Codex R13 | fixed | 0151f5c | an id whose every character is escaped twice is hidden, and other bytes stay as sent |
| F90 | LOW | An empty stored service list ignored the scopes DATEV granted | R10-6 | fixed | 3e0f865 | an empty stored service list falls back to the scopes DATEV granted |
| F91 | LOW | An unclosed bracket stopped every later sentence from being translated | R10-7 | fixed | 3e0f865 | German keeps a client name that starts with unnamed client, and translates every sentence after an open bracket |
| F92 | HIGH | Ending a connection left older unconfirmed access tokens from earlier logins unrevoked | R11 | fixed | 881f64b | ending a connection also revokes an earlier login's access token, and keeps it when DATEV does not confirm |
| F93 | MEDIUM | Each refused call on an ended connection started its own revoke retry | R11 | fixed | 881f64b | many refused calls on an ended connection send one revoke, not one each |
| F94 | MEDIUM | The error scan stopped at the title and dropped DATEV's help link and request id | R11 | fixed | 881f64b | the error scan keeps a help link and request id that come after the title |
| F95 | LOW | A character cut at the read limit was decoded broken | R11 | fixed | 881f64b | a character cut at the read limit is read whole |
| F96 | MEDIUM | An error answer that went quiet past the read limit was waited for indefinitely | R11, Grok R12 | fixed | 68bdce6 | an error answer exactly as long as the read limit that then goes quiet is not waited for |
| F97 | LOW | An undeclared client path parameter was hidden as if it were the client id | R11 | fixed | 881f64b | only a declared client path parameter is hidden, also as a consultant and client number pair and when percent-encoded |
| F98 | LOW | An expired access token waiting for its revoke was never dropped from the record | R11 | fixed | 881f64b | an expired access token waiting for its revoke is dropped from the record |
| F99 | HIGH | An error answer still dribbling past the read limit ran into the overall timeout and lost DATEV's refusal | R12 | fixed | 803cbc8 | a refused write whose error answer keeps dribbling past the read limit is reported as refused, quickly |
| F100 | MEDIUM | An error answer that broke off past the read limit lost its status and was retried | R12 | fixed | 803cbc8 | an error answer that breaks off past the read limit keeps its status and title |
| F101 | LOW | A numeric request id in an error answer was not kept | R12 | fixed | 803cbc8 | the error scan keeps a numeric request id, also one cut at a scan batch edge |
| F102 | LOW | A nested title in an error answer can win over the top-level one | R12, Codex R13, R14 | fixed | 3eaab61 | a nested title and help link do not hide the top-level ones (F102) |
| F103 | HIGH | Master client ids and combined consultant and client numbers were shown in answer links | R12 | fixed | 5b75d34 | every declared path parameter that names a client is read as a client id, an unrelated one is not |
| F104 | MEDIUM | An upper-case GUID, or an id before a dot, semicolon or comma, was shown | R12 | fixed | 5b75d34 | a GUID is hidden whatever its case, and an id before a dot, semicolon or comma is hidden too |
| F105 | LOW | Hiding an id re-encoded the rest of a query and missed the fragment | R12, Codex R13 | fixed | 0151f5c | an id joined to a longer token by a dash, and the URL authority, are never rewritten |
| F106 | LOW | A client id percent-encoded twice was shown | R12, Codex R13 | fixed | 0151f5c | an id whose every character is escaped twice is hidden, and other bytes stay as sent |
| F107 | MEDIUM | A late refusal of an older access token ended a newer login | R12, Grok R12 | fixed | ab8850d | a late 403 from an older access token never ends a newer login saved meanwhile |
| F108 | MEDIUM | A new login over an active one left the old access token live and unrecorded | R12, Grok R12 | fixed | ab8850d | a new login over an active one revokes the old unexpired access token too |
| F109 | LOW | An ended connection kept saying a revoke was open after DATEV confirmed all of them | R12 | fixed | ab8850d | once DATEV confirmed every revoke, an ended connection no longer claims a revoke is still open |
| F110 | LOW | A disconnect of another app registration's session hid the tokens it could not revoke | R12 | fixed | ab8850d | a disconnect of a session from another app registration says which tokens could not be revoked here |
| F111 | MEDIUM | Past the read limit a 2 second pause ends the scan before a later title or help link arrives | Grok R12, Codex R13, R14 | fixed | ae97681 | a title and help link that arrive after a pause past the read limit are still kept, inside the scan limit |
| F112 | MEDIUM | Disconnect reports the local session removed while tokens stay live, for another app registration or with --local-only | Grok R12, R14 | fixed | 1d441d9 | disconnect exits with an error when another app registration's tokens stay live, and not after --local-only |
| F113 | LOW | A field whose key and value are thousands of spaces apart across a scan batch is not kept | Grok R12, Codex R13, R14 | fixed | 3eaab61 | a key separated from its value by more whitespace than any window is read (F113) |
| F114 | LOW | Expired backlog of another app registration's session was never dropped | Grok R12 | fixed | 68bdce6 | an expired backlog entry of another app registration's session is dropped, a live one is kept and nothing is sent |
| F115 | MEDIUM | A refusal that arrived after an ordinary token refresh left the session active | R13 | fixed | 816c104 | a 403 that arrives after an ordinary refresh still ends that login and revokes its tokens |
| F116 | MEDIUM | A break past the read limit vanished from the HTTP log when the answer was kept | R13 | fixed | f4d152c | an error answer that breaks off past the read limit still logs the break |
| F117 | LOW | An expired access token was reported as a revoke DATEV confirmed | R13 | fixed | 816c104 | an ended connection whose unconfirmed access token expired says so, never that DATEV confirmed it |
| F118 | MEDIUM | A write DATEV answered with a server error gave no warning that it may already be applied | R13 | fixed | 096fc3e | a write that DATEV answers with a server error warns that the change may already be applied |
| F119 | LOW | A complete file exactly as long as the read limit was called cut off when the answer closed slowly | R13 | fixed | 096fc3e | a complete file exactly as long as the read limit is not called cut off when the answer closes slowly |
| F120 | MEDIUM | The login page had no language, no viewport, no dark mode, no security headers and English only | R14 | fixed | 8ee68e1 | the callback page is sent with locked-down headers |
| F121 | LOW | The login page broke the datev-mcp login command across two lines | R14 | fixed | d6d1c26 | the login command on the page never splits across lines |
| F122 | LOW | The login page read as a generic template, with a raw OAuth error code and no product identity | R14 | fixed | bfdd0d6 | known OAuth errors become one plain sentence, the raw code stays secondary |
| F123 | LOW | Two scan speed tests failed when the machine was busy, not when the scan was slow | R14 | fixed | 3ea3d8c | the error scan costs the same per byte however small the pieces are |
| F124 | MEDIUM | A refusal after a refresh left the refused access token live at DATEV, and a session saved without a login id never got one, so F115 still held for older sessions | Grok R14 | fixed | e66c31a | a 403 on a pre-login-id session after a refresh ends that login and revokes both tokens and the refused one |
| F125 | MEDIUM | A client id whose first digits read as a percent escape, or that followed an escaped slash in the host, was shown unhidden | Grok R14 | fixed | 9becfae | an id whose first two digits read as a percent escape is still hidden |
| F126 | MEDIUM | An answer that filled the read limit and then broke off lost the bytes already read, and a write became an uncertain-send error | Grok R14 | fixed | ad3d346 | a 5xx write that fills the cap and then breaks off returns its status instead of throwing |
| F127 | MEDIUM | The may-already-be-applied warning was overwritten on binary answers and missing on file uploads, EXTF uploads and broken-off writes, so F118 still held there | Grok R14 | fixed | ad3d346 | datev_upload_file warns on a 5xx or 408 that the files may already be stored |
| F128 | HIGH | A client id that is literally client made the id hiding loop forever, because the {client} it inserted matched again, blocking the whole server | Codex R15 | fixed | ba24d5c | hideClientValues returns for an id inside the placeholder |
| F129 | MEDIUM | A large JSON error that was a list, or carried a nested errors list, lost its title and help link | Codex R15 | fixed | 713bba8 | a large JSON error that is a list keeps the first member's title and help link |
| F130 | MEDIUM | Whether late title and help fields of a large error were kept depended on where the answer was split into chunks | Codex R15 | fixed | 713bba8 | an exact-cap JSON error head followed by a pause past 2 s keeps the later fields |
| F131 | MEDIUM | A write that timed out before DATEV answered said try again, with no warning that it may already be applied | Codex R15 | fixed | 713bba8 | a write that times out before DATEV answers warns it may be applied and does not invite a retry |
| F132 | LOW | The architecture doc claimed unconditional approval, a key never next to the session, no stored client data and no calls without a tool, which the code contradicts | Codex R15 | fixed | 2976e1d | the architecture doc names the start-up revoke retry and the HTTP log the code keeps |
| F133 | LOW | The ledger check matched two-digit ids only, so no row from F100 on was checked against its guarding test | self-check | fixed | 03ec479 | the ledger check reads finding ids of three or more digits |
| F134 | MEDIUM | An errors list nested inside the first member of a list-shaped error answer lost its title and help link | Codex R16 | fixed | 199312a | a list body whose first member nests errors keeps errors[0]'s title and help link |
| F135 | LOW | When every private-use character already stood in a value, hiding the client id turned an unrelated character into {client} | Codex R16 | fixed | dce0173 | every BMP private-use character with no id stays exactly as sent |
| F136 | LOW | The architecture doc said only the HTTP log is kept, but the EXTF sent ledger with client id and file name is kept too | Codex R16 | fixed | 9f7a613 | the architecture doc names the EXTF sent ledger the code keeps |
| F137 | MEDIUM | A value holding every private-use character made the client id hiding search for a free marker for about 42 seconds, freezing the server | Codex R17 | fixed | 24e3dda | every private-use character in all three ranges returns in under 2 s |
| F138 | LOW | When no free marker was left, the fallback hid the plain id but showed a percent-escaped copy of it | Codex R17 | fixed | 24e3dda | exhausted READ forms never leak an escaped id in any decoding |
| F139 | LOW | The architecture doc promised the same bookings are never sent twice, but the check compares whole files, so a re-exported file counts as new | Codex R17 | fixed | fb60536 | the architecture doc promises duplicate detection per file, as the whole-file hash gives |

## Evidence for rejected and disputed findings

- **F02 names.** The DATEV-Datenservices list at https://www.datev.de/web/de/berufsgruppenuebergreifend/mydatev/datenservices includes "Dokumentenservice Grundsteuer" and "Belegbilderservice Einkommensteuer". The product list at https://developer.datev.de/de/products names "DATEV Basisdaten online" for `master-data:master-clients`. Names with formats such as "Buchungsdatenservice und DATEV-Format" are written that way on the Schnittstellenvorgaben page, so the R1 point about two names in one string was not adopted.
- **F07.** DATEV refresh tokens rotate on every use, see the token lifecycle notes in [SETUP.md](SETUP.md).
