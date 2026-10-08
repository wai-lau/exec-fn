// BOSSES BY TOWER (owner, 2026-10-08: "so ACD is way better than SOL against bosses?"): each
// boss wave (10, 20 .. 100) alone against a team of SIX towers of ONE kind, every slot
// filled, each tower's chart spent to POINTS points spread evenly, no core powers. Per
// (kind, boss): did it breach (reach the core), how close it came, and how long the wave
// took to clear. Answers which kind handles which boss, and how far ahead ACD is.
// usage: node bossvs.mjs [seeds=2] [out.jsonl]   env POINTS=4,8  KINDS=sol,acd  BV_PATCH="BOSS_HP.star = 2;" (a balance try)
import { isMainThread } from "node:worker_threads";
import { makeGame, cellScores } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const KINDS = (process.env.KINDS || "arc,frz,sol,acd").split(","), PATCH = process.env.BV_PATCH || "", WAVES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const POINTS = (process.env.POINTS || "4,8").split(",").map(Number);

export default async function task({ kind, wave, points, seed, patch = "" }) {
  const g = makeGame(seed, patch); g.reset();
  g.run(`G.started = true; G.money = 1e12; G.lives = 1e6; let prev = "swarm"; for (let n = 1; n < ${wave}; n++) { const w = wavePlan(n, prev); if (w.type !== "bonus") prev = w.type; } G.lastType = prev; G.wave = ${wave - 1};`);
  const sc = cellScores(g, kind), open = g.run("CELLS.map((c, i) => i).filter(cellOpen)").sort((a, b) => sc[b] - sc[a]);
  const axes = g.run(`SKILL_TREES[${JSON.stringify(kind)}].map(a => a.id)`);
  for (const ci of open) {
    const t = g.place(kind, ci); if (!t) continue;
    const sk = {}; for (let p = 0; p < points; p++) { const a = axes[p % 3]; sk[a] = (sk[a] || 0) + 1; }
    t.skills = sk; t.lvl = 1 + points;
  }
  g.run("G.nextIn = 0;");
  let near = Infinity, time = 0, breached = false, sent = false;
  while (time < 600) {
    g.step(0.05); g.clearFx(); time += 0.05;
    if (g.G.wave === wave) sent = true;
    for (const e of g.G.enemies) if (!e.dead && e.type === "bonus") near = Math.min(near, Math.hypot(e.x - g.CX, e.y - g.CY));
    if (g.G.lives === 0) { breached = true; break; }
    if (sent && g.run("waveClear()")) break;
  }
  return { breached, near: Math.round(near === Infinity ? 999 : near), time: Math.round(time) };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("bossvs.mjs")) {
  const SEEDS = Number(process.argv[2] || 2), OUT = process.argv[3] || null;
  const jobs = []; for (const points of POINTS) for (const wave of WAVES) for (const kind of KINDS) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kind, wave, points, seed, patch: PATCH });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const g0 = makeGame(1), name = w => g0.run(`arcanaOf(${w}).name || arcanaOf(${w}).id`);
  for (const points of POINTS) {
    console.log(`\n=== six towers of one kind, ${points} points each (spread), ${SEEDS} seeds: BREACH, or closest approach / seconds to clear`);
    console.log("boss".padEnd(18) + KINDS.map(k => k.toUpperCase().padEnd(14)).join(""));
    for (const wave of WAVES) {
      const cells = KINDS.map(kind => { const rs = jobs.map((j, i) => (j.kind === kind && j.wave === wave && j.points === points ? res[i] : null)).filter(Boolean); const b = rs.filter(r => r.breached).length;
        return (b ? `BREACH ${b}/${rs.length}` : `${Math.round(rs.reduce((a, r) => a + r.near, 0) / rs.length)} / ${Math.round(rs.reduce((a, r) => a + r.time, 0) / rs.length)}s`).padEnd(14); });
      console.log((wave + " " + name(wave)).padEnd(18) + cells.join(""));
    }
  }
}
