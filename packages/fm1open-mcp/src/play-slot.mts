// Load a stored project slot and run it for a while (MIDI Start/Stop over the same port).
// Usage: tsx src/play-slot.mts "<port>" <slot> [seconds]
import { Fm1Open, Kind, sleep } from "./fm1open.js";
import { describe } from "./project.js";
import { patchName } from "./dx7.js";

const fm = Fm1Open.open(process.argv[2] ?? "FM1");
const slot = Number(process.argv[3] ?? 0);
const secs = Number(process.argv[4] ?? 16);
try {
  await fm.loadSlot(slot);
  const p = await fm.readProject();
  const d = describe(p);
  console.log(d.name, d.tempo, "bpm", d.tracks.map((t) => `${t.track}:${t.source}`).join(" "));
  console.log("t0 voice:", patchName(await fm.read(Kind.fmVoice, 0)));
  fm.sendRaw([0xfa]);
  console.log("playing", secs, "s");
  await sleep(secs * 1000);
  fm.sendRaw([0xfc]);
  console.log("stopped");
} finally {
  fm.close();
}
