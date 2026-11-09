import { readFileSync } from "node:fs";
import { Felucca } from "./felucca.js";
import { planSong, writeSong, type TrackMap } from "./felucca-song.js";
import { Link } from "./link.js";
import { parseMidi } from "./midi-file.js";

const [path, mode = "dry"] = process.argv.slice(2);
const { notes, bpm } = parseMidi(readFileSync(path));
const maps: TrackMap[] = [
  { midiTrack: 2, track: 0, engine: 0, preset: 2, transpose: -12 }, // lute -> ANALOG SQR BASS
  { midiTrack: 1, track: 1, engine: 12, preset: 0, transpose: 0 }, // piano -> FM6 TINE EP
];
const plan = planSong(notes, maps);
console.log("file bpm", bpm, "| slots", plan.slots.length, "| rows", JSON.stringify(plan.rows), `| covers ${plan.coveredChunks}/${plan.totalChunks} chunks`);
if (mode === "write") {
  const link = Link.open("Felucca");
  try {
    const f = new Felucca(link);
    const rc = await writeSong(f, plan, maps, bpm ?? 94, console.log);
    console.log("song set:", rc.join(","));
    console.log("start:", (await f.song(2)).join(","));
  } finally {
    link.close();
  }
}
