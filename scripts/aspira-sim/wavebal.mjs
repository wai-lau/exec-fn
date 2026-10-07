// Wave-count balance for waves 1-30 (owner, 2026-10-04): against ONE L1 tower
// of each kind, how close does each wave get to the core? Then search, per
// wave, the count multiplier (WAVE_COUNT_MUL) that brings its closest approach
// to TARGET. Bosses (every 10th) are measured, not tuned.
// usage: node wavebal.mjs [measure|tune] [target=150] [seeds=2]
import { makeGame } from "./sim.mjs";
const MODE = process.argv[2] || "measure", TARGET = Number(process.argv[3] || 150), SEEDS = Number(process.argv[4] || 2);
const MULS = JSON.parse(process.env.WB_MULS || "{}");
function closest(n, mul, seed) {
  const g = makeGame(seed); g.reset();
  g.run("G.money = 1e9;");
  ["arc", "frz", "sol", "acd"].forEach((k, i) => g.place(k, i));
  g.run(`Object.assign(WAVE_COUNT_MUL, ${JSON.stringify(MULS)}); WAVE_COUNT_MUL[${n}] = ${mul};
    let prev = "swarm"; for (let k = 1; k < ${n}; k++) { const w = wavePlan(k, prev); if (w.type !== "bonus") prev = w.type; }
    G.lastType = prev; G.started = true; G.wave = ${n - 1}; G.nextIn = 0;`);
  g.step(0.02); g.run("G.nextIn = 1e9;");
  const lives0 = g.G.lives; let best = Infinity, t = 0;
  while (t < 240 && !g.G.over) {
    g.step(0.02); g.clearFx(); t += 0.02;
    if (g.G.lives < lives0) return 0; // something got through
    for (const e of g.G.enemies) if (!e.dead) best = Math.min(best, Math.hypot(e.x - 500, e.y - 500));
    if (g.run("waveClear()")) break;
  }
  return best === Infinity ? 500 : best;
}
const avg = (n, mul) => { let s = 0; for (let k = 1; k <= SEEDS; k++) s += closest(n, mul, k); return s / SEEDS; };
const out = {};
for (let n = 1; n <= 30; n++) {
  if (MODE === "measure" || n % 10 === 0) { out[n] = { mul: MULS[n] ?? 1, d: Math.round(avg(n, MULS[n] ?? 1)) }; console.log(n, JSON.stringify(out[n])); continue; }
  // closest approach falls as the count rises: bisect the multiplier (log scale)
  let lo = 0.1, hi = 6;
  for (let it = 0; it < 8; it++) {
    const mid = Math.sqrt(lo * hi), d = avg(n, mid);
    if (d > TARGET) lo = mid; else hi = mid;
  }
  const mul = +Math.sqrt(lo * hi).toFixed(2);
  out[n] = { mul, d: Math.round(avg(n, mul)) };
  console.log(n, JSON.stringify(out[n]));
}
console.log("MULS " + JSON.stringify(Object.fromEntries(Object.entries(out).filter(([n]) => n % 10).map(([n, v]) => [n, v.mul]))));
