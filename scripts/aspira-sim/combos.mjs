// every tower subset (1-4 kinds), best forms, opening with its first kind x2
import fs from "node:fs";
import { play } from "./sim.mjs";
const patch = process.argv[2] && process.argv[2] !== "-" ? fs.readFileSync(process.argv[2], "utf8") : "";
const SEEDS = Number(process.argv[3] || 2);
const best = { arc: [1, 1], frz: [1, 0], sol: [1, 0], acd: [0, 2] };
const K = ["arc", "frz", "sol", "acd"], rows = [];
for (let m = 1; m < 16; m++) {
  const ks = K.filter((_, i) => m & (1 << i));
  const open = ks.includes("arc") ? "arc" : ks.includes("sol") ? "sol" : ks[0];
  const s = { up: 0.5, maxTowers: 20, opening: [open, open], mix: Object.fromEntries(ks.map(k => [k, 1])), paths: best };
  const w = [], leaks = {};
  for (let seed = 1; seed <= SEEDS; seed++) { const r = play(s, seed, 110, 0.02, patch); w.push(r.wave); for (const [k, v] of Object.entries(r.leaks)) leaks[k] = (leaks[k] || 0) + v; }
  const avg = w.reduce((a, b) => a + b) / w.length;
  rows.push([ks.map(k => ({ arc: "ARC", frz: "FRZ", sol: "SOL", acd: "ACD" })[k]).join("+"), avg, w.join(","), JSON.stringify(leaks)]);
  console.log(rows.at(-1)[0].padEnd(18), avg.toFixed(1).padStart(5), rows.at(-1)[2], rows.at(-1)[3]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log("RANKED"); for (const r of rows) console.log(r[0].padEnd(18), r[1].toFixed(1).padStart(5));
console.log("DONE");
