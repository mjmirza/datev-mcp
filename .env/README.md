# Environment variables

| Variable | Required | Used by | Format | Description |
|---|---|---|---|---|
| DATEV_CLIENT_ID | Yes | server | string | Client id of your DATEV portal app |
| DATEV_CLIENT_SECRET | No | server | string | Only for a Confidential app. Leave it out for a Public client, which production requires. Never commit it, never paste it into a chat |
| DATEV_ENV | No | server | `sandbox` or `production` | Which DATEV servers to call. Default `sandbox` |
| DATEV_MCP_SERVICES | No | login | comma separated product ids | Data services to connect, the same as `login --services`. Only their scopes are requested. `login --services` wins |
| DATEV_SCOPES | No | login | space separated | Experts only. Exact scopes, used only when no data service is chosen. `openid` is added when it is missing. With neither a service nor this list, login refuses |
| DATEV_MCP_HOME | No | server | absolute folder path | Where the login session is saved. Default `$XDG_CONFIG_HOME/datev-mcp`, else `~/.config/datev-mcp`. An empty value counts as unset |
| DATEV_MCP_LOG_DIR | No | server | absolute folder path | Technical HTTP log. Default the `logs` folder inside the session folder |
| DATEV_MCP_SESSION_KEY | No | server | 64 hex characters | Encrypts the session when no OS credential store is available. 32 bytes, hex or base64 |
| DATEV_MCP_CONFIRM | No | server | `human` or `token` | Sandbox only. `token` (default) lets the preview's confirm code approve a write. `human` asks you in the client. Production always asks you, whatever this says |
| DATEV_SMARTTRANSFER_API_KEY | No | server | string | The `X-API-Key` for SmartTransfer. It stays in the server and is never passed through the assistant |
| DATEV_MCP_LANG | No | server | `de` | German messages and a German status view. Anything else, or nothing, keeps English |
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

A password manager that injects the credentials at start is safer than a file. See [docs/SETUP.md](../docs/SETUP.md).
