// every 2-tower opening (what 100 credits buys) vs wave 1: lives lost
// usage: node wave1.mjs [patchfile|-] [seeds]
import fs from "node:fs";
import { makeGame, cellScores } from "./sim.mjs";
const patch = process.argv[2] && process.argv[2] !== "-" ? fs.readFileSync(process.argv[2], "utf8") : "";
const SEEDS = Number(process.argv[3] || 3);
const K = ["arc", "frz", "sol", "acd"];
const g0 = makeGame(1, patch); g0.reset();
const cells = Object.fromEntries(K.map(k => { const sc = cellScores(g0, k); return [k, sc.map((v, i) => i).sort((a, b) => sc[b] - sc[a]).slice(0, 5)]; }));
let fails = 0;
for (let i = 0; i < K.length; i++) for (let j = i; j < K.length; j++) {
  const lost = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = makeGame(seed, patch); g.reset();
    g.place(K[i], cells[K[i]][0]);
    g.place(K[j], cells[K[j]][K[i] === K[j] ? 1 : 0] === cells[K[i]][0] ? cells[K[j]][1] : cells[K[j]][0]);
    let t = 0;
    while (g.G.wave === 1 && !g.G.over && t < 300) { g.step(0.02); g.clearFx(); t += 0.02; }
    lost.push(20 - g.G.lives);
  }
  const bad = lost.some(x => x > 0); if (bad) fails++;
  console.log((K[i] + "+" + K[j]).padEnd(16), "lives lost", lost.join(","), bad ? "  <-- FAIL" : "");
}
console.log(fails ? fails + " opening(s) leak" : "ALL CLEAN");
