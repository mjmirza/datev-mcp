import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatevEnv } from "../auth/endpoints.js";
import { localizeApproval, messageLang } from "../i18n.js";

type ConfirmMode = "human" | "token";

// "human": the server asks the person through the client (elicitation), so the assistant cannot approve its own write.
// "token": the preview's confirm code is enough. Production is always "human": the assistant must never approve a
// write to real DATEV data on its own. DATEV_MCP_CONFIRM only chooses the mode in the sandbox.
function confirmMode(env: DatevEnv, vars: NodeJS.ProcessEnv = process.env): ConfirmMode {
  if (env === "production") return "human";
  const v = vars.DATEV_MCP_CONFIRM?.trim().toLowerCase();
  return v === "human" ? "human" : "token";
}

/** Returns undefined when the write may go ahead, otherwise the reason it may not. */
export async function humanApproval(server: McpServer, env: DatevEnv, summary: string, vars: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const canAsk = server.server.getClientCapabilities()?.elicitation !== undefined;
  if (!canAsk) {
    if (confirmMode(env, vars) === "token") return undefined;
    return env === "production"
      ? "This write to DATEV production needs your approval in the client, but this MCP client cannot ask you (no elicitation support). Nothing was sent. Use a client that supports it."
      : "This write needs your approval in the client, but this MCP client cannot ask you (no elicitation support). Use a client that supports it, or set DATEV_MCP_CONFIRM=token to let the preview's confirm code approve sandbox writes.";
  }
  const de = messageLang(vars) === "de";
  let res;
  try {
    res = await server.server.elicitInput({
      mode: "form",
      message: de ? `Dies an DATEV ${env === "production" ? "Produktion" : "Sandbox"} senden?\n\n${localizeApproval(summary, "de")}` : `Send this to DATEV ${env}?\n\n${summary}`,
      requestedSchema: {
        type: "object",
        properties: { approve: { type: "boolean", title: de ? "Ja, an DATEV senden" : "Yes, send it to DATEV", default: false } },
        required: ["approve"],
      },
    });
  } catch (e) {
    return `The approval could not be asked (${e instanceof Error ? e.message : String(e)}). Nothing was sent.`;
  }
  if (res.action === "accept" && res.content?.approve === true) return undefined;
  return "You did not approve this write. Nothing was sent.";
}
