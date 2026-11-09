#!/usr/bin/env node
// MCP server for the FM-1 running Felucca (hugelton/Felucca, GPL-3.0). Speaks the documented
// editor SysEx protocol (web/EDITOR_PROTOCOL.md); nothing is reverse-engineered here.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { CMD, Felucca } from "./felucca.js";
import { planSong, writeSong, type TrackMap } from "./felucca-song.js";
import { Player } from "./felucca-play.js";
import { Link } from "./link.js";
import { parseMidi } from "./midi-file.js";

const server = new McpServer({ name: "felucca-mcp", version: "0.1.0" });
const port = z.string().default("Felucca").describe('MIDI port name substring, "Felucca"');
const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });

async function withDevice<T>(portName: string, fn: (f: Felucca) => Promise<T>): Promise<T> {
  const link = Link.open(portName);
  try {
    return await fn(new Felucca(link));
  } finally {
    link.close();
  }
}

server.registerTool(
  "felucca_status",
  {
    title: "Felucca status",
    description: "Firmware version, engines, the 4 tracks (engine, preset, level, mute), BPM and the song chain state.",
    inputSchema: { port },
  },
  async ({ port: p }) =>
    json(
      await withDevice(p, async (f) => ({
        info: await f.info(),
        ...(await f.tracks()),
        bpm: await f.getGlobal(0),
        song: await f.song(0),
      })),
    ),
);

server.registerTool(
  "felucca_list_presets",
  {
    title: "List presets of an engine",
    description: "Preset names for an engine number (0 ANALOG, 2 PHASE, 3 LOFI, 4 SAMPLE, 5 VOICE, 6 TRIO, 7 WHEEL, 8 GRAIN, 9 PHYS, 10 DRUM, 11 NOISE, 12 FM6, 13 SLICE).",
    inputSchema: { port, engine: z.number().int().min(0).max(13) },
  },
  async ({ port: p, engine }) =>
    json(
      await withDevice(p, async (f) => {
        const r = await f.req(CMD.NAMES, [engine]);
        r.u8();
        const n = r.u8();
        return Array.from({ length: n }, (_, i) => ({ preset: i, name: r.str() }));
      }),
    ),
);

server.registerTool(
  "felucca_set_sound",
  {
    title: "Set a track's sound",
    description: "Loads engine+preset on a track (0-3). Changes the sound only; steps and mix stay.",
    inputSchema: {
      port,
      track: z.number().int().min(0).max(3),
      engine: z.number().int().min(0).max(13),
      preset: z.number().int().min(0).max(127),
    },
  },
  async ({ port: p, track, engine, preset }) =>
    json(
      await withDevice(p, async (f) => {
        await f.selectTrack(track);
        await f.loadPreset(engine, preset);
        return (await f.tracks()).tracks[track];
      }),
    ),
);

server.registerTool(
  "felucca_params",
  {
    title: "Read or write parameters",
    description: "Describes parameters (label, range, current value) for ids from..to, of a track (scope 'track') or the globals (scope 'global'; id 0 = BPM). Pass `set` ({id: value}) to write values first.",
    inputSchema: {
      port,
      scope: z.enum(["track", "global"]),
      track: z.number().int().min(0).max(3).default(0),
      from: z.number().int().min(0).default(0),
      to: z.number().int().min(0).default(10),
      set: z.record(z.string(), z.number().int()).optional(),
    },
  },
  async ({ port: p, scope, track, from, to, set }) =>
    json(
      await withDevice(p, async (f) => {
        for (const [id, v] of Object.entries(set ?? {})) {
          if (scope === "global") await f.setGlobal(Number(id), v);
          else await f.setTrackParam(track, Number(id), v);
        }
        const out = [];
        for (let id = from; id <= to; id++) {
          const d = await f.desc(scope === "global" ? 1 : 0, id);
          const value = scope === "global" ? await f.getGlobal(id) : await f.trackParam(track, id);
          out.push({ id, label: d.label, min: d.min, max: d.max, value, names: d.names.length ? d.names : undefined });
        }
        return out;
      }),
    ),
);

server.registerTool(
  "felucca_write_steps",
  {
    title: "Write steps of a track",
    description: "Writes steps (0-63) to a track's pattern: up to 4 notes per step; time 0 NOTE, 1 TIE (holds the previous note), 2 REST. With clear=true every other step becomes a rest first. LEN (param 29) and DIV (30; 2 = 1/16) are set if given. Ignored while a song plays.",
    inputSchema: {
      port,
      track: z.number().int().min(0).max(3),
      clear: z.boolean().default(false),
      len: z.number().int().min(1).max(64).optional(),
      div: z.number().int().min(0).max(9).optional(),
      steps: z.array(
        z.object({
          index: z.number().int().min(0).max(63),
          notes: z.array(z.number().int().min(0).max(127)).max(4).default([]),
          time: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
          vel: z.number().int().min(0).max(127).default(100),
          accent: z.boolean().default(false),
          slide: z.boolean().default(false),
        }),
      ),
    },
  },
  async ({ port: p, track, clear, len, div, steps }) =>
    json(
      await withDevice(p, async (f) => {
        await f.song(3);
        if (len !== undefined) await f.setTrackParam(track, 29, len);
        if (div !== undefined) await f.setTrackParam(track, 30, div);
        if (clear) for (let k = 0; k < 64; k++) await f.setStep(track, k, { notes: [], time: 2, vel: 0 });
        for (const s of steps) {
          await f.setStep(track, s.index, {
            notes: s.notes,
            time: s.time,
            vel: s.vel,
            flags: (s.accent ? 1 : 0) | (s.slide ? 2 : 0),
          });
        }
        return { written: steps.length };
      }),
    ),
);

server.registerTool(
  "felucca_import_midi",
  {
    title: "Import a MIDI file as a song",
    description: "Splits the file into 64-step (1/16) chunks, gives each distinct chunk one of the 4 project slots, chains them as the song and sets BPM. Only what fits in 4 distinct chunks is imported (reported as covered/total). OVERWRITES project slots 1-4 and mutes unused tracks; refuses if a slot is in use unless overwrite=true.",
    inputSchema: {
      port,
      path: z.string(),
      maps: z.array(
        z.object({
          midiTrack: z.number().int().min(0),
          track: z.number().int().min(0).max(3),
          engine: z.number().int().min(0).max(13),
          preset: z.number().int().min(0).max(127),
          transpose: z.number().int().default(0),
        }),
      ),
      bpm: z.number().int().min(40).max(240).optional().describe("Defaults to the file's tempo"),
      overwrite: z.boolean().default(false),
      start: z.boolean().default(true),
      dryRun: z.boolean().default(false),
    },
  },
  async ({ port: p, path, maps, bpm, overwrite, start, dryRun }) => {
    const parsed = parseMidi(readFileSync(path));
    const plan = planSong(parsed.notes, maps as TrackMap[]);
    const summary = {
      fileBpm: parsed.bpm,
      slots: plan.slots.length,
      rows: plan.rows,
      coveredChunks: plan.coveredChunks,
      totalChunks: plan.totalChunks,
    };
    if (dryRun) return json({ dryRun: true, ...summary });
    return json(
      await withDevice(p, async (f) => {
        if (!overwrite) {
          for (let s = 0; s < 4; s++) {
            if ((await f.project(2, s))[2] === 1) throw new Error(`project slot ${s + 1} is in use; pass overwrite=true`);
          }
        }
        const rc = await writeSong(f, plan, maps as TrackMap[], bpm ?? parsed.bpm ?? 120);
        const started = start ? await f.song(2) : null;
        return { ...summary, songRc: rc, started };
      }),
    );
  },
);

let live: { link: Link; player: Player } | null = null;
const endLive = () => {
  if (!live) return;
  live.player.stop(live.link);
  live.link.close();
  live = null;
};

server.registerTool(
  "felucca_play_midi",
  {
    title: "Play a MIDI file live on the tracks",
    description: "The computer acts as the sequencer: streams the file's notes to Felucca tracks over MIDI channels 1-4 (MIDI IN must be CH1-4). Whole song, no slot limit. Returns immediately; stop with felucca_stop_play. Optionally loads a sound on each mapped track first. Stops the on-device song.",
    inputSchema: {
      port,
      path: z.string(),
      maps: z.array(
        z.object({
          midiTrack: z.number().int().min(0),
          track: z.number().int().min(0).max(3).describe("Felucca track = MIDI channel 1-4"),
          transpose: z.number().int().default(0),
          engine: z.number().int().min(0).max(13).optional(),
          preset: z.number().int().min(0).max(127).optional(),
        }),
      ),
      bpm: z.number().int().min(20).max(300).optional().describe("Defaults to the file's tempo; also set on the device"),
      fromBeat: z.number().min(0).default(0),
      maxBeats: z.number().min(1).optional(),
    },
  },
  async ({ port: p, path, maps, bpm, fromBeat, maxBeats }) => {
    endLive();
    const parsed = parseMidi(readFileSync(path));
    const tempo = bpm ?? parsed.bpm ?? 120;
    const link = Link.open(p);
    try {
      const f = new Felucca(link);
      await f.song(3);
      await f.setGlobal(0, Math.min(240, Math.max(40, tempo)));
      for (const m of maps) {
        if (m.engine !== undefined && m.preset !== undefined) {
          await f.selectTrack(m.track);
          await f.loadPreset(m.engine, m.preset);
        }
      }
    } catch (e) {
      link.close();
      throw e;
    }
    const player = new Player();
    live = { link, player };
    player.start(
      link,
      parsed.notes,
      maps.map((m) => ({ midiTrack: m.midiTrack, channel: m.track, transpose: m.transpose })),
      tempo,
      { fromBeat, maxBeats, onEnd: endLive },
    );
    return json({ playing: true, bpm: tempo, durationSec: Math.round(player.durationSec) });
  },
);

server.registerTool(
  "felucca_stop_play",
  { title: "Stop live playback", description: "Stops felucca_play_midi and releases all notes.", inputSchema: {} },
  async () => {
    const was = live !== null;
    endLive();
    return json({ stopped: was });
  },
);

server.registerTool(
  "felucca_song",
  {
    title: "Song chain control",
    description: "op: query | start | stop | set (rows = [[slot 0-3, repeats 1-16], ...], max 16 rows).",
    inputSchema: {
      port,
      op: z.enum(["query", "start", "stop", "set"]),
      rows: z.array(z.tuple([z.number().int().min(0).max(3), z.number().int().min(1).max(16)])).max(16).optional(),
    },
  },
  async ({ port: p, op, rows }) =>
    json(
      await withDevice(p, async (f) =>
        f.song({ query: 0, set: 1, start: 2, stop: 3 }[op] as 0 | 1 | 2 | 3, rows ?? []),
      ),
    ),
);

server.registerTool(
  "felucca_project",
  {
    title: "Project slots",
    description: "op: query (is the slot used) | load | save. Save writes flash (~2 s) and stops the transport.",
    inputSchema: { port, op: z.enum(["query", "load", "save"]), slot: z.number().int().min(0).max(3) },
  },
  async ({ port: p, op, slot }) =>
    json(await withDevice(p, async (f) => f.project({ load: 0, save: 1, query: 2 }[op] as 0 | 1 | 2, slot))),
);

await server.connect(new StdioServerTransport());
