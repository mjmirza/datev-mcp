// Live check through the real MCP protocol against the DATEV sandbox. Run via: npm run test:live
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type ToolText = { content: { type: string; text: string }[]; isError?: boolean };

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: process.env as Record<string, string> });
const client = new Client({ name: "datev-mcp-live", version: "0" });
await client.connect(transport);

const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolText;
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const found = await call("datev_search_operations", { query: "list clients", product: "accounting-clients" });
const ops = JSON.parse(found.content[0].text) as { id: string; path: string; method: string }[];
const list = ops.find((o) => o.path === "/clients" && o.method === "GET");
if (!list) throw new Error("search did not return the clients list operation");
console.log("search ->", list.id);

const res = await call("datev_call", { operation_id: list.id });
const body = JSON.parse(res.content[0].text) as { status: number; body: unknown; env: string };
const clients = Array.isArray(body.body) ? body.body : [];
console.log(`datev_call -> HTTP ${body.status}, env ${body.env}, ${clients.length} clients, isError=${Boolean(res.isError)}`);

const writeOp = (JSON.parse((await call("datev_search_operations", { query: "upload", writes_only: true, limit: 1 })).content[0].text) as { id: string }[])[0];
const preview = await call("datev_call", { operation_id: writeOp.id, path_params: {}, body: {} });
console.log(`write without confirm -> ${preview.content[0].text.includes('"preview": true') ? "preview only, nothing sent" : preview.content[0].text.slice(0, 160)}`);

await client.close();
if (body.status !== 200 || res.isError) process.exit(1);
