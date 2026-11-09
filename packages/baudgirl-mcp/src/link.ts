import midi from "midi";

type MidiOutput = InstanceType<typeof midi.Output>;
type MidiInput = InstanceType<typeof midi.Input>;

export function listPorts(): { inputs: string[]; outputs: string[] } {
  const i = new midi.Input();
  const o = new midi.Output();
  const names = (p: MidiInput | MidiOutput) =>
    Array.from({ length: p.getPortCount() }, (_, k) => p.getPortName(k));
  return { inputs: names(i), outputs: names(o) };
}

function openByName<T extends MidiInput | MidiOutput>(port: T, sub: string, kind: string): T {
  const count = port.getPortCount();
  const all: string[] = [];
  for (let i = 0; i < count; i++) {
    all.push(port.getPortName(i));
    if (port.getPortName(i).includes(sub)) {
      port.openPort(i);
      return port;
    }
  }
  throw new Error(`No MIDI ${kind} port matches "${sub}". Known: ${all.join(", ") || "(none)"}`);
}

export class LinkError extends Error {}

/** A USB MIDI link to the FM-1+VA: send frames, or send and wait for a matching SysEx reply. */
export class Link {
  private listeners = new Set<(frame: Uint8Array) => void>();
  private partial: number[] | null = null;

  private constructor(
    private readonly input: MidiInput,
    private readonly output: MidiOutput,
  ) {
    input.ignoreTypes(false, true, true);
    input.on("message", (_dt, msg) => this.onMessage(msg));
  }

  static open(portSubstring: string): Link {
    const output = openByName(new midi.Output(), portSubstring, "output");
    const input = openByName(new midi.Input(), portSubstring, "input");
    return new Link(input, output);
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
    const bytes = Uint8Array.from(frame);
    for (const l of [...this.listeners]) l(bytes);
  }

  send(bytes: Uint8Array | number[]): void {
    this.output.sendMessage(Array.from(bytes));
  }

  ask<T>(
    msg: Uint8Array,
    match: (frame: Uint8Array) => T | null,
    timeoutMs = 1500,
    tries = 3,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let left = tries;
      let timer: NodeJS.Timeout | undefined;
      const stop = () => {
        clearTimeout(timer);
        this.listeners.delete(hear);
      };
      const hear = (frame: Uint8Array) => {
        let v: T | null = null;
        try {
          v = match(frame);
        } catch {
          // not ours
        }
        if (v) {
          stop();
          resolve(v);
        }
      };
      const attempt = () => {
        if (left-- <= 0) {
          stop();
          reject(new LinkError("The FM-1+VA did not answer (is the Sequencer playing? is it the FM-1+VA firmware?)."));
          return;
        }
        this.send(msg);
        timer = setTimeout(attempt, timeoutMs);
      };
      this.listeners.add(hear);
      attempt();
    });
  }

  close(): void {
    this.input.closePort();
    this.output.closePort();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
