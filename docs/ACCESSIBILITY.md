<!-- freshness: 60d -->
# Accessibility

datev-mcp has no screens of its own. People use it through an AI client, by typing or by voice. Accessibility here means the words the server sends back are easy to understand, easy to hear read aloud, and never depend on seeing a layout.

## What is in place today

- **Plain sentences for every error.** Each error says what went wrong and what to do next, for example "DATEV login needed. Run datev-mcp login." There are no bare error codes without an explanation.
- **Text only.** Answers are JSON or short sentences. Nothing relies on colour, icons or position, so a screen reader reads them in a sensible order.
- **No time pressure on people.** Confirmation codes for writes stay valid for 15 minutes, long enough to have a preview read aloud and think it over.
- **Small answers by default.** List tools return 50 rows unless asked for more, so a screen reader user is not handed thousands of lines.
- **Command line output.** `doctor` prints one check per line, starting with `OK` or `FAIL`, which reads well with VoiceOver and NVDA.

## Known gaps

| Gap | Plan |
|---|---|
| Messages are English only | German messages for the most common errors, since most users work in German |
| JSON field names are English and technical | One sentence in everyday words before each JSON answer |
| The login opens a DATEV web page | That page belongs to DATEV and follows DATEV's own accessibility work. The login URL is also printed, so it can be opened in any browser |

## Reporting a barrier

If something in the output is hard to use with assistive technology, open an issue in the repository with the tool name and what you heard or saw. Barriers are treated as bugs.
