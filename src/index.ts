#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { doctor } from "./setup/doctor.js";
import { login } from "./setup/login.js";
import { runStdio } from "./server.js";

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === "login" || cmd === "setup") {
    await login(loadConfig());
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
  process.stderr.write("Usage: datev-mcp [serve|login|doctor]\n");
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
