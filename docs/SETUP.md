<!-- freshness: 45d -->
# Setup

This takes about 20 minutes the first time, most of it in the DATEV developer portal.

## What you need

- Node.js 22 or newer (`node -v` to check).
- A DATEV developer account at developer.datev.de.
- An app registered there for the sandbox, with the API products you want subscribed.
- A password manager or another way to put two values into the environment without typing them into a chat.

## 1. Register the app at DATEV

1. Sign in to the DATEV developer portal and create an app.
2. Subscribe the app to the API products you need. Each product is a separate subscription. A call to a product you have not subscribed to fails with 401 or 403, and that is DATEV refusing, not this server.
3. Choose the client type **Public**. datev-mcp runs on your own machine and signs in with PKCE, so it needs no client secret. DATEV blocks Confidential apps with a localhost redirect in production since 01.03.2026, so a Public client is the only setup that works in production. For an existing Confidential app, ask DATEV to switch it to Public.
4. Add the redirect URI `http://localhost`. The login command starts a short-lived receiver on a free local port and prints the exact URL it uses. Never register an IP address or `https://localhost`, DATEV does not allow them.
5. Copy the client id into your password manager. A Confidential sandbox app also has a client secret, keep it there too.

## 2. Install and build

```bash
git clone <this repository>
cd datev-mcp
npm install
npm run specs
npm run build
```

`npm run specs` downloads DATEV's public API specifications into `specs/` and builds the operation index in `src/data/operations.json`. Both are kept out of git on purpose, because DATEV's terms do not allow redistributing their documentation. Every developer downloads their own copy.

## 3. Provide the credentials

The server reads these environment variables.

| Variable | Required | Meaning |
|---|---|---|
| `DATEV_CLIENT_ID` | Yes | The app's client id from the portal |
| `DATEV_CLIENT_SECRET` | No | Only for a Confidential app. Leave it out for a Public client, which production requires. A few APIs (Basisdaten online, SmartTransfer) work only with a Confidential client |
| `DATEV_ENV` | No | `sandbox` (default) or `production` |
| `DATEV_MCP_SERVICES` | No | Comma separated DATEV data services to connect, the same as `login --services`. Only their scopes are requested |
| `DATEV_SCOPES` | No | Experts only. Exact space separated scopes, overriding the service choice |
| `DATEV_MCP_HOME` | No | Absolute path for the session file. Default `$XDG_CONFIG_HOME/datev-mcp`, else `~/.config/datev-mcp` |
| `DATEV_MCP_LOG_DIR` | No | Absolute path for the technical HTTP log. Default `<home>/logs` |
| `DATEV_MCP_SESSION_KEY` | No | 64 hex characters. Encrypts the session when no OS credential store is available |
| `DATEV_MCP_CONFIRM` | No | Sandbox only. `human` asks you in the client before every write, `token` (default) lets the preview's confirm code approve it. Production always asks you, whatever this says |
| `DATEV_SMARTTRANSFER_API_KEY` | No | The `X-API-Key` for SmartTransfer. It stays in the server and is never passed through the assistant |
| `DATEV_MCP_LANG` | No | `de` gives German messages and a German status view. Default English |

Inject the credentials from your password manager when you start the server, for example with a small launcher script that reads them from the vault and then runs `node dist/index.js`. Do not write them into a committed file, and never paste them into an AI conversation.

## 4. Log in once

Choose the DATEV data services you actually use. DATEV allows only their scopes, so the server never asks for more.

```bash
node dist/index.js services
node dist/index.js login --services accounting-documents,accounting-extf-files
```

`services` lists every data service with the name DATEV uses for it. A browser opens at DATEV. After you sign in, the server checks DATEV's ID token (signature, issuer, app, nonce and expiry) and reads your name from DATEV's userinfo. Nothing is saved if the ID token check fails.

The session is encrypted with AES-256-GCM. The key lives in the macOS Keychain, the Linux Secret Service, a Windows DPAPI-protected file, or `DATEV_MCP_SESSION_KEY`. The access token lasts 15 minutes and is refreshed automatically. The refresh token lasts about 11 hours and can be used only once, so a new one is stored after every refresh. Logging in again revokes the previous refresh token, so only one is ever valid.

## Connection status and disconnecting

```bash
node dist/index.js status
node dist/index.js disconnect
```

`status` shows whether the connection is active, who is signed in, when it expires (`TT.MM.JJJJ HH:MM`), the connected data services, the error rate of the last 14 days, and the link to the DATEV page where you can see and remove connected apps, https://apps.datev.de/tokrevui. Your AI client can show the same through the `datev_connection_status` tool.

`disconnect` revokes the tokens at DATEV and deletes the local session. If DATEV cannot be reached, the session is kept and you are told so. Remove the app at the DATEV page above, then run `disconnect --local-only`.

## Technical log

Every call to DATEV, including token calls, is written to a daily JSON lines file in the log directory and kept for 30 days. Each line holds the request time, method, URL, request headers, a size and hash of the request body, the response status, response headers and response time. DATEV's tracing headers such as `X-Global-Transaction-ID` are kept. Secrets, authorization headers and API keys are removed. Response bodies are kept only for errors and job status answers, cut to 8,000 characters. The files are readable only by you.

## 5. Check the setup

```bash
node dist/index.js doctor
```

Each line is `OK` or `FAIL` with a short reason. It checks the credentials are present, the operation index loaded, a session exists, it yields a valid access token (refreshed only when due), DATEV's userinfo answers, and the clients API answers.

## 6. Connect your AI client

The server speaks MCP over standard input and output. For Claude Code, run this once.

```bash
claude mcp add datev -- node /absolute/path/to/datev-mcp/dist/index.js
```

Any other MCP client takes `node` as the command and the path to `dist/index.js` as its one argument. If you use a launcher script that injects the credentials, point the client at the launcher as the command, with an empty argument list.

## 7. First questions to try

1. "List my DATEV clients."
2. "Which fiscal years does my first client have?"
3. "Show the sums and balances for accounts starting with 12 in that year."
4. "Find the account for bank in the chart of accounts."

## When something fails

| You see | Likely cause | What to do |
|---|---|---|
| `DATEV login needed` | The refresh token expired or was used up | Run `node dist/index.js login` again |
| HTTP 401 or 403 | The app is not subscribed to that product, or the scope was not granted | Check the product subscription in the portal |
| HTTP 500 with "Sandboxing policy error" | DATEV's sandbox gateway refuses that resource for your app | Nothing is wrong with the request. Ask DATEV to enable the product for the sandbox |
| HTTP 429 | DATEV's rate limit | Wait and try again. Reads retry by themselves a few times. Writes are never retried, so nothing is sent twice. When DATEV names a time to wait, every call to that service pauses until then |
| "not part of the connected data services" | The operation belongs to a service you did not choose at login | Run `login --services` again with that service added |
| "needs your approval in the client" | Production writes always ask you first, and this client cannot ask | Use a client that supports MCP elicitation. In the sandbox, `DATEV_MCP_CONFIRM=token` also works |
| "Ran out of time" | The call did not finish within its 55 second budget | Narrow the request, or continue a postings job with its `job_id` |

When DATEV answers an error with a help link, the message shows it after "Help".
