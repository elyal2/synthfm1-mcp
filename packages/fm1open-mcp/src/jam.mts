// Loop a stored project on the device's own clock and play a generated lead live on top.
// Usage: tsx src/jam.mts "<port>" <slot> [passes] [libraryVoice] [leadTrack]
// The lead goes to a free DX7 track via its MIDI input channel (track n -> channel n+1).
import { Fm1Open, sleep } from "./fm1open.js";
import { patchName } from "./dx7.js";
import { readPreset, readStep, STEPS, tempoOf, nameOf } from "./project.js";

const [port = "FM1", slotArg = "0", passesArg = "4", voiceArg = "2", trackArg = "5"] = process.argv.slice(2);
const slot = Number(slotArg);
const passes = Number(passesArg);
const voice = Number(voiceArg);
const lead = Number(trackArg);
const channel = lead; // track 5 listens on MIDI channel 6 (index 5)

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const fm = Fm1Open.open(port);
try {
  await fm.loadSlot(slot);
  const p = await fm.readProject();
  const expected = await fm.slotName(slot);
  if (nameOf(p) !== expected) throw new Error(`Working project is "${nameOf(p)}", expected "${expected}" from slot ${slot}; not touching any track.`);
  const bpm = tempoOf(p);
  const stepSec = 60 / bpm / 4;
  console.log(`slot ${slot} ${JSON.stringify(nameOf(p))} ${bpm} bpm, lead on track ${lead}`);

  // Harmony from the project itself: scale = pitch classes of the melodic tracks, root = commonest bass pc.
  const pcCount = (tr: number[]) => {
    const h = new Array(12).fill(0);
    for (const t of tr) for (let s = 0; s < STEPS; s++) {
      const st = readStep(p, t, s);
      if (st.velocity > 0) h[st.note % 12]++;
    }
    return h;
  };
  const melodic = [0, 1, 2, 3, 4, 5, 6, 7].filter((t) => t !== lead && ![2, 5].includes(readPreset(p, t).type) && pcCount([t]).some((x) => x));
  const bassHist = pcCount([1]);
  const root = bassHist.indexOf(Math.max(...bassHist));
  const scalePcs = new Set<number>([root]);
  for (const t of melodic) pcCount([t]).forEach((c, pc) => c && scalePcs.add(pc));
  const notes: number[] = [];
  for (let n = 62; n <= 84; n++) if (scalePcs.has(n % 12)) notes.push(n);
  console.log("root pc", root, "scale pcs", [...scalePcs].sort((a, b) => a - b).join(","));

  const patch = await fm.libraryPatch(voice);
  await fm.setTrackPatch(lead, patch);
  console.log("lead voice", voice, patchName(patch));

  // Compose 4-bar phrases (64 steps) per pass: sparse -> busier -> resolve.
  const rand = rng(7);
  const rhythms: number[][][] = [
    [[0, 12]],
    [[0, 5], [8, 4], [12, 3]],
    [[0, 2], [3, 2], [6, 2], [8, 2], [11, 2], [14, 2]],
    [[0, 3], [4, 3], [8, 2], [10, 2], [12, 4]],
  ];
  const rootNotes = notes.filter((n) => n % 12 === root);
  const events: { t: number; bytes: number[] }[] = [];
  let idx = Math.max(0, notes.indexOf(rootNotes[Math.floor(rootNotes.length / 2)]));
  for (let pass = 0; pass < passes; pass++) {
    const pattern = rhythms[Math.min(pass, rhythms.length - 1)];
    for (let bar = 0; bar < 4; bar++) {
      const last = pass === passes - 1 && bar === 3;
      pattern.forEach(([at, len], i) => {
        const step = pass * STEPS + bar * 16 + at;
        const final = last && i === pattern.length - 1;
        if (final) idx = notes.indexOf(rootNotes[Math.floor(rootNotes.length / 2)]);
        else idx = Math.min(notes.length - 1, Math.max(0, idx + [-2, -1, -1, 0, 1, 1, 2][Math.floor(rand() * 7)]));
        const vel = Math.round(82 + rand() * 24);
        const dur = (final ? 16 : len) * stepSec * 0.92;
        events.push({ t: step * stepSec, bytes: [0x90 | channel, notes[idx], vel] });
        events.push({ t: step * stepSec + dur, bytes: [0x80 | channel, notes[idx], 0] });
      });
    }
  }
  events.sort((a, b) => a.t - b.t || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));
  const total = passes * STEPS * stepSec;

  // Start the device clock and the lead together.
  let i = 0;
  fm.sendRaw([0xfa]);
  const t0 = performance.now();
  console.log(`jam: ${passes} passes, ~${Math.round(total)} s`);
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const now = (performance.now() - t0) / 1000;
      while (i < events.length && events[i].t <= now) fm.sendRaw(events[i++].bytes);
      if (now >= total + 0.5) {
        clearInterval(timer);
        resolve();
      }
    }, 2);
  });
  fm.sendRaw([0xb0 | channel, 123, 0]);
  await sleep(1500); // let the last bar of the loop ring out
  fm.sendRaw([0xfc]);
  console.log("stopped");
} finally {
  fm.close();
}
