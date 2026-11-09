import midi from "midi";

export function listPorts(): { inputs: string[]; outputs: string[] } {
  const i = new midi.Input();
  const o = new midi.Output();
  const names = (p: InstanceType<typeof midi.Input> | InstanceType<typeof midi.Output>) =>
    Array.from({ length: p.getPortCount() }, (_, k) => p.getPortName(k));
  return { inputs: names(i), outputs: names(o) };
}

/** An output-only MIDI port (USB or Bluetooth LE MIDI), matched by a name substring. */
export class MidiOut {
  private constructor(private readonly out: InstanceType<typeof midi.Output>) {}

  static open(nameSubstring: string): MidiOut {
    const out = new midi.Output();
    const names: string[] = [];
    for (let i = 0; i < out.getPortCount(); i++) {
      names.push(out.getPortName(i));
      if (out.getPortName(i).toLowerCase().includes(nameSubstring.toLowerCase())) {
        out.openPort(i);
        return new MidiOut(out);
      }
    }
    throw new Error(`No MIDI output port matches "${nameSubstring}". Known: ${names.join(", ") || "(none)"}`);
  }

  send(bytes: number[]): void {
    this.out.sendMessage(bytes);
  }

  close(): void {
    this.out.closePort();
  }
}
