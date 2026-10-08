// IS SOL REQUIRED? (owner, 2026-10-08: "make sure SOL isn't a required tower to win"): full games to
// wave 100 for every tower mix that leaves SOL out (and an all-four control), the interest-aware
// saver with every boss pick and both core powers, two openings per mix. Per mix: waves reached,
// wins, where the losses fell and to which boss.
// usage: node nosol.mjs [seeds=4] [out.jsonl]   env DROP=sol (the kind to leave out)  BV_PATCH=... (a balance try)  ONLY=frz+sol+acd
import { isMainThread } from "node:worker_threads";
import { makePlayer } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const PATCH = process.env.BV_PATCH || "", DROP = process.env.DROP || "sol", ALL = ["arc", "frz", "sol", "acd"], KEEP = ALL.filter(k => k !== DROP);
export const MIXES = { control: ALL };
for (let m = 1; m < 1 << KEEP.length; m++) { const ks = KEEP.filter((k, i) => m & (1 << i)); if (ks.length >= 2) MIXES[ks.join("+")] = ks; }

export default async function task({ mix, open, seed }) {
  const ks = MIXES[mix], opening = [ks[open % ks.length], ks[(open + 1) % ks.length]];
  const p = makePlayer({ up: 0.5, maxTowers: 6, opening, mix: Object.fromEntries(ks.map(k => [k, 1])), econ: "smart", threat: 220, core: ["temporal", "relay"], useCore: true }, seed, 100, 0.02, PATCH);
  p.runTo(101); const r = p.result();
  return { wave: r.wave, won: r.won, lives: r.lives, leaks: r.leaks, opening: opening.join("+") };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("nosol.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), OUT = process.argv[3] || null;
  const jobs = []; for (const mix of Object.keys(MIXES).filter(m => !process.env.ONLY || process.env.ONLY.split(",").includes(m))) for (const open of [0, 1]) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ mix, open, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  console.log(`without ${DROP.toUpperCase()}: full games to wave 100, smart saver, both core powers, ${SEEDS} seeds x 2 openings\n`);
  for (const mix of Object.keys(MIXES).filter(m => !process.env.ONLY || process.env.ONLY.split(",").includes(m))) {
    const rs = jobs.map((j, i) => (j.mix === mix ? res[i] : null)).filter(Boolean), won = rs.filter(r => r.won).length;
    const deaths = {}; for (const r of rs) if (!r.won) deaths[r.wave] = (deaths[r.wave] || 0) + 1;
    console.log(mix.padEnd(14), `won ${won}/${rs.length}`.padEnd(10), `avg wave ${(rs.reduce((a, r) => a + r.wave, 0) / rs.length).toFixed(1)}`.padEnd(15), "deaths " + (Object.entries(deaths).map(([w, n]) => "w" + w + " x" + n).join(" ") || "-"));
  }
}
