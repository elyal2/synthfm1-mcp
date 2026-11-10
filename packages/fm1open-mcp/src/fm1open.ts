// Client for the project-transfer SysEx documented in the comment at the top of
// m-vave/fm1_open app/transfer.c (read independently; no code copied):
//   F0 7D 'F' 'M' 02 cmd token-lo token-hi <packed data> checksum F7
// Packing = LSB-first stream of 8-bit bytes in 7-bit groups. Checksum makes the sum
// of bytes 7D..checksum zero mod 128. Replies set cmd bit 6 and begin with a status
// byte (0 ok, 1 empty, 64-error for negative errors). One request at a time.
import midi from "midi";
import { vmemToPatch } from "./dx7.js";

type MidiOutput = InstanceType<typeof midi.Output>;
type MidiInput = InstanceType<typeof midi.Input>;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function listPorts(): { inputs: string[]; outputs: string[] } {
  const i = new midi.Input();
  const o = new midi.Output();
  const names = (p: MidiInput | MidiOutput) => Array.from({ length: p.getPortCount() }, (_, k) => p.getPortName(k));
  return { inputs: names(i), outputs: names(o) };
}

function openByName<T extends MidiInput | MidiOutput>(port: T, sub: string, kind: string): T {
  const all: string[] = [];
  for (let i = 0; i < port.getPortCount(); i++) {
    all.push(port.getPortName(i));
    if (port.getPortName(i).toLowerCase().includes(sub.toLowerCase())) {
      port.openPort(i);
      return port;
    }
  }
  throw new Error(`No MIDI ${kind} port matches "${sub}". Known: ${all.join(", ") || "(none)"}`);
}

/** Pack 8-bit bytes into 7-bit MIDI data bytes, LSB first. */
export function pack7(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (let i = 0; i < data.length; i++) {
    value |= data[i] << bits;
    bits += 8;
    while (bits >= 7) {
      out.push(value & 127);
      value >>= 7;
      bits -= 7;
    }
  }
  if (bits) out.push(value & 127);
  return out;
}

export function unpack7(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (let i = 0; i < data.length; i++) {
    value |= data[i] << bits;
    bits += 7;
    if (bits >= 8) {
      out.push(value & 255);
      value >>= 8;
      bits -= 8;
    }
  }
  return out;
}

export function crc32(buf: ArrayLike<number>): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

export class Fm1Error extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** Transfer kinds for cmd 1 / cmd 3. */
export const Kind = { project: 0, fmVoice: 1, timbre: 2, projectTuned: 3, dx7Bank: 4 } as const;

const PROJECT_BYTES = 4064;

export class Fm1Open {
  private listeners = new Set<(f: number[]) => void>();
  private partial: number[] | null = null;
  private token = (Date.now() & 0x3fff) + 1;

  private constructor(
    private readonly input: MidiInput,
    private readonly output: MidiOutput,
  ) {
    input.ignoreTypes(false, true, true);
    input.on("message", (_dt, msg) => this.onMessage(msg));
  }

  static open(portSubstring: string): Fm1Open {
    const output = openByName(new midi.Output(), portSubstring, "output");
    const input = openByName(new midi.Input(), portSubstring, "input");
    return new Fm1Open(input, output);
  }

  private onMessage(msg: number[]): void {
    let frame = msg;
    if (this.partial) {
      frame = [...this.partial, ...msg];
      this.partial = null;
    }
    if (frame[0] !== 0xf0) return;
    if (frame[frame.length - 1] !== 0xf7) {
      this.partial = frame;
      return;
    }
    for (const l of [...this.listeners]) l(frame);
  }

  close(): void {
    this.input.closePort();
    this.output.closePort();
  }

  /** One request, one reply. Returns [status, ...data]. */
  async call(cmd: number, data: ArrayLike<number> = [], timeoutMs = 2500, tries = 3): Promise<{ status: number; data: number[] }> {
    this.token = (this.token % 0x3fff) + 1; // never reuse: identical retries get a cached reply
    const tLo = this.token & 127;
    const tHi = this.token >> 7;
    const body = [0x7d, 0x46, 0x4d, 0x02, cmd, tLo, tHi, ...pack7(data)];
    const sum = body.reduce((a, b) => a + b, 0);
    const frame = [0xf0, ...body, (128 - (sum & 127)) & 127, 0xf7];
    return new Promise((resolve, reject) => {
      let left = tries;
      let timer: NodeJS.Timeout | undefined;
      const stop = () => {
        clearTimeout(timer);
        this.listeners.delete(hear);
      };
      const hear = (f: number[]) => {
        if (f.length < 11 || f[1] !== 0x7d || f[2] !== 0x46 || f[3] !== 0x4d || f[5] !== (cmd | 64) || f[6] !== tLo || f[7] !== tHi) return;
        const s = f.slice(1, f.length - 1).reduce((a, b) => a + b, 0);
        if (s & 127) return;
        const bytes = unpack7(f.slice(8, f.length - 2));
        stop();
        resolve({ status: bytes[0] ?? 0, data: bytes.slice(1) });
      };
      const attempt = () => {
        if (left-- <= 0) {
          stop();
          reject(new Fm1Error(`No reply to cmd ${cmd}. Is the FM-1 on FM1 Open V14, and is the workbench tab closed?`));
          return;
        }
        this.output.sendMessage(frame);
        timer = setTimeout(attempt, timeoutMs);
      };
      this.listeners.add(hear);
      attempt();
    });
  }

  /** Like call, but throws unless status is 0. */
  async ok(cmd: number, data: ArrayLike<number> = []): Promise<number[]> {
    const r = await this.call(cmd, data);
    if (r.status !== 0) throw new Fm1Error(`cmd ${cmd} failed: ${r.status === 1 ? "empty" : `error ${-(r.status - 64)}`}`, r.status);
    return r.data;
  }

  async info() {
    const d = await this.ok(0);
    return { slots: d[1], slot: d[2], projectBytes: d[3] | (d[4] << 8), externalClock: d[5] === 1, trackTypes: d.slice(6, 14) };
  }

  async capabilities() {
    const d = await this.ok(22);
    return { version: d[0], dx7Voices: d[1], dx7Groups: d[2], libraryAvailable: d[3] === 1, sampleLimit: (d[4] | (d[5] << 8) | (d[6] << 16) | (d[7] << 24)) >>> 0, flags: d[8] };
  }

  /** Name of a stored slot, or null if empty. */
  async slotName(slot: number): Promise<string | null> {
    const r = await this.call(9, [slot]);
    if (r.status !== 0) return null;
    return String.fromCharCode(...r.data.slice(0, 12)).trimEnd();
  }

  async read(kind: number, target: number): Promise<Uint8Array> {
    const head = await this.ok(1, [kind, target]);
    const size = head[0] | (head[1] << 8);
    const out = new Uint8Array(size);
    for (let at = 0; at < size; at += 64) {
      const n = Math.min(64, size - at);
      const chunk = await this.ok(2, [at & 255, at >> 8, n]);
      out.set(chunk.slice(0, n), at);
    }
    return out;
  }

  async write(kind: number, target: number, bytes: Uint8Array): Promise<void> {
    await this.ok(3, [kind, target, bytes.length & 255, bytes.length >> 8]);
    try {
      for (let at = 0; at < bytes.length; at += 64) {
        const chunk = Array.from(bytes.subarray(at, at + 64));
        await this.ok(4, [at & 255, at >> 8, ...chunk]);
      }
      const c = crc32(bytes);
      await this.ok(5, [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255]);
    } catch (e) {
      await this.call(6).catch(() => undefined); // cancel the half-written transfer
      throw e;
    }
  }

  /** Raw MIDI bytes (e.g. 0xFA Start, 0xFC Stop, notes). */
  sendRaw(bytes: number[]): void {
    this.output.sendMessage(bytes);
  }

  /** Voice `index` 0..127 of the DX7 library, as a 156-byte track patch. */
  async libraryPatch(index: number): Promise<Uint8Array> {
    const bank = await this.read(Kind.dx7Bank, index >> 5);
    const o = (index & 31) * 128;
    return vmemToPatch(bank.subarray(o, o + 128));
  }

  /** Replace the FM voice of a DX7 track in the working project. */
  setTrackPatch(track: number, patch: Uint8Array) {
    return this.write(Kind.fmVoice, track, patch);
  }

  readProject() {
    return this.read(Kind.project, 0);
  }

  async writeProject(p: Uint8Array): Promise<void> {
    if (p.length !== PROJECT_BYTES) throw new Fm1Error(`project must be ${PROJECT_BYTES} bytes`);
    await this.write(Kind.project, 0, p);
  }

  saveSlot(slot: number) {
    return this.ok(7, [slot]);
  }

  loadSlot(slot: number) {
    return this.ok(8, [slot]);
  }
}
