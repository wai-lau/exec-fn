// Boss FLEET size (owner, 2026-10-09: "bosses feel easier than the regular waves because they don't accumulate now -
// balance by adding to boss fleets"). A regular wave comes on the timer while the last is still out, so the waves
// before a boss PILE UP; a boss wave waits for a clear field. So the yardstick is the STRETCH: waves n-3..n-1 sent
// on their real timers, closest approach of anything to the core. Team as bossbal.mjs (every open slot, ARC FRZ SOL
// ACD, the lowest level at which the stretch stays out). Bisect FLEET_MUL[arcana] until the boss wave (boss + fleet)
// comes CLOSER x the stretch.
// usage: node bossfleet.mjs [measure|tune] [seeds=2]   env BB_ONLY=10,20 to pick waves, BF_MUL=x to measure one mul
import { makeGame } from "./sim.mjs";
const MODE = process.argv[2] || "measure", SEEDS = Number(process.argv[3] || 2);
const CLOSER = 0.9, MIN_D = 90;
const ONLY = (process.env.BB_ONLY || "").split(",").filter(Boolean).map(Number);
function team(g, n, lvl) {
  g.run(`G.money = 1e12; G.opened = {}; CELLS.forEach((c, i) => { if (c.unlock && c.unlock < ${n}) G.opened[i] = true; });`);
  const kinds = ["arc", "frz", "sol", "acd"], open = g.run("CELLS.map((c, i) => i).filter(cellOpen)");
  open.forEach((ci, j) => {
    const k = kinds[j % 4], t = g.place(k, ci);
    const want = g.maxLvl(t) > g.MAX_LVL ? 1 + 5 * (lvl - 1) : lvl;
    while (t.lvl < want) {
      const need = g.pendingChoice(t);
      const choice = need === "path" ? Object.keys(g.UPGRADES[k])[0] : need === "form" ? 0 : undefined;
      if (!g.upgrade(t, choice)) break;
    }
  });
}
function prime(g, n) { // the alternation of wave types up to n, as a real game would have it
  g.run(`let prev = "swarm"; for (let k = 1; k < ${n}; k++) { const w = wavePlan(k, prev); if (w.type !== "bonus") prev = w.type; } G.lastType = prev;`);
}
// the regular stretch before boss wave n: n-3, n-2, n-1 on their timers
function stretch(n, lvl, seed) {
  const g = makeGame(seed); g.reset(); g.run("G.started = true;"); team(g, n, lvl); prime(g, n - 3);
  g.run(`G.wave = ${n - 4}; G.nextIn = 0;`);
  const lives0 = g.G.lives; let best = Infinity, t = 0;
  while (t < 400 && !g.G.over) {
    g.step(0.02); g.clearFx(); t += 0.02;
    if (g.G.lives < lives0) return 0;
    for (const e of g.G.enemies) if (!e.dead) best = Math.min(best, Math.hypot(e.x - 500, e.y - 500));
    if (g.G.wave >= n - 1 && g.run("waveClear()")) break;
    if (g.G.wave >= n) break; // (the boss came: stop)
  }
  return best === Infinity ? 500 : best;
}
function boss(n, lvl, mul, seed) {
  const g = makeGame(seed); g.reset(); g.run("G.started = true;"); team(g, n, lvl); prime(g, n);
  const arc = g.run(`arcanaOf(${n}).id`);
  g.run(`${mul != null ? `FLEET_MUL["${arc}"] = ${mul};` : ""} G.wave = ${n - 1}; G.nextIn = 0;`);
  g.step(0.02); g.run("G.nextIn = 1e9;");
  const lives0 = g.G.lives; let best = Infinity, t = 0;
  while (t < 400 && !g.G.over) {
    g.step(0.02); g.clearFx(); t += 0.02;
    if (g.G.lives < lives0) return 0;
    for (const e of g.G.enemies) if (!e.dead) best = Math.min(best, Math.hypot(e.x - 500, e.y - 500));
    if (g.run("waveClear()")) break;
  }
  return best === Infinity ? 500 : best;
}
const avg = f => { let s = 0; for (let k = 1; k <= SEEDS; k++) s += f(k); return s / SEEDS; };
const g0 = makeGame(1); g0.reset();
const res = {};
for (let n = 10; n <= 100; n += 10) {
  if (ONLY.length && !ONLY.includes(n)) continue;
  const arc = g0.run(`arcanaOf(${n}).id`), mul0 = Number(process.env.BF_MUL) || g0.run(`FLEET_MUL["${arc}"] || 1`);
  let lvl = 1, st = 0;
  for (; lvl <= g0.MAX_LVL; lvl++) { st = avg(s => stretch(n, lvl, s)); if (st >= MIN_D) break; }
  lvl = Math.min(lvl, g0.MAX_LVL);
  const target = st * CLOSER, d0 = avg(s => boss(n, lvl, mul0, s));
  let mul = mul0, d = d0;
  if (MODE === "tune") {
    // closest approach falls as the fleet grows: bisect on a log scale
    let lo = 0.25, hi = 8;
    for (let it = 0; it < 7; it++) { const mid = Math.sqrt(lo * hi); if (avg(s => boss(n, lvl, mid, s)) > target) lo = mid; else hi = mid; }
    mul = +Math.sqrt(lo * hi).toPrecision(2); d = avg(s => boss(n, lvl, mul, s));
  }
  res[arc] = mul;
  console.log(n, arc, JSON.stringify({ lvl, stretch: Math.round(st), target: Math.round(target), mul0, d0: Math.round(d0), mul, d: Math.round(d) }));
}
console.log("FLEET_MUL " + JSON.stringify(res));
