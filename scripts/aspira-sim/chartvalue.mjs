// Skill-chart value (owner, 2026-10-07; replaces formvalue.mjs, which measured
// the old path/form tree): for each kind, every way to spend its 6 chart points
// over its 3 axes (max 3 a tier) vs the even 2/2/2 - the test tower MAXED at
// cell 0 with three L1 helpers (the other kinds), lives refilled so every wave
// plays out, over waves FROM..TO. The metric is the TEAM's damage (so FRZ's
// slow counts through the others' hits); the tower's own damage, the leaks
// and the boss BREACHES (a boss at the core, which would have ended a real
// game) are printed beside it. Then per axis: the mean value at each tier.
// usage: node chartvalue.mjs [seeds=3] [out.jsonl]   env FROM=30 TO=60 CV_KINDS=arc,acd (a subset)
import { isMainThread } from "node:worker_threads";
import { makeGame } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const KINDS = ["arc", "frz", "sol", "acd"], RUN_KINDS = process.env.CV_KINDS ? process.env.CV_KINDS.split(",") : KINDS;
const FROM = Number(process.env.FROM || 30), TO = Number(process.env.TO || 60);
export const DISTS = [];
for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) { const c = 6 - a - b; if (c >= 0 && c <= 3) DISTS.push([a, b, c]); }

export default async function task({ kind, dist, seed }) {
  const g = makeGame(seed); g.reset();
  g.run(`G.money = 1e12; G.started = true; G.wave = ${FROM - 1}; G.lives = 1e6;`);
  const axes = g.run(`SKILL_TREES[${JSON.stringify(kind)}].map(a => a.id)`);
  const sk = {}; dist.forEach((n, i) => { if (n) sk[axes[i]] = n; });
  const t = g.place(kind, 0); t.skills = sk; t.lvl = 1 + dist.reduce((a, b) => a + b, 0);
  KINDS.filter(k => k !== kind).forEach((k, i) => g.place(k, [2, 3, 4][i]));
  g.run(`let prev = "swarm"; for (let k = 1; k < ${FROM}; k++) { const w = wavePlan(k, prev); if (w.type !== "bonus") prev = w.type; } G.lastType = prev; G.nextIn = 0;`);
  let guard = 0, lost = 0, breaches = 0;
  while (g.G.wave <= TO && guard++ < 200000) {
    g.step(0.05); g.clearFx();
    // a boss reaching the core zeroes the lives (aspira-game.js): count it as a BREACH, not a million leaks
    if (g.G.lives === 0) breaches++; else lost += 1e6 - g.G.lives;
    g.run("G.lives = 1e6; G.over = false;");
    if (g.G.wave === TO && g.run("waveClear()")) break;
  }
  const team = g.G.towers.reduce((a, x) => a + (x.dealt || 0), 0);
  return { own: Math.round(t.dealt || 0), team: Math.round(team), lost, breaches, kills: t.kills || 0 };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("chartvalue.mjs")) {
  const SEEDS = Number(process.argv[2] || 3), OUT = process.argv[3] || null;
  const jobs = [];
  for (const kind of RUN_KINDS) for (const dist of DISTS) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kind, dist, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const g0 = makeGame(1);
  const key = j => j.kind + ":" + j.dist.join("");
  const agg = {};
  jobs.forEach((j, i) => { const k = key(j); (agg[k] = agg[k] || []).push(res[i]); });
  const mean = (rows, f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  console.log(`waves ${FROM}-${TO}, ${SEEDS} seeds; value = team damage vs 2/2/2 (own damage, leaks)`);
  for (const kind of RUN_KINDS) {
    const axes = g0.run(`SKILL_TREES[${JSON.stringify(kind)}].map(a => a.name)`);
    const base = agg[kind + ":222"];
    const bt = mean(base, r => r.team), bo = mean(base, r => r.own);
    console.log(`\n${kind.toUpperCase()}  axes ${axes.join(" / ")}   baseline team ${Math.round(bt)} own ${Math.round(bo)} leaks ${mean(base, r => r.lost).toFixed(1)} breaches ${mean(base, r => r.breaches).toFixed(1)}`);
    const rows = DISTS.map(d => { const r = agg[kind + ":" + d.join("")]; return { d, team: mean(r, x => x.team) / bt, own: mean(r, x => x.own) / bo, lost: mean(r, x => x.lost), breaches: mean(r, x => x.breaches) }; })
      .sort((a, b) => b.team - a.team);
    for (const r of rows) console.log("  " + r.d.join("/") + "  team " + (100 * r.team).toFixed(0).padStart(4) + "%  own " + (100 * r.own).toFixed(0).padStart(4) + "%  leaks " + r.lost.toFixed(1).padStart(6) + "  breaches " + r.breaches.toFixed(1));
    // per axis: mean team value at each tier, over every distribution with that tier
    for (let ax = 0; ax < 3; ax++) {
      const byTier = [0, 1, 2, 3].map(t => { const rs = rows.filter(r => r.d[ax] === t); return rs.length ? (100 * mean(rs, r => r.team)).toFixed(0) + "%" : "-"; });
      console.log("  " + axes[ax].padEnd(13) + " tier 0..3 -> " + byTier.join("  "));
    }
  }
}
