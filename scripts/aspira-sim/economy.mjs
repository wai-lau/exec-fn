// THE ECONOMY (owner, 2026-10-07 balancing runs): full games for a ladder of players -
// three economies (smart saver / balanced spender / hoarder) x four openings - with the
// ledger sim.mjs keeps: banked + built at every 10th wave, interest earned, the wave
// every slot was filled and the wave every tower was maxed, and where each game died.
// Answers: how much of the money is interest, when a board fills / maxes, whether
// saving beats spending, and whether the late game runs out of things to buy.
// usage: node economy.mjs [seeds=4] [out.jsonl]
import { isMainThread } from "node:worker_threads";
import { makePlayer } from "./sim.mjs";
import { runPool } from "./pool.mjs";

export const ECONS = { smart: { econ: "smart", threat: 220 }, balanced: { up: 0.5 }, hoard: { econ: "smart", threat: 0, noBossPrep: true } };
export const OPENINGS = { "arc frz": ["arc", "frz"], "sol frz": ["sol", "frz"], "arc acd": ["arc", "acd"], "acd frz": ["acd", "frz"] };
const MIX = { arc: 1, frz: 1, sol: 1, acd: 1 };

export default async function task({ econ, opening, seed }) {
  const p = makePlayer({ up: 0.5, maxTowers: 6, opening: OPENINGS[opening], mix: MIX, core: ["temporal", "relay"], useCore: true, ...ECONS[econ] }, seed, 100);
  p.runTo(101);
  const r = p.result();
  return { wave: r.wave, won: r.won, lives: r.lives, interest: r.interest, money: r.money, spent: r.spent, builtAt: r.builtAt, fullAt: r.fullAt, econ: r.econ };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("economy.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), OUT = process.argv[3] || null;
  const jobs = [];
  for (const econ of Object.keys(ECONS)) for (const opening of Object.keys(OPENINGS)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ econ, opening, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const mean = (a, f) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : NaN);
  console.log(`economy: ${Object.keys(ECONS).length} economies x ${Object.keys(OPENINGS).length} openings x ${SEEDS} seeds, full games, 6 slots, core picked and used\n`);
  for (const econ of Object.keys(ECONS)) {
    const rs = jobs.map((j, i) => (j.econ === econ ? res[i] : null)).filter(Boolean);
    const at = w => { const xs = rs.map(r => r.econ.find(e => e.wave === w)).filter(Boolean); return xs.length ? `${Math.round(mean(xs, e => e.money + e.spent))} (${Math.round(mean(xs, e => e.money))} banked, ${mean(xs, e => e.towers).toFixed(1)} towers, ${mean(xs, e => e.maxed).toFixed(1)} maxed)` : "-"; };
    console.log(`${econ.toUpperCase()}  avg wave ${mean(rs, r => r.wave).toFixed(1)}  won ${rs.filter(r => r.won).length}/${rs.length}  interest earned ${Math.round(mean(rs, r => r.interest))}  of ${Math.round(mean(rs, r => r.money + r.spent))} total wealth (${(100 * mean(rs, r => r.interest / Math.max(1, r.money + r.spent))).toFixed(0)}%)`);
    console.log(`   slots filled at wave ${mean(rs.filter(r => r.builtAt), r => r.builtAt).toFixed(0)} (${rs.filter(r => r.builtAt).length}/${rs.length})   every tower maxed at wave ${mean(rs.filter(r => r.fullAt), r => r.fullAt).toFixed(0)} (${rs.filter(r => r.fullAt).length}/${rs.length})   banked at the end ${Math.round(mean(rs, r => r.money))}`);
    for (const w of [11, 21, 31, 51, 71, 91]) console.log(`   wave ${String(w).padStart(2)}: wealth ${at(w)}`);
    for (const opening of Object.keys(OPENINGS)) { const o = rs.filter((r, k) => jobs.filter(j => j.econ === econ)[k].opening === opening); console.log(`   ${opening.padEnd(8)} waves ${o.map(r => r.wave + (r.won ? "W" : "")).join(",")}`); }
    console.log("");
  }
}
