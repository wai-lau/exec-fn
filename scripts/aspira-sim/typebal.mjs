// Enemy-TYPE balance (owner, 2026-10-04): at the same wave, a swarm, shield,
// armor or fast wave should come about as close to the core against ONE L1
// tower of each kind; the rise from wave 1 to 30 stays. Each type is played
// at sample waves (WAVE_TYPE_FORCE); the per-wave target is the median of the
// four types; one count multiplier per type (TYPE_COUNT_MUL) is bisected
// until that type sits on the target on average.
// usage: node typebal.mjs [seeds=2]
import { makeGame } from "./sim.mjs";
const SEEDS = Number(process.argv[2] || 2), WAVES = [3, 6, 9, 13, 16, 19, 23, 26, 29];
const TYPES = ["swarm", "shield", "armor", "fast"];
const METRIC = process.env.TB_METRIC || "load", LEAK_S = 30, BOUNDS = [0.5, 2]; // multipliers kept within BOUNDS (owner)
function closest(n, type, mul, seed) {
  const g = makeGame(seed); g.reset();
  g.run("G.money = 1e9;");
  ["arc", "frz", "sol", "acd"].forEach((k, i) => g.place(k, i));
  g.run(`WAVE_TYPE_FORCE[${n}] = "${type}"; TYPE_COUNT_MUL["${type}"] = ${mul};
    G.lastType = "${type === "swarm" ? "fast" : "swarm"}"; G.started = true; G.wave = ${n - 1}; G.nextIn = 0;`);
  g.step(0.02); g.run("G.nextIn = 1e9;");
  const lives0 = g.G.lives; let best = Infinity, t = 0, load = 0;
  while (t < 240 && !g.G.over) {
    g.step(0.02); g.clearFx(); t += 0.02;
    let alive = 0;
    for (const e of g.G.enemies) if (!e.dead) { alive++; best = Math.min(best, Math.hypot(e.x - 500, e.y - 500)); }
    load += alive * 0.02;
    if (METRIC === "close" && g.G.lives < lives0) return 0;
    if (g.run("waveClear()")) break;
  }
  // "load" (default): ENEMY-SECONDS alive - crowding and pressure - plus LEAK_S
  // per life lost; "close": the closest approach to the core
  if (METRIC === "load") return load + LEAK_S * (lives0 - g.G.lives);
  return best === Infinity ? 500 : best;
}
const dist = (n, type, mul) => { let s = 0; for (let k = 1; k <= SEEDS; k++) s += closest(n, type, mul, k); return s / SEEDS; };
// TB_TARGET: reuse a measured per-wave target ({"3":263,...}); TB_ONLY: tune only these types
const median = a => { const b = [...a].sort((x, y) => x - y); return (b[1] + b[2]) / 2; };
let target = process.env.TB_TARGET ? JSON.parse(process.env.TB_TARGET) : null;
if (!target) {
  const base = {};
  for (const n of WAVES) base[n] = Object.fromEntries(TYPES.map(t => [t, dist(n, t, 1)]));
  target = Object.fromEntries(WAVES.map(n => [n, median(TYPES.map(t => base[n][t]))]));
  console.log("baseline (closest approach by wave x type):");
  for (const n of WAVES) console.log("  " + n + " " + TYPES.map(t => t + " " + Math.round(base[n][t])).join("  ") + "   target " + Math.round(target[n]));
}
const out = {};
for (const type of process.env.TB_ONLY ? process.env.TB_ONLY.split(",") : TYPES) {
  // mean signed gap to the target (in log for load): >0 = too EASY -> more of them
  const gap = mul => WAVES.reduce((a, n) => {
    const v = dist(n, type, mul);
    return a + (METRIC === "load" ? Math.log(target[n] + 1) - Math.log(v + 1) : v - target[n]);
  }, 0) / WAVES.length;
  let [lo, hi] = BOUNDS;
  for (let it = 0; it < 7; it++) { const mid = Math.sqrt(lo * hi); if (gap(mid) > 0) lo = mid; else hi = mid; }
  out[type] = +Math.sqrt(lo * hi).toFixed(2);
  console.log(type, "x" + out[type]);
}
console.log("TYPE_COUNT_MUL " + JSON.stringify(out));
