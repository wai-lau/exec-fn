// best default targeting per tower: the all-four build with ONE kind's mode
// varied (the rest "close"), average waves reached over SEEDS seeds (games on the pool)
// usage: node modes.mjs [seeds=3] [maxWave=120]
import { runPool } from "./pool.mjs";
const SEEDS = Number(process.argv[2] || 3), MAXW = Number(process.argv[3] || 120);
const best = { arc: [1, 1], frz: [0, 1], sol: [0, 0], acd: [1, 0] };
const cases = [];
for (const kind of ["arc", "frz", "sol", "acd"]) for (const mode of ["fresh", "biggest", "close"])
  cases.push({ kind, mode, s: { up: 0.5, maxTowers: 6, paths: best, opening: ["arc", "frz"], mix: { arc: 1, frz: 1, sol: 1, acd: 1 }, modes: { [kind]: mode } } });
const jobs = [];
for (const c of cases) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ strategy: c.s, seed, maxWave: MAXW });
const res = await runPool(new URL("./playjob.mjs", import.meta.url), jobs);
for (const c of cases) {
  const w = jobs.map((j, i) => j.strategy === c.s ? res[i].wave : null).filter(x => x != null);
  console.log(c.kind.toUpperCase(), c.mode.padEnd(7), (w.reduce((a, b) => a + b) / w.length).toFixed(1).padStart(5), w.join(","));
}
