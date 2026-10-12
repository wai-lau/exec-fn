// SWAP ONE TOWER (owner, 2026-10-11; TRIOS since 2026-10-12 - the game holds three towers): every three-kind trio, and
// each trio with ONE of its towers replaced by a second copy of one of the other two - same tower count, same money - so
// each kind is measured by what its trios lose without it. Same styles and seeds for every cell.
// Prints each trio's base, then per kind: mean lives over its trios as built vs with it swapped out.
// usage: node swap.mjs [seeds=4]   (ASPIRA_PATCH / ASPIRA_WEB as everywhere)
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

const K = ["arc", "frz", "sol", "acd"], TRIOS = [["arc", "frz", "sol"], ["arc", "frz", "acd"], ["arc", "sol", "acd"], ["frz", "sol", "acd"]];
const STYLES = { greedy: { up: 0.8, econ: "spend" }, balanced: { up: 0.5 }, saver: { up: 0.3, reserve: 10 } };
export default async function task({ trio, out, dbl, style, seed }) {
  const team = out ? [...trio.filter(k => k !== out), dbl] : trio, mix = {};
  for (const k of team) mix[k] = (mix[k] || 0) + 1;
  const r = play({ ...STYLES[style], maxTowers: 3, opening: team, mix, core: ALL, useCore: true }, seed, 120);
  return { wave: r.wave, won: r.won, lives: Math.max(0, r.lives), leaks: r.leaks };
}
if (isMainThread && process.argv[1] && process.argv[1].endsWith("swap.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), cells = [], jobs = [];
  for (const trio of TRIOS) { cells.push({ trio, out: null, dbl: null }); for (const out of trio) for (const dbl of trio) if (dbl !== out) cells.push({ trio, out, dbl }); }
  for (const c of cells) for (const style of Object.keys(STYLES)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ ...c, style, seed });
  const res = await runPool(new URL(import.meta.url), jobs, {});
  const pick = f => res.filter((r, i) => f(jobs[i])), mean = rs => rs.reduce((a, r) => a + r.lives, 0) / (rs.length || 1);
  for (const trio of TRIOS) { const b = pick(j => j.trio === trio && !j.out); console.log(trio.join("+").toUpperCase().padEnd(14), "as built: lives", mean(b).toFixed(1).padStart(5), ` won ${b.filter(r => r.won).length}/${b.length}`); }
  for (const k of K) {
    const built = pick(j => j.trio.includes(k) && !j.out), without = pick(j => j.out === k), doubled = pick(j => j.dbl === k);
    console.log(k.toUpperCase().padEnd(5), "its trios", mean(built).toFixed(1).padStart(5), "| swapped out", mean(without).toFixed(1).padStart(5), `(won ${without.filter(r => r.won).length}/${without.length})`, "| doubled in", mean(doubled).toFixed(1).padStart(5));
  }
}
