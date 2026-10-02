// evaluate a balance patch over a standard strategy set
// usage: node eval.mjs <patchfile|-> [seeds] [maxWave]
import fs from "node:fs";
import { play } from "./sim.mjs";
const patch = process.argv[2] && process.argv[2] !== "-" ? fs.readFileSync(process.argv[2], "utf8") : "";
const SEEDS = Number(process.argv[3] || 2), MAXW = Number(process.argv[4] || 100);
const best = { chain: [1, 1], slower: [0, 1], reaper: [0, 0], acid: [1, 0] };
const A = (o) => ({ up: 0.5, maxTowers: 20, paths: best, ...o });
const S = [
  A({ name: "mono ARC", mix: { chain: 1 } }),
  A({ name: "mono SOL", mix: { reaper: 1 } }),
  A({ name: "mono ACD", mix: { acid: 1 } }),
  A({ name: "ARC>all4", opening: ["chain", "chain"], mix: { chain: 1, slower: 1, reaper: 1, acid: 1 } }),
  A({ name: "ARC>all4 -FRZ", opening: ["chain", "chain"], mix: { chain: 1, reaper: 1, acid: 1 } }),
  A({ name: "ARC>all4 -SOL", opening: ["chain", "chain"], mix: { chain: 1, slower: 1, acid: 1 } }),
  A({ name: "ARC>all4 -ACD", opening: ["chain", "chain"], mix: { chain: 1, slower: 1, reaper: 1 } }),
  A({ name: "ARC>all4 -ARC", opening: ["chain", "chain"], mix: { slower: 1, reaper: 1, acid: 1 } }),
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
