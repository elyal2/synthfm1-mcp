#!/usr/bin/env node
// Experimental MCP server, outside FM Foundry's stock-FM-1 scope: drives the
// FM-1+VA (Baud Girl's custom firmware) over real USB MIDI, using Baud Girl's
// own fm1seq.js / fm1preset.js (fetched live, see fm1seq.ts) for every byte.
//
// Wire protocol reverse-read from their Device Manager and confirmed on real
// hardware (2026-11-09): patterns write as cmd 0x22 (+0x21 locks) with a
// per-message ack and read back with cmd 0x11 memory requests; presets read
// with cmd 0x10 and write with cmd 0x04. The older 0x20 "pattern" message also
// still works on current firmware (a first test wrote C-E-G to pattern 16 with
// it) but cannot carry Chain, step options or ratchets; 0x22 is what Studio sends.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  describePattern,
  readPatterns,
  readPreset,
  scanPresets,
  writePattern,
  writePreset,
} from "./device.js";
import { readFileSync } from "node:fs";
import { loadFm1 } from "./fm1seq.js";
import { Link, listPorts } from "./link.js";
import { parseMidi } from "./midi-file.js";
import { toPatterns } from "./midi-import.js";

const server = new McpServer({ name: "baudgirl-mcp", version: "0.3.0" });

const port = z
  .string()
  .default("USB Composite")
  .describe('Substring of the MIDI port name (input and output), e.g. "USB Composite"');

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });

async function withLink<T>(portName: string, fn: (link: Link) => Promise<T>): Promise<T> {
  const link = Link.open(portName);
  try {
    return await fn(link);
  } finally {
    link.close();
  }
}

server.registerTool(
  "list_midi_ports",
  {
    title: "List MIDI ports",
    description: "Lists the MIDI input and output ports this machine sees, to find the FM-1+VA.",
    inputSchema: {},
  },
  async () => json(listPorts()),
);

server.registerTool(
  "read_patterns",
  {
    title: "Read sequencer patterns",
    description:
      "Reads patterns from the device (0-based; the UI shows 1-16): settings (steps, rate, gate, swing), Chain/Repeats, and every non-empty step with its notes and locks. Read-only.",
    inputSchema: {
      port,
      pats: z.array(z.number().int().min(0).max(15)).default([...Array(16).keys()]),
    },
  },
  async ({ port: p, pats }) =>
    json(
      await withLink(p, async (link) => {
        const fm1 = await loadFm1();
        const bank = await readPatterns(link, fm1, pats);
        return { onScreen: bank.current, patterns: pats.map((n) => describePattern(fm1, bank, n)) };
      }),
    ),
);

const StepSchema = z.object({
  step: z.number().int().min(0).max(63).describe("0-based step index"),
  notes: z
    .array(
      z.object({
        note: z.number().int().min(0).max(127),
        vel: z.number().int().min(1).max(127).default(100),
      }),
    )
    .max(9),
  length: z
    .number()
    .int()
    .min(0)
    .max(9)
    .optional()
    .describe("Step length as a note-value index: 0=1/1 1=1/2 2=1/4 3=1/4T 4=1/8 5=1/8T 6=1/16 ... 9=1/32T"),
  gate: z.number().int().min(5).max(100).nullable().optional(),
  chance: z.number().int().min(5).max(100).nullable().optional(),
  transpose: z.number().int().min(-24).max(24).optional(),
});

server.registerTool(
  "write_pattern",
  {
    title: "Write a sequencer pattern",
    description:
      "Replaces pattern `pat` with the given steps. Sends only what differs from the device, waits for an ack per message, saves to flash with the last one (save=true), then reads the pattern back and reports whether it matches. Fails if the Sequencer is playing (stop it first). Chain: \"repeat\" or {next, repeats} with repeats in 1,2,3,4,6,8,12,16.",
    inputSchema: {
      port,
      pat: z.number().int().min(0).max(15),
      stepsLength: z.number().int().min(1).max(64).default(16),
      rate: z.number().int().min(0).max(9).default(6).describe("Note-value index; 6 = 1/16"),
      gate: z.number().int().min(5).max(100).default(50),
      swing: z.number().int().min(50).max(75).default(50),
      chain: z
        .union([
          z.literal("repeat"),
          z.object({
            next: z.number().int().min(0).max(15),
            repeats: z.number().int().default(1),
          }),
        ])
        .default("repeat"),
      save: z.boolean().default(true),
      steps: z.array(StepSchema).default([]),
    },
  },
  async ({ port: p, pat, save, ...spec }) =>
    json(await withLink(p, async (link) => writePattern(link, await loadFm1(), pat, spec, save))),
);

server.registerTool(
  "import_midi",
  {
    title: "Import a MIDI file into patterns",
    description:
      "Quantizes a .mid to 16th-note steps and writes it into consecutive 64-step patterns starting at `startPat`, chained in order (and looping back if `loop`). Laid out for an 8-Bit preset: GM drums -> drum keys, bassChannels -> bass lane (folded into F2-E5), leadChannels -> lead lane (chords/melody; sustained by step length). Use dryRun to preview. Overwrites those patterns; the Sequencer is stopped first.",
    inputSchema: {
      port,
      path: z.string().describe("Absolute path to the .mid file"),
      startPat: z.number().int().min(0).max(15).default(2),
      bassChannels: z.array(z.number().int().min(0).max(15)).default([]),
      leadChannels: z.array(z.number().int().min(0).max(15)).default([]),
      drumChannels: z.array(z.number().int().min(0).max(15)).default([9]),
      bassTracks: z.array(z.number().int().min(0)).default([]).describe("Track indexes, when tracks share a channel"),
      leadTracks: z.array(z.number().int().min(0)).default([]),
      bassTranspose: z.number().int().min(-36).max(36).default(0),
      leadTranspose: z.number().int().min(-36).max(36).default(0),
      fromStep: z.number().int().min(0).default(0),
      maxPatterns: z.number().int().min(1).max(16).default(4),
      loop: z.boolean().default(true),
      dryRun: z.boolean().default(false),
    },
  },
  async ({ port: p, path, startPat, dryRun, ...opt }) => {
    const { notes, bpm } = parseMidi(readFileSync(path));
    const { specs, dropped, totalSteps } = toPatterns(notes, opt, startPat);
    if (startPat + specs.length > 16) throw new Error("not enough pattern slots from startPat");
    const summary = {
      fileBpm: bpm,
      totalSteps,
      dropped,
      patterns: specs.map((s) => ({
        ui: s.pat + 1,
        stepsLength: s.spec.stepsLength,
        chain: s.spec.chain,
        filledSteps: s.spec.steps.length,
      })),
    };
    if (dryRun) return json({ dryRun: true, ...summary });
    const results = await withLink(p, async (link) => {
      const fm1 = await loadFm1();
      link.send([0xfc]);
      const out = [];
      for (const s of specs) {
        const r = await writePattern(link, fm1, s.pat, s.spec, true);
        out.push({ ui: s.pat + 1, messages: r.messages, verified: r.verified });
      }
      return out;
    });
    return json({ ...summary, written: results });
  },
);

server.registerTool(
  "scan_presets",
  {
    title: "Scan presets",
    description:
      "Lists the stored presets (slot 0-127 = preset 001-128): name, engine and whether the slot is blank. Read-only.",
    inputSchema: {
      port,
      from: z.number().int().min(0).max(127).default(0),
      to: z.number().int().min(0).max(127).default(127),
    },
  },
  async ({ port: p, from, to }) =>
    json(await withLink(p, async (link) => scanPresets(link, await loadFm1(), from, to))),
);

server.registerTool(
  "read_preset",
  {
    title: "Read one preset",
    description: "Reads a preset's raw voice (128 B DX7 packed) and settings record (59 B) as hex.",
    inputSchema: { port, slot: z.number().int().min(0).max(127) },
  },
  async ({ port: p, slot }) =>
    json(
      await withLink(p, async (link) => {
        const fm1 = await loadFm1();
        const pr = await readPreset(link, fm1, slot);
        return {
          slot,
          name: fm1.preset.voiceName(pr.voice).trim(),
          voiceHex: Buffer.from(pr.voice).toString("hex"),
          recordHex: Buffer.from(pr.record).toString("hex"),
        };
      }),
    ),
);

server.registerTool(
  "write_preset",
  {
    title: "Write a preset",
    description:
      "Overwrites preset `slot`: starts from `baseSlot` (default: the slot itself), optionally replaces the voice with a 155-byte DX7 edit buffer (`vced`) and/or renames it, writes it and reads it back to verify. DESTRUCTIVE to that slot. Whether it persists after power-off without pressing SAVE on the device is not yet verified.",
    inputSchema: {
      port,
      slot: z.number().int().min(0).max(127),
      baseSlot: z.number().int().min(0).max(127).optional(),
      name: z.string().max(10).optional(),
      vced: z.array(z.number().int().min(0).max(127)).length(155).optional(),
    },
  },
  async ({ port: p, ...args }) =>
    json(await withLink(p, async (link) => writePreset(link, await loadFm1(), args))),
);

server.registerTool(
  "select_preset",
  {
    title: "Select a preset (Program Change)",
    description:
      "Sends a MIDI Program Change so the device switches to preset `slot` (0 = preset 001). The sequencer plays on the selected preset.",
    inputSchema: {
      port,
      slot: z.number().int().min(0).max(127),
      channel: z.number().int().min(0).max(15).default(0),
    },
  },
  async ({ port: p, slot, channel }) =>
    json(
      await withLink(p, async (link) => {
        link.send([0xc0 | channel, slot]);
        return { sent: "program change", slot, channel };
      }),
    ),
);

server.registerTool(
  "transport",
  {
    title: "Start / stop the sequencer",
    description:
      "Sends MIDI Start, Stop or Continue. The device only acts on it while its Sequencer is switched on (hold PLAY on the device).",
    inputSchema: { port, action: z.enum(["start", "stop", "continue"]) },
  },
  async ({ port: p, action }) =>
    json(
      await withLink(p, async (link) => {
        link.send([{ start: 0xfa, continue: 0xfb, stop: 0xfc }[action]]);
        return { sent: action };
      }),
    ),
);

await server.connect(new StdioServerTransport());
