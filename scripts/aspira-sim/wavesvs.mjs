// ORDINARY WAVES BY TOWER (owner, 2026-10-08: "how is SOL against non-bosses?"): a team of SIX
// towers of ONE kind, each chart spent to POINTS points spread evenly, plays the ordinary
// waves of a window (boss waves skipped), lives refilled so every wave plays out. Per kind:
// enemies leaked by type, and the team's damage - the non-boss twin of bossvs.mjs.
// usage: node wavesvs.mjs [seeds=2]   env POINTS=8 WINDOWS=21-29,41-49,61-69,81-89 KINDS=... BV_PATCH=...
import { isMainThread } from "node:worker_threads";
import { makeGame, cellScores } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const KINDS = (process.env.KINDS || "arc,frz,sol,acd").split(","), POINTS = Number(process.env.POINTS || 8), PATCH = process.env.BV_PATCH || "";
const WINDOWS = (process.env.WINDOWS || "21-29,41-49,61-69,81-89").split(",").map(w => w.split("-").map(Number));

export default async function task({ kind, from, to, seed, patch = "" }) {
  const g = makeGame(seed, patch); g.reset();
  g.run(`G.started = true; G.money = 1e12; G.lives = 1e6; let prev = "swarm"; for (let n = 1; n < ${from}; n++) { const w = wavePlan(n, prev); if (w.type !== "bonus") prev = w.type; } G.lastType = prev; G.wave = ${from - 1};`);
  const sc = cellScores(g, kind), open = g.run("CELLS.map((c, i) => i).filter(cellOpen)").sort((a, b) => sc[b] - sc[a]);
  const axes = g.run(`SKILL_TREES[${JSON.stringify(kind)}].map(a => a.id)`);
  for (const ci of open) { const t = g.place(kind, ci); if (!t) continue; const sk = {}; for (let p = 0; p < POINTS; p++) { const a = axes[p % 3]; sk[a] = (sk[a] || 0) + 1; } t.skills = sk; t.lvl = 1 + POINTS; }
  g.run("G.nextIn = 0;");
  const leaks = {}; let guard = 0;
  while (g.G.wave <= to && guard++ < 400000) {
    if (g.G.wave % 10 === 0) g.run("for (const e of G.enemies) if (e.type === 'bonus') { e.dead = true; e.gone = true; } G.spawns = G.spawns.filter(w => !w.list.includes('bonus'));"); // boss waves skipped
    const alive = g.G.enemies.filter(e => !e.dead);
    g.step(0.05); g.clearFx();
    for (const e of alive) if (e.dead && e.gone && e.hp > 0 && e.type !== "bonus") leaks[e.type] = (leaks[e.type] || 0) + 1;
    g.run("G.lives = 1e6; G.over = false;");
    if (g.G.wave === to && g.run("waveClear()")) break;
  }
  return { leaks, dealt: Math.round(g.G.towers.reduce((a, t) => a + (t.dealt || 0), 0)) };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("wavesvs.mjs")) {
  const SEEDS = Number(process.argv[2] || 2);
  const jobs = []; for (const [from, to] of WINDOWS) for (const kind of KINDS) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kind, from, to, seed, patch: PATCH });
  const res = await runPool(new URL(import.meta.url), jobs, { quiet: true });
  console.log(`six towers of one kind, ${POINTS} points each, ordinary waves only, ${SEEDS} seeds: enemies LEAKED per window (by type)`);
  console.log("waves".padEnd(8) + KINDS.map(k => k.toUpperCase().padEnd(30)).join(""));
  for (const [from, to] of WINDOWS) {
    const cells = KINDS.map(kind => { const rs = jobs.map((j, i) => (j.kind === kind && j.from === from ? res[i] : null)).filter(Boolean), l = {}; for (const r of rs) for (const [t, n] of Object.entries(r.leaks)) l[t] = (l[t] || 0) + n / rs.length;
      const tot = Object.values(l).reduce((a, b) => a + b, 0); return (Math.round(tot) + (tot ? " (" + Object.entries(l).map(([t, n]) => t + " " + Math.round(n)).join(", ") + ")" : "")).padEnd(30); });
    console.log(`${from}-${to}`.padEnd(8) + cells.join(""));
  }
}
