export type MidiNote = { ch: number; track: number; note: number; start: number; dur: number; vel: number };

/** Byte cursor. A class (not closures over a mutable local) so parsing is deterministic. */
class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  u8(): number {
    return this.buf[this.pos++];
  }
  u16(): number {
    const a = this.u8();
    const b = this.u8();
    return (a << 8) | b;
  }
  u32(): number {
    const a = this.u8();
    const b = this.u8();
    const c = this.u8();
    const d = this.u8();
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }
  vlq(): number {
    let v = 0;
    let b: number;
    do {
      b = this.u8();
      v = (v << 7) | (b & 0x7f);
    } while (b & 0x80);
    return v;
  }
  ascii(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.buf[this.pos + i]);
    this.pos += n;
    return s;
  }
}

/** Minimal SMF reader (formats 0/1): note on/off only, times in quarter-note beats. */
export function parseMidi(buf: Uint8Array): { notes: MidiNote[]; bpm: number | null } {
  const r = new Reader(buf);
  if (r.ascii(4) !== "MThd") throw new Error("not a MIDI file");
  r.pos += 4;
  r.u16(); // format
  const ntrks = r.u16();
  const division = r.u16();
  if (division & 0x8000) throw new Error("SMPTE time division is not supported");

  const notes: MidiNote[] = [];
  let bpm: number | null = null;
  for (let t = 0; t < ntrks; t++) {
    if (r.ascii(4) !== "MTrk") throw new Error("bad track header");
    const length = r.u32();
    const end = r.pos + length;
    let tick = 0;
    let running = 0;
    const on = new Map<number, { tick: number; vel: number }>();
    while (r.pos < end) {
      tick += r.vlq();
      const first = buf[r.pos];
      if (first === 0xff) {
        r.pos++;
        const type = r.u8();
        const n = r.vlq();
        if (type === 0x51 && bpm === null) bpm = Math.round(60000000 / ((buf[r.pos] << 16) | (buf[r.pos + 1] << 8) | buf[r.pos + 2]));
        r.pos += n;
        continue;
      }
      if (first === 0xf0 || first === 0xf7) {
        r.pos++;
        r.pos += r.vlq();
        running = 0;
        continue;
      }
      let status = first;
      if (status & 0x80) {
        running = status;
        r.pos++;
      } else status = running;
      const hi = status & 0xf0;
      const ch = status & 15;
      const a = r.u8();
      const b = hi === 0xc0 || hi === 0xd0 ? 0 : r.u8();
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
    r.pos = end;
  }
  return { notes: notes.sort((x, y) => x.start - y.start), bpm };
}
