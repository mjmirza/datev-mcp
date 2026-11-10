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
  [/^the connection was ended here and is not used again; DATEV has not confirmed every revoke yet$/, () => "die Verbindung wurde hier beendet und wird nicht mehr genutzt; DATEV hat noch nicht jeden Widerruf bestätigt"],
  [/^the connection was ended here and is not used again; DATEV confirmed every revoke$/, () => "die Verbindung wurde hier beendet und wird nicht mehr genutzt; DATEV hat jeden Widerruf bestätigt"],
  [/^the connection was ended here and is not used again; the tokens DATEV did not confirm as revoked have expired$/, () => "die Verbindung wurde hier beendet und wird nicht mehr genutzt; die von DATEV nicht als widerrufen bestätigten Tokens sind abgelaufen"],
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
  "This write needs your approval in the client, but this MCP client cannot ask you (no elicitation support). Use a client that supports it, or set DATEV_MCP_CONFIRM=token to let the preview's confirm code approve sandbox writes.":
    "Dieser Schreibvorgang braucht Ihre Freigabe im Client, aber dieser MCP-Client kann Sie nicht fragen (keine Unterstützung für Rückfragen). Nutzen Sie einen Client, der das kann, oder setzen Sie DATEV_MCP_CONFIRM=token, damit der Bestätigungscode der Vorschau Schreibvorgänge in der Sandbox freigibt.",
  "This write to DATEV production needs your approval in the client, but this MCP client cannot ask you (no elicitation support). Nothing was sent. Use a client that supports it.":
    "Dieser Schreibvorgang in die DATEV-Produktion braucht Ihre Freigabe im Client, aber dieser MCP-Client kann Sie nicht fragen (keine Unterstützung für Rückfragen). Es wurde nichts gesendet. Nutzen Sie einen Client, der das kann.",
  "You did not approve this write. Nothing was sent.": "Sie haben diesen Schreibvorgang nicht freigegeben. Es wurde nichts gesendet.",
  "There is no saved DATEV connection.": "Es gibt keine gespeicherte DATEV-Verbindung.",
  "There is no saved DATEV connection. Connected apps are listed at https://apps.datev.de/tokrevui.": "Es gibt keine gespeicherte DATEV-Verbindung. Verbundene Anwendungen sehen Sie unter https://apps.datev.de/tokrevui.",
  "DATEV returned no ID token for this login, so it cannot be checked. Nothing was saved.":
    "DATEV hat für diese Anmeldung kein ID-Token geliefert, daher kann sie nicht geprüft werden. Es wurde nichts gespeichert.",
  "DATEV's userinfo gives no full name for this user, and DATEV requires apps to show it. Nothing was saved.":
    "Die Benutzerinformationen von DATEV enthalten keinen vollständigen Namen, den DATEV in der App verlangt. Es wurde nichts gespeichert.",
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
    /^(\S+) belongs to (\S+), which is not part of the connected data services\. Run "datev-mcp login --services \.\.\." with (\S+) added\.$/,
    (m) => `${m[1]} gehört zu ${m[2]}, das nicht zu den verbundenen Datenservices gehört. Führen Sie "datev-mcp login --services ..." mit ${m[3]} aus.`,
  ],
  [
    /^(\S+) needs the (\S+) header\. Set (\S+) in the server's environment; it is never passed through the assistant\.$/,
    (m) => `${m[1]} braucht den Header ${m[2]}. Setzen Sie ${m[3]} in der Umgebung des Servers; er wird nie über den Assistenten weitergegeben.`,
  ],
  [
    /^The connection was NOT removed: ([\s\S]*)\. It is no longer used here and is revoked again on the next call\. Try again, or remove it at (\S+) and then run "datev-mcp disconnect --local-only"\.$/,
    (m) => `Die Verbindung wurde NICHT entfernt: ${m[1]}. Sie wird hier nicht mehr genutzt und beim nächsten Aufruf erneut widerrufen. Versuchen Sie es erneut oder entfernen Sie sie unter ${m[2]} und führen Sie danach "datev-mcp disconnect --local-only" aus.`,
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
  [
    /^(\S+) needs the app's client secret, which a DATEV Public client does not have\. This API is available to Confidential clients only\.$/,
    (m) => `${m[1]} braucht das Client Secret der App, das ein DATEV Public Client nicht hat. Diese API steht nur Confidential Clients zur Verfügung.`,
  ],
  [/^(Available, as --services a,b,c: [\s\S]*)$/, (m) => servicesTail(m[1]!)],
  [/^Choose at least one DATEV data service\. ([\s\S]*)$/, (m) => `Wählen Sie mindestens einen DATEV-Datenservice. ${servicesTail(m[1])}`],
  [
    /^Unknown data service ((?:"[^"]*"(?:, )?)+)\. ([\s\S]*)$/,
    (m) => `Unbekannter Datenservice ${m[1]}. ${servicesTail(m[2])}`,
  ],
  [
    /^Choose the DATEV data services to connect: "([^"]+)"\. DATEV allows only the scopes of the services you use\. ([\s\S]*)$/,
    (m) => `Wählen Sie die DATEV-Datenservices, die verbunden werden sollen, zum Beispiel "${m[1]}". DATEV erlaubt nur die Scopes der Services, die Sie nutzen. ${servicesTail(m[2])}`,
  ],
  // The lines datev-mcp login prints.
  [/^WARNING: ([\s\S]*)$/, (m) => `WARNUNG: ${localize(m[1]!, "de")}`],
  [
    /^DATEV blocks Confidential apps with a localhost redirect in production since 01\.03\.2026\. Ask DATEV to switch this app to a Public client and remove DATEV_CLIENT_SECRET\.$/,
    () => "DATEV sperrt seit dem 01.03.2026 Confidential Apps mit localhost-Weiterleitung in der Produktion. Lassen Sie die App bei DATEV auf einen Public Client umstellen und entfernen Sie DATEV_CLIENT_SECRET.",
  ],
  [/^Connecting these DATEV data services: ([\s\S]*)\.$/, (m) => `Diese DATEV-Datenservices werden verbunden: ${m[1]}.`],
  [
    /^Added ([\s\S]*), because DATEV requires checking the client list before any accounting data service\.$/,
    (m) => `${m[1]} wurde ergänzt, weil DATEV vor jedem Datenservice im Rechnungswesen die Prüfung der Mandantenliste verlangt.`,
  ],
  [
    /^Opening the DATEV (\S+) login in your browser\. If nothing opens, visit:\n\n {2}(\S+)\n$/,
    (m) => `Die DATEV-Anmeldung (${m[1]}) wird im Browser geöffnet. Wenn sich nichts öffnet, rufen Sie diese Adresse auf:\n\n  ${m[2]}\n`,
  ],
  [/^The refresh token of the previous login was revoked at DATEV\.$/, () => "Das Refresh-Token der vorherigen Anmeldung wurde bei DATEV widerrufen."],
  [
    /^(\d+) earlier refresh token\(s\) could not be revoked yet\. Every "datev-mcp status" and server start retries\. To end it now, remove the old connection at (\S+)\.$/,
    (m) => `${m[1]} frühere(s) Refresh-Token konnte(n) noch nicht widerrufen werden. Jedes "datev-mcp status" und jeder Serverstart versucht es erneut. Um es sofort zu beenden, entfernen Sie die alte Verbindung unter ${m[2]}.`,
  ],
  [
    /^Connected to DATEV (\S+) as ([\s\S]+)\. The connection is valid until (\d{2}\.\d{2}\.\d{4} \d{2}:\d{2})\.$/,
    (m) => `Mit DATEV ${m[1]} verbunden als ${m[2]}. Die Verbindung gilt bis ${m[3]}.`,
  ],
  [
    /^Session saved encrypted to (.+)\. "datev-mcp status" shows the connection, "datev-mcp disconnect" ends it\.$/,
    (m) => `Sitzung verschlüsselt gespeichert unter ${m[1]}. "datev-mcp status" zeigt die Verbindung, "datev-mcp disconnect" beendet sie.`,
  ],
  // Preview notes of the write tools. confirm and confirm_token are parameter names and stay.
  [
    /^This (\S+) changes data in DATEV (\S+)\. Nothing was sent\. Show this to the user and call again with confirm: true and the confirm_token once they agree\.$/,
    (m) => `Dieses ${m[1]} ändert Daten in DATEV ${m[2]}. Es wurde nichts gesendet. Zeigen Sie dies dem Benutzer und rufen Sie nach seiner Zustimmung erneut mit confirm: true und dem confirm_token auf.`,
  ],
  [
    /^Nothing was sent\. This uploads (.+) \((\d+) bytes, ([^)]*)\) to (.+?) of (.*) in DATEV (\S+)\. Ask the user, then call again with confirm: true and this confirm_token\.$/,
    (m) => `Es wurde nichts gesendet. Dies lädt ${m[1]} (${m[2]} Bytes, ${m[3]}) in ${m[4]} von ${who(m[5]!)} in DATEV ${m[6]} hoch. Fragen Sie den Benutzer und rufen Sie dann erneut mit confirm: true und diesem confirm_token auf.`,
  ],
  [
    /^Nothing was sent\. This imports (\d+) rows into Buchungsdatenservice of (.*) in DATEV (\S+)(, AGAIN although it was sent before)?\. Ask the user, then call again with confirm: true and this confirm_token\.$/,
    (m) => `Es wurde nichts gesendet. Dies überträgt ${m[1]} Zeilen in den Buchungsdatenservice von ${who(m[2]!)} in DATEV ${m[3]}${m[4] ? ", ERNEUT, obwohl die Datei schon gesendet wurde" : ""}. Fragen Sie den Benutzer und rufen Sie dann erneut mit confirm: true und diesem confirm_token auf.`,
  ],
  [
    /^Nothing was sent\. This sends (\d+) file\(s\) to (\S+) (\S+) in DATEV (\S+)\. Ask the user, then call again with confirm: true and this confirm_token\.$/,
    (m) => `Es wurde nichts gesendet. Dies sendet ${m[1]} Datei(en) an ${m[2]} ${m[3]} in DATEV ${m[4]}. Fragen Sie den Benutzer und rufen Sie dann erneut mit confirm: true und diesem confirm_token auf.`,
  ],
  // The details datev-mcp doctor prints.
  [/^client id (\S+), env (\S+)$/, (m) => `Client-ID ${m[1]}, Umgebung ${m[2]}`],
  [/^(\d+) operations$/, (m) => `${m[1]} Operationen`],
  [/^none, run "datev-mcp login"$/, () => 'keine, führen Sie "datev-mcp login" aus'],
  [/^valid \(refreshed if needed\)$/, () => "gültig (bei Bedarf erneuert)"],
  [/^HTTP (\d{3}), (\d+) clients$/, (m) => `HTTP ${m[1]}, ${m[2]} Mandanten`],
  [/^not connected \(no accounting service chosen at login\), not checked$/, () => "nicht verbunden (bei der Anmeldung kein Datenservice im Rechnungswesen gewählt), nicht geprüft"],
];

const CHECK_NAMES: Record<string, string> = {
  credentials: "Zugangsdaten",
  "operation index": "Operationsindex",
  "saved session": "gespeicherte Sitzung",
  "access token": "Zugriffstoken",
  userinfo: "Benutzerinformationen",
  "accounting-clients API": "accounting-clients-API",
};

// Only the final bracket describeClient appends is translated. The name before it is DATEV's text.
const who = (s: string) =>
  s
    .replace(/^unnamed client(?=(?: \((?:consultant \d+)?(?:, )?(?:client \d+)?\))?$)/, "Mandant ohne Namen")
    .replace(/ \((consultant \d+)?(, )?(client \d+)?\)$/, (all: string) => all.replace("consultant ", "Berater ").replace("client ", "Mandant "));

// Single sentences the safety refusals are built from. A message no whole-message pattern matches is
// translated sentence by sentence, so a new combination of known sentences still reaches the person in German.
const SENTENCES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Nothing was sent\.$/, () => "Es wurde nichts gesendet."],
  [
    /^Access to client (\S+) could not be confirmed for this data service \((?:its answer was cut off|DATEV answered HTTP (\d{3}))\)\.$/,
    (m) => `Der Zugriff auf den Mandanten ${m[1]} konnte für diesen Datenservice nicht bestätigt werden (${m[2] ? `DATEV antwortete mit HTTP ${m[2]}` : "die Antwort war abgeschnitten"}).`,
  ],
  [
    /^Please check the consultant and client number, or ask your administrator whether the data service is ordered and switched on at DATEV, see (\S+?)\.$/,
    (m) => `Bitte prüfen Sie Berater- und Mandantennummer oder fragen Sie Ihre Administration, ob der Datenservice bei DATEV bestellt und freigeschaltet ist, siehe ${m[1]}.`,
  ],
  [/^DATEV may already have applied this change, so check in DATEV before sending it again\.$/, () => "DATEV hat diese Änderung möglicherweise schon übernommen. Prüfen Sie das in DATEV, bevor Sie sie erneut senden."],
  [/^DATEV answered HTTP (\d{3}) \(a redirect\), which this server does not follow\.$/, (m) => `DATEV antwortete mit HTTP ${m[1]} (einer Weiterleitung), der dieser Server nicht folgt.`],
  [/^Nothing was read\.$/, () => "Es wurde nichts gelesen."],
  [/^Nothing was saved\.$/, () => "Es wurde nichts gespeichert."],
  [/^The file is larger than (\d+) bytes and was not read completely\.$/, (m) => `Die Datei ist größer als ${m[1]} Bytes und wurde nicht vollständig gelesen.`],
  [/^Binary answer too large to show\.$/, () => "Die binäre Antwort ist zu groß zum Anzeigen."],
  [/^Call again with save_to to store it as a file\.$/, () => "Rufen Sie erneut mit save_to auf, um sie als Datei zu speichern."],
  [/^The call was cancelled before DATEV was asked\.?$/, () => "Der Aufruf wurde abgebrochen, bevor DATEV gefragt wurde."],
  [/^The call was cancelled\.?$/, () => "Der Aufruf wurde abgebrochen."],
  [/^DATEV did not answer: ([\s\S]*)$/, (m) => `DATEV hat nicht geantwortet: ${m[1]}`],
  [/^DATEV's answer broke off: ([\s\S]*)$/, (m) => `Die Antwort von DATEV brach ab: ${m[1]}`],
  [/^Ran out of time while waiting for DATEV to answer\.$/, () => "Die Zeit beim Warten auf die Antwort von DATEV ist abgelaufen."],
  [/^Ran out of time while reading DATEV's answer\.$/, () => "Die Zeit beim Lesen der Antwort von DATEV ist abgelaufen."],
  [/^Try again, or narrow the request\.$/, () => "Versuchen Sie es erneut oder grenzen Sie die Anfrage ein."],
  [/^DATEV accepted the file, but asking for the result stopped \(([\s\S]*)\)\.$/, (m) => `DATEV hat die Datei angenommen, aber die Abfrage des Ergebnisses brach ab (${localize(m[1]!, "de")}).`],
  [/^Check with datev_extf_job \(client_id (\S+), job_id (\S+)\)\.$/, (m) => `Prüfen Sie das Ergebnis mit datev_extf_job (client_id ${m[1]}, job_id ${m[2]}).`],
  [/^Do not send the file again\.$/, () => "Senden Sie die Datei nicht erneut."],
  [/^Nothing was sent again\.$/, () => "Es wurde nichts erneut gesendet."],
  [/^Nothing was requested\.$/, () => "Es wurde nichts angefordert."],
  [/^Try again later\.$/, () => "Versuchen Sie es später erneut."],
  [/^DATEV could not confirm the client's data services right now \(HTTP (\d{3})\)\.$/, (m) => `DATEV konnte die Datenservices des Mandanten gerade nicht bestätigen (HTTP ${m[1]}).`],
  [/^DATEV answered HTTP (\d{3}) for this client\.$/, (m) => `DATEV hat für diesen Mandanten mit HTTP ${m[1]} geantwortet.`],
  [/^(.+) has not switched on (.+)\.$/, (m) => `${m[1] === "This client" ? "Dieser Mandant" : m[1]} hat ${m[2]!.replace(/ or /g, " oder ")} nicht freigeschaltet.`],
  [/^The client or their tax advisor switches the data service on at DATEV, see (\S+?)\.$/, (m) => `Der Mandant oder die Kanzlei schaltet den Datenservice bei DATEV frei, siehe ${m[1]}.`],
  [/^As DATEV requires, the connection was ended and both tokens revoked; sign in again after the service is switched on\.$/, () => "Wie von DATEV verlangt, wurde die Verbindung beendet und beide Tokens widerrufen. Melden Sie sich erneut an, sobald der Datenservice freigeschaltet ist."],
  [/^The connection was ended here, but DATEV did not confirm revoking it, so it is revoked again on the next call\.$/, () => "Die Verbindung wurde hier beendet, aber DATEV hat den Widerruf nicht bestätigt. Er wird beim nächsten Aufruf wiederholt."],
  [/^It can also be removed at (\S+?)\.$/, (m) => `Sie kann auch unter ${m[1]} entfernt werden.`],
  [/^The connection was ended, but DATEV did not confirm revoking the access token \(([\s\S]*)\); it can no longer be renewed and expires at (\d{2}:\d{2}) UTC\.$/, (m) => `Die Verbindung wurde beendet, aber DATEV hat den Widerruf des Zugriffstokens nicht bestätigt (${m[1]}). Es kann nicht mehr erneuert werden und läuft um ${m[2]} UTC ab.`],
  [/^There was no saved connection to end\.$/, () => "Es gab keine gespeicherte Verbindung zu beenden."],
  [/^A newer login replaced the refused connection, so it was kept\.$/, () => "Eine neuere Anmeldung hat die abgelehnte Verbindung ersetzt, sie wurde daher behalten."],
  [/^The local session was deleted\.$/, () => "Die lokale Sitzung wurde gelöscht."],
  [/^Check (\S+) that the app no longer appears there\.$/, (m) => `Prüfen Sie unter ${m[1]}, dass die App dort nicht mehr erscheint.`],
  [/^(\d+) token\(s\) of another DATEV app registration could not be revoked here, so remove that app at (\S+?)\.$/, (m) => `${m[1]} Token(s) einer anderen DATEV-App-Registrierung konnten hier nicht widerrufen werden, entfernen Sie diese App daher unter ${m[2]}.`],
  [/^Ending the connection failed \(([\s\S]*)\)\.$/, (m) => `Das Beenden der Verbindung ist fehlgeschlagen (${m[1]}).`],
  [/^(\S+) names its client by GUID, which this server cannot check\.$/, (m) => `${m[1]} nennt den Mandanten per GUID, die dieser Server nicht prüfen kann.`],
  [/^DATEV's client list could not be read \(HTTP (\d{3})\), so the client was not checked\.$/, (m) => `Die Mandantenliste von DATEV konnte nicht gelesen werden (HTTP ${m[1]}), daher wurde der Mandant nicht geprüft.`],
  [/^The client (\S+) is not in this login's DATEV client list\.$/, (m) => `Der Mandant ${m[1]} ist nicht in der DATEV-Mandantenliste dieser Anmeldung.`],
  [/^Please check it, or ask your administrator whether the data service is switched on, see (\S+?)\.$/, (m) => `Bitte prüfen Sie ihn oder fragen Sie Ihre Administration, ob der Datenservice freigeschaltet ist, siehe ${m[1]}.`],
  [/^(\S+) names its client as (.+), which this server cannot check against DATEV's permission\.$/, (m) => `${m[1]} nennt den Mandanten als ${m[2]}, was dieser Server nicht gegen die Freigabe bei DATEV prüfen kann.`],
  [/^"(.+)" is not a consultant-client number such as 455148-1\.$/, (m) => `"${m[1]}" ist keine Berater-Mandanten-Nummer wie 455148-1.`],
  [/^DATEV names a different GUID for client (\S+) than (\S+)\.$/, (m) => `DATEV nennt für den Mandanten ${m[1]} eine andere GUID als ${m[2]}.`],
  [/^This client does not grant the report types (.+)\.$/, (m) => `Dieser Mandant gibt die Auswertungsarten ${m[1]} nicht frei.`],
  [/^Granted: (.+)\.$/, (m) => `Freigegeben: ${m[1] === "none" ? "keine" : m[1]}.`],
  [/^Belegbilderservice does not take category, folder or register\.$/, () => "Der Belegbilderservice nimmt keine Kategorie, keinen Ordner und kein Register an."],
  [/^Leave them out, or use service buchungsdatenservice\.$/, () => "Lassen Sie sie weg oder nutzen Sie service buchungsdatenservice."],
  [/^Buchungsdatenservice needs category, folder and register for every document\.$/, () => "Der Buchungsdatenservice braucht für jedes Dokument Kategorie, Ordner und Register."],
  [/^Buchungsdatenservice needs category, folder and register together\.$/, () => "Der Buchungsdatenservice braucht Kategorie, Ordner und Register zusammen."],
  [/^Belegbilderservice needs a document_type for every document\.$/, () => "Der Belegbilderservice braucht für jedes Dokument einen document_type."],
  [/^Belegbilderservice needs a document_type in metadata\.$/, () => "Der Belegbilderservice braucht einen document_type in metadata."],
  [/^List them with datev_document_types\.$/, () => "Sie stehen in datev_document_types."],
  [/^"(.+)" is not a document type of this client\.$/, (m) => `"${m[1]}" ist kein Belegtyp dieses Mandanten.`],
  [/^Available: (.+)\.$/, (m) => `Verfügbar: ${m[1] === "none" ? "keine" : m[1]}.`],
  [/^The record of earlier sends cannot be read \(([\s\S]*)\)\.$/, (m) => `Der Nachweis früherer Sendungen kann nicht gelesen werden (${m[1]}).`],
  [/^Nothing was sent, so booking data cannot go out twice by accident\.$/, () => "Es wurde nichts gesendet, damit Buchungsdaten nicht versehentlich doppelt übertragen werden."],
  [/^The record of earlier sends at (.+) is damaged\.$/, (m) => `Der Nachweis früherer Sendungen unter ${m[1]} ist beschädigt.`],
  [/^Check or move the file, then try again\.$/, () => "Prüfen oder verschieben Sie die Datei und versuchen Sie es dann erneut."],
  [/^This file is being sent to this client right now \(started (\S+)\)\.$/, (m) => `Diese Datei wird gerade an diesen Mandanten gesendet (begonnen ${m[1]}).`],
  [/^Wait for that send to finish\.$/, () => "Warten Sie, bis diese Sendung abgeschlossen ist."],
  [/^DATEV already accepted it on (\S+)(?: \(job (\S+)\))?\.$/, (m) => `DATEV hat sie bereits am ${m[1]} angenommen${m[2] ? ` (Job ${m[2]})` : ""}.`],
  [/^This file was being sent to this client on (\S+) \((.+)\) and DATEV's answer was lost or was a server error, so it may already be imported\.$/, (m) => `Diese Datei wurde am ${m[1]} (${m[2]}) an diesen Mandanten gesendet, und die Antwort von DATEV ging verloren oder war ein Serverfehler. Sie ist daher möglicherweise schon übernommen.`],
  [/^Check the batch in DATEV Rechnungswesen; to send it again on purpose, call with resend: true\.$/, () => "Prüfen Sie den Stapel in DATEV Rechnungswesen. Um sie bewusst erneut zu senden, rufen Sie mit resend: true auf."],
  [/^This file was already sent to this client on (\S+) \((.+)\)\.$/, (m) => `Diese Datei wurde bereits am ${m[1]} (${m[2]!.replace(/\bjob /, "Job ")}) an diesen Mandanten gesendet.`],
  [/^DATEV requires booking data to be sent only once\.$/, () => "DATEV verlangt, dass Buchungsdaten nur einmal gesendet werden."],
  [/^To send it again on purpose, call with resend: true\.$/, () => "Um sie bewusst erneut zu senden, rufen Sie mit resend: true auf."],
  [/^These files were already sent to this client on (\S+) \((.+)\)\.$/, (m) => `Diese Dateien wurden bereits am ${m[1]} (${m[2]}) an diesen Mandanten gesendet.`],
  [/^DATEV cannot tell a repeat of a stapled upload apart, so it would keep two copies\.$/, () => "DATEV kann eine Wiederholung eines gehefteten Uploads nicht erkennen und würde zwei Kopien behalten."],
  [/^To send them again on purpose, call with resend: true\.$/, () => "Um sie bewusst erneut zu senden, rufen Sie mit resend: true auf."],
  [/^These files are being sent or were just sent to this client \((.+)\)\.$/, (m) => `Diese Dateien werden gerade an diesen Mandanten gesendet oder wurden eben gesendet (${m[1]}).`],
];

/** Splits after a period followed by whitespace, never inside brackets, a URL or a version number. */
function sentencesOf(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "." && depth === 0 && /\s/.test(s[i + 1] ?? "")) {
      out.push(s.slice(start, i + 1));
      while (/\s/.test(s[i + 1] ?? "")) i++;
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  // A bracket that never closes would hide every later sentence, so such a text is split the plain way.
  return depth > 0 ? s.split(/(?<=\.)\s+/) : out;
}

function bySentence(message: string): string {
  const parts = sentencesOf(message.trim());
  if (parts.length < 2 && !SENTENCES.some(([re]) => re.test(message.trim()))) return message;
  const out = parts.map((p) => {
    for (const [re, to] of SENTENCES) {
      const m = p.match(re);
      if (m) return to(m);
    }
    return p;
  });
  return (message.startsWith(" ") ? " " : "") + out.join(" ");
}

// The summary lines of an approval dialog. Methods, operation ids and URLs stay as they are.
const APPROVAL: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Client: (.*)$/, (m) => `Mandant: ${who(m[1]!)}`],
  [/^Upload (.+) \((\d+) bytes(?:, ([^)]*))?\) to (.+?) of (.*)$/, (m) => `${m[1]} (${m[2]} Bytes${m[3] ? `, ${m[3]}` : ""}) hochladen in ${m[4]} von ${who(m[5]!)}`],
  [/^Import (\d+) booking rows from (.+) into Buchungsdatenservice of (.*?)( \(sent again\))?$/, (m) => `${m[1]} Buchungszeilen aus ${m[2]} in den Buchungsdatenservice von ${who(m[3]!)} übertragen${m[4] ? " (erneut gesendet)" : ""}`],
  [/^file (\S+): (.+) \((\d+) bytes, ([^)]*)\)$/, (m) => `Datei ${m[1]}: ${m[2]} (${m[3]} Bytes, ${m[4]})`],
  [/^(ids|query|headers|fields|body): ([\s\S]*)$/, (m) => `${{ ids: "IDs", query: "Abfrage", headers: "Header", fields: "Felder", body: "Inhalt" }[m[1]!]}: ${m[2]}`],
];

/** An approval summary in the chosen language, line by line. */
export function localizeApproval(summary: string, lang: MessageLang = messageLang()): string {
  if (lang === "en") return summary;
  return summary
    .split("\n")
    .map((line) => {
      for (const [re, to] of APPROVAL) {
        const m = line.match(re);
        if (m) return to(m);
      }
      return line;
    })
    .join("\n");
}

export type CallbackOutcome = "done" | "failed" | "no-code" | "mismatch";

interface CallbackPageText {
  title: string;
  status: string;
  lead: string;
  where: string;
  answerLabel: string;
  next: string;
}

interface CallbackWords {
  answerLabel: string;
  retry: string;
  where: (port: number) => string;
  pages: Record<CallbackOutcome, { title: string; status: string; lead: string; next?: string }>;
  oauthErrors: Record<string, string>;
}

const CALLBACK_TEXT: Record<MessageLang, CallbackWords> = {
  en: {
    answerLabel: "DATEV answered with",
    retry: "Close this tab and run this command in your terminal again.",
    where: (port) => `local sign-in on port ${port}`,
    pages: {
      done: { title: "DATEV login complete", status: "Signed in", lead: "You are signed in to DATEV.", next: "You can close this tab and return to your terminal." },
      failed: { title: "DATEV login failed", status: "Sign-in failed", lead: "DATEV did not complete the login." },
      "no-code": { title: "DATEV login failed", status: "Sign-in failed", lead: "DATEV sent back no login code." },
      mismatch: { title: "Login not accepted", status: "Not accepted", lead: "The answer that reached this page does not belong to this login attempt, so it was not used." },
    },
    oauthErrors: {
      access_denied: "You cancelled the consent at DATEV, or this account cannot grant the requested data services.",
      invalid_scope: "DATEV did not accept one of the requested data services for this client.",
      invalid_request: "DATEV rejected the login request as incomplete or malformed.",
      unauthorized_client: "This client is not allowed to sign in this way at DATEV. Check the client ID and its settings in the DATEV developer portal.",
      server_error: "DATEV hit an internal error during the login. Try again in a moment.",
      temporarily_unavailable: "The DATEV login service is busy or under maintenance right now. Try again later.",
      consent_required: "DATEV needs your consent before it can sign you in.",
      login_required: "DATEV needs you to sign in again before it can continue.",
    },
  },
  de: {
    answerLabel: "DATEV antwortete mit",
    retry: "Schließen Sie diesen Tab und führen Sie diesen Befehl im Terminal erneut aus.",
    where: (port) => `lokale Anmeldung über Port ${port}`,
    pages: {
      done: { title: "DATEV-Anmeldung abgeschlossen", status: "Angemeldet", lead: "Sie sind bei DATEV angemeldet.", next: "Sie können diesen Tab schließen und zum Terminal zurückkehren." },
      failed: { title: "DATEV-Anmeldung fehlgeschlagen", status: "Anmeldung fehlgeschlagen", lead: "DATEV hat die Anmeldung nicht abgeschlossen." },
      "no-code": { title: "DATEV-Anmeldung fehlgeschlagen", status: "Anmeldung fehlgeschlagen", lead: "DATEV hat keinen Anmeldecode zurückgegeben." },
      mismatch: { title: "Anmeldung nicht angenommen", status: "Nicht angenommen", lead: "Die Antwort auf dieser Seite gehört nicht zu diesem Anmeldeversuch und wurde daher nicht verwendet." },
    },
    oauthErrors: {
      access_denied: "Sie haben die Zustimmung bei DATEV abgebrochen, oder dieses Konto kann die angefragten Datenservices nicht freigeben.",
      invalid_scope: "DATEV hat einen der angefragten Datenservices für diesen Client nicht akzeptiert.",
      invalid_request: "DATEV hat die Anmeldeanfrage als unvollständig oder fehlerhaft abgelehnt.",
      unauthorized_client: "Dieser Client darf sich auf diesem Weg nicht bei DATEV anmelden. Prüfen Sie die Client-ID und ihre Einstellungen im DATEV-Entwicklerportal.",
      server_error: "Bei DATEV ist während der Anmeldung ein interner Fehler aufgetreten. Versuchen Sie es gleich noch einmal.",
      temporarily_unavailable: "Der Anmeldedienst von DATEV ist gerade ausgelastet oder in Wartung. Versuchen Sie es später erneut.",
      consent_required: "DATEV benötigt Ihre Zustimmung, bevor die Anmeldung möglich ist.",
      login_required: "DATEV verlangt eine erneute Anmeldung, bevor es weitergehen kann.",
    },
  },
};

/** The words on the browser page the login redirect lands on. A known OAuth error code gets its own plain sentence. */
export function callbackPageText(outcome: CallbackOutcome, lang: MessageLang = messageLang(), opts: { port?: number; error?: string } = {}): CallbackPageText {
  const t = CALLBACK_TEXT[lang];
  const o = t.pages[outcome];
  const known = opts.error !== undefined && Object.hasOwn(t.oauthErrors, opts.error) ? t.oauthErrors[opts.error] : undefined;
  return {
    title: o.title,
    status: o.status,
    lead: outcome === "failed" && known ? known : o.lead,
    where: t.where(opts.port ?? 0),
    answerLabel: t.answerLabel,
    next: o.next ?? t.retry,
  };
}

/** One doctor line, in the chosen language. */
export function doctorLine(c: { ok: boolean; name: string; detail: string }, lang: MessageLang = messageLang()): string {
  const name = lang === "de" ? (CHECK_NAMES[c.name] ?? c.name) : c.name;
  const status = lang === "de" ? (c.ok ? "OK    " : "FEHLER") : c.ok ? "OK  " : "FAIL";
  return `${status} ${name.padEnd(24)} ${localize(c.detail, lang)}`;
}

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
  return bySentence(message);
}
