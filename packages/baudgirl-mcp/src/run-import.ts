import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// usage: tsx src/run-import.ts <file.mid> <dry|write> '<json overrides>'
const [path, mode = "dry", extra = "{}"] = process.argv.slice(2);
const client = new Client({ name: "import", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/server.ts"] }));
const r = await client.callTool({
  name: "import_midi",
  arguments: { path, dryRun: mode !== "write", ...JSON.parse(extra) },
});
console.log((r as { content: { text: string }[] }).content[0].text);
await client.close();
