// THREE TOWERS (owner, 2026-10-09: "the only requirement now that we're on 3 towers, is that, for every combination of
// 3 towers, it is possible to win the game"): every multiset of three kinds (20), built exactly as the opening, played
// greedy / balanced / saver with every core pick, over seeds. A trio passes if ANY of its games wins.
// usage: node trios.mjs [seeds=2] [out.jsonl]   (ASPIRA_PATCH applies to every game, ASPIRA_WEB a snapshot)
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

const K = ["arc", "frz", "sol", "acd"];
const STYLES = { greedy: { up: 0.8 }, balanced: { up: 0.5 }, saver: { up: 0.3, reserve: 10 } };
export default async function task({ trio, style, seed }) {
  const r = play({ ...STYLES[style], maxTowers: 3, opening: trio, mix: Object.fromEntries(trio.map(k => [k, 1])), core: ALL, useCore: true }, seed, 100);
  return { wave: r.wave, won: r.won, lives: r.lives };
}
if (isMainThread && process.argv[1] && process.argv[1].endsWith("trios.mjs")) {
  const SEEDS = Number(process.argv[2] || 2), OUT = process.argv[3] || null, trios = [], jobs = [];
  for (let a = 0; a < 4; a++) for (let b = a; b < 4; b++) for (let c = b; c < 4; c++) trios.push([K[a], K[b], K[c]]);
  for (const trio of trios) for (const style of Object.keys(STYLES)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ trio, style, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const rows = trios.map(trio => {
    const mine = res.filter((r, i) => jobs[i].trio === trio);
    return { trio: trio.join("+").toUpperCase(), wins: mine.filter(r => r.won).length, n: mine.length, best: Math.max(...mine.map(r => r.wave)), p50: mine.map(r => r.wave).sort((x, y) => x - y)[Math.floor(mine.length / 2)] };
  }).sort((x, y) => y.wins - x.wins || y.best - x.best);
  for (const r of rows) console.log(r.trio.padEnd(14), `won ${r.wins}/${r.n}`.padEnd(10), "best", String(r.best).padStart(3), " p50", r.p50);
  console.log("PASS", rows.filter(r => r.wins).length, "of", rows.length);
}
