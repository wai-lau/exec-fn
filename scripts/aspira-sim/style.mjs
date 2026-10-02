import { play } from "./sim.mjs";
const best = { chain: [1, 2], slower: [1, 2], reaper: [0, 2], acid: [1, 2] };
for (const up of [0.2, 0.5, 0.8]) for (const reserve of [0, 10, 30]) for (const maxT of [12, 20, 30]) {
  if (maxT !== 20 && (up !== 0.5 || reserve !== 0)) continue;
  const s = { up, reserve, maxTowers: maxT, opening: ["chain", "chain"], mix: { chain: 1, slower: 1, reaper: 1, acid: 1 }, paths: best };
  const w = []; for (let seed = 1; seed <= 2; seed++) w.push(play(s, seed, 110).wave);
  console.log(`up ${up} reserve ${reserve} maxTowers ${maxT}`.padEnd(34), (w.reduce((a, b) => a + b) / 2).toFixed(1), w.join(","));
}
console.log("DONE");
