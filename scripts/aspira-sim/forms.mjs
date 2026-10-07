// each tower's 6 forms inside the standard all-four build (others on defaults)
import fs from "node:fs";
import { play } from "./sim.mjs";
const patch = process.argv[2] && process.argv[2] !== "-" ? fs.readFileSync(process.argv[2], "utf8") : "";
const SEEDS = Number(process.argv[3] || 2), ONLY = process.argv[4] || "";
const base = { arc: [1, 1], frz: [0, 1], sol: [0, 0], acd: [1, 0] };
const NAMES = {};
for (const k of ["arc", "frz", "sol", "acd"]) {
  if (ONLY && k !== ONLY) continue;
  for (const pf of [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]) {
    const s = { up: 0.5, maxTowers: 20, opening: ["arc", "arc"], mix: { arc: 1, frz: 1, sol: 1, acd: 1 }, paths: { ...base, [k]: pf } };
    const w = [], dealt = {};
    for (let seed = 1; seed <= SEEDS; seed++) { const r = play(s, seed, 110, 0.02, patch); w.push(r.wave);
      for (const [kk, v] of Object.entries(r.towers)) if (kk.startsWith(k + "/")) dealt[kk] = (dealt[kk] || 0) + v.dealt; }
    const label = Object.keys(dealt).find(x => x.split("/").length === 3) || Object.keys(dealt)[0] || k + " " + pf;
    console.log(label.padEnd(32), (w.reduce((a, b) => a + b) / w.length).toFixed(1).padStart(5), w.join(","));
  }
}
console.log("DONE");
