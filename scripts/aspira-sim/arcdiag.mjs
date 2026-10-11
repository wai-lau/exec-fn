// WHY AN EXTRA ARC HURTS (2026-10-11, teambal.mjs: +ARC ended with fewer lives than the plain four): per kind, the
// credits spent, chart points, damage and kills, and the leaks by type and by wave band, for the base team, +ARC and
// +SOL, on the same styles and seeds.
// usage: node arcdiag.mjs [seeds=4]
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

const K = ["arc", "frz", "sol", "acd"];
const STYLES = { greedy: { up: 0.8 }, balanced: { up: 0.5 }, saver: { up: 0.3, reserve: 10 } };
export default async function task({ extra, style, seed }) {
  const opening = extra ? [...K, extra] : K, mix = Object.fromEntries(K.map(k => [k, k === extra ? 2 : 1]));
  const r = play({ ...STYLES[style], maxTowers: opening.length, opening, mix, core: ALL, useCore: true }, seed, 100);
  const by = {};
  for (const b of r.build) { const o = by[b.kind] ||= { n: 0, pts: 0 }; o.n++; o.pts += b.lvl - 1; }
  for (const [key, v] of Object.entries(r.towers)) { const k = key.split("/")[0]; by[k].dealt = (by[k].dealt || 0) + v.dealt; by[k].kills = (by[k].kills || 0) + v.kills; }
  const bands = {}; for (const [w, n] of Object.entries(r.leakWave || {})) { const b = Math.floor((+w - 1) / 20) * 20 + 1; bands[b] = (bands[b] || 0) + (typeof n === "number" ? n : Object.values(n).reduce((a, x) => a + x, 0)); }
  return { lives: r.lives, spent: r.spent, interest: r.interest, by, leaks: r.leaks, bands };
}
if (isMainThread && process.argv[1] && process.argv[1].endsWith("arcdiag.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), rows = [null, "arc", "sol"], jobs = [];
  for (const extra of rows) for (const style of Object.keys(STYLES)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ extra, style, seed });
  const res = await runPool(new URL(import.meta.url), jobs, {});
  const avg = (a, f) => a.reduce((s, r) => s + (f(r) || 0), 0) / a.length;
  for (const extra of rows) {
    const mine = res.filter((r, i) => jobs[i].extra === extra);
    console.log(`== ${extra ? "+" + extra.toUpperCase() : "base 4"}  lives ${avg(mine, r => r.lives).toFixed(1)}  spent ${(avg(mine, r => r.spent) / 1e3).toFixed(0)}k  interest ${(avg(mine, r => r.interest) / 1e3).toFixed(0)}k`);
    for (const k of K) console.log(`   ${k.toUpperCase()} n ${avg(mine, r => r.by[k]?.n).toFixed(1)}  pts ${avg(mine, r => r.by[k]?.pts).toFixed(1).padStart(5)}  dealt ${(avg(mine, r => r.by[k]?.dealt) / 1e6).toFixed(1).padStart(6)}M  kills ${avg(mine, r => r.by[k]?.kills).toFixed(0).padStart(5)}`);
    const lk = {}, bd = {}; for (const r of mine) { for (const [k, v] of Object.entries(r.leaks)) lk[k] = (lk[k] || 0) + v / mine.length; for (const [k, v] of Object.entries(r.bands)) bd[k] = (bd[k] || 0) + v / mine.length; }
    console.log("   leaks", Object.entries(lk).map(([k, v]) => k + " " + v.toFixed(1)).join(", "), "| by wave", Object.entries(bd).map(([k, v]) => k + "+ " + v.toFixed(1)).join(", "));
  }
}
