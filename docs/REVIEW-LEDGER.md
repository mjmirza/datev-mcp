# Review ledger

Every finding from every review round, in one place, with one id. This page stops the review loop. A finding is
never fixed twice, never silently reopened, and a fix that breaks an earlier one is caught by that earlier finding's test.

## Rules

1. **One id per defect.** A new review round first maps each of its findings to an existing id. Only a defect that matches no row gets a new id.
2. **Fixed means guarded.** A row is `fixed` only with the commit and the name of the test that fails without the fix. `test/unit/review-ledger.test.ts` checks that every named test exists, so a deleted guard turns the build red.
3. **A reappearing finding is a regression, not a new finding.** Reopen the row as `regressed`, find the commit that broke it, and fix both together.
4. **Rejected needs evidence.** A finding we do not adopt carries the reason and the source. Reviewers who disagree are settled by DATEV's own pages, never by the louder reviewer.
5. **Conflicting fixes are decided once.** When two findings pull in opposite directions (log more against log less), the decision is written here and both findings point at it.

R1 is the Grok review of 2026-11-09. R2 is the Codex review of 2026-11-10, which read commit 33c2205. R3 is the reading of DATEV's published Schnittstellenvorgaben on 2026-11-10, see [COMPLIANCE-CHECKLIST.md](COMPLIANCE-CHECKLIST.md). R4 is the Codex attack on commits e3ad92a..bc6085f, 2026-11-10. Finding numbers are the reviewer's own.

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
| F12 | HIGH | cashregister and SmartTransfer have no scopes, so the chosen-service boundary does not apply | R1-8, R2-15 | open | | |
| F13 | LOW | `DATEV_SCOPES` precedence and "all scopes by default" documented wrongly | R1-8, R2-31, R2-32 | open | | |
| F14 | HIGH | Docs claim write retries, redirects followed, nothing saved on a failed check | R1-9, R2-30 | fixed | 134c625 | docs, Q&A sources and code never repeat a claim a reviewer proved false |
| F15 | HIGH | German mode leaves login, services, doctor, previews and approvals in English | R1-10, R2-21 | open | | |
| F16 | HIGH | A quarantined corrupt session file stays in plaintext | R1-11 | open | | |
| F17 | HIGH | Login completes without the full user name DATEV requires | R1-12, R2-13 | fixed | 15dcb51 | a login without the full user name saves nothing |
| F18 | MEDIUM | `azp` checked only for multiple audiences, `at_hash` never | R1-13, R2-23 | fixed | 3edd7c4 | the ID token check rejects a foreign authorized party |
| F19 | MEDIUM | Client secret not trimmed | R1-14 | fixed | 8a3374d | a DATEV Public client signs in with PKCE and client_id alone |
| F20 | MEDIUM | Log keeps job and status bodies and full query strings (business data), while R2-10 asks for more body logging | R1-15, R2-10 | rejected | - | DATEV minimum log scope (GEN-18, GEN-19) requires the full URL with query and the bodies of status answers, so they stay. Request bodies are added, see F33 |
| F21 | HIGH | A failed log write is reported once, then DATEV traffic continues unlogged | R1-16, R2-8 | fixed | 6a099df | no call goes out while the technical HTTP log cannot be written |
| F22 | MEDIUM | `datev_call` treats 3xx as success | R1-17 | open | | |
| F23 | MEDIUM | DATEV's technical client id shown to people in tool text and approval dialogs | R1-18, R2-28 | open | | |
| F24 | MEDIUM | Shipped `dist/data/operations.json` carries DATEV description text | R1-19 | open | | |
| F25 | MEDIUM | Requirement tests miss several MUSTs | R1-20 | open | | covered row by row as fixes land |
| F26 | LOW | Connection tool says true or false instead of AKTIV or INAKTIV, disconnect without a session lacks the tokrevui link | R1-21 | fixed | 0324e85 | the connection status tool answers with AKTIV or INAKTIV text the person can read |
| F27 | BLOCKER | JWKS (signing key) requests not in the HTTP log | R2-2 | fixed | 3edd7c4 | the ID token check rejects a foreign authorized party |
| F28 | BLOCKER | Quick start keeps the client secret in a plaintext file while docs claim it is stored encrypted | R2-3 | fixed | 134c625 | docs, Q&A sources and code never repeat a claim a reviewer proved false |
| F29 | BLOCKER | Token, userinfo and revoke errors drop DATEV's help link | R2-5 | fixed | 3edd7c4 | token, userinfo and revoke errors keep DATEV's help link |
| F30 | HIGH | Tokens issued before the identity check are abandoned, not revoked, when a later login step fails | R2-6 | fixed | 15dcb51 | a login without the full user name saves nothing |
| F31 | HIGH | A body that breaks off is thrown before the call is logged | R2-7 | fixed | 6a099df | a write whose answer breaks off is still logged |
| F32 | HIGH | A retried GET error answer is logged without its body | R2-9 | fixed | 6a099df | a write whose answer breaks off is still logged |
| F33 | HIGH | Request bodies kept only as a hash | R2-10 | fixed | b49460d | request bodies are logged as DATEV's minimum scope asks |
| F34 | HIGH | Status reports ACTIVE without checking userinfo's shape and that `sub` matches the saved identity | R2-14 | fixed | 15dcb51 | the status is ACTIVE only for a valid userinfo answer about the same person |
| F35 | HIGH | Choosing accounting services silently adds the accounting-clients scope | R2-16 | open | | |
| F36 | HIGH | Upload approval does not show the destination client, query and resolved URL | R2-18 | fixed | 6182745 | documents use only the client's document types and the field rules of the chosen service |
| F37 | HIGH | Uploads do not check the client list and the service before sending | R2-20 | fixed | 6182745 | a document is refused before sending when the client has not switched the service on, with DATEV's setup link |
| F38 | MEDIUM | A `null` token answer crashes before it is logged | R2-22 | fixed | 3edd7c4 | token, userinfo and revoke errors keep DATEV's help link |
| F39 | MEDIUM | Session key creation not serialised across environments | R2-24 | open | | |
| F40 | MEDIUM | Status shows an invented 11-hour validity when no expiry is stored | R2-26 | fixed | 15dcb51 | the status is ACTIVE only for a valid userinfo answer about the same person |
| F41 | MEDIUM | `doctor` calls accounting-clients even when that service is not connected | R2-27 | open | | |
| F42 | MEDIUM | Setup walkthrough grants too few scopes for its own example questions | R2-29 | open | | |
| F43 | BLOCKER | The login uses a localhost redirect with a client secret (Confidential client), which DATEV blocks in production since 01.03.2026 | R3 DATEV requirements AUTH-13, REDIR-01 | fixed | 8a3374d | a DATEV Public client signs in with PKCE and client_id alone |
| F44 | HIGH | The client gate checks the first client alias it finds, not the client the URL actually targets | R4-1 | open | | |
| F45 | HIGH | hr-documents uploads by `client_guid` skip the client check | R4-2 | open | | |
| F46 | HIGH | `datev_upload_file` reaches accounting-documents without the service check and the document rules | R4-3 | open | | |
| F47 | HIGH | Two concurrent EXTF sends both pass the duplicate check, and parallel ledger writes lose entries | R4-4 | open | | |
| F48 | HIGH | An unreadable send ledger counts as never sent, and a failed ledger write forgets an accepted file | R4-5 | open | | |
| F49 | HIGH | An EXTF POST whose answer is lost is not recorded, so a fresh confirmation sends it again | R4-6 | open | | |
| F50 | HIGH | A missing Export permission says the connection ended even when a token revocation failed | R4-7 | open | | |
| F51 | HIGH | A DATEV 5xx during the Export permission check logs the person out | R4-8 | open | | |
| F52 | MEDIUM | `datev_call` of getfiscalyears skips the Export guard | R4-9 | open | | |
| F53 | MEDIUM | Payroll report types are requested when DATEV's answer lacks access_granted | R4-10 | open | | |
| F54 | MEDIUM | The document id ignores service and filing, so the same bytes cannot be filed differently | R4-11 | open | | |
| F55 | MEDIUM | Retry-After above 20 seconds is shortened | R4-12 | open | | |
| F56 | MEDIUM | The document type cache is shared across logins | R4-13 | open | | |
| F57 | MEDIUM | Document types can be read more than once per day (explicit tool, parallel uploads) | R4-14 | open | | |
| F58 | MEDIUM | An earlier transfer's name, time and job id are shown before the current permission is checked | R4-15 | open | | |
| F59 | LOW | Some accounting-rules tests pass without proving their claim (revocation, daily cache, repeated PUT) | R4-16 | open | | |

## Evidence for rejected and disputed findings

- **F02 names.** The DATEV-Datenservices list at https://www.datev.de/web/de/berufsgruppenuebergreifend/mydatev/datenservices includes "Dokumentenservice Grundsteuer" and "Belegbilderservice Einkommensteuer". The product list at https://developer.datev.de/de/products names "DATEV Basisdaten online" for `master-data:master-clients`. Names with formats such as "Buchungsdatenservice und DATEV-Format" are written that way on the Schnittstellenvorgaben page, so the R1 point about two names in one string was not adopted.
- **F07.** DATEV refresh tokens rotate on every use, see the token lifecycle notes in [SETUP.md](SETUP.md).
