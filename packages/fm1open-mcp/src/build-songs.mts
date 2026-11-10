// Build FM1 Open project slots from MIDI files (4-bar sections).
// Usage: tsx src/build-songs.mts <template.bin> [--write "<port>"] [--only 0,1]
// Without --write nothing touches the device: it prints what would be written.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { drumLine, melodicLine, type Pick } from "./convert.js";
import { Fm1Open } from "./fm1open.js";
import { parseMidi, type MidiNote } from "./midi-file.js";
import { describe, readStep, readPreset, setName, setTempo, writeStep, STEPS, TRACKS } from "./project.js";
import { patchName } from "./dx7.js";

const dir = `${homedir()}/Documents/FM-1-midi-examples`;

type Line = { track: number; midiTrack: number; pick?: Pick; transpose?: number; drums?: boolean };
type Section = { slot: number; name: string; beat: number; lines: Line[]; voices: { track: number; program: number }[] };
type Song = { file: string; bpm: number; sections: Section[] };

// Library program numbers (see dump.mts): 65 WOODWIND 1, 117 KALIMBA, 4 PIANO 2.
const btwA: Line[] = [
  { track: 1, midiTrack: 1, pick: "low" }, // 303 bass
  { track: 2, midiTrack: 6, pick: "high" }, // PSG synth-voice arpeggio
  { track: 0, midiTrack: 3, pick: "high" }, // DX7 bottle blow
  { track: 6, midiTrack: 8, pick: "low" }, // 303 guitar
  { track: 7, midiTrack: 11, drums: true },
];
const btwB: Line[] = [
  { track: 1, midiTrack: 1, pick: "low" },
  { track: 0, midiTrack: 7, pick: "high" }, // DX7 xylo
  { track: 3, midiTrack: 5, pick: "high" }, // pluck marimba
  { track: 7, midiTrack: 11, drums: true },
];
const btwVoicesA = [{ track: 0, program: 65 }];
const btwVoicesB = [{ track: 0, program: 117 }];

const crkt: Line[] = [
  { track: 0, midiTrack: 1, pick: "high" }, // tine EP -> DX7
  { track: 1, midiTrack: 2, pick: "low", transpose: -12 }, // square bass -> 303
];
const crktVoices = [{ track: 0, program: 4 }];

export const songs: Song[] = [
  {
    file: `${dir}/behindtw.mid`,
    bpm: 125,
    sections: [
      { slot: 0, name: "BTW 1", beat: 224, lines: btwA, voices: btwVoicesA },
      { slot: 1, name: "BTW 2", beat: 240, lines: btwA, voices: btwVoicesA },
      { slot: 2, name: "BTW 3", beat: 256, lines: btwB, voices: btwVoicesB },
      { slot: 3, name: "BTW 4", beat: 272, lines: btwB, voices: btwVoicesB },
    ],
  },
  {
    file: `${dir}/Jan Hammer - Crockett's Theme (Miami Vice) - Solo - Ayla.mid`,
    bpm: 94,
    sections: [0, 1, 2, 3].map((i) => ({ slot: 4 + i, name: `CROCKETT ${i + 1}`, beat: i * 16, lines: crkt, voices: crktVoices })),
  },
];

export function buildBlob(template: Uint8Array, notes: MidiNote[], bpm: number, s: Section): Uint8Array {
  const p = template.slice();
  p[3834] = 0; // mute mask
  p[3835] = 0; // solo mask
  setTempo(p, bpm);
  setName(p, s.name);
  for (let t = 0; t < TRACKS; t++) {
    const drum = readPreset(template, t).type === 2 || readPreset(template, t).type === 5;
    for (let st = 0; st < STEPS; st++) writeStep(p, t, st, drum ? { note: 0, velocity: 0, cell: 0 } : { note: 60, velocity: 0, cell: 0 });
  }
  for (const l of s.lines) {
    const sel = notes.filter((n) => n.track === l.midiTrack && n.start >= s.beat - 0.25 && n.start < s.beat + 16);
    const cells = l.drums ? drumLine(sel, s.beat) : melodicLine(sel, s.beat, l.pick ?? "high", l.transpose ?? 0);
    cells.forEach((c, st) => writeStep(p, l.track, st, c));
  }
  return p;
}

const template = new Uint8Array(readFileSync(process.argv[2]));
const wi = process.argv.indexOf("--write");
const port = wi > 0 ? process.argv[wi + 1] : null;
const oi = process.argv.indexOf("--only");
const only = oi > 0 ? new Set(process.argv[oi + 1].split(",").map(Number)) : null;
const fm = port ? Fm1Open.open(port) : null;
try {
  for (const song of songs) {
    const { notes } = parseMidi(readFileSync(song.file));
    for (const s of song.sections) {
      if (only && !only.has(s.slot)) continue;
      const blob = buildBlob(template, notes, song.bpm, s);
      const d = describe(blob);
      const used = d.tracks.map((t) => {
        let n = 0;
        for (let st = 0; st < STEPS; st++) {
          const c = readStep(blob, t.track, st);
          if (c.velocity > 0 || (c.cell & 0x1f) > 0 && (t.source === "808" || t.source === "SAMPLE")) n++;
        }
        return `${t.track}:${t.source}=${n}`;
      });
      console.log(`slot ${s.slot} "${s.name}" ${song.bpm}bpm @beat ${s.beat}  ${used.join(" ")}`);
      if (!fm) continue;
      await fm.writeProject(blob);
      for (const v of s.voices) {
        const patch = await fm.libraryPatch(v.program);
        await fm.setTrackPatch(v.track, patch);
        console.log(`   t${v.track} voice ${v.program} ${patchName(patch)}`);
      }
      await fm.saveSlot(s.slot);
      console.log(`   saved slot ${s.slot}: ${await fm.slotName(s.slot)}`);
    }
  }
} finally {
  fm?.close();
}
