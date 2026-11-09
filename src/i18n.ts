// German versions of the most common error messages. Errors are raised in English everywhere and translated
// only where a tool hands them to the user, so code that matches on the English text keeps working.

export type MessageLang = "en" | "de";

/** DATEV_MCP_LANG=de switches error messages to German. Anything else, or nothing, keeps English. */
export function messageLang(env: Record<string, string | undefined> = process.env): MessageLang {
  return env.DATEV_MCP_LANG?.trim().toLowerCase() === "de" ? "de" : "en";
}

const WHEN: Record<string, string> = {
  "while getting a DATEV access token": "beim Abrufen des DATEV-Zugriffstokens",
  "while waiting to retry": "beim Warten auf den nächsten Versuch",
  "while waiting for DATEV to answer": "beim Warten auf die Antwort von DATEV",
  "while reading DATEV's answer": "beim Lesen der Antwort von DATEV",
};

// The reasons src/auth/session.ts gives for a needed login.
const LOGIN_REASON: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^no saved session$/, () => "keine gespeicherte Sitzung"],
  [/^saved session belongs to a different DATEV app$/, () => "die gespeicherte Sitzung gehört zu einer anderen DATEV-App"],
  [/^session expired and has no refresh token$/, () => "die Sitzung ist abgelaufen und enthält kein Refresh-Token"],
  [/^DATEV no longer accepts the saved session \(([^)]*)\)$/, (m) => `DATEV akzeptiert die gespeicherte Sitzung nicht mehr (${m[1]})`],
];

const TARGET: Record<string, string> = { "the chart of accounts": "den Kontenplan" };

const FIXED: Record<string, string> = {
  "Show the preview first: call without confirm, then call again with confirm: true and the confirm_token it returned.":
    "Zeigen Sie zuerst die Vorschau. Rufen Sie das Werkzeug ohne confirm auf und danach erneut mit confirm: true und dem confirm_token aus der Antwort.",
  "The confirm_token is malformed. Request a new preview.": "Der confirm_token hat ein ungültiges Format. Fordern Sie eine neue Vorschau an.",
  "The confirm_token expired. Request a new preview.": "Der confirm_token ist abgelaufen. Fordern Sie eine neue Vorschau an.",
  "The confirm_token does not match this request. Something changed since the preview, so request a new one.":
    "Der confirm_token passt nicht zu dieser Anfrage. Seit der Vorschau hat sich etwas geändert, fordern Sie daher eine neue an.",
  "The confirm_token was already used. Request a new preview to send this again.":
    "Der confirm_token wurde bereits verwendet. Fordern Sie eine neue Vorschau an, um die Anfrage erneut zu senden.",
  "Too many confirmations in the last 15 minutes. Wait and request a new preview.":
    "Zu viele Bestätigungen in den letzten 15 Minuten. Warten Sie und fordern Sie dann eine neue Vorschau an.",
  "This write needs your approval in the client, but this MCP client cannot ask you (no elicitation support). Use a client that supports it, or set DATEV_MCP_CONFIRM=token to let the preview's confirm code approve writes.":
    "Dieser Schreibvorgang braucht Ihre Freigabe im Client, aber dieser MCP-Client kann Sie nicht fragen (keine Unterstützung für Rückfragen). Nutzen Sie einen Client, der das kann, oder setzen Sie DATEV_MCP_CONFIRM=token, damit der Bestätigungscode der Vorschau Schreibvorgänge freigibt.",
  "You did not approve this write. Nothing was sent.": "Sie haben diesen Schreibvorgang nicht freigegeben. Es wurde nichts gesendet.",
  "There is no saved DATEV connection.": "Es gibt keine gespeicherte DATEV-Verbindung.",
  "DATEV returned no ID token for this login, so it cannot be checked. Nothing was saved.":
    "DATEV hat für diese Anmeldung kein ID-Token geliefert, daher kann sie nicht geprüft werden. Es wurde nichts gespeichert.",
  "DATEV's userinfo names a different user than the ID token. Nothing was saved.":
    "Die Benutzerinformationen von DATEV nennen einen anderen Benutzer als das ID-Token. Es wurde nichts gespeichert.",
};

// Reasons the ID token check gives, after "failed the ID token check: ".
const ID_REASON: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^the (.+) is missing$/, (m) => `Teil "${m[1]}" fehlt`],
  [/^the (.+) is not valid JSON$/, (m) => `Teil "${m[1]}" ist kein gültiges JSON`],
  [/^DATEV's signing keys could not be loaded \(([\s\S]*)\)$/, (m) => `die Signaturschlüssel von DATEV konnten nicht geladen werden (${m[1]})`],
  [/^DATEV's signing keys answered HTTP (\d{3})$/, (m) => `die Signaturschlüssel von DATEV antworteten mit HTTP ${m[1]}`],
  [/^no DATEV signing key with id "([^"]*)"$/, (m) => `kein DATEV-Signaturschlüssel mit der Kennung "${m[1]}"`],
  [/^it is not a signed JWT$/, () => "es ist kein signiertes JWT"],
  [/^unexpected signature algorithm "([^"]*)"$/, (m) => `unerwarteter Signaturalgorithmus "${m[1]}"`],
  [/^the header names no signing key$/, () => "der Header nennt keinen Signaturschlüssel"],
  [/^the signature does not match DATEV's key$/, () => "die Signatur passt nicht zum Schlüssel von DATEV"],
  [/^issuer "([^"]*)" is not "([^"]*)"$/, (m) => `Aussteller "${m[1]}" ist nicht "${m[2]}"`],
  [/^the token was issued for a different app$/, () => "das Token wurde für eine andere App ausgestellt"],
  [/^the authorized party is a different app$/, () => "die autorisierte Partei ist eine andere App"],
  [/^it has expired$/, () => "es ist abgelaufen"],
  [/^it was issued in the future$/, () => "es wurde in der Zukunft ausgestellt"],
  [/^it is not valid yet$/, () => "es ist noch nicht gültig"],
  [/^the nonce does not match this login$/, () => "die Nonce passt nicht zu dieser Anmeldung"],
  [/^it names no user$/, () => "es nennt keinen Benutzer"],
];

function idReason(reason: string): string {
  for (const [re, to] of ID_REASON) {
    const m = reason.match(re);
    if (m) return to(m);
  }
  return reason;
}

/** German for a DATEV problem detail's trailing "Help: <url>" and request id. */
function problemTail(tail: string): string {
  return tail.replace(/\. Help: (\S+)/, ". Hilfe: $1").replace(/\(request id ([^)]*)\)/, "(Anfrage-ID $1)");
}

const RETRY_DE = "Versuchen Sie es erneut oder grenzen Sie die Anfrage ein.";

function loginReason(reason: string): string {
  for (const [re, to] of LOGIN_REASON) {
    const m = reason.match(re);
    if (m) return to(m);
  }
  return reason;
}

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^DATEV login needed: ([\s\S]*)\. Run "datev-mcp login"\.$/, (m) => `DATEV-Anmeldung nötig, ${loginReason(m[1])}. Führen Sie "datev-mcp login" aus.`],
  [/^Ran out of time before DATEV answered\. Try again, or narrow the request\.$/, () => `Die Zeit ist abgelaufen, bevor DATEV geantwortet hat. ${RETRY_DE}`],
  [/^Ran out of time (while [^.]+)\. Try again, or narrow the request\.$/, (m) => (WHEN[m[1]] ? `Die Zeit ist ${WHEN[m[1]]} abgelaufen. ${RETRY_DE}` : m[0])],
  [/^Unknown operation "([\s\S]*)"\. Use datev_search_operations first\.$/, (m) => `Unbekannte Operation "${m[1]}". Suchen Sie sie zuerst mit datev_search_operations.`],
  [
    /^DATEV returned HTTP (\d{3}) for (.+?): ([\s\S]*)$/,
    (m) => `DATEV hat die Anfrage für ${TARGET[m[2]] ?? `die Operation "${m[2]}"`} mit HTTP ${m[1]} beantwortet: ${problemTail(m[3])}`,
  ],
  [/^The DATEV login answer failed the ID token check: ([\s\S]*)$/, (m) => `Die Anmeldeantwort von DATEV hat die ID-Token-Prüfung nicht bestanden, ${idReason(m[1])}.`],
  [
    /^The approval could not be asked \(([\s\S]*)\)\. Nothing was sent\.$/,
    (m) => `Die Freigabe konnte nicht abgefragt werden (${m[1]}). Es wurde nichts gesendet.`,
  ],
  [
    /^DATEV asked to pause requests to this service until (\d{2}:\d{2}:\d{2}) UTC\. Try again after that\.$/,
    (m) => `DATEV hat gebeten, Anfragen an diesen Dienst bis ${m[1]} UTC zu pausieren. Versuchen Sie es danach erneut.`,
  ],
  [
    /^(\S+) needs the scope ([^,]+(?:, [^,]+)*), which is not part of the connected data services\. Run "datev-mcp login --services \.\.\." with the data service it belongs to\.$/,
    (m) => `${m[1]} braucht den Scope ${m[2]}, der nicht zu den verbundenen Datenservices gehört. Führen Sie "datev-mcp login --services ..." mit dem zugehörigen Datenservice aus.`,
  ],
  [
    /^(\S+) needs the (\S+) header\. Set (\S+) in the server's environment; it is never passed through the assistant\.$/,
    (m) => `${m[1]} braucht den Header ${m[2]}. Setzen Sie ${m[3]} in der Umgebung des Servers; er wird nie über den Assistenten weitergegeben.`,
  ],
  [
    /^The connection was NOT removed: ([\s\S]*)\. Try again, or remove it at (\S+) and then run "datev-mcp disconnect --local-only"\.$/,
    (m) => `Die Verbindung wurde NICHT entfernt: ${m[1]}. Versuchen Sie es erneut oder entfernen Sie sie unter ${m[2]} und führen Sie danach "datev-mcp disconnect --local-only" aus.`,
  ],
  [
    /^DATEV refused to revoke the (refresh|access) token \(HTTP (\d{3})\)$/,
    (m) => `DATEV hat das Widerrufen des ${m[1] === "refresh" ? "Refresh-Tokens" : "Zugriffstokens"} abgelehnt (HTTP ${m[2]})`,
  ],
  [
    /^Could not reach DATEV to revoke the (refresh|access) token: ([\s\S]*)$/,
    (m) => `DATEV war zum Widerrufen des ${m[1] === "refresh" ? "Refresh-Tokens" : "Zugriffstokens"} nicht erreichbar: ${m[2]}`,
  ],
  [
    /^The DATEV session is encrypted, but its key is missing from the (.+)\. Log in again\.$/,
    (m) => `Die DATEV-Sitzung ist verschlüsselt, aber ihr Schlüssel fehlt im Speicher "${m[1]}". Melden Sie sich erneut an.`,
  ],
  [/^Choose at least one DATEV data service\. ([\s\S]*)$/, (m) => `Wählen Sie mindestens einen DATEV-Datenservice. ${servicesTail(m[1])}`],
  [
    /^Unknown data service ((?:"[^"]*"(?:, )?)+)\. ([\s\S]*)$/,
    (m) => `Unbekannter Datenservice ${m[1]}. ${servicesTail(m[2])}`,
  ],
  [
    /^Choose the DATEV data services to connect: "([^"]+)"\. DATEV allows only the scopes of the services you use\. ([\s\S]*)$/,
    (m) => `Wählen Sie die DATEV-Datenservices, die verbunden werden sollen, zum Beispiel "${m[1]}". DATEV erlaubt nur die Scopes der Services, die Sie nutzen. ${servicesTail(m[2])}`,
  ],
];

function servicesTail(tail: string): string {
  return tail.replace(/^Available, as --services a,b,c: /, "Verfügbar, als --services a,b,c: ");
}

export function localize(message: string, lang: MessageLang = messageLang()): string {
  if (lang === "en") return message;
  if (FIXED[message]) return FIXED[message];
  for (const [re, to] of PATTERNS) {
    const m = message.match(re);
    if (m) return to(m);
  }
  return message;
}
