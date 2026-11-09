import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// usage: tsx src/test-play.ts <port> <file.mid> '<maps json>' [maxBeats]
const [port, path, maps, maxBeats] = process.argv.slice(2);
const client = new Client({ name: "play", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "./node_modules/.bin/tsx", args: ["src/server.ts"] }));
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const out = text(await client.callTool({
  name: "play_midi",
  arguments: { port, path, maps: JSON.parse(maps), ...(maxBeats ? { maxBeats: Number(maxBeats) } : {}) },
}));
console.log(out);
await new Promise((r) => setTimeout(r, (JSON.parse(out).durationSec + 2) * 1000));
await client.close();
