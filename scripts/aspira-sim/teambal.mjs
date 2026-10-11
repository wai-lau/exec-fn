// TOWERS AGAINST EACH OTHER IN A STABLE TEAM (owner, 2026-10-11: "balance the towers against each other (with a
// stable team)"): the base team is one of each kind (4 towers, built in a fixed order), and each test adds a FIFTH
// tower of one kind to it. Same styles and seeds for every row, so the only change is that one extra tower; a
// balanced roster gains about the same from any of the four. Metric: wave reached, wins, lives, leaks.
// usage: node teambal.mjs [seeds=4]   (ASPIRA_PATCH / ASPIRA_WEB as everywhere; pick a setting hard enough to lose)
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

const K = ["arc", "frz", "sol", "acd"];
const STYLES = { greedy: { up: 0.8 }, balanced: { up: 0.5 }, saver: { up: 0.3, reserve: 10 } };
export default async function task({ extra, style, seed }) {
  const opening = extra ? [...K, extra] : K, mix = Object.fromEntries(K.map(k => [k, k === extra ? 2 : 1]));
  const r = play({ ...STYLES[style], maxTowers: opening.length, opening, mix, core: ALL, useCore: true }, seed, 100);
  return { wave: r.wave, won: r.won, lives: r.lives, leaks: r.leaks };
}
if (isMainThread && process.argv[1] && process.argv[1].endsWith("teambal.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), rows = [null, ...K], jobs = [];
  for (const extra of rows) for (const style of Object.keys(STYLES)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ extra, style, seed });
  const res = await runPool(new URL(import.meta.url), jobs, {});
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  for (const extra of rows) {
    const mine = res.filter((r, i) => jobs[i].extra === extra), lk = {};
    for (const r of mine) for (const [k, v] of Object.entries(r.leaks || {})) lk[k] = (lk[k] || 0) + v / mine.length;
    console.log((extra ? "+" + extra.toUpperCase() : "base 4").padEnd(8), `won ${mine.filter(r => r.won).length}/${mine.length}`.padEnd(10),
      "wave", mean(mine.map(r => r.wave)).toFixed(1).padStart(5), " lives", mean(mine.map(r => Math.max(0, r.lives))).toFixed(1).padStart(5),
      " leaks", Object.entries(lk).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + v.toFixed(1)).join(", "));
  }
}
