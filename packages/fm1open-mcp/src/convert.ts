// MIDI notes -> FM1 Open step cells. Semantics from m-vave/fm1_open web/engine/sequencer.c:
//  melodic cell: velocity 0 = rest; drums field bits 0..4 chord, 5..8 gate (0 = 50%, 15 = full step,
//  else n/16), bit 12 tie (hold into next step, same note is not retriggered).
//  808/sampler cell: drums field is a pad mask; note low nibble must be 0 (high nibble = probability).
import type { MidiNote } from "./midi-file.js";
import { STEPS, type Step } from "./project.js";

export const REST: Step = { note: 60, velocity: 0, cell: 0 };
export const DRUM_REST: Step = { note: 0, velocity: 0, cell: 0 };

/** 808 pad order from drum808.h: BD SD LT MT HT RS CP CB CY OH CH. */
export const Pad808 = { BD: 0, SD: 1, LT: 2, MT: 3, HT: 4, RS: 5, CP: 6, CB: 7, CY: 8, OH: 9, CH: 10 } as const;

const GM_TO_808: Record<number, number> = {
  35: Pad808.BD, 36: Pad808.BD,
  38: Pad808.SD, 40: Pad808.SD,
  37: Pad808.RS,
  39: Pad808.CP,
  41: Pad808.LT, 43: Pad808.LT,
  45: Pad808.MT, 47: Pad808.MT,
  48: Pad808.HT, 50: Pad808.HT,
  56: Pad808.CB,
  49: Pad808.CY, 51: Pad808.CY, 52: Pad808.CY, 53: Pad808.CY, 55: Pad808.CY, 57: Pad808.CY, 59: Pad808.CY,
  46: Pad808.OH,
  42: Pad808.CH, 44: Pad808.CH,
};

export type Pick = "high" | "low";

const gateFor = (steps: number) => (steps >= 0.9 ? 15 : Math.max(1, Math.min(14, Math.round(steps * 16))));

/** One monophonic line (top or bottom note wins at each step) from beat `base` for 64 sixteenths. */
export function melodicLine(notes: MidiNote[], base: number, pick: Pick, transpose = 0): Step[] {
  type Cand = { note: number; vel: number; dur: number };
  const at = new Map<number, Cand>();
  for (const n of notes) {
    const s = Math.round((n.start - base) * 4);
    if (s < 0 || s >= STEPS) continue;
    const c = { note: Math.min(127, Math.max(0, n.note + transpose)), vel: Math.max(1, n.vel), dur: n.dur * 4 };
    const old = at.get(s);
    if (!old || (pick === "high" ? c.note > old.note : c.note < old.note)) at.set(s, c);
  }
  const out: Step[] = Array.from({ length: STEPS }, () => ({ ...REST }));
  const starts = [...at.keys()].sort((a, b) => a - b);
  starts.forEach((s, i) => {
    const c = at.get(s)!;
    const next = i + 1 < starts.length ? starts[i + 1] : STEPS;
    const n = Math.max(1, Math.min(Math.round(c.dur), next - s, STEPS - s));
    if (n === 1) {
      out[s] = { note: c.note, velocity: c.vel, cell: gateFor(c.dur) << 5 };
      return;
    }
    for (let k = 0; k < n - 1; k++) out[s + k] = { note: c.note, velocity: c.vel, cell: (15 << 5) | (1 << 12) };
    out[s + n - 1] = { note: c.note, velocity: c.vel, cell: gateFor(c.dur - (n - 1)) << 5 };
  });
  return out;
}

/** GM drums to the 808 pad mask grid. Unmapped notes are dropped. */
export function drumLine(notes: MidiNote[], base: number): Step[] {
  const out: Step[] = Array.from({ length: STEPS }, () => ({ ...DRUM_REST }));
  for (const n of notes) {
    const s = Math.round((n.start - base) * 4);
    const pad = GM_TO_808[n.note];
    if (s < 0 || s >= STEPS || pad === undefined) continue;
    const cur = out[s];
    out[s] = { note: 0, velocity: Math.max(cur.velocity, n.vel), cell: cur.cell | (1 << pad) };
  }
  return out;
}
