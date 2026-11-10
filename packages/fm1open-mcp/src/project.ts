// Layout of struct groove_project (version 4, 4064 bytes, little-endian) from
// m-vave/fm1_open app/instrument.h. Values only; the device validates on import.
export const TRACKS = 8;
export const STEPS = 64;
export const PRESET_BYTES = 223;
const STEP_OFF = 0;
const PRESET_OFF = TRACKS * STEPS * 4; // 2048
const TEMPO_OFF = PRESET_OFF + TRACKS * PRESET_BYTES; // 3832
const MUTE_OFF = TEMPO_OFF + 2;
const SOLO_OFF = MUTE_OFF + 1;
const NAME_OFF = SOLO_OFF + 1; // 3836, 12 chars space padded

export const Source = ["DX7", "303", "808", "PSG", "PLUCK", "SAMPLE"] as const;

export type Step = {
  note: number; // MIDI note, 0 = none (melodic)
  velocity: number;
  /** Melodic: bits 0..4 chord, 5..8 gate, 9..11 probability, 12 tie, 13 alt tuning.
   *  Drum tracks: pad mask. */
  cell: number;
};

export function readStep(p: Uint8Array, track: number, step: number): Step {
  const o = STEP_OFF + (track * STEPS + step) * 4;
  return { note: p[o], velocity: p[o + 1], cell: p[o + 2] | (p[o + 3] << 8) };
}

export function writeStep(p: Uint8Array, track: number, step: number, s: Step): void {
  const o = STEP_OFF + (track * STEPS + step) * 4;
  p[o] = s.note;
  p[o + 1] = s.velocity;
  p[o + 2] = s.cell & 255;
  p[o + 3] = s.cell >> 8;
}

export function readPreset(p: Uint8Array, track: number) {
  const o = PRESET_OFF + track * PRESET_BYTES;
  return { type: p[o], volume: p[o + 1], program: p[o + 2], modified: p[o + 3], sequencePages: p[o + 221], samplerPads: p[o + 222] };
}

export function presetBytes(p: Uint8Array, track: number): Uint8Array {
  const o = PRESET_OFF + track * PRESET_BYTES;
  return p.slice(o, o + PRESET_BYTES);
}

export function setPresetBytes(p: Uint8Array, track: number, preset: Uint8Array): void {
  p.set(preset.subarray(0, PRESET_BYTES), PRESET_OFF + track * PRESET_BYTES);
}

export const tempoOf = (p: Uint8Array) => p[TEMPO_OFF] | (p[TEMPO_OFF + 1] << 8);

export function setTempo(p: Uint8Array, bpm: number): void {
  p[TEMPO_OFF] = bpm & 255;
  p[TEMPO_OFF + 1] = bpm >> 8;
}

export const nameOf = (p: Uint8Array) => String.fromCharCode(...p.slice(NAME_OFF, NAME_OFF + 12)).trimEnd();

export function setName(p: Uint8Array, name: string): void {
  const n = name.replace(/[^\x20-\x7e]/g, "?").slice(0, 12).padEnd(12, " ");
  for (let i = 0; i < 12; i++) p[NAME_OFF + i] = n.charCodeAt(i);
}

export const mutedMask = (p: Uint8Array) => p[MUTE_OFF];
export const soloMask = (p: Uint8Array) => p[SOLO_OFF];

export function describe(p: Uint8Array) {
  return {
    name: nameOf(p),
    tempo: tempoOf(p),
    muteMask: mutedMask(p),
    soloMask: soloMask(p),
    tracks: Array.from({ length: TRACKS }, (_, t) => {
      const pr = readPreset(p, t);
      let notes = 0;
      let last = -1;
      for (let s = 0; s < STEPS; s++) {
        const st = readStep(p, t, s);
        if (st.note || st.cell & 0xff) {
          notes++;
          last = s;
        }
      }
      return { track: t, source: Source[pr.type] ?? `?${pr.type}`, program: pr.program, volume: pr.volume, pages: pr.sequencePages, filledSteps: notes, lastStep: last };
    }),
  };
}
