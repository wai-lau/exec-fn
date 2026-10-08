// SOL vs armor (owner, 2026-10-07: "SOL should no longer ignore armor, increase damage to
// compensate"): the balanced all-four player, full games, SOL's damage dealt and the
// waves reached, at SOL damage multipliers MULS. Run once with the game as it is and once
// with a snapshot whose SOL no longer pierces (ASPIRA_WEB), and compare.
// usage: node solarmor.mjs [seeds=4] [maxWave=70] [out.jsonl]   env MULS=1,1.2,1.4
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
const MULS = (process.env.MULS || "1").split(",").map(Number);
const BASE = { up: 0.5, maxTowers: 6, opening: ["arc", "frz"], mix: { arc: 1, frz: 1, sol: 1, acd: 1 }, econ: "smart", threat: 220, core: ["temporal", "relay"], useCore: true };
export default async function task({ mul, seed, maxWave }) {
  const r = play(BASE, seed, maxWave, 0.02, `TOWERS.sol.dmg *= ${mul};`);
  const sol = Object.entries(r.towers).filter(([k]) => k.startsWith("sol")).reduce((a, [, v]) => a + v.dealt, 0);
  const all = Object.values(r.towers).reduce((a, v) => a + v.dealt, 0);
  return { wave: r.wave, lives: r.lives, sol: Math.round(sol), share: all ? sol / all : 0 };
}
if (isMainThread && process.argv[1] && process.argv[1].endsWith("solarmor.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), MAXW = Number(process.argv[3] || 70), OUT = process.argv[4] || null;
  const jobs = []; for (const mul of MULS) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ mul, seed, maxWave: MAXW });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT, quiet: true });
  for (const mul of MULS) {
    const rs = jobs.map((j, i) => (j.mul === mul ? res[i] : null)).filter(Boolean), m = f => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    console.log(`x${mul}  wave ${m(r => r.wave).toFixed(1)}  lives ${m(r => r.lives).toFixed(0)}  SOL dealt ${Math.round(m(r => r.sol))}  share ${(100 * m(r => r.share)).toFixed(0)}%  waves ${rs.map(r => r.wave).join(",")}`);
  }
}
