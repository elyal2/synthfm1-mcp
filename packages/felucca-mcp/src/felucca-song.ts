import type { Felucca } from "./felucca.js";
import type { MidiNote } from "./midi-file.js";

const STEPS = 64;
type StepPlan = { notes: number[]; time: 0 | 1 | 2; vel: number };

export type TrackMap = {
  /** MIDI track index in the file. */
  midiTrack: number;
  /** Felucca track 0..3. */
  track: number;
  engine: number;
  preset: number;
  transpose: number;
};

/** One 64-step chunk of a MIDI track as Felucca steps: notes, then TIE steps for held notes. */
function chunkSteps(notes: MidiNote[], chunk: number, transpose: number): StepPlan[] {
  const steps: StepPlan[] = Array.from({ length: STEPS }, () => ({ notes: [], time: 2 as const, vel: 0 }));
  const lens = new Map<number, number>();
  for (const n of notes) {
    const s = Math.round(n.start * 4) - chunk * STEPS;
    if (s < 0 || s >= STEPS) continue;
    const note = Math.min(127, Math.max(0, n.note + transpose));
    if (!steps[s].notes.includes(note) && steps[s].notes.length < 4) steps[s].notes.push(note);
    steps[s].time = 0;
    steps[s].vel = Math.max(steps[s].vel, n.vel);
    lens.set(s, Math.min(lens.get(s) ?? 99, Math.max(1, Math.round(n.dur * 4))));
  }
  const starts = [...lens.keys()].sort((a, b) => a - b);
  starts.forEach((s, i) => {
    const next = starts[i + 1] ?? STEPS;
    const hold = Math.min(lens.get(s)!, next - s, STEPS - s);
    for (let k = 1; k < hold; k++) steps[s + k] = { notes: [], time: 1, vel: steps[s].vel };
  });
  return steps;
}

const keyOf = (plans: StepPlan[][]) => JSON.stringify(plans);

export type SongPlan = {
  slots: { chunk: number; tracks: Map<number, StepPlan[]> }[];
  rows: [number, number][];
  coveredChunks: number;
  totalChunks: number;
};

/** Splits the file into 64-step chunks, gives each distinct chunk a project slot (max 4), chains them. */
export function planSong(notes: MidiNote[], maps: TrackMap[], maxSlots = 4, maxRows = 16): SongPlan {
  const last = Math.max(...notes.map((n) => Math.round(n.start * 4)));
  const totalChunks = Math.floor(last / STEPS) + 1;
  const slots: SongPlan["slots"] = [];
  const keyToSlot = new Map<string, number>();
  const seq: number[] = [];
  for (let c = 0; c < totalChunks; c++) {
    const tracks = new Map<number, StepPlan[]>();
    for (const m of maps) {
      tracks.set(m.track, chunkSteps(notes.filter((n) => n.track === m.midiTrack), c, m.transpose));
    }
    const key = keyOf([...tracks.values()]);
    let slot = keyToSlot.get(key);
    if (slot === undefined) {
      if (slots.length >= maxSlots) break;
      slot = slots.length;
      keyToSlot.set(key, slot);
      slots.push({ chunk: c, tracks });
    }
    seq.push(slot);
  }
  const rows: [number, number][] = [];
  for (const s of seq) {
    const prev = rows[rows.length - 1];
    if (prev && prev[0] === s && prev[1] < 16) prev[1]++;
    else rows.push([s, 1]);
  }
  return { slots, rows: rows.slice(0, maxRows), coveredChunks: seq.length, totalChunks };
}

export async function writeSong(
  f: Felucca,
  plan: SongPlan,
  maps: TrackMap[],
  bpm: number,
  onProgress: (msg: string) => void = () => {},
) {
  await f.song(3);
  await f.setGlobal(0, bpm);
  for (const m of maps) {
    await f.selectTrack(m.track);
    await f.loadPreset(m.engine, m.preset);
    await f.setTrackParam(m.track, 29, STEPS); // LEN
    await f.setTrackParam(m.track, 30, 2); // DIV = 1/16
  }
  const used = new Set(maps.map((m) => m.track));
  for (let t = 0; t < 4; t++) if (!used.has(t)) await f.setTrackParam(t, 40, 1); // MUTE the rest
  for (let i = 0; i < plan.slots.length; i++) {
    for (const [track, steps] of plan.slots[i].tracks) {
      for (let k = 0; k < STEPS; k++) {
        const s = steps[k];
        await f.setStep(track, k, { notes: s.notes, time: s.time, vel: s.vel });
      }
    }
    await f.project(1, i);
    onProgress(`slot ${i} saved (chunk ${plan.slots[i].chunk})`);
  }
  const rc = await f.song(1, plan.rows);
  return rc;
}
