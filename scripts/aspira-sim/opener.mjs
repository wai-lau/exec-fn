// THE OPENER (owner, 2026-10-12: "it's starting to feel like you have to open with ARC" - "opener with rewinds to find most
// cost effective openers"): every trio in every BUILD ORDER (its first tower is the opener), played by the smart saver -
// rewinds on - to a few early horizons. What it costs to get there clean: credits SPENT (the saver buys only what a leak
// forced), REWINDS (how often it had to), lives kept and how near anything came. Per opener: the mean over its orders.
// usage: node opener.mjs [seeds=6] [horizons=8,16,24]   (ASPIRA_PATCH / ASPIRA_WEB as everywhere)
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";
import { simBanner } from "./simver.mjs";

const TRIOS = [["arc", "frz", "sol"], ["arc", "frz", "acd"], ["arc", "sol", "acd"], ["frz", "sol", "acd"]];
const perms = a => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])));
export default async function task({ order, horizon, seed }) {
  const mix = {}; for (const k of order) mix[k] = 1;
  const r = play({ up: 0.5, maxTowers: 3, opening: order, mix, core: ALL, useCore: true }, seed, horizon);
  return { spent: r.spent, rewinds: r.rewinds, lives: Math.max(0, r.lives), nearest: r.nearest, over: r.over };
}
if (isMainThread && process.argv[1] && process.argv[1].endsWith("opener.mjs")) {
  const SEEDS = Number(process.argv[2] || 6), H = (process.argv[3] || "8,16,24").split(",").map(Number);
  console.log(simBanner());
  const orders = TRIOS.flatMap(perms), jobs = [];
  for (const order of orders) for (const horizon of H) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ order, horizon, seed });
  const res = await runPool(new URL(import.meta.url), jobs, {});
  const mean = (rs, k) => rs.reduce((a, r) => a + r[k], 0) / (rs.length || 1);
  const pick = f => res.filter((r, i) => f(jobs[i]));
  for (const h of H) {
    console.log(`\n== to wave ${h}: per OPENER (mean over its ${orders.length / 4} build orders x ${SEEDS} seeds)`);
    console.log("opener   spent  rewinds  lives  nearest  died");
    const rows = ["arc", "frz", "sol", "acd"].map(k => { const rs = pick(j => j.horizon === h && j.order[0] === k); return [k, mean(rs, "spent"), mean(rs, "rewinds"), mean(rs, "lives"), mean(rs, "nearest"), rs.filter(r => r.over).length + "/" + rs.length]; });
    rows.sort((a, b) => a[1] - b[1]);
    for (const [k, s, rw, l, n, d] of rows) console.log(k.toUpperCase().padEnd(6), String(Math.round(s)).padStart(6), rw.toFixed(1).padStart(8), l.toFixed(1).padStart(6), String(Math.round(n)).padStart(8), d.padStart(6));
    console.log("-- best build orders (least spent):");
    const byOrder = orders.map(o => { const rs = pick(j => j.horizon === h && j.order === o); return [o.join(">").toUpperCase(), mean(rs, "spent"), mean(rs, "rewinds")]; }).sort((a, b) => a[1] - b[1]);
    for (const [o, s, rw] of [...byOrder.slice(0, 5), ["...", NaN, NaN], ...byOrder.slice(-3)]) console.log("  ", o.padEnd(14), isNaN(s) ? "" : String(Math.round(s)).padStart(6) + " spent, " + rw.toFixed(1) + " rewinds");
  }
}
