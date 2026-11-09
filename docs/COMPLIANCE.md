<!-- freshness: 45d -->
# Compliance

This page explains which rules apply when you use datev-mcp and what the project does to keep you inside them. It is a working summary, not legal advice. Confirm anything that matters for your practice against DATEV's current signed terms and with your own counsel.

## DATEV's developer terms

| Rule | What the project does |
|---|---|
| API documentation may not be passed on | DATEV's specs are downloaded by each developer into `specs/` and never committed. The derived operation index is also kept out of git. Public pages here name operation ids and counts only, never DATEV's descriptions |
| The sandbox may hold test data only | The server defaults to `DATEV_ENV=sandbox`. Do not put real client data into the sandbox, not even to try something out |
| Production access needs DATEV's review | Using real client data needs the paid technical review (Technische Prüfung) for your app. Until that is done, run in sandbox only |
| No DATEV logo, no advertising with the name | The project uses no DATEV logo or artwork. The name DATEV appears only to say which system it connects to |
| The client secret stays with the app owner | The secret is read from the environment only. It is never logged, never written to the session file, never shown in a tool answer |

## Data protection (DSGVO / GDPR)

Answers from DATEV can contain personal data, for example employee payroll records, names on invoices or bank details in postings.

- **Where the data goes.** The server passes DATEV's answer to your AI client. From there it goes wherever that client sends it, which is usually the AI provider. Check that you have a data processing agreement with that provider and that sending this category of data to it is permitted for your clients.
- **What the server keeps.** On disk, only the encrypted login session, the technical HTTP log (30 days, secrets removed, response bodies only for errors and job status) and the files you ask for: downloads saved with `save_to` and EXTF files written by `datev_write_extf_batch`, both where you tell it. Charts of accounts are kept in memory while the server runs, reused for 10 minutes, and dropped when the server stops.
- **Least access.** Choose only the data services you use with `login --services`. The server requests only their scopes and refuses an operation outside them before anything is sent. Subscribe your app only to the products you use.
- **Less data by default.** Account postings come with a basic set of fields unless you ask for all of them, and tool answers carry field names and types, never DATEV's documentation text.
- **Payroll and special categories.** Payroll data can include health related or religious information (sick days, church tax). Treat the HR products as high risk and keep them out of conversations that do not need them.

## Professional secrecy for tax advisors

Tax advisors are bound by professional secrecy (§ 57 StBerG, § 203 StGB). Sending client data to an outside AI service can count as disclosure to a third party. Before using this with real clients, check that the AI provider has been bound to secrecy in writing, as § 62a StBerG requires for service providers.

## EU AI Act

datev-mcp is a connector, not an AI system. If you build a product on top of it that people talk to, you must tell them they are dealing with an AI (Article 50), and the people running it need sufficient AI literacy (Article 4). Nothing in this project performs a prohibited practice or a high-risk use.

## Writes and accountability

Every change to DATEV data needs a preview and a confirmation code that matches that exact preview. In production the server also asks you directly in the client before it sends, so the assistant cannot approve its own write. Writes are never retried automatically, so nothing is sent twice. Keep the person who approves the write the person who is accountable for the booking. Do not set up a client that approves writes automatically.

## Before going to production

1. Complete DATEV's technical review for your app. [DATEV-REVIEW.md](DATEV-REVIEW.md) maps every requirement to its proof.
2. Sign a data processing agreement with your AI provider and bind it to professional secrecy.
3. Log in with only the data services you use (`login --services`).
4. Run `npm audit`, `npm test` and `npm run eval`, and keep the reports.
5. Decide who in your practice confirms writes, and write that down.
