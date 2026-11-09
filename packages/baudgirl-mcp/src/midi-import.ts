import type { PatternSpec, StepSpec } from "./device.js";
import type { MidiNote } from "./midi-file.js";

/** General MIDI drum note -> 8-Bit drum key (F0..E1 = 17..28), by the RAW KIT layout. */
export const GM_TO_8BIT: Record<number, number> = {
  35: 17, 36: 17, 38: 19, 40: 19, 39: 21, 37: 21, 42: 18, 44: 20, 46: 22, 49: 28, 57: 28, 51: 22, 53: 22,
  41: 23, 43: 24, 45: 26, 47: 26, 48: 26, 50: 26, 69: 25, 70: 25, 82: 25, 54: 25, 56: 27,
};

export type ImportOptions = {
  bassChannels: number[];
  leadChannels: number[];
  drumChannels: number[];
  /** Track indexes (file order), for files whose tracks share a channel. */
  bassTracks: number[];
  leadTracks: number[];
  bassTranspose: number;
  leadTranspose: number;
  loop: boolean;
  /** 0-based step to start from, in 16ths after the first note (skips an intro). */
  fromStep: number;
  maxPatterns: number;
};

const fold = (n: number, lo: number, hi: number) => {
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  return n;
};
const lengthIndex = (steps: number) => (steps >= 16 ? 0 : steps >= 8 ? 1 : steps >= 4 ? 2 : steps >= 2 ? 4 : undefined);

/** Quantizes to 16th steps and splits into 64-step patterns laid out for an 8-Bit preset's lanes. */
export function toPatterns(
  notes: MidiNote[],
  opt: ImportOptions,
  startPat: number,
): { specs: { pat: number; spec: PatternSpec }[]; dropped: number; totalSteps: number } {
  const isBass = (n: MidiNote) => opt.bassChannels.includes(n.ch) || opt.bassTracks.includes(n.track);
  const isLead = (n: MidiNote) => opt.leadChannels.includes(n.ch) || opt.leadTracks.includes(n.track);
  const used = notes.filter((n) => isBass(n) || isLead(n) || opt.drumChannels.includes(n.ch));
  if (!used.length) throw new Error("no notes on the requested channels");
  const t0 = Math.min(...used.map((n) => n.start));
  type Item = { note: number; vel: number; prio: number; len?: number };
  const grid = new Map<number, Item[]>();
  let last = 0;
  for (const n of used) {
    const step = Math.round((n.start - t0) * 4) - opt.fromStep;
    if (step < 0) continue;
    let item: Item | null = null;
    if (!isBass(n) && !isLead(n)) {
      const key = GM_TO_8BIT[n.note];
      if (key !== undefined) item = { note: key, vel: Math.min(127, Math.max(1, n.vel)), prio: n.note === 69 ? 9 : 1 };
    } else if (isBass(n)) {
      item = { note: fold(n.note + opt.bassTranspose, 41, 76), vel: n.vel, prio: 2 };
    } else {
      const sound = fold(n.note + opt.leadTranspose, 65, 100);
      item = { note: sound + 12, vel: n.vel, prio: 3, len: lengthIndex(Math.round(n.dur * 4)) };
    }
    if (!item) continue;
    (grid.get(step) ?? grid.set(step, []).get(step)!).push(item);
    last = Math.max(last, step);
  }

  const totalSteps = last + 1;
  const count = Math.min(Math.ceil(totalSteps / 64), opt.maxPatterns);
  let dropped = 0;
  const specs: { pat: number; spec: PatternSpec }[] = [];
  for (let i = 0; i < count; i++) {
    const steps: StepSpec[] = [];
    for (let k = 0; k < 64; k++) {
      const items = grid.get(i * 64 + k);
      if (!items) continue;
      const seen = new Set<number>();
      const kept = items
        .sort((a, b) => a.prio - b.prio)
        .filter((it) => (seen.has(it.note) ? false : (seen.add(it.note), true)));
      dropped += items.length - Math.min(kept.length, 9);
      const lens = kept.map((it) => it.len).filter((l): l is number => l !== undefined);
      steps.push({
        step: k,
        notes: kept.slice(0, 9).map((it) => ({ note: it.note, vel: it.vel })),
        ...(lens.length ? { length: Math.min(...lens) } : {}),
      });
    }
    const stepsLength = i === count - 1 ? totalSteps - i * 64 : 64;
    const next = i === count - 1 ? (opt.loop ? startPat : null) : startPat + i + 1;
    specs.push({
      pat: startPat + i,
      spec: {
        stepsLength: Math.min(64, Math.max(1, stepsLength)),
        rate: 6,
        gate: 50,
        swing: 50,
        chain: next === null ? "repeat" : { next, repeats: 1 },
        steps,
      },
    });
  }
  return { specs, dropped, totalSteps };
}
