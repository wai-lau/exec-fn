// evaluate a balance patch over a standard strategy set
// usage: node eval.mjs <patchfile|-> [seeds] [maxWave]
import fs from "node:fs";
import { play } from "./sim.mjs";
const patch = process.argv[2] && process.argv[2] !== "-" ? fs.readFileSync(process.argv[2], "utf8") : "";
const SEEDS = Number(process.argv[3] || 2), MAXW = Number(process.argv[4] || 100);
const best = { arc: [1, 1], frz: [0, 1], sol: [0, 0], acd: [1, 0] };
const A = (o) => ({ up: 0.5, maxTowers: 20, paths: best, ...o });
const S = [
  A({ name: "mono ARC", mix: { arc: 1 } }),
  A({ name: "mono SOL", mix: { sol: 1 } }),
  A({ name: "mono ACD", mix: { acd: 1 } }),
  A({ name: "ARC>all4", opening: ["arc", "arc"], mix: { arc: 1, frz: 1, sol: 1, acd: 1 } }),
  A({ name: "ARC>all4 -FRZ", opening: ["arc", "arc"], mix: { arc: 1, sol: 1, acd: 1 } }),
  A({ name: "ARC>all4 -SOL", opening: ["arc", "arc"], mix: { arc: 1, frz: 1, acd: 1 } }),
  A({ name: "ARC>all4 -ACD", opening: ["arc", "arc"], mix: { arc: 1, frz: 1, sol: 1 } }),
  A({ name: "ARC>all4 -ARC", opening: ["arc", "arc"], mix: { frz: 1, sol: 1, acd: 1 } }),
];
for (const s of S) {
  const w = [], dealt = {}, leaks = {};
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = play(s, seed, MAXW, 0.02, patch); w.push(r.wave);
    for (const [k, v] of Object.entries(r.towers)) { const kk = k.split("/")[0]; dealt[kk] = (dealt[kk] || 0) + v.dealt; }
    for (const [k, v] of Object.entries(r.leaks)) leaks[k] = (leaks[k] || 0) + v;
  }
  const tot = Object.values(dealt).reduce((a, b) => a + b, 0) || 1;
  const share = Object.entries(dealt).map(([k, v]) => k.slice(0, 3) + " " + Math.round(100 * v / tot) + "%").join(" ");
  console.log(s.name.padEnd(16), (w.reduce((a, b) => a + b) / w.length).toFixed(1).padStart(5), w.join(",").padEnd(8), "|", share, "| leaks", JSON.stringify(leaks));
}
