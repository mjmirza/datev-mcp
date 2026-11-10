# Putting a DATEV data service into operation

Everything a client, a tax advisor and the person setting up datev-mcp needs, in one place. One section per DATEV data service.

## The same three steps for every data service

1. **At DATEV.** The client or their tax advisor orders the data service and switches it on for the client (Mandant). DATEV describes this on its setup page, [go.datev.de/datenservices-einrichten](http://go.datev.de/datenservices-einrichten). datev-mcp cannot do this step.
2. **In datev-mcp.** Connect with exactly the data services you use, for example `datev-mcp login --services accounting-documents`. `datev-mcp services` lists the names. Only their scopes are requested.
3. **Check the client.** Ask your assistant to run `datev_check_client` with the consultant number (Beraternummer) and client number (Mandantennummer). It shows the company name when access is granted, and a clear reason when it is not.

datev-mcp repeats the permission check once per transfer day before data moves, and refuses with a clear message when DATEV denies it.

## Accounting

| Data service (DATEV name) | `--services` | What datev-mcp does | Settings that matter |
|---|---|---|---|
| Belegbilderservice Rechnungswesen | `accounting-documents` | Uploads receipts and invoices to the client's document inbox | A document type of the client is required for every document, `datev_document_types` lists them |
| Buchungsdatenservice und DATEV-Format | `accounting-extf-files` | Imports EXTF booking files, waits for DATEV's import result, stores documents for a booking batch | Category, folder and register are required for documents of this service. A file is sent once, a deliberate resend needs `resend: true` |
| Rechnungsdatenservice 1.0 und DXSO-Format | `accounting-dxso-jobs` | Sends ledger files through `datev_upload_file`, after the client check | DATEV expects the client's processing form "Erweitert", a matching fiscal year, a matching account length and the needed ledger switched on |
| Datenservice Export Rechnungswesen | `accounting-dataexchange` | Reads fiscal years, balances, postings and the chart of accounts | Without this service DATEV requires ending the connection. datev-mcp does that and links DATEV's order page |
| accounting:clients (DATEV Rechnungswesen) | `accounting-clients` | Lists clients and checks which data services each one switched on | Added automatically with the accounting services above, because their permission check needs it |

## Payroll

| Data service (DATEV name) | `--services` | What datev-mcp does |
|---|---|---|
| Lohnimportdatenservice und ASCII-Format | `hr-files` | Sends import files after the client check |
| Lohnauswertungsdatenservice | `hr-payrollreports` | Reads payroll reports, only for report types the client grants |
| Lohnergebnisdatenservice | `hr-exports` | Reads payroll results after the client check |
| Lohnaustauschdatenservice (hr:exchange) | `hr-exchange` | Reads and writes payroll master data after the client check, every write with preview and approval |
| Lohnaustauschdatenservice (hr:eau) | `eau-api` | eAU requests and feedback after the client check |
| Datenservice Dokumente Personalwirtschaft | `hr-documents` | Uploads payroll documents after the client check |

## Tax and other

| Data service (DATEV name) | `--services` | What datev-mcp does |
|---|---|---|
| Belegbilderservice Einkommensteuer | `my-tax-income-tax-documents` | Uploads income tax documents after the client check |
| Dokumentenservice Grundsteuer | `property-tax-file-upload-api` | Uploads property tax documents |
| DATEV Basisdaten online (master-data:master-clients) | `master-data-master-clients` | Reads client master data |

## When something does not work

| What you see | What to do |
|---|---|
| "Access to client ... could not be confirmed" | Check the consultant and client number. If they are right, the data service is not switched on for this client at DATEV yet, see step 1 |
| "has not switched on ..." | The client exists, but this data service is not active for it. See step 1 |
| A DATEV help link in an error | Open it. DATEV explains the error there |
| The connection was ended after an Export call | The client lacks Datenservice Export Rechnungswesen. Order it at DATEV, then run `datev-mcp login` again |

Connected apps can be reviewed and removed at [apps.datev.de/tokrevui](https://apps.datev.de/tokrevui).
