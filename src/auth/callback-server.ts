import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomToken } from "./pkce.js";
import { callbackPageText, messageLang, type CallbackOutcome } from "../i18n.js";

interface CallbackResult {
  code: string;
}

export interface CallbackServer {
  redirectUri: string;
  result: Promise<CallbackResult>;
  close: () => void;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Mirrors the shadcn token names in OKLCH. One emerald accent, a rust tone only for the failure mark.
const STYLE = `:root{color-scheme:light dark;--background:oklch(0.985 0.004 155);--foreground:oklch(0.22 0.012 155);--card:oklch(1 0 0);--card-foreground:oklch(0.22 0.012 155);--muted-foreground:oklch(0.46 0.012 155);--border:oklch(0.9 0.006 155);--primary:oklch(0.52 0.13 155);--primary-foreground:oklch(0.985 0.01 155);--destructive:oklch(0.52 0.16 28);--radius:0.75rem}
@media (prefers-color-scheme: dark){:root{--background:oklch(0.18 0.006 155);--foreground:oklch(0.95 0.006 155);--card:oklch(0.22 0.008 155);--card-foreground:oklch(0.95 0.006 155);--muted-foreground:oklch(0.74 0.01 155);--border:oklch(0.32 0.01 155);--primary:oklch(0.74 0.14 155);--primary-foreground:oklch(0.18 0.006 155);--destructive:oklch(0.72 0.14 28)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:clamp(1rem,4vw,2rem);background:var(--background);color:var(--foreground);font-family:"Inter","Geist",ui-sans-serif,sans-serif;font-size:clamp(0.95rem,0.9rem + 0.2vw,1.05rem);line-height:1.6}
main{width:100%;max-width:28rem;padding:clamp(1.5rem,5vw,2.25rem);background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius)}
.mark{display:grid;place-items:center;width:2.75rem;height:2.75rem;margin-bottom:1.25rem;border-radius:999px;color:var(--tone);background:color-mix(in oklch,var(--tone) 14%,transparent)}
.mark svg{width:1.5rem;height:1.5rem}
.ok{--tone:var(--primary)}
.bad{--tone:var(--destructive)}
h1{margin:0 0 0.5rem;font-size:clamp(1.25rem,1.1rem + 0.8vw,1.6rem);line-height:1.25;font-weight:650;letter-spacing:-0.01em}
p{margin:0 0 0.75rem;overflow-wrap:anywhere}
.next{margin:1.25rem 0 0;padding-top:1rem;border-top:1px solid var(--border);color:var(--muted-foreground)}
code{font-family:ui-monospace,monospace;font-size:0.9em;padding:0.1em 0.35em;border:1px solid var(--border);border-radius:0.35rem}`;

const CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const CROSS = '<path d="M7 7l10 10M17 7L7 17"/>';

function page(outcome: CallbackOutcome, answer?: string): string {
  const lang = messageLang();
  const t = callbackPageText(outcome, lang);
  const ok = outcome === "done";
  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ok ? CHECK : CROSS}</svg>`;
  const detail = answer === undefined ? "" : `<p>${escapeHtml(t.answerLabel)} <code>${escapeHtml(answer)}</code></p>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body><main class="${ok ? "ok" : "bad"}"><div class="mark">${icon}</div><h1>${escapeHtml(t.title)}</h1><p role="status">${escapeHtml(t.lead)}</p>${detail}<p class="next">${escapeHtml(t.next)}</p></main></body></html>`;
}

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// DATEV's sandbox accepts http://localhost with any port and path when http://localhost is registered.
export async function startCallbackServer(expectedState: string, opts: { timeoutMs?: number; port?: number } = {}): Promise<CallbackServer> {
  const path = `/redirect/${randomToken(12)}/`;
  let settle!: { resolve: (r: CallbackResult) => void; reject: (e: Error) => void };
  const result = new Promise<CallbackResult>((resolve, reject) => (settle = { resolve, reject }));
  const servers: Server[] = [];

  const handler: Parameters<typeof createServer>[1] = (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (state !== expectedState) {
      res.writeHead(400, HEADERS).end(page("mismatch"));
      settle.reject(new Error("State mismatch on the DATEV login redirect"));
      return;
    }
    if (error || !code) {
      res.writeHead(400, HEADERS).end(error ? page("failed", error) : page("no-code"));
      settle.reject(new Error(`DATEV login failed: ${error ?? "no code returned"}`));
      return;
    }
    res.writeHead(200, HEADERS).end(page("done"));
    settle.resolve({ code });
  };

  const listen = (host: string, port: number) =>
    new Promise<Server>((resolve, reject) => {
      const s = createServer(handler);
      s.once("error", reject);
      s.listen(port, host, () => resolve(s));
    });

  const first = await listen("127.0.0.1", opts.port ?? 0);
  servers.push(first);
  const port = (first.address() as AddressInfo).port;
  // Browsers may resolve "localhost" to ::1 first, so listen there too when IPv6 is available.
  await listen("::1", port).then((s) => servers.push(s), () => undefined);

  const timer = setTimeout(() => settle.reject(new Error("Timed out waiting for the DATEV login in the browser")), opts.timeoutMs ?? 300_000);
  const close = () => {
    clearTimeout(timer);
    for (const s of servers) s.close();
  };
  result.then(close, close);
  return { redirectUri: `http://localhost:${port}${path}`, result, close };
}
