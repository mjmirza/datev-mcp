<!-- freshness: 60d -->
# Questions and answers

## For tax advisors and bookkeepers

**Can the AI change my clients' books without me knowing?**
No. Every change (an upload, a booking import, any write) first comes back as a preview with a confirmation code. The change only happens when the assistant calls again with that exact code, and the code stops working if anything in the request changed. You decide whether the assistant may confirm. Keep that decision with a person.

**Does it work with real client data?**
Only after DATEV has reviewed your app (the paid Technische Prüfung) and you have a data processing agreement with your AI provider. Until then it runs against the DATEV sandbox with test data. See [COMPLIANCE.md](COMPLIANCE.md).

**Which DATEV products does it cover?**
All 209 operations across 23 DATEV API specifications, including accounting, documents, payroll (Lohn), master data, cash register, eAU, smart transfer and income tax documents. Your app still has to be subscribed to each product in the DATEV portal.

**Why do I sometimes get 401, 403 or "Sandboxing policy error"?**
That is DATEV saying your app is not allowed to use that product or resource yet. The request itself was fine. Check the product subscriptions in the DATEV portal.

**I uploaded a ZIP and it was refused.**
DATEV does not accept ZIP files for documents. Upload the files one by one. Accepted types are PDF, JPG, PNG, TIFF, GIF, BMP, XML, TXT and CSV.

**Why does it ask me to log in again?**
DATEV's refresh token lasts about 11 hours and can be used only once. After a long break, run `datev-mcp login` again.

## For developers

**Why are DATEV's API specs not in the repository?**
DATEV's terms do not allow passing their API documentation on. `npm run specs` downloads them for you.

**How do I call an operation that has no dedicated tool?**
Use `datev_search_operations` to find it, `datev_describe_operation` to see its parameters, then `datev_call`. `datev_call` sends JSON or text bodies, never a file. 18 operations take a file: 12 require one and cannot be used through `datev_call`, 6 can be called without a file. Two of them have their own tools, `datev_upload_extf` and `datev_upload_document`.

**How do I download a PDF?**
Call the operation with `datev_call` and pass `save_to` with an absolute path. The file is written byte for byte. Small files can also come back as base64 without `save_to`.

**A postings call returned `ready: false` or `complete: false`. What now?**
DATEV prepares postings as a background job. Call again with the returned `job_id`, and with `from_page` if some pages were already read. No second job is started.

**What happens when DATEV is slow or rate limits?**
Reads retry 429, 502, 503, 504 and network errors up to three attempts, honoring `Retry-After`. Writes retry only a 429. Each DATEV call has a 55 second budget, token included, and your AI client can cancel it earlier.

**How do I know the tests mean anything?**
The offline scenarios are checked by planting bugs in the client and confirming the scenarios fail. The last check caught all three planted bugs with 440 failing scenarios. See [VALIDATION.md](VALIDATION.md).

More than 2,000 further answers, including one page per DATEV product with every operation, are in [docs/qa](qa/README.md).
