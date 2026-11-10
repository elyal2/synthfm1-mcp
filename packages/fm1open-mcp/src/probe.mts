// Read-only probe: info, capabilities, slot names, backup of the working project.
// Usage: tsx src/probe.mts "<port substring>" [backupDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { Fm1Open, listPorts } from "./fm1open.js";
import { describe } from "./project.js";

const port = process.argv[2] ?? "FM1";
const dir = process.argv[3] ?? "backups";
console.log(JSON.stringify(listPorts()));
const fm = Fm1Open.open(port);
try {
  console.log("info", JSON.stringify(await fm.info()));
  console.log("caps", JSON.stringify(await fm.capabilities()));
  const info = await fm.info();
  for (let s = 0; s < info.slots; s++) console.log("slot", s, JSON.stringify(await fm.slotName(s)));
  const p = await fm.readProject();
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/working-project-${new Date().toISOString().replace(/[:.]/g, "-")}.bin`;
  writeFileSync(file, p);
  console.log("saved", file, p.length, "bytes");
  console.log(JSON.stringify(describe(p), null, 1));
} finally {
  fm.close();
}
