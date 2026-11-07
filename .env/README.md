# Environment variables

| Variable | Required | Used by | Format | Description |
|---|---|---|---|---|
| DATEV_CLIENT_ID | Yes | server | string | Client id of your DATEV portal app |
| DATEV_CLIENT_SECRET | Yes | server | string | Client secret of your DATEV portal app. Never commit it, never paste it into a chat |
| DATEV_ENV | No | server | `sandbox` or `production` | Which DATEV servers to call. Default `sandbox` |
| DATEV_SCOPES | No | server | space separated | OAuth scopes to request. Default every scope the operation index knows |
| DATEV_MCP_HOME | No | server | folder path | Where the login session is saved. Default `~/.config/datev-mcp` |
| DATEV_MCP_NO_BROWSER | No | login | `1` | Only print the sign-in link, do not open a browser |
| DATEV_LIVE_CLIENT | No | live tests | client id | Sandbox client used by `npm run test:live` and `npm run sweep`. Default `455148-1` |
| DATEV_MCP_LAUNCHER | No | live tests | file path | A launcher that starts the server with the credentials injected |
| DATEV_SWEEP_MAX | No | sweep | number | Live calls per day. Default 150 |
| DATEV_SWEEP_GAP_MS | No | sweep | milliseconds | Pause between live calls. Default 3000 |
| DATEV_SWEEP_ALL | No | sweep | `1` | Call every operation again, not only the unfinished ones |

## Setup

1. Copy `.env.example` to `.env.local` in this folder.
2. Fill in your values.
3. Start with `node --env-file=.env/.env.local dist/index.js` (Node.js 22 reads the file itself, no extra package needed).
4. Never commit `.env.local`. Git ignores it already.

A password manager that injects the two credentials at start is safer than a file. See [docs/SETUP.md](../docs/SETUP.md).
