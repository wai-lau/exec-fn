// COUNTER MATRIX (owner, 2026-10-08: "at minimum, 1 tower that counters [each enemy],
// and 1 other tower that has a counter path"): every ordinary wave of a window is
// FORCED to one enemy type (WAVE_TYPE_FORCE), and a team of N towers of ONE kind
// plays it - charts spread evenly ("spread"), or one axis maxed with the rest spread.
// Lives refilled so every wave plays out. Prints % of that type LEAKED per window.
// usage: node countermx.mjs [seeds=2]   env N=3 POINTS=8 WINDOWS=41-49,61-69 KINDS=... BV_PATCH=<file>
import fs from "node:fs";
import { isMainThread } from "node:worker_threads";
import { makeGame, cellScores } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const KINDS = (process.env.KINDS || "arc,frz,sol,acd").split(","), TYPES = ["swarm", "fast", "shield", "armor"];
const N = Number(process.env.N || 3), POINTS = Number(process.env.POINTS || 8);
const WINDOWS = (process.env.WINDOWS || "41-49,61-69").split(",").map(w => w.split("-").map(Number));
const PATCH = process.env.BV_PATCH ? fs.readFileSync(process.env.BV_PATCH, "utf8") : "";

export default async function task({ kind, build, type, from, to, seed }) {
  const g = makeGame(seed, PATCH); g.reset();
  g.run(`for (let n = ${from}; n <= ${to}; n++) if (n % 10) WAVE_TYPE_FORCE[n] = ${JSON.stringify(type)};`);
  g.run(`G.started = true; G.money = 1e12; G.lives = 1e6; G.wave = ${from - 1}; G.lastType = ${JSON.stringify(type)};`);
  const sc = cellScores(g, kind), open = g.run("CELLS.map((c, i) => i).filter(cellOpen)").sort((a, b) => sc[b] - sc[a]);
  const axes = g.run(`SKILL_TREES[${JSON.stringify(kind)}].map(a => a.id)`), tiers = g.run("SKILL_TIERS");
  const sk = {};
  if (build === "spread") for (let p = 0; p < POINTS; p++) sk[axes[p % 3]] = (sk[axes[p % 3]] || 0) + 1;
  else { sk[build] = tiers; const rest = axes.filter(a => a !== build); for (let p = 0; p < POINTS - tiers; p++) sk[rest[p % 2]] = (sk[rest[p % 2]] || 0) + 1; }
  let placed = 0;
  for (const ci of open) { if (placed >= N) break; const t = g.place(kind, ci); if (!t) continue; t.skills = { ...sk }; t.lvl = 1 + POINTS; placed++; }
  g.run("G.nextIn = 0;");
  let leaked = 0, seen = new Set(), guard = 0;
  while (g.G.wave <= to && guard++ < 400000) {
    if (g.G.wave % 10 === 0) g.run("for (const e of G.enemies) if (e.type === 'bonus') { e.dead = true; e.gone = true; } G.spawns = G.spawns.filter(w => !w.list.includes('bonus'));");
    for (const e of g.G.enemies) if (e.type === type) seen.add(e.id);
    const alive = g.G.enemies.filter(e => !e.dead);
    g.step(0.05); g.clearFx();
    for (const e of alive) if (e.dead && e.gone && e.hp > 0 && e.type === type) leaked++;
    g.run("G.lives = 1e6; G.over = false;");
    if (g.G.wave === to && g.run("waveClear()")) break;
  }
  return { leaked, spawned: seen.size };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("countermx.mjs")) {
  const SEEDS = Number(process.argv[2] || 2);
  const AX = { arc: ["conductivity", "voltage", "capacitance"], frz: ["temp", "rime", "moons"], sol: ["focus", "refraction", "breach"], acd: ["corrosion", "spray", "contagion"] };
  const jobs = [];
  for (const [from, to] of WINDOWS) for (const kind of KINDS) for (const build of ["spread", ...AX[kind]]) for (const type of TYPES) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kind, build, type, from, to, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { quiet: true });
  console.log(`${N} towers of one kind, ${POINTS} points (spread, or that axis at V + rest spread), every ordinary wave forced to one type, ${SEEDS} seeds: % LEAKED`);
  for (const [from, to] of WINDOWS) {
    console.log(`\nwaves ${from}-${to}`.padEnd(26) + TYPES.map(t => t.padStart(8)).join(""));
    for (const kind of KINDS) for (const build of ["spread", ...AX[kind]]) {
      const cells = TYPES.map(type => { const rs = jobs.map((j, i) => (j.kind === kind && j.build === build && j.type === type && j.from === from ? res[i] : null)).filter(Boolean);
        const l = rs.reduce((a, r) => a + r.leaked, 0), s = rs.reduce((a, r) => a + r.spawned, 0); return (s ? Math.round(100 * l / s) + "%" : "-").padStart(8); });
      console.log(("  " + kind.toUpperCase() + " " + build).padEnd(25) + cells.join(""));
    }
  }
}
