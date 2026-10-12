// SOL vs ARMOR, diagnosed (2026-10-12: SOL leaked 22-35% of late armor in countermx though Refraction hops strip it):
// SOL (one build) + ARC + FRZ, armor-only waves FROM..TO, every SOL shot's hops counted (how many of st.refraction it
// found), and each armored enemy's armor lost by its death or escape. usage: node soldiag.mjs [seeds=2]
//   env BUILD=refraction|focus|breach|spread POINTS=10 FROM=81 TO=85
import { makeGame, cellScores } from "./sim.mjs";
const BUILD = process.env.BUILD || "refraction", POINTS = Number(process.env.POINTS || 10), FROM = Number(process.env.FROM || 81), TO = Number(process.env.TO || 85);
const SEEDS = Number(process.argv[2] || 2);
for (let seed = 1; seed <= SEEDS; seed++) {
  const g = makeGame(seed); g.reset();
  g.run(`for (let n = ${FROM}; n <= ${TO}; n++) if (n % 10) WAVE_TYPE_FORCE[n] = "armor"; G.started = true; G.money = 1e12; G.lives = 1e6; G.wave = ${FROM - 1}; G.lastType = "armor";`);
  const team = [["sol", BUILD], ["arc", "spread"], ["frz", "spread"]];
  for (const [k, b] of team) {
    const ax = g.run(`SKILL_TREES["${k}"].map(a => a.id)`), sk = {}, tiers = Math.min(POINTS, 5);
    if (b === "spread") for (let p = 0; p < POINTS; p++) sk[ax[p % 3]] = (sk[ax[p % 3]] || 0) + 1;
    else { sk[b] = tiers; const rest = ax.filter(a => a !== b); for (let p = 0; p < POINTS - tiers; p++) sk[rest[p % 2]] = (sk[rest[p % 2]] || 0) + 1; }
    const sc = cellScores(g, k), free = g.run("CELLS.map((c, i) => i).filter(cellOpen)").filter(ci => !g.G.towers.some(t => t.cell === ci)).sort((a, b) => sc[b] - sc[a]);
    for (const ci of free) { const t = g.place(k, ci); if (t) { t.skills = sk; t.lvl = 1 + POINTS; break; } }
  }
  g.run(`globalThis.__d = { shots: 0, hops: 0, want: 0, noFirst: 0, hist: {} };
    const __sr = solRefraction; solRefraction = function (t, st, e) { const h0 = __d.hops; __d.shots++; __d.want += st.refraction === Infinity ? 0 : st.refraction; __sr.apply(this, arguments); const h = __d.hops - h0; __d.hist[h] = (__d.hist[h] || 0) + 1; };
    const __rh = rayHit; rayHit = function (t, st, e, base, from) { if (from !== t) __d.hops++; return __rh.apply(this, arguments); };
    G.nextIn = 0;`);
  const lost = [], seen = new Set(), T = { all: 0, armor: 0, inR: 0 }; let leaked = 0, guard = 0;
  while (g.G.wave <= TO && guard++ < 400000) {
    const alive = g.G.enemies.filter(e => !e.dead);
    { const sol = g.G.towers.find(t => t.kind === "sol"), r = g.run("towerStats(G.towers.find(t => t.kind === 'sol')).range"); T.all++; if (alive.some(e => e.type === "armor")) { T.armor++; if (alive.some(e => e.type === "armor" && Math.hypot(e.x - sol.x, e.y - sol.y) <= r)) T.inR++; } T.r = r; T.pos = [Math.round(sol.x - 500), Math.round(sol.y - 500)]; }
    g.step(0.05); g.clearFx();
    for (const e of alive) if (e.dead && e.type === "armor" && !seen.has(e.id)) { seen.add(e.id); lost.push(Math.round((e.armor0 || 0) - (e.armor || 0))); if (e.gone && e.hp > 0) leaked++; }
    g.run("G.lives = 1e6; G.over = false;");
    if (g.G.wave === TO && g.run("waveClear()")) break;
  }
  const d = g.run("__d"), sol = g.G.towers.find(t => t.kind === "sol");
  lost.sort((a, b) => a - b);
  console.log(`   time ${(T.all * 0.05).toFixed(0)}s, armor on board ${(T.armor * 0.05).toFixed(0)}s, armor in SOL range (${Math.round(T.r)}) ${(T.inR * 0.05).toFixed(0)}s; SOL at ${T.pos} from the core`);
  const q = f => lost[Math.floor(f * (lost.length - 1))];
  console.log(`seed ${seed} ${BUILD}: SOL shots ${d.shots}, hops ${d.hops} (${(d.hops / d.shots).toFixed(2)}/shot of ${(d.want / d.shots).toFixed(1)} wanted) | hops per shot ${JSON.stringify(d.hist)}`);
  console.log(`   armored ${lost.length}, leaked ${leaked} (${(100 * leaked / lost.length).toFixed(0)}%) | armor lost at death p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} (armor0 ~${g.run("Math.round(armorRefOf(" + FROM + "))")}) | SOL dealt ${Math.round(sol.dealt)} vs team ${Math.round(g.G.towers.reduce((a, t) => a + (t.dealt || 0), 0))}`);
}
