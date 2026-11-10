<!-- freshness: 30d -->
# DATEV technical review readiness

DATEV reviews every app before it may use real data, in two video appointments. The first covers the sandbox and, once passed, opens production access for three months. The second is held in production with test data only. This page maps each interface requirement to where datev-mcp meets it and which test proves it, so the review can be prepared in one place.

The requirements are DATEV's Schnittstellenvorgaben. They are summarised here in our own words. Read DATEV's current page for the binding text.

## How the parts fit together

```
AI client (Claude, Cursor, ...)
   |  MCP over stdin/stdout, on the person's own machine
datev-mcp
   |-- login.datev.de      OpenID Connect, authorization code with PKCE
   |-- api.datev.de        DATEV online APIs, OAuth bearer token
   |-- local disk          encrypted session, technical HTTP log
```

There is no server in between and no shared backend. Every installation belongs to one person, holds one DATEV session, and talks to DATEV directly.

| datev-mcp concept | DATEV concept |
|---|---|
| Data service chosen at login | DATEV data service (for example Belegbilderservice Rechnungswesen), and the scopes that belong to it |
| Client returned by `datev_list_clients` | DATEV client (Mandant) with consultant and client number, plus DATEV's technical client id used in API paths |
| Operation id | One operation of DATEV's public API specification |
| Session | One refresh token for one DATEV user and one app |

## Requirement by requirement

| Requirement | Where it is met | Proof |
|---|---|---|
| Technical HTTP log kept at least 14 days, with DATEV's tracing headers | `src/api/http-log.ts`, every API and token call, kept 30 days | `the HTTP log keeps method, full URL, transaction ids and timestamps, never tokens or secrets, and yields the 14-day error rate`, `status and doctor put every DATEV call they make into the HTTP log, with DATEV's tracing headers and no token` |
| Error rate below 10 percent | The status view and `datev_connection_status` show the rate of the last 14 days from the log | `the HTTP log keeps method, full URL, transaction ids and timestamps, never tokens or secrets, and yields the 14-day error rate` |
| The help link of a 4xx answer is shown | `problemText` in `src/api/client.ts` appends it to every error | `every DATEV error answer keeps its help link, title, detail and request id, as DATEV requires for 4xx` |
| Connect button and connection status (active or inactive) | `datev-mcp login`, `datev-mcp status`, `datev_connection_status` | `the status shows active or inactive, the full name, validity as TT.MM.JJJJ HH:MM, the data services and DATEV's connections page` |
| Disconnect revokes at DATEV | `datev-mcp disconnect` calls DATEV's revoke endpoint for both tokens | `disconnect revokes at DATEV and deletes the session; if DATEV is unreachable it keeps the session and says so` |
| Validity shown as TT.MM.JJJJ HH:MM | `formatDe` in `src/setup/status.ts` | `the status shows active or inactive, the full name, validity as TT.MM.JJJJ HH:MM, the data services and DATEV's connections page` |
| Full name of the signed in user | Read from DATEV's userinfo at login | `login checks the ID token, saves the name and chosen services, and revokes the previous refresh token` |
| Link to DATEV's page of connected apps | https://apps.datev.de/tokrevui in the status view and in every failed disconnect | `the status shows active or inactive, the full name, validity as TT.MM.JJJJ HH:MM, the data services and DATEV's connections page`, `disconnect revokes at DATEV and deletes the session; if DATEV is unreachable it keeps the session and says so` |
| Only one valid refresh token | A new login revokes the previous refresh token, every refresh replaces the stored one | `login checks the ID token, saves the name and chosen services, and revokes the previous refresh token` |
| Fresh PKCE verifier and nonce for every login | `src/auth/pkce.ts`, `src/auth/authorize.ts` | `property: PKCE challenge is base64url(sha256(verifier)) and verifier length is RFC-valid`, `state and nonce tokens meet DATEV's 20-character minimum` |
| ID token checked | Signature against DATEV's published keys, issuer, audience, authorized party, expiry, issue time and nonce, in `src/auth/id-token.ts` | `an ID token is accepted only with DATEV's signature, issuer, audience, expiry and this login's nonce` |
| Tokens stored encrypted, secret never stored by the app | Tokens use AES-256-GCM with the key in the OS credential store. datev-mcp never writes the client secret anywhere. In production it is injected from a password manager at start, a plain settings file is for sandbox development only | `the session file holds no readable token, and an old plain-text session is encrypted on first read` |
| Only the scopes that are needed | The person chooses data services, only their scopes are requested, an operation outside them is refused before sending | `only the scopes of the chosen data services are requested, and choosing is required` |
| DATEV's service names shown as DATEV writes them | `src/auth/services.ts`, `datev-mcp services` | `data services carry DATEV's own names, spelled as DATEV writes them, never an invented label` |
| No DATEV documentation passed on | Tool answers carry field names, types and constraints only | `property over all 209 operations: no DATEV wording leaves the server, every field name and constraint does` |
| Data service switched on before any transfer | `src/api/permission.ts` reads the client with accounting-clients first and refuses with DATEV's setup page, or for Datenservice Export Rechnungswesen ends the connection and links DATEV's order page | `a document is refused before sending when the client has not switched the service on, with DATEV's setup link` |
| Belegbilderservice and Buchungsdatenservice documents | One PUT with an id built from client and file hash, only the client's document types (read once a day), the field rules of each service | `documents use only the client's document types and the field rules of the chosen service` |
| Booking data sent once, import confirmed | A sent file is refused a second time unless resent on purpose; the import job is polled after Retry-After and counts only when DATEV imported it | `an EXTF import counts only when DATEV's job succeeded, and booking data is never sent twice by accident` |
| Datenservice Export reads fiscal years first | The year list, then the year's settings, before any accounting data | `Datenservice Export: fiscal years are checked first and the year's settings come with the answer` |

### Fiscal year settings used, and why

| Field from GET fiscal-years/{id} | Use in datev-mcp |
|---|---|
| `yearBegin`, `yearEnd` | Shown with every balance and posting answer, so the period is never guessed |
| `accountLength` | Account numbers are read and shown at the client's length |
| `accountSystem` | Names the chart of accounts (SKR) the accounts belong to |
| `currencyCode` | The currency of the amounts |
| `nationalRight` | Whether German or Austrian bookkeeping law applies |

The other fields are not used.

## Full requirement checklist

Every DATEV interface requirement, general and per data service, with its status in datev-mcp and the evidence, is in [COMPLIANCE-CHECKLIST.md](COMPLIANCE-CHECKLIST.md). `datev-mcp compliance` shows the same for a running installation. The requirements themselves, paraphrased with their DATEV source page, are in [requirements.md](../scripts/compliance/requirements.md).

## Still open, needs DATEV or a live run

| Item | Why it cannot be closed here |
|---|---|
| Booking the two review appointments | Done by the app owner in the DATEV developer portal |
| Production redirect URI accepted for a local receiver | Only DATEV's production app settings can confirm it |
| Some accounting-documents sandbox calls answer 400 | Needs DATEV support to confirm whether the sandbox data supports them |
| Data processing agreement with the AI provider | A contract between the practice and the provider, see [COMPLIANCE.md](COMPLIANCE.md) |

## Before each appointment

1. Run `npm run typecheck`, `npm test` and `npm run eval`, and keep the reports.
2. Run `datev-mcp status` and show the connection, the name, the validity and the error rate.
3. Show a write being previewed and then approved in the client.
4. Show `datev-mcp disconnect` and the app disappearing from DATEV's connected apps page.
5. Use test data only, in both appointments.
