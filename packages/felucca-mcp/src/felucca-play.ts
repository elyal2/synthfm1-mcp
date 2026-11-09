import type { Link } from "./link.js";
import type { MidiNote } from "./midi-file.js";

export type PlayMap = {
  /** MIDI track index in the file. */
  midiTrack: number;
  /** MIDI channel 0..3 = Felucca track 1..4 (MIDI IN routing CH1-4). */
  channel: number;
  transpose: number;
};

type Ev = { t: number; bytes: number[] };

/** Streams a parsed MIDI file to the device as live notes, so the song is not limited by project slots. */
export class Player {
  private timer: NodeJS.Timeout | null = null;
  private channels = new Set<number>();
  playing = false;
  durationSec = 0;

  start(link: Link, notes: MidiNote[], maps: PlayMap[], bpm: number, opts: { fromBeat?: number; maxBeats?: number; onEnd?: () => void } = {}) {
    this.stop(link);
    const from = opts.fromBeat ?? 0;
    const to = opts.maxBeats !== undefined ? from + opts.maxBeats : Infinity;
    const evs: Ev[] = [];
    const sec = (beat: number) => ((beat - from) * 60) / bpm;
    for (const n of notes) {
      const m = maps.find((x) => x.midiTrack === n.track);
      if (!m || n.start < from || n.start >= to) continue;
      const note = Math.min(127, Math.max(0, n.note + m.transpose));
      this.channels.add(m.channel);
      evs.push({ t: sec(n.start), bytes: [0x90 | m.channel, note, n.vel] });
      evs.push({ t: sec(Math.min(n.start + n.dur * 0.95, to)), bytes: [0x80 | m.channel, note, 0] });
    }
    evs.sort((a, b) => a.t - b.t || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));
    this.durationSec = evs.length ? evs[evs.length - 1].t : 0;
    const t0 = performance.now() + 200;
    let i = 0;
    this.playing = true;
    this.timer = setInterval(() => {
      const now = (performance.now() - t0) / 1000;
      while (i < evs.length && evs[i].t <= now) link.send(evs[i++].bytes);
      if (i >= evs.length) {
        this.stop(link);
        opts.onEnd?.();
      }
    }, 2);
  }

  stop(link: Link) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playing) for (const ch of this.channels) link.send([0xb0 | ch, 123, 0]);
    this.playing = false;
    this.channels.clear();
  }
}
