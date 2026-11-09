import midi from "midi";

type MidiOutput = InstanceType<typeof midi.Output>;

export function listOutputPorts(): string[] {
  const output = new midi.Output();
  const count = output.getPortCount();
  const names: string[] = [];
  for (let i = 0; i < count; i++) names.push(output.getPortName(i));
  output.closePort();
  return names;
}

export function openOutputByName(nameSubstring: string): MidiOutput {
  const output = new midi.Output();
  const count = output.getPortCount();
  for (let i = 0; i < count; i++) {
    if (output.getPortName(i).includes(nameSubstring)) {
      output.openPort(i);
      return output;
    }
  }
  output.closePort();
  throw new Error(
    `No MIDI output port matches "${nameSubstring}". Known ports: ${listOutputPorts().join(", ") || "(none)"}`,
  );
}

export function sendSysex(output: MidiOutput, bytes: Uint8Array): void {
  output.sendMessage(Array.from(bytes));
}
