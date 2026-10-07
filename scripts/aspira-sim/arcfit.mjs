// ARC skill-chart fit (owner, 2026-10-05): each tier of Conductivity and of
// Voltage should deal +25% / +50% / +100% over the base ARC (damage dealt,
// overkill excluded) over waves FROM..TO, with ARC and three L1 helpers (FRZ,
// SOL, ACD) and lives refilled so every wave plays out. Bisects
// ARC_CONDUCTIVITY[k].d and ARC_VOLTAGE_DMG[k].
// usage: node arcfit.mjs [seeds=2]   env FROM=6 TO=20
import { makeGame } from "./sim.mjs";
const FROM = Number(process.env.FROM || 6), TO = Number(process.env.TO || 20), SEEDS = Number(process.argv[2] || 2);
const GOAL = [1, 1.25, 1.5, 2];
function run(sk, seed, cd, vd) {
  const g = makeGame(seed); g.reset(); g.run("G.money = 1e12; G.started = true; G.wave = " + (FROM - 1) + ";");
  g.run(`${JSON.stringify(cd)}.forEach((d, i) => { ARC_CONDUCTIVITY[i].d = d; }); ARC_VOLTAGE_DMG.splice(0, 4, ...${JSON.stringify(vd)});`);
  const t = g.place("arc", 0); t.skills = sk; t.lvl = 1 + Object.values(sk).reduce((a, b) => a + b, 0);
  g.place("frz", 2); g.place("sol", 3); g.place("acd", 4);
  g.run(`let prev = "swarm"; for (let k = 1; k < ${FROM}; k++) { const w = wavePlan(k, prev); if (w.type !== "bonus") prev = w.type; } G.lastType = prev; G.nextIn = 0;`);
  let guard = 0;
  while (g.G.wave <= TO && guard++ < 200000) { g.step(0.05); g.clearFx(); g.run("G.lives = 1e6; G.over = false;"); if (g.G.wave === TO && g.run("waveClear()")) break; }
  return t.dealt || 0;
}
const cd = [1, 1, 1, 1], vd = [1, 1, 1, 1];
const avg = sk => { let s = 0; for (let k = 1; k <= SEEDS; k++) s += run(sk, k, cd, vd); return s / SEEDS; };
const base = avg({});
console.log("base", Math.round(base));
for (const [axis, arr] of [["conductivity", cd], ["voltage", vd]]) {
  for (const k of [1, 2, 3]) {
    const target = base * GOAL[k];
    let lo = 0.3, hi = 6;
    for (let it = 0; it < 7; it++) { const mid = Math.sqrt(lo * hi); arr[k] = mid; if (avg({ [axis]: k }) < target) lo = mid; else hi = mid; }
    arr[k] = +Math.sqrt(lo * hi).toFixed(2);
    console.log(axis, k, "x" + arr[k], Math.round(avg({ [axis]: k })), "target", Math.round(target));
  }
}
console.log("ARC_CONDUCTIVITY d", JSON.stringify(cd), "ARC_VOLTAGE_DMG", JSON.stringify(vd));
