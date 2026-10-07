// Core-power value (owner, 2026-10-07): the balanced all-four player plays a
// full game taking ONE power at its first boss pick (or none, or all three as
// the picks come) and USING it (corepower.mjs). The powers are free since
// 2026-10-07, so this measures the power alone. Prints the waves reached per config.
// usage: node corevalue.mjs [seeds=6] [out.jsonl]
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

export const CONFIGS = { none: null };
for (const p of ALL) CONFIGS[p] = [p];
CONFIGS.all = ALL;
const BASE = { up: 0.5, maxTowers: 9, opening: ["arc", "arc"], mix: { arc: 1, frz: 1, sol: 1, acd: 1 } };

export default async function task({ config, seed }) {
  const order = CONFIGS[config];
  const r = play({ ...BASE, core: order, useCore: !!order }, seed, 100);
  return { wave: r.wave, lives: r.lives, won: r.won, core: r.core, fires: r.fires, leaks: r.leaks };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("corevalue.mjs")) {
  const SEEDS = Number(process.argv[2] || 6), OUT = process.argv[3] || null;
  const jobs = [];
  for (const config of Object.keys(CONFIGS)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ config, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  console.log(`balanced all-four player, ${SEEDS} seeds, to wave 100`);
  for (const config of Object.keys(CONFIGS)) {
    const rs = jobs.map((j, i) => j.config === config ? res[i] : null).filter(Boolean);
    const w = rs.map(r => r.wave), avg = w.reduce((a, b) => a + b) / w.length;
    const fires = {}; for (const r of rs) for (const [k, v] of Object.entries(r.fires || {})) fires[k] = (fires[k] || 0) + v / rs.length;
    const bought = rs.map(r => r.core ? Object.values(r.core).reduce((a, b) => a + b, 0) : 0);
    console.log(config.padEnd(14), avg.toFixed(1).padStart(5), w.join(",").padEnd(24), "won " + rs.filter(r => r.won).length, "| bought " + bought.join(","), "| fires/game " + JSON.stringify(Object.fromEntries(Object.entries(fires).map(([k, v]) => [k, +v.toFixed(1)]))));
  }
}
