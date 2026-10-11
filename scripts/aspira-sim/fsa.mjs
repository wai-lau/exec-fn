// FRZ+SOL+ACD with a CONTAGION-FIRST acid (2026-10-11): the no-ARC trio's swarm answer is ACD's puddles, so this
// plays it the way a player would - Contagion bought first - over the three styles and seeds.
// usage: node fsa.mjs [seeds=3]   (ASPIRA_PATCH / ASPIRA_WEB as everywhere)
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

const STYLES = { greedy: { up: 0.8 }, balanced: { up: 0.5 }, saver: { up: 0.3, reserve: 10 } };
const ORDERS = { spread: null, contagion: ["contagion", "spray", "corrosion"] };
export default async function task({ style, order, seed }) {
  const trio = ["frz", "sol", "acd"], skills = ORDERS[order] ? { acd: ORDERS[order] } : undefined;
  const r = play({ ...STYLES[style], maxTowers: 3, opening: trio, mix: { frz: 1, sol: 1, acd: 1 }, core: ALL, useCore: true, skills }, seed, 100);
  return { wave: r.wave, won: r.won, leaks: r.leaks };
}
if (isMainThread && process.argv[1] && process.argv[1].endsWith("fsa.mjs")) {
  const SEEDS = Number(process.argv[2] || 3), jobs = [];
  for (const order of Object.keys(ORDERS)) for (const style of Object.keys(STYLES)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ order, style, seed });
  const res = await runPool(new URL(import.meta.url), jobs, {});
  for (const order of Object.keys(ORDERS)) {
    const mine = res.filter((r, i) => jobs[i].order === order);
    console.log(order.padEnd(10), `won ${mine.filter(r => r.won).length}/${mine.length}`, "waves", mine.map(r => r.wave).join(" "), "leaks", JSON.stringify(mine.map(r => r.leaks)));
  }
}
