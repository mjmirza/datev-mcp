#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { doctor } from "./setup/doctor.js";
import { login } from "./setup/login.js";

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
  process.stderr.write("Usage: datev-mcp <login|doctor>\nThe MCP server itself lands in the next build step.\n");
  return cmd ? 2 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
