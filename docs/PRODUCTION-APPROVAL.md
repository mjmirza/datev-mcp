<!-- freshness: 90d -->
# Going from the DATEV sandbox to production

The sandbox app works with test data only. To use datev-mcp with real clients, DATEV has to approve your app. That takes two video meetings with DATEV, a paid onboarding package and a few signed agreements.

Every step below is done by the person or company that owns the DATEV app, with their own DATEV account, money and signature. Nobody can do them for you, and this project cannot either.

Facts and prices come from DATEV's developer documentation, as recorded in [COMPLIANCE-CHECKLIST.md](COMPLIANCE-CHECKLIST.md) (rows GEN-01 to GEN-12, WF-01 to WF-03, FAQ-01 to FAQ-04, DX-12, MD-01, EXTFF-04). Check DATEV's current terms before you order, because prices and dates change.

## At a glance

| | |
|---|---|
| Time | About 4 to 8 weeks, depending on when DATEV has meeting slots |
| Cost | EUR 1,500 plus VAT per data service, including 4 hours of consulting. Each extra hour is EUR 210 plus VAT |
| Meetings | Two video calls, one in the sandbox and one in production |
| Data | Test data only during both reviews, never real client data |

## The steps, in order

1. **Order the onboarding package and book the meetings.** Use DATEV's booking portal. Your developer organisation needs a DATEV advisor number. There is no cheaper or simpler route for internal or non-commercial use. Every integration goes through the same onboarding.
2. **Subscribe the app to every API product you need, before you ask for production.** You request the upgrade on the app's detail page in the DATEV developer portal. After the production release that app cannot subscribe to further API products.
3. **Sign the special terms for each product you use.**
   - master-data needs a signed supplementary agreement and a required consultation.
   - dataexchange is free until 31 December 2026. From 2027 DATEV charges EUR 1.20 per dataset, capped at EUR 300 a year.
   - Each product's running costs are set in its special terms.
4. **Book the file-format review if you use these services.** Buchungsdatenservice (the EXTF format) and Rechnungsdatenservice each need their own technical review. You send sample EXTF files to DATEV by email.
5. **Sign a data-processing agreement with your AI provider.** Prompts and answers can carry client data, and tax advisors are bound by professional secrecy. This has to be in place before any real data passes through the AI client. See [COMPLIANCE.md](COMPLIANCE.md).
6. **Clear known open issues with DATEV support first.** The accounting-documents endpoints currently answer some requests with 400. Raise that in a support ticket before meeting 1, so it does not come up in the demo.
7. **Meeting 1, the sandbox approval.** A screen share in which you show the integration and DATEV's advisor asks questions. Prepare with the checklist in [DATEV-REVIEW.md](DATEV-REVIEW.md), section "Before each appointment". Show these things.
   - the architecture, how DATEV's entities map to the tools, and how tokens are handled ([ARCHITECTURE.md](ARCHITECTURE.md))
   - `datev-mcp status`, one write previewed and then approved, and `datev-mcp disconnect`
   - the test and eval reports

   Passing opens production access for **3 months only**. After that the app is reset to the sandbox unless meeting 2 is passed.
8. **Test on production yourself within those 3 months.** Use test data only, together with your own DATEV test system.
9. **Meeting 2, the production approval.** The same demo, now on production and still with test data. Passing removes the time limit, and the integration may then be rolled out to all your users.

## After approval

- Keep the error rate below 10 percent, counted as requests answered with 4xx or 5xx divided by all requests. `datev-mcp compliance` shows your current rate from the HTTP log.
- Offer first-level support for the DATEV interface to your users. Only send them to DATEV when you cannot help yourself.
- Call DATEV only when a user asked for it, by hand or by a rule they set. No round-the-clock polling. datev-mcp calls DATEV when a tool is used, plus one start-up retry of a token revoke DATEV did not confirm.
- Address the APIs by their DNS names, never by IP address.

## Need help with the review

Preparing the meetings, mapping your own workflow onto DATEV's data services, or building a custom integration on top of this server is offered as a paid service. Reach out through [next8n.com](https://next8n.com).
