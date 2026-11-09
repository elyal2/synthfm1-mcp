#!/usr/bin/env node
// Firmware-agnostic MIDI player for any synth with a MIDI input (USB or Bluetooth LE MIDI).
// Notes, Program Change and CC only: no SysEx, no device replies needed.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseMidi } from "./midi-file.js";
import { listPorts, MidiOut } from "./out.js";
import { Player } from "./player.js";

const server = new McpServer({ name: "fm1-midi-mcp", version: "0.1.0" });
const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const port = z.string().describe('Substring of the MIDI output port name, e.g. "FM-1_BLE" (Bluetooth) or "USB"');
const channel = z.number().int().min(0).max(15).describe("MIDI channel 0-15 (the UI shows 1-16)");

let live: { out: MidiOut; player: Player } | null = null;
const endLive = () => {
  if (!live) return;
  live.player.stop(live.out);
  live.out.close();
  live = null;
};

server.registerTool(
  "list_midi_ports",
  { title: "List MIDI ports", description: "Lists MIDI input and output ports, including Bluetooth LE MIDI ports once connected in macOS Audio MIDI Setup.", inputSchema: {} },
  async () => json(listPorts()),
);

server.registerTool(
  "play_midi",
  {
    title: "Play a MIDI file live",
    description:
      "The computer acts as the sequencer: sends a .mid file's notes to a MIDI port, mapping each MIDI file track to a MIDI channel. Returns immediately; stop with stop_play. A new call replaces the one playing.",
    inputSchema: {
      port,
      path: z.string(),
      maps: z.array(
        z.object({
          midiTrack: z.number().int().min(0).describe("Track index in the file"),
          channel,
          transpose: z.number().int().default(0),
          program: z.number().int().min(0).max(127).optional().describe("Program Change sent first"),
        }),
      ),
      bpm: z.number().int().min(20).max(300).optional().describe("Defaults to the file's tempo"),
      fromBeat: z.number().min(0).default(0),
      maxBeats: z.number().min(1).optional(),
      loop: z.boolean().default(false),
    },
  },
  async ({ port: p, path, maps, bpm, fromBeat, maxBeats, loop }) => {
    endLive();
    const parsed = parseMidi(readFileSync(path));
    const tempo = bpm ?? parsed.bpm ?? 120;
    const out = MidiOut.open(p);
    const player = new Player();
    live = { out, player };
    player.start(out, parsed.notes, maps, tempo, { fromBeat, maxBeats, loop, onEnd: endLive });
    return json({ playing: true, bpm: tempo, durationSec: Math.round(player.durationSec), loop });
  },
);

server.registerTool(
  "stop_play",
  { title: "Stop playback", description: "Stops play_midi and releases all notes.", inputSchema: {} },
  async () => {
    const was = live !== null;
    endLive();
    return json({ stopped: was });
  },
);

server.registerTool(
  "send_note",
  {
    title: "Send one note",
    description: "Plays a single note for a given time, handy to check a connection or a channel.",
    inputSchema: { port, channel, note: z.number().int().min(0).max(127), velocity: z.number().int().min(1).max(127).default(90), ms: z.number().int().min(20).max(5000).default(500) },
  },
  async ({ port: p, channel: ch, note, velocity, ms }) => {
    const out = MidiOut.open(p);
    try {
      out.send([0x90 | ch, note, velocity]);
      await new Promise((r) => setTimeout(r, ms));
      out.send([0x80 | ch, note, 0]);
    } finally {
      out.close();
    }
    return json({ sent: { channel: ch, note, ms } });
  },
);

server.registerTool(
  "program_change",
  { title: "Program Change", description: "Selects a preset/program on a channel (0 = first).", inputSchema: { port, channel, program: z.number().int().min(0).max(127) } },
  async ({ port: p, channel: ch, program }) => {
    const out = MidiOut.open(p);
    try {
      out.send([0xc0 | ch, program]);
    } finally {
      out.close();
    }
    return json({ sent: "program change", channel: ch, program });
  },
);

server.registerTool(
  "cc",
  { title: "Control Change", description: "Sends a Control Change (e.g. 7 volume, 10 pan, 74 cutoff, 123 all notes off).", inputSchema: { port, channel, controller: z.number().int().min(0).max(127), value: z.number().int().min(0).max(127) } },
  async ({ port: p, channel: ch, controller, value }) => {
    const out = MidiOut.open(p);
    try {
      out.send([0xb0 | ch, controller, value]);
    } finally {
      out.close();
    }
    return json({ sent: "cc", channel: ch, controller, value });
  },
);

await server.connect(new StdioServerTransport());
