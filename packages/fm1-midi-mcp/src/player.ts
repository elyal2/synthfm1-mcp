import type { MidiNote } from "./midi-file.js";

export type Sender = { send(bytes: number[]): void };

export type PlayMap = {
  /** MIDI track index in the file. */
  midiTrack: number;
  /** MIDI channel 0..15 to send on (the synth decides what each channel plays). */
  channel: number;
  transpose: number;
  /** Optional Program Change sent on that channel before playing. */
  program?: number;
};

type Ev = { t: number; bytes: number[] };

/** Streams a parsed MIDI file to a port as live notes, optionally looping. */
export class Player {
  private timer: NodeJS.Timeout | null = null;
  private channels = new Set<number>();
  playing = false;
  durationSec = 0;

  start(
    out: Sender,
    notes: MidiNote[],
    maps: PlayMap[],
    bpm: number,
    opts: { fromBeat?: number; maxBeats?: number; loop?: boolean; onEnd?: () => void } = {},
  ) {
    this.stop(out);
    const from = opts.fromBeat ?? 0;
    const to = opts.maxBeats !== undefined ? from + opts.maxBeats : Infinity;
    const sec = (beat: number) => ((beat - from) * 60) / bpm;
    const evs: Ev[] = [];
    for (const m of maps) {
      this.channels.add(m.channel);
      if (m.program !== undefined) out.send([0xc0 | m.channel, m.program]);
    }
    for (const n of notes) {
      const m = maps.find((x) => x.midiTrack === n.track);
      if (!m || n.start < from || n.start >= to) continue;
      const note = Math.min(127, Math.max(0, n.note + m.transpose));
      evs.push({ t: sec(n.start), bytes: [0x90 | m.channel, note, n.vel] });
      evs.push({ t: sec(Math.min(n.start + n.dur * 0.95, to)), bytes: [0x80 | m.channel, note, 0] });
    }
    evs.sort((a, b) => a.t - b.t || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));
    this.durationSec = evs.length ? evs[evs.length - 1].t : 0;
    let t0 = performance.now() + 200;
    let i = 0;
    this.playing = true;
    this.timer = setInterval(() => {
      const now = (performance.now() - t0) / 1000;
      while (i < evs.length && evs[i].t <= now) out.send(evs[i++].bytes);
      if (i >= evs.length) {
        if (opts.loop) {
          this.silence(out);
          i = 0;
          t0 = performance.now() + 200;
        } else {
          this.stop(out);
          opts.onEnd?.();
        }
      }
    }, 2);
  }

  private silence(out: Sender) {
    for (const ch of this.channels) out.send([0xb0 | ch, 123, 0]);
  }

  stop(out: Sender) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playing) this.silence(out);
    this.playing = false;
  }
}
