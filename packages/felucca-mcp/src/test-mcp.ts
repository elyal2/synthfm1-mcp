import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "./node_modules/.bin/tsx", args: ["src/server.ts"] }));
console.log((await client.listTools()).tools.map((t) => t.name).join(", "));
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
console.log(text(await client.callTool({ name: "felucca_list_presets", arguments: { engine: 12 } })));
console.log(text(await client.callTool({ name: "felucca_params", arguments: { scope: "global", from: 0, to: 1 } })));
await client.close();
