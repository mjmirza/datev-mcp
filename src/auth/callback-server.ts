import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomToken } from "./pkce.js";

interface CallbackResult {
  code: string;
}

export interface CallbackServer {
  redirectUri: string;
  result: Promise<CallbackResult>;
  close: () => void;
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;margin:3rem;max-width:36rem"><h1>${title}</h1><p>${body}</p></body>`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
      res.writeHead(400, { "content-type": "text/html" }).end(page("Login not accepted", "The login response did not match this login attempt. Close this tab and run the login again."));
      settle.reject(new Error("State mismatch on the DATEV login redirect"));
      return;
    }
    if (error || !code) {
      const why = escapeHtml(error ?? "no code returned");
      res.writeHead(400, { "content-type": "text/html" }).end(page("DATEV login failed", `DATEV answered: ${why}. Close this tab and run the login again.`));
      settle.reject(new Error(`DATEV login failed: ${error ?? "no code returned"}`));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(page("DATEV login complete", "You can close this tab and return to your terminal."));
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
