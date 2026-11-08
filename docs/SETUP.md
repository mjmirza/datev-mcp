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
3. Add a redirect URI of the form `http://localhost` as your app settings allow. The login command starts a short-lived receiver on a free local port and prints the exact URL it uses.
4. Copy the client id and client secret into your password manager.

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
| `DATEV_CLIENT_SECRET` | Yes | The app's client secret |
| `DATEV_ENV` | No | `sandbox` (default) or `production` |
| `DATEV_SCOPES` | No | Space separated scopes. By default every scope the index knows is requested |
| `DATEV_MCP_HOME` | No | Where the session file lives. Default `~/.config/datev-mcp` |
| `DATEV_MCP_LANG` | No | `de` gives German versions of the most common error messages. Default English |

Inject the two credentials from your password manager when you start the server, for example with a small launcher script that reads them from the vault and then runs `node dist/index.js`. Do not write them into a committed file, and never paste them into an AI conversation.

## 4. Log in once

```bash
node dist/index.js login
```

A browser opens at DATEV. After you sign in, the session is saved on your machine with owner-only permissions. The access token lasts 15 minutes and is refreshed automatically. The refresh token lasts about 11 hours and can be used only once, so a new one is stored after every refresh. After a long break you log in again.

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
2. "Which fiscal years does client 455148-1 have?"
3. "Show the sums and balances for accounts starting with 12 in that year."
4. "Find the account for bank in the chart of accounts."

## When something fails

| You see | Likely cause | What to do |
|---|---|---|
| `DATEV login needed` | The refresh token expired or was used up | Run `node dist/index.js login` again |
| HTTP 401 or 403 | The app is not subscribed to that product, or the scope was not granted | Check the product subscription in the portal |
| HTTP 500 with "Sandboxing policy error" | DATEV's sandbox gateway refuses that resource for your app | Nothing is wrong with the request. Ask DATEV to enable the product for the sandbox |
| HTTP 429 | DATEV's rate limit | Wait and try again. Reads retry by themselves a few times |
| "Ran out of time" | The call did not finish within its 55 second budget | Narrow the request, or continue a postings job with its `job_id` |

DATEV does not return the list of granted scopes in its token answer, so the server cannot tell you in advance which products will work. The first call to each product shows it.
