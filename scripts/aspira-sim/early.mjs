// THE EARLY GAME (owner, 2026-10-07 balancing runs): waves 1-30 for every 2-tower
// opening (10) x three economies, the balanced mix after the opening. Per opening:
// lives lost by wave 30, the waves that took them, the closest an enemy came to the
// core in each 5-wave band, and whether the first boss (Star, 10) and Empress (20)
// and Strength (30) breached. Answers: which openings are traps, where the first
// real pressure is, and whether a saver can afford to save early.
// usage: node early.mjs [seeds=4] [out.jsonl]
import { isMainThread } from "node:worker_threads";
import { makePlayer } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ECONS } from "./economy.mjs";

const K = ["arc", "frz", "sol", "acd"], OPEN = [];
for (let i = 0; i < 4; i++) for (let j = i; j < 4; j++) OPEN.push([K[i], K[j]]);

export default async function task({ open, econ, seed }) {
  const p = makePlayer({ up: 0.5, maxTowers: 6, opening: open, mix: { arc: 1, frz: 1, sol: 1, acd: 1 }, core: ["temporal", "relay"], useCore: true, ...ECONS[econ] }, seed, 30);
  const near = {};
  for (let w = 2; w <= 31 && !p.g.G.over; w++) { p.runTo(w); near[w - 1] = Math.round(p.S.waveNear === Infinity ? 999 : p.S.waveNear); }
  const r = p.result();
  return { wave: r.wave, over: r.over, lives: r.lives, leakWave: r.leakWave, leaks: r.leaks, near, spent: r.spent, money: r.money };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("early.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), OUT = process.argv[3] || null;
  const jobs = [];
  for (const open of OPEN) for (const econ of Object.keys(ECONS)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ open, econ, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
  console.log(`early game: waves 1-30, ${OPEN.length} openings x ${Object.keys(ECONS).length} economies x ${SEEDS} seeds (start 18 lives)\n`);
  console.log("opening       econ       lives@31  died  lost by band (1-10 / 11-20 / 21-30)   closest approach by band");
  for (const open of OPEN) for (const econ of Object.keys(ECONS)) {
    const rs = jobs.map((j, i) => (j.open === open && j.econ === econ ? res[i] : null)).filter(Boolean);
    const band = (a, b) => mean(rs, r => Object.entries(r.leakWave).filter(([w]) => w >= a && w <= b).reduce((s, [, n]) => s + n, 0)).toFixed(1);
    const close = (a, b) => Math.round(mean(rs, r => Math.min(...Object.entries(r.near).filter(([w]) => w >= a && w <= b).map(([, v]) => v).concat([999]))));
    console.log(open.join("+").padEnd(13), econ.padEnd(10), mean(rs, r => r.lives).toFixed(1).padStart(7), String(rs.filter(r => r.over).length).padStart(5), "   " + [band(1, 10), band(11, 20), band(21, 30)].join(" / ").padEnd(28), "   " + [close(1, 10), close(11, 20), close(21, 30)].join(" / "));
  }
  const byWave = {}; for (const r of res) for (const [w, n] of Object.entries(r.leakWave)) byWave[w] = (byWave[w] || 0) + n / res.length;
  console.log("\nlives lost per game by wave: " + Object.entries(byWave).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => "w" + w + " " + n.toFixed(2)).join("  "));
  const lt = {}; for (const r of res) for (const [t, n] of Object.entries(r.leaks)) lt[t] = (lt[t] || 0) + n / res.length;
  console.log("leaks per game by type: " + Object.entries(lt).map(([t, n]) => t + " " + n.toFixed(2)).join("  "));
}
