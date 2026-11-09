import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "play", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "./node_modules/.bin/tsx", args: ["src/server.ts"] }));
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const out = text(await client.callTool({
  name: "felucca_play_midi",
  arguments: {
    path: process.argv[2],
    maps: [
      { midiTrack: 2, track: 0, transpose: -12, engine: 0, preset: 2 },
      { midiTrack: 1, track: 1, transpose: 0, engine: 12, preset: 0 },
    ],
    maxBeats: Number(process.argv[3] ?? 32),
  },
}));
console.log(out);
const { durationSec } = JSON.parse(out);
await new Promise((r) => setTimeout(r, (durationSec + 2) * 1000));
await client.close();
