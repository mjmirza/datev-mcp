import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests never touch the real session, log or sent-file folders of the person running them.
process.env.DATEV_MCP_HOME ??= mkdtempSync(join(tmpdir(), "datev-test-home-"));
process.env.DATEV_MCP_LOG_DIR ??= mkdtempSync(join(tmpdir(), "datev-test-logs-"));
