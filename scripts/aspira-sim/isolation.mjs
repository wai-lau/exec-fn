// UPGRADE ISOLATION (owner, 2026-10-07 balancing runs): every axis tier ALONE. For each
// kind, the test tower at cell 0 with ONE axis at tier k (k = 0..5, the others at 0)
// and one L1 helper of each other kind, lives refilled so every wave plays out, over
// two windows (WINDOWS: early 10-30, late 40-70). Metric: the TEAM's damage (so FRZ's
// slow and SOL's breach count through the others' hits), the tower's own damage, and
// leaks, each vs the bare tower (k = 0). Also prints each tier's price, so value per
// credit can be read: a tier is worth buying when its gain beats its cost.
// usage: node isolation.mjs [seeds=3] [out.jsonl]   env WINDOWS=10-30,40-70
import { isMainThread } from "node:worker_threads";
import { makeGame } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const KINDS = ["arc", "frz", "sol", "acd"];
const WINDOWS = (process.env.WINDOWS || "10-30,40-70").split(",").map(w => w.split("-").map(Number));

export default async function task({ kind, axis, k, seed, from, to, patch = "" }) {
  const g = makeGame(seed, patch); g.reset();
  g.run(`G.money = 1e12; G.started = true; G.wave = ${from - 1}; G.lives = 1e6;`);
  const t = g.place(kind, 0);
  if (axis && k) { t.skills = { [axis]: k }; t.lvl = 1 + k; }
  KINDS.filter(x => x !== kind).forEach((x, i) => g.place(x, [2, 3, 4][i]));
  g.run(`let prev = "swarm"; for (let n = 1; n < ${from}; n++) { const w = wavePlan(n, prev); if (w.type !== "bonus") prev = w.type; } G.lastType = prev; G.nextIn = 0;`);
  let guard = 0, lost = 0, breaches = 0;
  while (g.G.wave <= to && guard++ < 300000) {
    g.step(0.05); g.clearFx();
    if (g.G.lives === 0) breaches++; else lost += 1e6 - g.G.lives;
    g.run("G.lives = 1e6; G.over = false;");
    if (g.G.wave === to && g.run("waveClear()")) break;
  }
  return { own: Math.round(t.dealt || 0), team: Math.round(g.G.towers.reduce((a, x) => a + (x.dealt || 0), 0)), lost, breaches };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("isolation.mjs")) {
  const SEEDS = Number(process.argv[2] || 3), OUT = process.argv[3] || null;
  const g0 = makeGame(1);
  const axesOf = kind => g0.run(`SKILL_TREES[${JSON.stringify(kind)}].map(a => a.id)`);
  const jobs = [];
  for (const [from, to] of WINDOWS) for (const kind of KINDS) {
    for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kind, axis: null, k: 0, seed, from, to });
    for (const axis of axesOf(kind)) for (let k = 1; k <= 5; k++) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kind, axis, k, seed, from, to });
  }
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const mean = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const pick = f => jobs.map((j, i) => (f(j) ? res[i] : null)).filter(Boolean);
  const price = n => { let c = 0; for (let i = 0; i < n; i++) c += Math.round(40 * g0.run(`SKILL_STEP_COST[${i}]`)); return c; };
  for (const [from, to] of WINDOWS) {
    console.log(`\n=== waves ${from}-${to}, ${SEEDS} seeds: each axis tier ALONE vs the bare tower (team damage %, own damage %, leaks, breaches; tier price if bought first)`);
    for (const kind of KINDS) {
      const base = pick(j => j.kind === kind && !j.axis && j.from === from), bt = mean(base, r => r.team), bo = mean(base, r => r.own);
      console.log(`${kind.toUpperCase()}  bare: team ${Math.round(bt)} own ${Math.round(bo)} leaks ${mean(base, r => r.lost).toFixed(0)} breaches ${mean(base, r => r.breaches).toFixed(1)}`);
      for (const axis of axesOf(kind)) {
        const cells = [1, 2, 3, 4, 5].map(k => { const rs = pick(j => j.kind === kind && j.axis === axis && j.k === k && j.from === from); return `${["I", "II", "III", "IV", "V"][k - 1]} ${(100 * mean(rs, r => r.team) / bt).toFixed(0)}% / ${(100 * mean(rs, r => r.own) / bo).toFixed(0)}% / ${mean(rs, r => r.lost).toFixed(0)} / ${mean(rs, r => r.breaches).toFixed(1)}`; });
        console.log(`   ${axis.padEnd(13)} ${cells.join("   ")}`);
      }
    }
  }
  console.log(`\ntier prices if bought first: I ${price(1)}c, II ${price(2)}c, III ${price(3)}c (later points cost more: a full chart is ${price(15)}c)`);
}
