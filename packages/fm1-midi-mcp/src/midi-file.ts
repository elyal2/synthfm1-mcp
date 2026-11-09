export type MidiNote = { ch: number; track: number; note: number; start: number; dur: number; vel: number };

/** Minimal SMF reader (formats 0/1): note on/off only, times in quarter-note beats. */
export function parseMidi(buf: Uint8Array): { notes: MidiNote[]; bpm: number | null } {
  let p = 0;
  const ascii = (n: number) => String.fromCharCode(...buf.subarray(p, p + n));
  const u32 = () => ((buf[p++] << 24) | (buf[p++] << 16) | (buf[p++] << 8) | buf[p++]) >>> 0;
  const u16 = () => (buf[p++] << 8) | buf[p++];
  const vlq = () => {
    let v = 0;
    let b: number;
    do {
      b = buf[p++];
      v = (v << 7) | (b & 0x7f);
    } while (b & 0x80);
    return v;
  };
  if (ascii(4) !== "MThd") throw new Error("not a MIDI file");
  p += 4;
  u32();
  u16();
  const ntrks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error("SMPTE time division is not supported");

  const notes: MidiNote[] = [];
  let bpm: number | null = null;
  for (let t = 0; t < ntrks; t++) {
    if (ascii(4) !== "MTrk") throw new Error("bad track header");
    p += 4;
    const len = u32();
    const end = p + len;
    let tick = 0;
    let run = 0;
    const on = new Map<number, { tick: number; vel: number }>();
    while (p < end) {
      tick += vlq();
      let s = buf[p];
      if (s === 0xff) {
        p++;
        const type = buf[p++];
        const len = vlq();
        if (type === 0x51 && bpm === null) {
          bpm = Math.round(60000000 / ((buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2]));
        }
        p += len;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        p++;
        p += vlq();
        run = 0;
        continue;
      }
      if (s & 0x80) {
        run = s;
        p++;
      } else s = run;
      const hi = s & 0xf0;
      const ch = s & 15;
      const a = buf[p++];
      const b = hi === 0xc0 || hi === 0xd0 ? 0 : buf[p++];
      const key = ch * 128 + a;
      if (hi === 0x90 && b > 0) on.set(key, { tick, vel: b });
      else if (hi === 0x80 || (hi === 0x90 && b === 0)) {
        const st = on.get(key);
        if (st) {
          notes.push({ ch, track: t, note: a, start: st.tick / division, dur: (tick - st.tick) / division, vel: st.vel });
          on.delete(key);
        }
      }
    }
    p = end;
  }
  return { notes: notes.sort((x, y) => x.start - y.start), bpm };
}
