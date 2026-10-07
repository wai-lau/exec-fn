// Boss HP balance (owner, 2026-10-05): each boss should come JUST A LITTLE
// CLOSER to the core than the waves either side of it. Closest approach, not
// enemy-seconds: a boss is one or a few bodies, so its time on the field is
// mostly its HP over its speed. Team: EVERY slot open at that wave filled
// (6 ring, + the corners from wave 40), kinds cycling ARC FRZ SOL ACD, all at the
// lowest level (1-4, first path / first final) at which the neighbouring waves
// stay out (closest approach >= MIN_D) - so the comparison stays readable late.
// Then bisect BOSS_HP[arcana] until the boss's closest approach is CLOSER x
// the neighbours' mean.
// usage: node bossbal.mjs [measure|tune] [seeds=2]   env BB_ONLY=10,20 to pick waves,
// BB_HP=x to measure one HP, BB_BROOD=n to try an Empress brood
import { makeGame } from "./sim.mjs";
const MODE = process.argv[2] || "measure", SEEDS = Number(process.argv[3] || 2);
const CLOSER = 0.9, MIN_D = 90;
const ONLY = (process.env.BB_ONLY || "").split(",").filter(Boolean).map(Number);
function closest(n, lvl, hp, seed) {
  const g = makeGame(seed); g.reset(); g.run("G.started = true;"); // no auto-send on the first place
  // the corner slots whose boss fell BEFORE this wave are open
  g.run(`G.money = 1e12; G.wave = ${n}; G.opened = {}; CELLS.forEach((c, i) => { if (c.unlock && c.unlock < ${n}) G.opened[i] = true; });`);
  const kinds = ["arc", "frz", "sol", "acd"], open = g.run("CELLS.map((c, i) => i).filter(cellOpen)");
  open.forEach((ci, j) => {
    const k = kinds[j % 4], i = ci;
    const t = g.place(k, i);
    // a chart tower (ARC) has 7 levels for the others' 4: its level `lvl` is 1 + 2 x (lvl - 1)
    const want = g.maxLvl(t) > g.MAX_LVL ? 1 + 2 * (lvl - 1) : lvl;
    while (t.lvl < want) {
      const need = g.pendingChoice(t);
      const choice = need === "path" ? Object.keys(g.UPGRADES[k])[0] : need === "form" ? 0 : undefined;
      if (!g.upgrade(t, choice)) break;
    }
  });
  const arc = g.run(`arcanaOf(${n}).id`);
  g.run(`${process.env.BB_BROOD ? `EMPRESS_BROOD = ${process.env.BB_BROOD};` : ""}${hp != null ? `BOSS_HP["${arc}"] = ${hp};` : ""}
    let prev = "swarm"; for (let k = 1; k < ${n}; k++) { const w = wavePlan(k, prev); if (w.type !== "bonus") prev = w.type; }
    G.lastType = prev; G.started = true; G.wave = ${n - 1}; G.nextIn = 0;`);
  g.step(0.02); g.run("G.nextIn = 1e9;");
  const lives0 = g.G.lives; let best = Infinity, t = 0;
  while (t < 300 && !g.G.over) {
    g.step(0.02); g.clearFx(); t += 0.02;
    if (g.G.lives < lives0) return 0; // something got through
    for (const e of g.G.enemies) if (!e.dead) best = Math.min(best, Math.hypot(e.x - 500, e.y - 500));
    if (g.run("waveClear()")) break;
  }
  return best === Infinity ? 500 : best;
}
const avg = (n, lvl, hp) => { let s = 0; for (let k = 1; k <= SEEDS; k++) s += closest(n, lvl, hp, k); return s / SEEDS; };
const g0 = makeGame(1); g0.reset();
const res = {};
for (let n = 10; n <= 100; n += 10) {
  if (ONLY.length && !ONLY.includes(n)) continue;
  const arc = g0.run(`arcanaOf(${n}).id`), hp0 = Number(process.env.BB_HP) || g0.run(`BOSS_HP["${arc}"] || 1`); // BB_HP: try one HP in measure mode
  let lvl = 1, nb = 0;
  // neighbours: the two waves either side (four), for less type noise - the
  // last boss takes the four BEFORE it: the game is won at WIN_WAVE, so the
  // waves after it never spawn (they read as "nothing came near", 500)
  const near = n >= g0.run("WIN_WAVE") ? [-4, -3, -2, -1] : [-2, -1, 1, 2];
  for (; lvl <= g0.MAX_LVL; lvl++) { nb = near.reduce((a, k) => a + avg(n + k, lvl), 0) / 4; if (nb >= MIN_D) break; }
  lvl = Math.min(lvl, g0.MAX_LVL);
  const target = nb * CLOSER, d0 = avg(n, lvl, hp0);
  let hp = hp0, d = d0;
  if (MODE === "tune") {
    // closest approach falls as HP rises: bisect on a log scale
    let lo = hp0 / 20, hi = hp0 * 20;
    for (let it = 0; it < 9; it++) { const mid = Math.sqrt(lo * hi); if (avg(n, lvl, mid) > target) lo = mid; else hi = mid; }
    hp = +Math.sqrt(lo * hi).toPrecision(2); d = avg(n, lvl, hp);
  }
  res[arc] = hp;
  console.log(n, arc, JSON.stringify({ lvl, neighbours: Math.round(nb), target: Math.round(target), hp0, d0: Math.round(d0), hp, d: Math.round(d) }));
}
console.log("BOSS_HP " + JSON.stringify(res));
