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
| F23 | MEDIUM | DATEV's technical client id shown to people in tool text and approval dialogs | R1-18, R2-28, R7, R8, R9, R10, R11 | fixed | 881f64b | only a declared client path parameter is hidden, also as a consultant and client number pair and when percent-encoded |
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
| F89 | MEDIUM | The client id stayed in query strings of result, location and paging addresses | R10-5, R11 | fixed | 881f64b | only a declared client path parameter is hidden, also as a consultant and client number pair and when percent-encoded |
| F90 | LOW | An empty stored service list ignored the scopes DATEV granted | R10-6 | fixed | 3e0f865 | an empty stored service list falls back to the scopes DATEV granted |
| F91 | LOW | An unclosed bracket stopped every later sentence from being translated | R10-7 | fixed | 3e0f865 | German keeps a client name that starts with unnamed client, and translates every sentence after an open bracket |
| F92 | HIGH | Ending a connection left older unconfirmed access tokens from earlier logins unrevoked | R11 | fixed | 881f64b | ending a connection also revokes an earlier login's access token, and keeps it when DATEV does not confirm |
| F93 | MEDIUM | Each refused call on an ended connection started its own revoke retry | R11 | fixed | 881f64b | many refused calls on an ended connection send one revoke, not one each |
| F94 | MEDIUM | The error scan stopped at the title and dropped DATEV's help link and request id | R11 | fixed | 881f64b | the error scan keeps a help link and request id that come after the title |
| F95 | LOW | A character cut at the read limit was decoded broken | R11 | fixed | 881f64b | a character cut at the read limit is read whole |
| F96 | MEDIUM | An error answer that went quiet past the read limit was waited for indefinitely | R11 | fixed | 881f64b | an error answer that goes quiet past the read limit is not waited for |
| F97 | LOW | An undeclared client path parameter was hidden as if it were the client id | R11 | fixed | 881f64b | only a declared client path parameter is hidden, also as a consultant and client number pair and when percent-encoded |
| F98 | LOW | An expired access token waiting for its revoke was never dropped from the record | R11 | fixed | 881f64b | an expired access token waiting for its revoke is dropped from the record |

## Evidence for rejected and disputed findings

- **F02 names.** The DATEV-Datenservices list at https://www.datev.de/web/de/berufsgruppenuebergreifend/mydatev/datenservices includes "Dokumentenservice Grundsteuer" and "Belegbilderservice Einkommensteuer". The product list at https://developer.datev.de/de/products names "DATEV Basisdaten online" for `master-data:master-clients`. Names with formats such as "Buchungsdatenservice und DATEV-Format" are written that way on the Schnittstellenvorgaben page, so the R1 point about two names in one string was not adopted.
- **F07.** DATEV refresh tokens rotate on every use, see the token lifecycle notes in [SETUP.md](SETUP.md).
