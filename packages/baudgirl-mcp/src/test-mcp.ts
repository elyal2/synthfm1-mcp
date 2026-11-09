import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/server.ts"] }));

console.log((await client.listTools()).tools.map((t) => t.name).join(", "));

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

console.log(text(await client.callTool({ name: "list_midi_ports", arguments: {} })));
// identical rewrite of preset 001: no net change, exercises cmd 0x04 + read-back
console.log(text(await client.callTool({ name: "write_preset", arguments: { slot: 0 } })));
console.log(text(await client.callTool({ name: "scan_presets", arguments: { from: 0, to: 2 } })));
await client.close();
