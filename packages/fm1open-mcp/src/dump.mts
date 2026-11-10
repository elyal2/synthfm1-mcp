// Read-only: dump steps of the working project and DX7 library voice names.
// Usage: tsx src/dump.mts "<port substring>"
import { Fm1Open, Kind } from "./fm1open.js";
import { readStep, readPreset, STEPS, TRACKS } from "./project.js";

const fm = Fm1Open.open(process.argv[2] ?? "FM1");
try {
  const p = await fm.readProject();
  for (let t = 0; t < TRACKS; t++) {
    const pr = readPreset(p, t);
    const cells: string[] = [];
    for (let s = 0; s < STEPS; s++) {
      const st = readStep(p, t, s);
      cells.push(st.note || st.cell ? `${s}:${st.note}/${st.velocity}/0x${st.cell.toString(16)}` : "");
    }
    console.log(`T${t} type=${pr.type} prog=${pr.program} pages=${pr.sequencePages} pads=${pr.samplerPads}`);
    console.log("  " + cells.filter(Boolean).slice(0, 40).join(" "));
  }
  for (let b = 0; b < 4; b++) {
    const bank = await fm.read(Kind.dx7Bank, b);
    const names: string[] = [];
    for (let v = 0; v < 32; v++) names.push(`${b * 32 + v}:${String.fromCharCode(...bank.slice(v * 128 + 118, v * 128 + 128)).trim()}`);
    console.log(`bank ${"ABCD"[b]}: ${names.join(" | ")}`);
  }
} finally {
  fm.close();
}
