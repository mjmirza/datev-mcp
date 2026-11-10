# DATEV interface requirements (Schnittstellenvorgaben) - evidence file

Collected 2026-11-10 from public pages of developer.datev.de (read-only, no login). Every requirement is paraphrased in English in our own words; DATEV's text is not reproduced. Level column uses DATEV's marking exactly (MUST / SHOULD / DONT / COULD, 'MUSS' shown as MUST (MUSS)); 'unmarked' means stated in prose without a label, with the wording strength in brackets where relevant. Sandbox/production duplicates on DATEV pages are listed once unless they differ.


## 1. General interface requirements (Allgemeine Schnittstellenvorgaben)

Apply to every DATEV-Datenservice integration in addition to the service-specific rules. DATEV's own legend: MUST = mandatory for approval, SHOULD = recommended, DONT = must be avoided, endangers approval.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| GEN-01 | unmarked | Every new integration with the DATEV cloud has to pass a joint approval (Freigabe) process with DATEV. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-02 | unmarked | Approval needs at least two joint appointments: a sandbox approval and a production approval. Before the sandbox appointment the integration must be built and tested on sandbox, both general and service-specific requirements met, and an appointment booked. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-03 | unmarked | A positive sandbox approval grants production access for 3 months only; afterwards the API client is reset to sandbox unless production approval is passed. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-04 | unmarked | Before production approval: integration implemented and tested on production, tested together with the vendor's own DATEV test system (involving first customers recommended), any file formats (CSV, XML) already accepted in a separate file-format appointment, and test datasets prepared for the involved apps. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-05 | unmarked (marked 'Wichtig') | No live customer datasets or real data may be used during the technical review. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-06 | unmarked | Approval appointments are video calls: vendor shares screen and demonstrates the interface; the DATEV advisor poses questions/challenges and checks the API-gateway log records for conformity. Production approval additionally checks successful data exchange with the DATEV apps. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-07 | unmarked | Production approval removes the time limit on production access; the integration can then be rolled out to all customers. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-08 | unmarked | Use the gateway sparingly: only send API calls the customer directly requested beforehand (manual click or rule-based). Blanket round-the-clock calls without concrete customer interest are not permitted. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-09 | MUST | After production approval the error rate (requests with 4xx and 5xx / all requests) must stay below 10 %. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-10 | unmarked | The software must log all API communication with the gateway and make sure the 10 % threshold is not exceeded; if DATEV monitoring detects an overrun, DATEV contacts the vendor for a paid repeat review. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-11 | DONT | Do not build round-the-clock ('24/7') polling. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-12 | unmarked | The API consumer must offer first-level support for its DATEV interface to its users, analyse reported problems itself, and only if it cannot help, point the user to targeted DATEV self-help media (e.g. DATEV help center, data-service setup guides). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-13 | MUST | Handle 4xx error codes: at minimum show the help URL contained in DATEV's standardized error body in the UI, or give equivalent help. A basic level is expected at approval, with continuous improvement afterwards. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-14 | MUST | Use DATEV's ticket system for the vendor's own support needs and fulfil the duty to cooperate. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-15 | DONT | Do not send users straight to DATEV or to DATEV members (tax advisors) for problems with the integration; repeated incidents trigger a review of the approval. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-16 | MUST | Implement a technical HTTP log that lets every request to the DATEV API gateway be traced chronologically and covers at least the minimum log scope. The log does not have to be exposed to customers. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-17 | unmarked | Keep the gateway communication log for at least 14 days. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-18 | unmarked | Minimum request fields: timestamp (at least hh:mm:ss), HTTP method plus full URL including query parameters, HTTP headers WITHOUT the Authorization header, body (large bodies may be omitted from the log but must be retrievable on demand). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-19 | unmarked | Minimum response fields: timestamp, status code plus message, headers including at least 'X-Global-Transaction-ID' and 'V-Cap-Request-ID', body only for error responses or status queries (no need to log personal real data from GETs). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-20 | unmarked (recommendation) | Authorization Code flow is recommended over Hybrid flow (same customer experience, simpler integration). Token lifetimes: access token 15 min; short refresh token 11 h; long refresh token 2 years, extended on refresh, bound to one dataset. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-21 | unmarked | Strictly separate 'establishing the connection' from 'data exchange' in the app's UI. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-22 | MUST | Start authentication via a dedicated button (e.g. 'Mit DATEV verbinden'). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-23 | MUST | Connection status of the refresh token must be visible at a glance (e.g. green/red light, connected/disconnected). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-24 | MUST | Provide a button to delete the refresh token (e.g. 'Verbindung trennen'): delete it in the app and call DATEV's /revoke. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-25 | MUST | Show the computed expiry date of the refresh token (at least format DD.MM.YYYY HH:MM). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-26 | MUST | Show the full name of the person who issued the token (taken from the userinfo endpoint). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-27 | MUST | Link to DATEV's 'Verbundene Anwendungen' app (https://apps.datev.de/tokrevui). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-28 | MUST | Short-term refresh token: revoke the refresh token when the user logs out of the third-party app. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-29 | MUST | Short-term refresh token: never have more than one valid refresh token issued at DATEV. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-30 | SHOULD | Short-term refresh token: revoke the access token right after the data exchange. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-31 | MUST | Long-term refresh token: the connection status must show which dataset ({client-id}) the connection applies to. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-32 | MUST | Long-term refresh token: add a verification step during connection setup; only show 'connected' once the online API has confirmed access to that dataset (normally via GET /clients/{client-id} of each API). | https://developer.datev.de/de/guides/interface-requirements |
| GEN-33 | MUST | Long-term refresh token: never more than one valid refresh token per dataset at DATEV. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-34 | SHOULD | Long-term refresh token: revoke the access token right after the data exchange. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-35 | MUST | Use the security mechanisms of OAuth 2.0/OIDC/PKCE; parameters such as code_challenge, code_verifier and nonce must be freshly generated for every request. (DATEV recommends using an existing OIDC library.) | https://developer.datev.de/de/guides/interface-requirements |
| GEN-36 | MUST | Data with higher protection needs (client secret = high, access/refresh tokens = highest) must always be encrypted with current techniques. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-37 | DONT | Never display such sensitive data (client secret, tokens) in the UI or write it to logs. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-38 | MUST | Request only the scopes the end customer needs for the selected data services. If one token needs scopes of several data services, the app must offer a UI (e.g. settings) where the customer actively chooses to use several data services. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-39 | MUST | At the approval appointments, explain how the app's own entities map to DATEV entities ({client-id}) and how tokens are handled/stored. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-40 | unmarked | The vendor is responsible for a clean entity mapping and careful token storage; especially with 2-year tokens, a token issued once must not automatically be usable by every user of the entity. For highly sensitive APIs (e.g. salary data) the app should introduce its own role/permission. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-41 | MUST | The rules on the DATEV word mark and logos must be followed. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-42 | unmarked | Write the word mark 'DATEV' in capitals; toward users use the DATEV data-service names (not online-API names), make clear which data services are available, and spell them exactly as in DATEV's list of released data services. Any use of DATEV logos needs a contract with DATEV. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-43 | MUST | At the approval appointments, present the chosen architecture (web server, hybrid, desktop/mobile) covering every component that talks to the DATEV API gateway. | https://developer.datev.de/de/guides/interface-requirements |
| GEN-44 | unmarked | The vendor needs a concept for making its single production API client available securely to all its users; unusual usage detected at the gateway leads at least to blocking that API client. | https://developer.datev.de/de/guides/interface-requirements |

## 2. Authentication guide (OAuth 2.0 / OIDC specifics)

Technical rules from the authentication guide. DATEV does not use MUST/SHOULD labels here; wording is 'required'/'must'.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| AUTH-01 | unmarked (required) | The 'state' parameter is mandatory and must be at least 20 characters long. | https://developer.datev.de/de/guides/authentication |
| AUTH-02 | unmarked (required) | PKCE is mandatory with code_challenge_method 'S256'. | https://developer.datev.de/de/guides/authentication |
| AUTH-03 | unmarked (required) | Scope must include at least 'openid'; only space or plus may separate scopes. | https://developer.datev.de/de/guides/authentication |
| AUTH-04 | unmarked (required) | Refresh tokens are single-use; each must be redeemed exactly once. Reusing one invalidates all tokens of the session and forces re-authentication (multi-threaded clients must serialize refresh). | https://developer.datev.de/de/guides/authentication |
| AUTH-05 | unmarked (required) | Use HTTP Basic authorization for the code/token exchange (RFC 6749 2.3.1). | https://developer.datev.de/de/guides/authentication |
| AUTH-06 | unmarked (required) | Token revocation (RFC 7009) requires token_type_hint; the app must send two revocation requests, one for the access token and one for the refresh token. | https://developer.datev.de/de/guides/authentication |
| AUTH-07 | unmarked | Choose 'OpenID Connect Authorization Code Flow'; the Hybrid flow is deprecated and should not be used for new apps. | https://developer.datev.de/de/guides/authentication |
| AUTH-08 | unmarked (recommended) | Adding enableWindowsSso=true to the authorize request is optional but recommended. | https://developer.datev.de/de/guides/authentication |
| AUTH-09 | unmarked | Long-term (offline) access needs scope 'offline_access' plus 'datev:iam:client:<consultant>-<client>'; such a token only works for endpoints that carry {client-id} in the path. | https://developer.datev.de/de/guides/authentication |
| AUTH-10 | unmarked (must) | Before requesting an offline-access token, check that the single client/dataset is reachable (list of clients or client detail). | https://developer.datev.de/de/guides/authentication |
| AUTH-11 | unmarked (must) | If the offline token is used, the app must implement token revocation so users can disconnect their accounts. | https://developer.datev.de/de/guides/authentication |
| AUTH-12 | unmarked (must) | Place a prominent link to https://apps.datev.de/tokrevui in the app. | https://developer.datev.de/de/guides/authentication |
| AUTH-13 | unmarked (must) | Production redirect URLs for Confidential clients: HTTPS only, no IP addresses, no localhost (http or https), no custom URL schemes. Sandbox still allows IP/localhost; invalid URLs must be removed before upgrading to production. | https://developer.datev.de/de/guides/authentication |
| AUTH-14 | unmarked (must) | Production redirect URLs for Public clients: no IP addresses and no https://localhost. | https://developer.datev.de/de/guides/authentication |
| AUTH-15 | unmarked | Approved apps were grandfathered, but any app configuration change (new redirect URL, renamed app) removes that protection; the portal blocks saving invalid redirect URLs since July 2025. | https://developer.datev.de/de/guides/authentication |
| AUTH-16 | unmarked (must) | Web applications must follow the Backend-for-Frontend pattern: only the backend talks to login.datev.de / api.datev.de and holds the tokens; the browser gets an HttpOnly + Secure session cookie (DATEV endpoints do not allow CORS). | https://developer.datev.de/de/guides/authentication |
| AUTH-17 | unmarked | Client type Public suffices in most cases; Confidential is for BFF web apps needing long-lived tokens. App name should be recognizable to users because it appears on the consent page. | https://developer.datev.de/de/guides/authentication |
| AUTH-18 | unmarked (must) | Send the access token as a Bearer token in the Authorization header (e.g. for the userinfo endpoint). | https://developer.datev.de/de/guides/authentication |

## 3. New redirect-URL guidelines


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| REDIR-01 | unmarked | Since 09.05.2025 Confidential apps cannot add invalid redirect URLs (localhost, custom scheme, IP). Grandfathering ended 28.02.2026; from 01.03.2026 every app still registering an invalid redirect URL is blocked from the gateway, whether or not the URL is used. | https://developer.datev.de/de/guides/new-guidelines-redirect-urls |
| REDIR-02 | unmarked | Remedies: delete unused invalid URLs in the portal; apps not using offline_access must be switched to Public client by DATEV (email request); apps needing offline_access must move to a valid HTTPS redirect (e.g. cloud middleware), tested via a new sandbox app, then swap URLs in the production app in coordination with customer updates; or drop the 'offline_access' and 'datev:iam:client:' scopes and request the Public switch. | https://developer.datev.de/de/guides/new-guidelines-redirect-urls |

## 4. General error codes (Allgemeine Fehlercodes)

Descriptive page; no MUST/SHOULD labels.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| ERR-01 | unmarked | Generic errors use HTTP status codes per RFC 9110 and bodies as 'application/problem+json' per RFC 9457; clients should use the 'title' and 'detail' fields to classify and react. | https://developer.datev.de/de/guides/generalerrors |
| ERR-02 | unmarked | Typical 401 causes: unknown client ID, wrong/missing client secret, missing/expired/revoked token, token lacking required scopes, dataset-bound token used for another dataset. 403: app not subscribed to the API product or subscription not yet confirmed. 404: URL not found. | https://developer.datev.de/de/guides/generalerrors |

## 5. Help and documentation requirements (Vorgaben zu Hilfen und Dokumentationen)

Mandatory for DATEV-Marktplatz partners; recommended by DATEV for all vendors (interface-requirements index says marketplace partners MUST, interface providers optional but recommended).


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| DOC-01 | unmarked (mandatory for marketplace partners) | Use the exact DATEV product name and spelling of the data service in the software and in all help/documentation. | https://developer.datev.de/de/guides/requirements-customer-onboarding |
| DOC-02 | unmarked (mandatory for marketplace partners) | The software shows, at the data service, a hint on the steps needed before use (ordering and activating the service at DATEV), with link http://go.datev.de/datenservices-einrichten. | https://developer.datev.de/de/guides/requirements-customer-onboarding |
| DOC-03 | unmarked (mandatory for marketplace partners) | All information customers and tax advisors need to put the data service into operation is bundled in one place (e.g. one help document). | https://developer.datev.de/de/guides/requirements-customer-onboarding |
| DOC-04 | unmarked (mandatory for marketplace partners) | That document contains at least: which data service it refers to; DATEV-side activation steps including the ordering/setup link; vendor-side steps and required settings in the vendor's software. | https://developer.datev.de/de/guides/requirements-customer-onboarding |
| DOC-05 | unmarked (mandatory for marketplace partners) | The setup information must be reachable via the vendor's own media (software, help search, help center) and via a link in the DATEV-Marktplatz; if the vendor refuses the link, it must send the document to datev-partner-onboarding@datev.de. | https://developer.datev.de/de/guides/requirements-customer-onboarding |

## 6. Onboarding workflow, FAQ and related guides


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| WF-01 | unmarked | An onboarding package (paid) must be ordered and appointments booked via DATEV's booking portal; a DATEV advisor-number for the developer organisation is required. | https://developer.datev.de/de/guides/cloud-integration-workflow |
| WF-02 | unmarked (mandatory) | A separate technical file-format review is mandatory for Buchungsdatenservice (DATEV-Format), Rechnungsdatenservice 1.0 (XML-Schnittstelle online) and Lohnimportdatenservice (ASCII); results come by email. | https://developer.datev.de/de/guides/cloud-integration-workflow |
| WF-03 | unmarked | Production access after sandbox review is limited to three months, then the API client is reset to sandbox. | https://developer.datev.de/de/guides/cloud-integration-workflow |
| FAQ-01 | unmarked | There is no simplified procedure for integrations used only internally/non-commercially; all integrations go through the same onboarding. | https://developer.datev.de/de/help |
| FAQ-02 | unmarked | Upgrade to production is requested on the app detail page; after production release no further API products can be subscribed for that app and it cannot be downgraded to sandbox. | https://developer.datev.de/de/help |
| FAQ-03 | unmarked | Address APIs by the documented DNS names; IP addresses can change (relevant for static firewall rules). | https://developer.datev.de/de/help |
| FAQ-04 | unmarked | Costs: first onboarding of a data service EUR 1,500 + VAT incl. 4 h consulting; further hours EUR 210 + VAT; running costs per product in the special terms of use / DATEV price list. | https://developer.datev.de/de/help |
| CS-01 | unmarked (should, only for on-premise components) | For hosting in DATEVasp/DATEV-SmartIT and DATEVnet: released for Windows Server (min. 2025), terminal-server capable, no admin rights, proxy-capable/configurable, ports 80/443 only, no TLS-certificate validation dependency, no WebSockets; for SmartIT also unattended install/update, no extra components, install without licence entry. | https://developer.datev.de/de/guides/cloud-sourcing |
| LOGO-01 | unmarked | The 'DATEV-Datenservice' label may be used in the vendor UI to mark the data service (not for file interfaces) and, only after a successful technical review, for advertising. | https://developer.datev.de/de/resources/logo-datev-datenservice |

## 7. accounting:clients

No standalone interface-requirements page exists for accounting:clients (product docs only contain 'Erste Schritte'). Its rules are embedded in the services that use it.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| CLI-01 | unmarked | accounting:clients (GET /v2/clients and /v2/clients/{client-id}) is the mandated permission check for Buchungsdatenservice (EXTF-02..05) and Datenservice Export Rechnungswesen (DX-01, DX-02); Belegbilderservice may use it optionally. See those sections. | https://developer.datev.de/de/product-detail/accounting-clients/2.0/overview |

## 8. Belegbilderservice Rechnungswesen (accounting:documents)

Sandbox and production requirements are identical on this page (listed once).


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| DOCS-01 | MUST | Keep document uploads (PUT/POST) and read requests (GET) in a healthy ratio; e.g. 30 GETs per uploaded document is not acceptable. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-02 | MUST | Use one of GET /clients or GET /clients/{client-id} for the permission check. If the list endpoint is used, show a paged list with company name, consultant and client number; if the single endpoint is used, show where the customer enters consultant/client number. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-03 | unmarked (important note) | Getting a long-term token does not prove permission: call GET clients right after obtaining the token and only show 'connected' once it confirms the rights. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-04 | MUST | Use GET /clients/{client-id}/document-types and show the result transparently; before each transfer day verify the document types still exist unchanged (once per day suffices). | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-05 | MUST | Show in the review how the app's document types map to Belege online document types. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-06 | DONT | Do not re-check document types before every single document upload. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-07 | MUST | Demonstrate a successful upload of at least two documents with different document types; send 'document_type' in the 'metadata' object for every document. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-08 | MUST | Documents must arrive well readable (OCR must reliably read all values) yet small in size; explain which compression the app applies. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-09 | SHOULD | The 'note' field may be used to pass a note. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-10 | DONT | Do not use hard-coded document types in the metadata object. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-11 | DONT | Do not use the other metadata fields 'category', 'folder', 'register' for this service. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |
| DOCS-12 | unmarked | Max. 20 MB per document in Belege online; PUT /documents/stapled can logically staple several files (e.g. multi-page or >20 MB split); PUT /documents/{id} is not an update, only a POST alternative with own GUID. | https://developer.datev.de/de/product-detail/accounting-documents/2.0/documentation/interface-requirements |

## 9. Buchungsdatenservice (accounting:extf-files + accounting:documents + accounting:clients)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| EXTF-01 | MUST | Keep uploads and GET requests in a healthy ratio (not 30 GETs per uploaded document). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-02 | MUST | Use one of accounting-clients GET /v2/clients or /v2/clients/{client-id}; list → paging plus company name and consultant/client numbers; single → show where the customer enters them. With a long-term token only the single-client endpoint may be used. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-03 | unmarked (must) | Filter datasets by permission: data may only be sent to datasets whose services include 'Buchungsdatenservice'. Show 'connected' only after GET clients confirms rights. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-04 | DONT | Do not use accounting-documents …/clients (reserved for Belegbilderservice). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-05 | DONT | Do not use accounting-dxso-jobs …/clients (reserved for Rechnungsdatenservice 1.0). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-06 | unmarked (preferred) | Prefer PUT /documents/{guid} with an app-generated GUID (RFC 4122, 8-4-4-4-12) to prevent duplicates; use POST /documents only if the app cannot create GUIDs. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-07 | unmarked (recommended) | 'document_type' is optional; offer the customer a checkbox whether to send it. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-08 | MUST | Send the 'metadata' JSON with all three fields category, folder and register for every document (category = reference to the app, folder = kind of document, register = month/year, e.g. 2023-05). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-09 | MUST | Sandbox: show a successful upload of one document. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-10 | unmarked (recommended) | Upload linked documents first, then the DATEV-Format file; link via field 'Beleglink' (column 20). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-11 | unmarked (must) | The app must ensure booking data can only be sent once (users normally cannot resend), while allowing deliberate re-sending for support situations. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-12 | unmarked (mandatory) | The import POST usually returns 202 even for invalid/virus files, so job status must always be polled (URL from Location header); only show success when result = success, otherwise display the error messages. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-13 | SHOULD | Do not poll job status immediately; wait the Retry-After seconds returned by the POST. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-14 | MUST | Sandbox: transmit a file with booking (transaction) data. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-15 | unmarked | Production review prerequisite: processing into a productive system with DATEV Rechnungswesen and Unternehmen online, a prepared test client with access rights and client registration for Buchungsdatenservice. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-16 | MUST | Production: upload at least two documents from different calendar months. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-17 | MUST | Production: documents must arrive readable but small (no oversized files). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-18 | MUST | Production: send booking data for two different months. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-19 | SHOULD | Production: send master data for creditors or debtors. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-20 | MUST | Production: transmitted booking and master data must import and process in DATEV Rechnungswesen without errors. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-21 | MUST | Production: the document linked to a booking record must be displayed in DATEV Rechnungswesen. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |
| EXTF-22 | unmarked (challenges) | Expect challenges: client without Buchungsdatenservice permission, invalid numbers, hundreds of datasets, error test client (455148/2), re-sending booking data, deviating fiscal year, invoice corrections, too-large document, wrong file extension. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements |

## 10. DATEV-Format file (Buchungsdatenservice file requirements)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| EXTFF-01 | MUST | Implement DATEV-Format at least main version 700 with format version 12 (Buchungsstapel) and 5 (Debitoren/Kreditoren). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-02 | MUST | Generate CSV files per specification (charset, field lengths, special characters) and validate them with DATEV's check program before submitting sample data. (The service itself only validates the header.) | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-03 | SHOULD | Test-import the CSV files into a test dataset in the production DATEV app. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-04 | unmarked | Submit sample files by email via the booked appointment; justify any base field the app cannot fill; explain how the app splits CSV files (e.g. by month and transaction type); single-record files are not sensible. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-05 | unmarked (required base data) | Buchungsstapel must be able to carry at least: Umsatz(1), Soll/Haben(2), Konto(7), Gegenkonto(8), Belegdatum(10), Belegfeld 1/2(11/12), Buchungstext(14), Beleglink(20), plus conditional fields for foreign currency(3-6), discount(13), OSS(40,41,122,123), order no.(95), booking type(96), delivery date(115,116), Generalumkehr(118). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-06 | MUST | Per applicable use case (incoming/outgoing invoices, credit note, invoice correction, reversal) create a sample file from DATEV's sample receipts with at least the base data; put the use case in header field 'Bezeichnung' (017). | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-07 | MUST | Cash data / payment bookings: per applicable use case a sample file with at least 3 records of own sample data; use case in field 017. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-08 | MUST | Special cases (ePayment, delivery date, foreign currency, down-payment/final invoices, OSS): per applicable case a sample file with at least 3 records; case in field 017. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-09 | unmarked (required base data) | Debitoren/Kreditoren must carry at least: Konto, company name or person name/first name, Adressatentyp, Kurzbezeichnung, EU-Land/EU-UStID (companies), Anrede, Adressart, Straße, Postfach, PLZ, Ort, Land, correspondence-address flag = 1. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-10 | MUST | Create a sample business-partner file from the sample invoices; use case in field 017. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |
| EXTFF-11 | MUST | General-ledger account labels: create a sample file (Konto, Kontobeschriftung, SprachId) with own data; use case in field 017. | https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/documentation/interface-requirements-file |

## 11. Rechnungsdatenservice 1.0 (accounting:dxso-jobs)

Production section repeats the sandbox rules.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| DXSO-01 | MUST | Structured invoice/cash data must be sent exclusively as 'Belegsatzdatendatei' (ledger XML). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-02 | MUST | Keep job POSTs and GETs in a healthy ratio (not 30 GETs per job). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-03 | MUST | Use at least one clients endpoint for the permission check; after selection show company name and consultant/client number. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-04 | MUST | Re-check permissions before each data transfer (once per day suffices for multiple transfers). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-05 | MUST | React to permission changes with a meaningful error message. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-06 | unmarked (important note) | Only show 'connected' after GET clients/{client-id} confirms permission. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-07 | unmarked | Dataset prerequisites to check: processing form 'Erweitert', matching fiscal year present, account length matching the XML (accountNo/bpAccountNo = account_length+1), required ledger activated (payables/receivables/cash). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-08 | MUST | Use GET /clients/{client-id} to validate the dataset configuration before each transfer (once per day suffices). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-09 | MUST | React appropriately to configuration changes, either with a clear error or by adapting automatically (e.g. account length, ledger name). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-10 | MUST | Check the ledger folder name ('ledger_folder_names') returned on job creation and adjust it in the XML files if needed. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-11 | MUST | Files of one job max. 150 MB in total, single file max. 20 MB. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-12 | MUST | Use ASCII characters for all file names in a job. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-13 | SHOULD | Bundle invoices/cash data belonging to the same ledger and month in one job to spare the rate limit (was MUST until v1.1). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-14 | MUST | Use both GET job status and GET protocol-entries; show the processing result to the user immediately after transfer and document it. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-15 | MUST | Store both processing status and processing protocol in the app's log, viewable for at least 1 year. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |
| DXSO-16 | unmarked | Production needs a real DATEV authentication medium and a Belege online dataset in processing form 'Erweitert'. Sandbox is a mock with fixed responses (client 455148-1 only, status always 4). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements |

## 12. DXSO / DATEV XML-Schnittstelle online (file requirements)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| DXSOF-01 | MUST | Implement the LEDGER (Belegsatzdatendatei) format for invoice data, not INVOICE. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |
| DXSOF-02 | MUST | Implement automated XSD validation when generating XML files (the API does no validation). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |
| DXSOF-03 | SHOULD | Test-import the XML files into a test dataset of the production DATEV app (via Belegtransfer or the service). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |
| DXSOF-04 | unmarked (required base data) | Invoice XML must carry at least: customer/supplier name and city, invoice date, invoice number, amount, tax rate, currency code, booking text; justify missing fields in the submission email. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |
| DXSOF-05 | MUST | Sample files for incoming and/or outgoing invoices from DATEV's sample receipts with base data, bundled as ZIP exactly as transmitted, named by use case (e.g. Ausgangsrechnungen_1.zip). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |
| DXSOF-06 | MUST | Sample files for an invoice correction (own correction document), as ZIP named by use case. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |
| DXSOF-07 | unmarked (required base data) | Cash XML must carry at least: GL account, date, amount, tax rate, currency code, receipt number (for at least one entry). | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |
| DXSOF-08 | MUST | Daily cash report (Tagesprotokoll) sample: two days, several incomes/expenses, different tax rates, as named ZIP. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |
| DXSOF-09 | MUST | Single-transaction sample: several incomes/expenses with different tax rates spread over at least two months, as named ZIP. | https://developer.datev.de/de/product-detail/accounting-dxso-jobs/2.0/documentation/interface-requirements-file |

## 13. Datenservice Export Rechnungswesen (accounting:dataexchange)

Production rules are identical to sandbox (tested with a test consultant number).


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| DX-01 | MUST | Use at least one of accounting-clients GET /v2/clients or /v2/clients/{client-id} to verify the customer's activation (services array contains 'Datenservice Export Rechnungswesen'). | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-02 | MUST | If permissions are missing (4xx, or 200 without the service), immediately revoke both tokens at the identity provider and show an error with a link to DATEV's order page or the vendor's own help document containing it. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-03 | MUST | Explain to the DATEV advisor which use cases were implemented. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-04 | MUST | Always check available fiscal years first (GET fiscal-years). | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-05 | MUST | Check the fiscal-year configuration (GET fiscal-years/{id}) and explain which response fields are used and why. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-06 | MUST | Demonstrate a technically correct call of general-ledger-accounts and explain whether/how it is used. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-07 | MUST | If accounting-sequences or terms-of-payment are used, explain the purpose. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-08 | unmarked | Account postings are asynchronous: POST a job, poll /jobs/{id}/state until 'completed', then fetch paged results. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-09 | MUST | Demonstrate successful retrieval of account postings. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-10 | MUST | Demonstrate retrieval of sums and balances and explain the purpose. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-11 | MUST | If the agriculture/forestry SKR14 endpoints are used, explain the purpose (verify beforehand they fit the customer base). | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/interface-requirements |
| DX-12 | unmarked (special terms) | Paid API: free until 31.12.2026; from 01.01.2027 an annual flat fee per retrieved dataset (EUR 1.20 own consultant numbers, capped EUR 300/yr; EUR 72 foreign consultant numbers, no cap), max. last five closed fiscal years per dataset; subscription via 'Kostenpflichtig abonnieren'. | https://developer.datev.de/de/product-detail/accounting-dataexchange/1/documentation/besondere-nutzungsbedingungen |

## 14. TRAFFIQX Invoice API for DATEV E-Rechnungsplattform (traffiqx:invoice)

Production rules identical to sandbox; production review uses a special DATEV test dataset.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| TQ-01 | MUST | Show where/how the customer enters their TRAFFIQX provider and TRAFFIQX ID (DATEV E-Rechnungsplattform may be hard-wired as provider). | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-02 | SHOULD | Design the integration so the customer can also reach other TRAFFIQX providers. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-03 | unmarked | Right after authentication run a neutral connection check using the inbox/outbox status endpoint with a filter (small payload); 403 means missing rights. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-04 | MUST | Perform the connection check for each supported use case (inbox/outbox) and verify HTTP 200. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-05 | MUST | Only signal a successful connection once the API returned 200. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-06 | MUST | On connection-check errors, tell the customer the connection failed and immediately revoke the tokens at the identity provider. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-07 | MUST | The mandatory header 'X-App-Display-Name' must always equal the app name belonging to the client ID in the developer portal. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-08 | SHOULD | On connection-check errors offer further self-help (own ticket system / solution help). | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-09 | MUST | Inbox: initially synchronize inbox status with the app and keep it in sync. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-10 | MUST | Inbox: the document_id must be visible to the customer throughout the document lifecycle. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-11 | MUST | Inbox: prominently show the e-invoice validation status (document_format + en_16931_compliant). | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-12 | MUST | Inbox: inform the customer when invalid e-invoices have arrived. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-13 | MUST | Inbox: extract downloaded documents from the ZIP, archive them individually and make them viewable. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-14 | MUST | Inbox: tell the customer where GoBD-compliant long-term archiving of incoming invoices takes place. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-15 | MUST | Outbox: support at least one upload path (structured-data XRechnung UBL/CII + PDF, or ZUGFeRD 2.x) and prove a successful 'sent' status. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-16 | MUST | Outbox: support entering a TRAFFIQX ID as addressing type. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-17 | MUST | Outbox: store the returned document_id and show it with its status to the customer. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-18 | MUST | Outbox: handle all status values (inProcess, sent, error, deleted, userAction) and make them transparent. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-19 | MUST | Outbox: limit polling of the status endpoint to the lifetime of one access token. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-20 | MUST | Outbox: download the document only after status 'sent' was confirmed (needed for GoBD archiving). | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-21 | MUST | Outbox: tell the customer where GoBD-compliant long-term archiving of outgoing invoices takes place. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-22 | MUST | Outbox: fetch metadata only after status 'sent' was confirmed. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-23 | MUST | Outbox: check the delivery channel (intended vs actual) and show at least format, send date, channel (email, TRAFFIQX, Peppol) and address/ID. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-24 | unmarked (challenges) | Demonstrate at least one 'sent' e-invoice per channel (email, TRAFFIQX, Peppol) and one ending in 'error', and how the app reacts. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/interface-requirements |
| TQ-25 | unmarked (special terms) | Connecting other TRAFFIQX providers requires first passing the DATEV technical review, then contacting b4value (customercare@b4value.net); the end customer needs a (possibly paid) contract with a TRAFFIQX provider. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/special-terms-of-use |
| TQ-26 | unmarked | Errors come as ProblemDetails with an error ID and help-center link per case (sandbox can simulate them via special TRAFFIQX IDs); the outbox status endpoint can return error objects with HTTP 200, so the body must be inspected. | https://developer.datev.de/de/product-detail/traffiqx-invoice/1.0.0/documentation/error-codes |

## 15. Lohnimportdatenservice (hr:files / hr:imports)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| HRIMP-01 | MUST | Keep file POSTs and GETs in a healthy ratio (not 30 GETs per uploaded file). | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements |
| HRIMP-02 | MUST | Use the single-client endpoint GET /clients/{client-id} (list endpoint not allowed); show where the customer enters consultant/client number, demonstrate a success message, and reproduce an error with numbers lacking permission, shown in the UI. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements |
| HRIMP-03 | unmarked (important note) | Only show 'connected' after GET clients confirms permission. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements |
| HRIMP-04 | MUST | Sandbox: demonstrate a successful file upload (one master-data and one movement-data file if both are used). | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements |
| HRIMP-05 | SHOULD | Sandbox: show the job status of uploaded files in the UI. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements |
| HRIMP-06 | MUST | Production: tests must run from a dedicated test system with sample data only; access to real productive data during acceptance is strictly forbidden. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements |
| HRIMP-07 | MUST | Production: demonstrate a successful upload and then the import into the DATEV payroll programs. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements |
| HRIMP-08 | MUST | Production: show the job status of uploaded files in the UI. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements |

## 16. ASCII format (Lohnimportdatenservice file requirements)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| HRIMPF-01 | unmarked (must) | Follow the ASCII interface descriptions of LODAS and Lohn und Gehalt; the data service performs no ASCII validation, a test import is recommended. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements-file |
| HRIMPF-02 | unmarked | Lohn und Gehalt movement import must follow the Standard.ini layout (or submit the vendor's own INI for review); the company personnel number cannot be used for Lohn und Gehalt master-data import. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements-file |
| HRIMPF-03 | unmarked | Full approval requires both LODAS and Lohn und Gehalt with movement (BWD) and master-data (PSD) examples; integrating only one product restricts approval to that product. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements-file |
| HRIMPF-04 | MUST | Sample files must fit the chosen scenario and be named accordingly. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements-file |
| HRIMPF-05 | MUST | Use sample data only, never real data. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements-file |
| HRIMPF-06 | unmarked (tasks) | Prepare movement- and master-data imports for LODAS and for Lohn und Gehalt with all mandatory fields correct. | https://developer.datev.de/de/product-detail/hr-imports/2.0.0/documentation/interface-requirements-file |

## 17. Lohnauswertungsdatenservice (hr:payrollreports)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| HRPAY-01 | MUST | Retrieval logic must follow the customer's real payroll cycle (e.g. monthly) and its rules be documented; alternatively offer an explicit manual trigger (UI element or defined API action). | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-02 | DONT | No permanent calls without cause (24/7 polling); use event- or time-based calls. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-03 | MUST | Use the permission query for a dataset; retrieve data only after matching against the configuration data. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-04 | unmarked (note) | A long-term token does not imply permission; call GET /clients after obtaining it and treat the customer as connected only on success. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-05 | MUST (MUSS) | For invalid consultant/client numbers show an understandable error with a hint (e.g. 'please check your input or contact your administrator'). | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-06 | MUST | Show where the customer enters the data, then a successful call of GET /clients/{client-id} (returns access_granted/denied per report type, 403 without access). | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-07 | SHOULD | Offer an overview of available reports for a given month (documents-metadata). | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-08 | SHOULD | Show documents added since a given date/month. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-09 | MUST | Assign reports to the correct employee and payroll month. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-10 | SHOULD | Also assign the correct client (company) and clerk. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-11 | MUST | Technical assignment of employee reports via a unique identifier, normally the DATEV personnel number. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-12 | MUST | Production: tests from a dedicated test system with sample data only; no real data. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-13 | MUST | Production: permission query with paging and display of consultant/client numbers and company name. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |
| HRPAY-14 | unmarked | metadata 'period' = payroll month of a document, 'timestamp' = creation time; both can be used to find new documents. | https://developer.datev.de/de/product-detail/hr-payrollreports/2.0.0/documentation/interface-requirements |

## 18. Lohnergebnisdatenservice (hr:exports)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| HREXP-01 | MUST | Retrieval logic must follow the customer's payroll cycle and be documented, or offer an explicit manual trigger. | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |
| HREXP-02 | DONT | No permanent calls without cause (24/7 polling). | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |
| HREXP-03 | MUST | Use one of GET /clients or /clients/{client-id}; list → paged display; single → show where the customer enters the data (sandbox and production). | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |
| HREXP-04 | unmarked (important notice) | Only show authentication as successful after GET clients confirms the rights. | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |
| HREXP-05 | MUST | Show an understandable error with a hint for invalid consultant/client numbers. | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |
| HREXP-06 | MUST | Use the HR master-data query; demonstrate correct assignment to company, employee and month and correct display of values. | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |
| HREXP-07 | MUST | Show any other data the app retrieves. | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |
| HREXP-08 | MUST | Production: tests from a dedicated test system with sample data only; no real data. | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |
| HREXP-09 | unmarked | Filter by 'accounting_month' or 'month_of_recalculation', never both at once. | https://developer.datev.de/de/product-detail/hr-exports/1.0.0/documentation/interface-requirements |

## 19. Lohnaustauschdatenservice (hr:exchange)

Polling and retrieval rules are repeated per use case; listed once per use case where DATEV repeats them.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| HREX-01 | MUST | Determine which use cases the integration needs and tell the DATEV advisor at the start of the technical review. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-02 | MUST | Corrections of monthly data are made by counter-booking plus re-submission in the relevant payroll period. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-03 | MUST | Run the permission check GET /clients/{client-id} (customer provides consultant-client number) and show whether it succeeded (200) or not. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-04 | MUST | Create one or more job requests (POST /clients/{client-id}/jobs) to read the needed data. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-05 | MUST | Before any later create/change (employees, gross payments, absences, month records) run a full read to detect differences and obtain current IDs. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-06 | MUST | Query job status no earlier than 1 minute after job creation (all use cases). | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-07 | MUST | Poll job status at most once per minute (all use cases). | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-08 | MUST | Stop polling after at most 15 minutes without status change and treat/document it as an error (all use cases). | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-09 | MUST | Initial sync: fetch all three resource types (client-data, employees, month-records) completely and store them in the third-party system. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-10 | MUST | Initial sync: DATEV data is leading; clean up deviations in the third-party system. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-11 | MUST | Log the results and show them to the user where relevant. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-12 | MUST | Gross payments: specify resource 'gross-payments' correctly in the job body and always read current IDs before a change. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-13 | SHOULD | Gross payments: separate job per employee or period eases traceability. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-14 | MUST | Gross payments: POST/PUT only with the correct, previously retrieved gross-payment IDs and periods; changes without prior read cause errors. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-15 | SHOULD | Gross payments: only one entry per period and personnel number per change. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-16 | MUST | Employees: specify resource 'employees' correctly; read and analyse data before any creation/change; store or process it locally. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-17 | SHOULD | Employees: separate jobs per period or employee group. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-18 | MUST | Employees: submit all mandatory fields per specification. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-19 | MUST | Employees: personnel numbers must be unique; a second POST with the same personnel number must be caught. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-20 | SHOULD | Employees: use PUT when the employee already exists. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-21 | COULD | Employees: personnel number may be left for the payroll system to assign; hourly wage can be sent at creation or via POST …/hourly-wages. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-22 | MUST | Absences: specify resource 'absences'; take over and analyse all absences completely before writing. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-23 | MUST | Absences: identify each absence by start date + type (LODAS) or by ID (Lohn und Gehalt). | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-24 | MUST | Absences LODAS: only valid combinations of start date, absence type and personnel number; invalid ones abort. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-25 | MUST | Absences Lohn und Gehalt: only valid absence types; the ID must exactly match the one from the read. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-26 | MUST | Month records: specify resource 'month-records'; before writing check whether an entry exists for the same month and type. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-27 | SHOULD | Month records: avoid duplicate movement types per month; use clearly defined periods and types. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-28 | MUST | Month records: every entry contains personnel number, period, wage type and value; changes by negative counter-booking and correct re-submission. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-29 | MUST | Production: tests from a dedicated test system with sample data only (no real data or live personnel cases); a separate test dataset early on is recommended. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-30 | MUST | Production: after every creation or change run a GET job to verify persistence. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-31 | MUST | Production: a second POST with an already used personnel number must produce an error (e.g. 409 Conflict). | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-32 | MUST | Production: every PUT change must be validated by a new GET job and stored traceably. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |
| HREX-33 | MUST | Production: the change must be technically traceable in follow-up processes. | https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements |

## 20. Lohnaustauschdatenservice eAU (hr:eau / eau-api)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| EAU-01 | MUST | Keep request POSTs and GETs in a healthy ratio; document the retrieval rules or offer an explicit manual trigger. | https://developer.datev.de/de/product-detail/eau-api/1.0.0/documentation/interface-requirements |
| EAU-02 | MUST | Use GET /clients/{client-id} with customer input of consultant/client number; show success and reproduce an error for numbers lacking permission, shown in the UI. | https://developer.datev.de/de/product-detail/eau-api/1.0.0/documentation/interface-requirements |
| EAU-03 | MUST | Demonstrate a successful eAU request to the DATEV data center / health insurer. | https://developer.datev.de/de/product-detail/eau-api/1.0.0/documentation/interface-requirements |
| EAU-04 | MUST | Display the health-insurer feedback data in the UI. | https://developer.datev.de/de/product-detail/eau-api/1.0.0/documentation/interface-requirements |
| EAU-05 | MUST | Demonstrate a successful withdrawal (DELETE) of an eAU request. | https://developer.datev.de/de/product-detail/eau-api/1.0.0/documentation/interface-requirements |
| EAU-06 | unmarked (mandatory note) | No production review exists (sample data impossible). Users must be warned that an eAU query may only be sent if the employee reported sick per § 5 (1) EntgFG; retrieval should start from the 4th day after the report. | https://developer.datev.de/de/product-detail/eau-api/1.0.0/documentation/interface-requirements |

## 21. Datenservice Dokumente Personalwirtschaft (hr:documents)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| HRDOCS-01 | MUST | Use the /clients endpoint for the permission check of a dataset (sandbox and production; expect large result sets in production). | https://developer.datev.de/de/product-detail/hr-documents/1/documentation/interface-requirements |
| HRDOCS-02 | unmarked (hint) | GET /clients/{consultant-client} and POST /clients/{consultant-client}/documents/upload can be used with a long-term token in production. | https://developer.datev.de/de/product-detail/hr-documents/1/documentation/interface-requirements |
| HRDOCS-03 | unmarked (hint) | Upload by client GUID (POST /clients/{guid}/documents) or by consultant-client number; sandbox clients 455148/10, /11, /12 return 429, 500, 422 to test error handling. | https://developer.datev.de/de/product-detail/hr-documents/1/documentation/interface-requirements |

## 22. Belegbilderservice Einkommensteuer / DATEV Meine Steuern (my-tax:income-tax-documents)

Rules apply to sandbox and production.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| MYTAX-01 | MUST | Keep uploads and GETs in a healthy ratio (not 30 GETs per document). | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-02 | MUST | Use one of GET /clients or /clients/{client-id}; list → paging with company name and numbers; single → show where the customer enters them. | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-03 | unmarked (important note) | Only show 'connected' after GET clients confirms permission. | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-04 | MUST | Use GET tax-years and show the result; verify before each transfer day (once per day suffices). | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-05 | MUST | Show in the review how the app's tax years map to DATEV Meine Steuern. | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-06 | DONT | Do not check tax years before every single document. | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-07 | MUST | Use GET tax-years/{year}/folders and show the result; verify before each transfer day. | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-08 | MUST | Show in the review how the app's folders map to DATEV Meine Steuern. | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-09 | DONT | Do not check folders before every single document. | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-10 | SHOULD | Implement POST tax-years so new tax years can be created automatically when needed (cannot be deleted later). | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-11 | MUST | Upload at least two documents with different file formats into different folders (each with a 'metadata' object). | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |
| MYTAX-12 | MUST | Documents must arrive well readable yet small; explain the compression used. | https://developer.datev.de/de/product-detail/my-tax-income-tax-documents-1/1/documentation/interface-requirements |

## 23. Dokumentenservice Grundsteuer (property tax file upload API)


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| PT-01 | not found | No interface-requirements (Schnittstellenvorgaben) page exists; the product documentation contains only 'Erste Schritte' and the API reference. Only the general requirements (section 1) apply as far as known. | https://developer.datev.de/de/product-detail/datev-property-tax-file-upload-api/2.1.5/overview |

## 24. DATEV Basisdaten online (master-data:master-clients)

No Schnittstellenvorgaben page; items below come from 'Nutzungshinweise', 'Konzepte' and 'Besondere Nutzungsbedingungen'.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| MD-01 | unmarked (mandatory) | Usage right only arises after signing a supplementary agreement; a consultation appointment to fix the transmitted data scope is mandatory (not optional). | https://developer.datev.de/de/product-detail/master-data-master-clients/3/documentation/special-terms-of-use |
| MD-02 | unmarked | Paid API: per retrieval with expand (0.10 / 0.05 / 0.03 EUR by monthly volume) and per delta query (0.002 EUR). Avoid expand=true unless the extended scope is needed (sandbox free). | https://developer.datev.de/de/product-detail/master-data-master-clients/3/documentation/special-terms-of-use |
| MD-03 | unmarked (should) | To identify central clients show at least name, consultant_number and number. | https://developer.datev.de/de/product-detail/master-data-master-clients/3/documentation/usage-notes |
| MD-04 | unmarked (must) | Store the ETag per central client; check updates via If-None-Match (304) or HEAD, or for many clients via POST /master-clients/search with id+etag tuples. | https://developer.datev.de/de/product-detail/master-data-master-clients/3/documentation/usage-notes |
| MD-05 | unmarked | GDPR purpose limitation: the delivered data scope is restricted to data areas booked during onboarding; access requires the rights administrator to unlock the client for the user. | https://developer.datev.de/de/product-detail/master-data-master-clients/3/documentation/terms-and-concepts |

## 25. Datenservice Kassenarchiv (cashregister:import)

No Schnittstellenvorgaben page; technical 'must' statements from the API documentation.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| CR-01 | unmarked (must) | After device registration, fetch tenants (again after any re-registration) and upload an init file to finish registration/create the register folder (taxonomy clients need the taxonomy init file). | https://developer.datev.de/de/product-detail/cashregister/2.6.0/documentation/2-cashminusregister-api-documentation |
| CR-02 | unmarked (must) | The register/TSE serial number must be unique and stable for the device's lifetime. | https://developer.datev.de/de/product-detail/cashregister/2.6.0/documentation/2-cashminusregister-api-documentation |
| CR-03 | unmarked (must) | Only metadata.json plus one file per upload; metadata must be valid JSON matching the documented patterns (escape line breaks). | https://developer.datev.de/de/product-detail/cashregister/2.6.0/documentation/2-cashminusregister-api-documentation |
| CR-04 | unmarked (must) | Use header 'Request-Id' (hyphen, not underscore); send access token as Bearer on every request; use tenant IDs from /tenants in /tenants/{tenant_id}/files/import. | https://developer.datev.de/de/product-detail/cashregister/2.6.0/documentation/2-cashminusregister-api-documentation |
| CR-05 | unmarked | Authentication uses the Hybrid flow per the product's authentication docs. | https://developer.datev.de/de/product-detail/cashregister/2.6.0/overview |

## 26. SmartTransfer inbound / outbound (b4value-net-smarttransfer)

Interface requirements are replaced by the API documentation per the special terms; inbound and outbound terms are identical.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| ST-01 | unmarked | No sandbox: a separate 'Pilotportal' test environment is granted on request (smarttransfer-vertrieb@service.datev.de). | https://developer.datev.de/de/product-detail/b4value-net-smarttransfer-inbound/1.2/documentation/special-terms-of-use |
| ST-02 | unmarked | Single-stage technical review in the pilot portal against the API documentation, plus check of the DATEV gateway connection; on success the vendor may migrate unchanged to production. | https://developer.datev.de/de/product-detail/b4value-net-smarttransfer-inbound/1.2/documentation/special-terms-of-use |
| ST-03 | unmarked | End customers need a paid DATEV SmartTransfer contract; authentication uses an X-API-KEY; support via smarttransfer-vertrieb@service.datev.de. | https://developer.datev.de/de/product-detail/b4value-net-smarttransfer-outbound/1.2/documentation/special-terms-of-use |

## 27. Login mit DATEV (extra, listed on the index page)

Not in scope list but part of DATEV's interface requirements.


| ID | Level | Requirement (paraphrase) | Source |
|---|---|---|---|
| LOGIN-01 | MUST | Demonstrate login with DATEV SmartCard / mIDentity (sandbox and production). | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |
| LOGIN-02 | MUST | Demonstrate login with DATEV SmartLogin. | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |
| LOGIN-03 | SHOULD | Demonstrate login with a DATEV user plus DATEV Kommunikationsserver. | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |
| LOGIN-04 | MUST | The authorize request must contain enableWindowsSso=true. | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |
| LOGIN-05 | MUST | Login button logos follow DATEV's design guidelines. | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |
| LOGIN-06 | MUST | Logging in with two different access media leads to the same account in the vendor app. | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |
| LOGIN-07 | MUST | Show a successful logout in the UI (via /revoke). | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |
| LOGIN-08 | MUST | Show the token is removed from https://apps.datev.de/tokrevui. | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |
| LOGIN-09 | unmarked | Scopes account_id and profile required, email optional. | https://developer.datev.de/de/resources/login-mit-datev#schnittstellenvorgaben-login-mit-datev |

## Not found / could not read

- **Dokumentenservice Grundsteuer** (datev-property-tax-file-upload-api 2.1.5): no Schnittstellenvorgaben page exists; documentation has only 'Erste Schritte'. https://developer.datev.de/de/product-detail/datev-property-tax-file-upload-api/2.1.5/overview
- **accounting:clients**: no own Schnittstellenvorgaben page; covered inside other services. https://developer.datev.de/de/product-detail/accounting-clients/2.0/overview
- **DATEV Basisdaten online (master-data:master-clients)**: no Schnittstellenvorgaben page; only usage notes / special terms (section 24).
- **Datenservice Kassenarchiv (cashregister:import)**: no Schnittstellenvorgaben page; only API documentation (section 25). The '1 API-Dokumentation von MeinFiskal' subpage contained only a short intro.
- **SmartTransfer inbound/outbound**: no Schnittstellenvorgaben by design; the API documentation (not fully read; only special terms + overview) replaces them. Endpoint-level rules in the API reference were not extracted.
- **Rate limits**: no numeric rate limit (requests per second/minute) is published on any page read; only qualitative rules (no 24/7 polling, healthy GET/POST ratio, hr:exchange 1 poll/min and 15-min cap, TRAFFIQX polling bounded by token lifetime, DXSO bundling to spare 'the rate limit'). 429 appears as a simulated error in hr:documents sandbox.
- **Nutzungsbedingungen DATEV Developer Portal und DATEV-Schnittstellen** (https://developer.datev.de/de/terms): page rendered no content in the headless browser (likely a PDF/download); contract-level obligations (support, liability, sections referenced by special terms) were not read.
- **Wordmark/logo rules referenced as MUST (GEN-41)** live in the terms of use and individual interface contracts, which were not readable.
- **Sandbox/production split**: the extraction de-duplicated identical sandbox/production paragraphs; production-only items are listed explicitly. Some product pages (DXSO, hr:payrollreports) repeat sandbox items in production verbatim.
- Not opened: hr:exchange use-case sub-pages (Erstbestückung, Neuanlage, etc.), accounting:dataexchange 'Hinweise zur Bestellung'/'Informationen zur Weiterverarbeitung', TRAFFIQX 'Sandbox Details'/'Versand von E-Rechnungen', Login-mit-DATEV design assets. These are descriptive docs, not marked requirement pages, but could contain further 'must' statements.


## Counts per section

| Section | MUST | SHOULD | DONT | unmarked/other |
|---|---|---|---|---|
| 1. General interface requirements (Allgemeine Schnittstellenvorgaben) | 21 | 2 | 3 | 18 |
| 2. Authentication guide (OAuth 2.0 / OIDC specifics) | 0 | 0 | 0 | 18 |
| 3. New redirect-URL guidelines | 0 | 0 | 0 | 2 |
| 4. General error codes (Allgemeine Fehlercodes) | 0 | 0 | 0 | 2 |
| 5. Help and documentation requirements (Vorgaben zu Hilfen und Dokumentationen) | 0 | 0 | 0 | 5 |
| 6. Onboarding workflow, FAQ and related guides | 0 | 0 | 0 | 9 |
| 7. accounting:clients | 0 | 0 | 0 | 1 |
| 8. Belegbilderservice Rechnungswesen (accounting:documents) | 6 | 1 | 3 | 2 |
| 9. Buchungsdatenservice (accounting:extf-files + accounting:documents + accounting:clients) | 10 | 2 | 2 | 8 |
| 10. DATEV-Format file (Buchungsdatenservice file requirements) | 7 | 1 | 0 | 3 |
| 11. Rechnungsdatenservice 1.0 (accounting:dxso-jobs) | 12 | 1 | 0 | 3 |
| 12. DXSO / DATEV XML-Schnittstelle online (file requirements) | 6 | 1 | 0 | 2 |
| 13. Datenservice Export Rechnungswesen (accounting:dataexchange) | 10 | 0 | 0 | 2 |
| 14. TRAFFIQX Invoice API for DATEV E-Rechnungsplattform (traffiqx:invoice) | 20 | 2 | 0 | 4 |
| 15. Lohnimportdatenservice (hr:files / hr:imports) | 6 | 1 | 0 | 1 |
| 16. ASCII format (Lohnimportdatenservice file requirements) | 2 | 0 | 0 | 4 |
| 17. Lohnauswertungsdatenservice (hr:payrollreports) | 8 | 3 | 1 | 2 |
| 18. Lohnergebnisdatenservice (hr:exports) | 6 | 0 | 1 | 2 |
| 19. Lohnaustauschdatenservice (hr:exchange) | 27 | 5 | 0 | 1 |
| 20. Lohnaustauschdatenservice eAU (hr:eau / eau-api) | 5 | 0 | 0 | 1 |
| 21. Datenservice Dokumente Personalwirtschaft (hr:documents) | 1 | 0 | 0 | 2 |
| 22. Belegbilderservice Einkommensteuer / DATEV Meine Steuern (my-tax:income-tax-documents) | 8 | 1 | 2 | 1 |
| 23. Dokumentenservice Grundsteuer (property tax file upload API) | 0 | 0 | 0 | 1 |
| 24. DATEV Basisdaten online (master-data:master-clients) | 0 | 0 | 0 | 5 |
| 25. Datenservice Kassenarchiv (cashregister:import) | 0 | 0 | 0 | 5 |
| 26. SmartTransfer inbound / outbound (b4value-net-smarttransfer) | 0 | 0 | 0 | 3 |
| 27. Login mit DATEV (extra, listed on the index page) | 7 | 1 | 0 | 1 |
| **Total** | 162 | 21 | 12 | 108 |
