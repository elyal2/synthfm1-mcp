// Per-16-beat window note counts per MIDI track, to choose 4-bar sections.
// Usage: tsx src/analyze.mts file.mid
import { readFileSync } from "node:fs";
import { parseMidi } from "./midi-file.js";

const { notes, bpm } = parseMidi(readFileSync(process.argv[2]));
const tracks = [...new Set(notes.map((n) => n.track))].sort((a, b) => a - b);
const last = Math.max(...notes.map((n) => n.start));
console.log("bpm", bpm, "tracks", tracks.join(","), "windows", Math.ceil(last / 16));
console.log("win beat   " + tracks.map((t) => `t${t}`.padStart(4)).join(""));
for (let w = 0; w * 16 <= last; w++) {
  const row = tracks.map((t) => String(notes.filter((n) => n.track === t && n.start >= w * 16 && n.start < (w + 1) * 16).length).padStart(4));
  console.log(String(w).padStart(3), String(w * 16).padStart(5), "  " + row.join(""));
}
