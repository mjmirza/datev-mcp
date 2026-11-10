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
| Technical HTTP log kept at least 14 days, with DATEV's tracing headers | `src/api/http-log.ts`, every API and token call, kept 30 days | `datev-requirements.test.ts`, the HTTP log test |
| Error rate below 10 percent | The status view and `datev_connection_status` show the rate of the last 14 days from the log | Same test, error rate part |
| The help link of a 4xx answer is shown | `problemText` in `src/api/client.ts` appends it to every error | The 4xx help link test |
| Connect button and connection status (active or inactive) | `datev-mcp login`, `datev-mcp status`, `datev_connection_status` | The status test |
| Disconnect revokes at DATEV | `datev-mcp disconnect` calls DATEV's revoke endpoint for both tokens | The disconnect and revocation tests |
| Validity shown as TT.MM.JJJJ HH:MM | `formatDe` in `src/setup/status.ts` | The status test |
| Full name of the signed in user | Read from DATEV's userinfo at login | The login test |
| Link to DATEV's page of connected apps | https://apps.datev.de/tokrevui in the status view and in every failed disconnect | The status and disconnect tests |
| Only one valid refresh token | A new login revokes the previous refresh token, every refresh replaces the stored one | The login test |
| Fresh PKCE verifier and nonce for every login | `src/auth/pkce.ts`, `src/auth/authorize.ts` | `auth.test.ts` |
| ID token checked | Signature against DATEV's published keys, issuer, audience, authorized party, expiry, issue time and nonce, in `src/auth/id-token.ts` | The ID token test |
| Tokens stored encrypted, secret never stored by the app | Tokens use AES-256-GCM with the key in the OS credential store. datev-mcp never writes the client secret anywhere. In production it is injected from a password manager at start, a plain settings file is for sandbox development only | The encryption tests |
| Only the scopes that are needed | The person chooses data services, only their scopes are requested, an operation outside them is refused before sending | The scope selection test |
| DATEV's service names shown as DATEV writes them | `src/auth/services.ts`, `datev-mcp services` | The scope selection test |
| No DATEV documentation passed on | Tool answers carry field names, types and constraints only | The property test over all 209 operations |
| Data service switched on before any transfer | `src/api/permission.ts` reads the client with accounting-clients first and refuses with DATEV's setup page, or for Datenservice Export Rechnungswesen ends the connection and links DATEV's order page | `accounting-rules.test.ts` |
| Belegbilderservice and Buchungsdatenservice documents | One PUT with an id built from client and file hash, only the client's document types (read once a day), the field rules of each service | `accounting-rules.test.ts` |
| Booking data sent once, import confirmed | A sent file is refused a second time unless resent on purpose; the import job is polled after Retry-After and counts only when DATEV imported it | `accounting-rules.test.ts` |
| Datenservice Export reads fiscal years first | The year list, then the year's settings, before any accounting data | `accounting-rules.test.ts` |

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

Every DATEV interface requirement, general and per data service, with its status in datev-mcp and the evidence, is in [COMPLIANCE-CHECKLIST.md](COMPLIANCE-CHECKLIST.md). `datev-mcp compliance` shows the same for a running installation.

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
