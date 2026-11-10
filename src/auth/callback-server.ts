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

// Mirrors the shadcn token names in OKLCH. One emerald accent, a rust tone only for the failure status.
const STYLE = `:root{color-scheme:light dark;--background:oklch(0.985 0.004 155);--foreground:oklch(0.22 0.012 155);--card:oklch(0.965 0.006 155);--card-foreground:oklch(0.22 0.012 155);--muted-foreground:oklch(0.46 0.012 155);--border:oklch(0.88 0.008 155);--primary:oklch(0.5 0.13 155);--primary-foreground:oklch(0.985 0.01 155);--destructive:oklch(0.52 0.16 28);--radius:0.5rem;--font-sans:"Inter","Geist",ui-sans-serif,sans-serif;--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme: dark){:root{--background:oklch(0.18 0.006 155);--foreground:oklch(0.95 0.006 155);--card:oklch(0.22 0.008 155);--card-foreground:oklch(0.95 0.006 155);--muted-foreground:oklch(0.74 0.01 155);--border:oklch(0.34 0.01 155);--primary:oklch(0.76 0.14 155);--primary-foreground:oklch(0.18 0.006 155);--destructive:oklch(0.74 0.14 28)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;padding:12vh clamp(1rem,7vw,5rem) 3rem;background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:1rem;line-height:1.6}
main{max-width:36rem}
.ok{--tone:var(--primary)}
.bad{--tone:var(--destructive)}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:0.25rem 0.75rem;margin-bottom:3rem;color:var(--muted-foreground);font-size:0.875rem}
.wordmark{font-family:var(--font-mono);font-weight:600;font-size:1rem;color:var(--foreground);letter-spacing:-0.01em}
.status{display:flex;align-items:center;gap:0.5rem;margin:0 0 0.5rem;color:var(--tone);font-weight:600;font-size:0.95rem}
.status::before{content:"";width:0.55rem;height:0.55rem;border-radius:0.1rem;background:var(--tone);flex:none}
h1{margin:0 0 0.75rem;font-size:clamp(1.6rem,1.25rem + 1.5vw,2.25rem);line-height:1.15;font-weight:700;letter-spacing:-0.02em}
p{margin:0;overflow-wrap:anywhere}
.lead{font-size:1.0625rem}
.raw{margin-top:0.5rem;color:var(--muted-foreground);font-size:0.85rem}
.close{margin-top:2rem;font-weight:600}
.next{margin-top:2.5rem}
.next p{color:var(--muted-foreground);margin-bottom:0.625rem}
code{white-space:nowrap;font-family:var(--font-mono);font-size:0.9em;padding:0.1em 0.35em;border:1px solid var(--border);border-radius:0.3rem}
.cmd{display:block;width:100%;padding:0.75rem 1rem;background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius);overflow-x:auto}
.cmd code{border:0;padding:0;font-size:0.95rem}`;

const COMMAND = "datev-mcp login";

function page(outcome: CallbackOutcome, port: number, error?: string): string {
  const lang = messageLang();
  const t = callbackPageText(outcome, lang, { port, error });
  const ok = outcome === "done";
  const raw = error === undefined ? "" : `<p class="raw">${escapeHtml(t.answerLabel)} <code>${escapeHtml(error)}</code></p>`;
  const after = ok
    ? `<p class="close">${escapeHtml(t.next)}</p>`
    : `<section class="next"><p>${escapeHtml(t.next)}</p><div class="cmd"><code>${COMMAND}</code></div></section>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body><main class="${ok ? "ok" : "bad"}"><header><span class="wordmark">datev-mcp</span><span>${escapeHtml(t.where)}</span></header><p class="status">${escapeHtml(t.status)}</p><h1>${escapeHtml(t.title)}</h1><p class="lead" role="status">${escapeHtml(t.lead)}</p>${raw}${after}</main></body></html>`;
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
  let port = 0;

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
      res.writeHead(400, HEADERS).end(page("mismatch", port));
      settle.reject(new Error("State mismatch on the DATEV login redirect"));
      return;
    }
    if (error || !code) {
      res.writeHead(400, HEADERS).end(error ? page("failed", port, error) : page("no-code", port));
      settle.reject(new Error(`DATEV login failed: ${error ?? "no code returned"}`));
      return;
    }
    res.writeHead(200, HEADERS).end(page("done", port));
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
  port = (first.address() as AddressInfo).port;
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
