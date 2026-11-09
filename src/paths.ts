import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

// An empty variable counts as unset, so a copied template with "DATEV_MCP_HOME=" never puts the session in the working directory.
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function absolute(name: string, value: string): string {
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path, got "${value}"`);
  return resolve(value);
}

/** Where the session and the HTTP log live: DATEV_MCP_HOME, else $XDG_CONFIG_HOME/datev-mcp, else ~/.config/datev-mcp. */
export function storeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = setting(env, "DATEV_MCP_HOME");
  if (home) return absolute("DATEV_MCP_HOME", home);
  const xdg = setting(env, "XDG_CONFIG_HOME");
  return join(xdg ? absolute("XDG_CONFIG_HOME", xdg) : join(homedir(), ".config"), "datev-mcp");
}

export function logDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = setting(env, "DATEV_MCP_LOG_DIR");
  return dir ? absolute("DATEV_MCP_LOG_DIR", dir) : join(storeDir(env), "logs");
}
