// German versions of the most common error messages. Errors are raised in English everywhere and translated
// only where a tool hands them to the user, so code that matches on the English text keeps working.

export type MessageLang = "en" | "de";

/** DATEV_MCP_LANG=de switches error messages to German. Anything else, or nothing, keeps English. */
export function messageLang(env: Record<string, string | undefined> = process.env): MessageLang {
  return env.DATEV_MCP_LANG?.trim().toLowerCase() === "de" ? "de" : "en";
}

const WHEN: Record<string, string> = {
  "before DATEV answered": "bevor DATEV geantwortet hat",
  "while getting a DATEV access token": "beim Abrufen des DATEV-Zugriffstokens",
  "while waiting to retry": "beim Warten auf den nächsten Versuch",
  "while waiting for DATEV to answer": "beim Warten auf die Antwort von DATEV",
  "while reading DATEV's answer": "beim Lesen der Antwort von DATEV",
};

const TARGET: Record<string, string> = { "the chart of accounts": "den Kontenrahmen" };

const FIXED: Record<string, string> = {
  "Show the preview first: call without confirm, then call again with confirm: true and the confirm_token it returned.":
    "Zuerst die Vorschau zeigen. Rufen Sie das Werkzeug ohne confirm auf und danach erneut mit confirm: true und dem confirm_token aus der Antwort.",
  "The confirm_token is malformed. Request a new preview.": "Der confirm_token ist ungültig. Fordern Sie eine neue Vorschau an.",
  "The confirm_token expired. Request a new preview.": "Der confirm_token ist abgelaufen. Fordern Sie eine neue Vorschau an.",
  "The confirm_token does not match this request. Something changed since the preview, so request a new one.":
    "Der confirm_token passt nicht zu dieser Anfrage. Seit der Vorschau hat sich etwas geändert, fordern Sie daher eine neue an.",
  "The confirm_token was already used. Request a new preview to send this again.":
    "Der confirm_token wurde bereits verwendet. Fordern Sie eine neue Vorschau an, um die Anfrage erneut zu senden.",
  "Too many confirmations in the last 15 minutes. Wait and request a new preview.":
    "Zu viele Bestätigungen in den letzten 15 Minuten. Warten Sie und fordern Sie dann eine neue Vorschau an.",
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^DATEV login needed: ([\s\S]*)\. Run "datev-mcp login"\.$/, (m) => `DATEV-Anmeldung nötig (${m[1]}). Führen Sie "datev-mcp login" aus.`],
  [
    /^Ran out of time (before DATEV answered|while [^.]+)\. Try again, or narrow the request\.$/,
    (m) => `Die Zeit ist abgelaufen, ${WHEN[m[1]] ?? m[1]}. Versuchen Sie es erneut oder grenzen Sie die Anfrage ein.`,
  ],
  [/^Unknown operation "([^"]*)"\. Use datev_search_operations first\.$/, (m) => `Unbekannte Operation "${m[1]}". Suchen Sie sie zuerst mit datev_search_operations.`],
  [/^DATEV returned HTTP (\d{3}) for (.+?): ([\s\S]*)$/, (m) => `DATEV hat ${TARGET[m[2]] ?? m[2]} mit HTTP ${m[1]} beantwortet: ${m[3]}`],
];

export function localize(message: string, lang: MessageLang = messageLang()): string {
  if (lang === "en") return message;
  if (FIXED[message]) return FIXED[message];
  for (const [re, to] of PATTERNS) {
    const m = message.match(re);
    if (m) return to(m);
  }
  return message;
}
