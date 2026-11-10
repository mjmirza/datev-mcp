#!/usr/bin/env node
import { writeHttpLog } from "./api/http-log.js";
import { serviceList } from "./auth/services.js";
import { loadConfig } from "./config.js";
import { localize, messageLang } from "./i18n.js";
import { disconnect } from "./setup/disconnect.js";
import { doctor } from "./setup/doctor.js";
import { login } from "./setup/login.js";
import { connectionStatus, renderStatus } from "./setup/status.js";
import { runStdio } from "./server.js";

const USAGE = `Usage: datev-mcp <command>
  login --services a,b   Connect to DATEV ("Mit DATEV verbinden") with the data services you choose
  status                 Show the connection: active or not, user, validity, data services
  disconnect             Revoke the connection at DATEV and delete it here ("Verbindung trennen")
  services               List the data services you can choose
  doctor                 Check credentials, session and API access
  serve                  Run the MCP server (default)`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const lang = messageLang();
  if (cmd === "login" || cmd === "setup" || cmd === "connect") {
    await login(loadConfig(), { services: flag(argv, "--services") });
    return 0;
  }
  if (cmd === "status") {
    const st = await connectionStatus(loadConfig(), { httpLog: (e) => writeHttpLog(e) });
    process.stdout.write(`${renderStatus(st, lang, process.stdout.isTTY)}\n`);
    return st.connected ? 0 : 1;
  }
  if (cmd === "disconnect" || cmd === "logout") {
    const r = await disconnect(loadConfig(), { localOnly: argv.includes("--local-only") });
    process.stdout.write(`${localize(r.message, lang)}\n`);
    return r.removed ? 0 : 1;
  }
  if (cmd === "services") {
    process.stdout.write(`${serviceList()}\n`);
    return 0;
  }
  if (cmd === "doctor") {
    const checks = await doctor(loadConfig());
    for (const c of checks) process.stdout.write(`${c.ok ? "OK  " : "FAIL"} ${c.name.padEnd(24)} ${c.detail}\n`);
    return checks.every((c) => c.ok) ? 0 : 1;
  }
  if (!cmd || cmd === "serve") {
    await runStdio(loadConfig());
    return -1;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (e: unknown) => {
    process.stderr.write(`${localize(e instanceof Error ? e.message : String(e))}\n`);
    process.exit(1);
  },
);
