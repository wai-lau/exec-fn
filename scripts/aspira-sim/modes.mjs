// best default targeting per tower: the all-four build with ONE kind's mode
// varied (the rest "close"), average waves reached over SEEDS seeds
// usage: node modes.mjs [seeds=3] [maxWave=120]
import { play } from "./sim.mjs";
const SEEDS = Number(process.argv[2] || 3), MAXW = Number(process.argv[3] || 120);
const best = { arc: [1, 1], frz: [0, 1], sol: [0, 0], acd: [1, 0] };
const AB = { arc: "ARC", frz: "FRZ", sol: "SOL", acd: "ACD" };
for (const kind of ["arc", "frz", "sol", "acd"]) {
  for (const mode of ["fresh", "biggest", "close"]) {
    const w = [];
    for (let s = 1; s <= SEEDS; s++) w.push(play({ up: 0.5, maxTowers: 6, paths: best, opening: ["arc", "frz"], mix: { arc: 1, frz: 1, sol: 1, acd: 1 }, modes: { [kind]: mode } }, s, MAXW, 0.02).wave);
    console.log(AB[kind], mode.padEnd(5), (w.reduce((a, b) => a + b) / w.length).toFixed(1).padStart(5), w.join(","));
  }
}
