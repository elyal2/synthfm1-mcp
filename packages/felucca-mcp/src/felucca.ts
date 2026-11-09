import { Link } from "./link.js";

// Felucca editor protocol (hugelton/Felucca, web/EDITOR_PROTOCOL.md, GPL-3.0 — read as a spec,
// implemented independently here). Request: F0 7D 46 4C <cmd> <args> F7, one at a time; the
// reply carries the same header and cmd.
const HEAD = [0xf0, 0x7d, 0x46, 0x4c];

export const CMD = {
  INFO: 1, GET: 2, SET: 3, DESC: 5, STEP_GET: 6, STEP_SET: 7, PRESET: 8, PROJECT: 9, NAMES: 10,
  WATCH: 22, PING: 25, TRACK: 27, TRACK_MIX: 28, TRACK_DUMP: 29, TRACK_STEP: 30, TRACK_PARAM: 31,
  SONG: 33,
} as const;

export const v14 = (value: number): number[] => {
  const n = value + 8192;
  return [n & 0x7f, (n >> 7) & 0x7f];
};
export const fromV14 = (lo: number, hi: number) => (lo | (hi << 7)) - 8192;

export class Reader {
  constructor(public readonly b: Uint8Array, public p = 0) {}
  u8() { return this.b[this.p++]; }
  v14() { const lo = this.b[this.p++]; const hi = this.b[this.p++]; return fromV14(lo, hi); }
  str() {
    let s = "";
    while (this.p < this.b.length && this.b[this.p] !== 0) s += String.fromCharCode(this.b[this.p++]);
    this.p++;
    return s;
  }
  get left() { return this.b.length - this.p; }
}

export class Felucca {
  constructor(private readonly link: Link) {}

  /** Sends one request and resolves with the reply's argument bytes. */
  async req(cmd: number, args: number[] = [], timeoutMs = 600, tries = 3): Promise<Reader> {
    const frame = Uint8Array.from([...HEAD, cmd, ...args, 0xf7]);
    const data = await this.link.ask(
      frame,
      (f) => (f.length >= 6 && f[1] === 0x7d && f[2] === 0x46 && f[3] === 0x4c && f[4] === cmd ? f.slice(5, -1) : null),
      timeoutMs,
      tries,
    );
    return new Reader(data);
  }

  async info() {
    const r = await this.req(CMD.INFO);
    const version = r.str();
    const nEngines = r.u8();
    const pCount = r.u8();
    const gCount = r.u8();
    const nStep = r.u8();
    const pE0 = r.u8();
    const engines = Array.from({ length: nEngines }, () => r.str());
    const nTrk = r.left ? r.u8() : 1;
    const chainRows = r.left ? r.u8() : 0;
    return { version, nEngines, pCount, gCount, nStep, pE0, engines, nTrk, chainRows };
  }

  async tracks() {
    const r = await this.req(CMD.TRACK);
    const selected = r.u8();
    const n = r.u8();
    const tracks = Array.from({ length: n }, (_, i) => ({
      track: i, engine: r.u8(), preset: r.u8(), level: r.v14(), mute: r.u8(), armed: r.u8(),
    }));
    return { selected, tracks };
  }

  async desc(scope: 0 | 1, id: number) {
    const r = await this.req(CMD.DESC, [scope, id]);
    r.u8(); r.u8();
    const fmt = r.u8();
    const min = r.v14(); const max = r.v14(); const def = r.v14();
    const label = r.str(); const unit = r.str();
    const names: string[] = [];
    if (fmt === 8) while (r.left > 0) names.push(r.str());
    return { scope, id, fmt, min, max, def, label, unit, names };
  }

  async getGlobal(id: number) {
    const r = await this.req(CMD.GET, [1, id]);
    r.u8(); r.u8();
    return r.v14();
  }

  async setGlobal(id: number, value: number) {
    const r = await this.req(CMD.SET, [1, id, ...v14(value)]);
    r.u8(); r.u8();
    return r.v14();
  }

  async selectTrack(track: number) {
    await this.req(CMD.TRACK, [track]);
  }

  async loadPreset(engine: number, preset: number) {
    await this.req(CMD.PRESET, [engine, preset], 1500);
  }

  /** time: 0 NOTE, 1 TIE, 2 REST. Up to 4 notes; the step keeps its other bytes (hits, chance…). */
  async setStep(track: number, index: number, s: { notes: number[]; time: 0 | 1 | 2; vel: number; flags?: number }) {
    const notes = s.notes.slice(0, 4);
    const args = [track, index, notes.length, ...notes, ...Array(4 - notes.length).fill(0), s.time, s.flags ?? 0, s.vel];
    await this.req(CMD.TRACK_STEP, args);
  }

  async project(op: 0 | 1 | 2, slot: number) {
    const r = await this.req(CMD.PROJECT, [op, slot], 4000, 2);
    return Array.from(r.b);
  }

  /** SONG: op 0 query, 1 set rows [(slot, repeat)], 2 start, 3 stop. Returns [op, rc, count, running, row, remaining, …]. */
  async song(op: 0 | 1 | 2 | 3, rows: [number, number][] = []) {
    const args = op === 1 ? [1, rows.length, ...rows.flat()] : [op];
    const r = await this.req(CMD.SONG, args, 1500);
    return Array.from(r.b);
  }

  async trackParam(track: number, id: number) {
    const r = await this.req(CMD.TRACK_PARAM, [track, id]);
    r.u8(); r.u8();
    return r.v14();
  }

  async setTrackParam(track: number, id: number, value: number) {
    const r = await this.req(CMD.TRACK_PARAM, [track, id, ...v14(value)]);
    r.u8(); r.u8();
    return r.v14();
  }
}
