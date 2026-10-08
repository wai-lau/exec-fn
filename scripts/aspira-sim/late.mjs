// Late game (owner, 2026-10-07 balancing runs; rewritten for the nine-point chart and
// six slots): start at wave START, fill all six slots with towers whose charts are
// spent to POINTS points (default 9: every axis maxed), every core power granted and
// used (corepower.mjs), then play until the core falls or the 10th boss does.
// A build is a kind per slot plus, when POINTS < 9, a spend per tower. Every 6-slot
// kind multiset is tried (84 of them; slot order follows the cell scores), each on
// SEEDS seeds; the report ranks them and shows where each mono build walls.
// Score = the WORST seed's wave x 100 + lives.
// usage: node late.mjs [seeds=2] [out.jsonl]   env START=60 MONEY=0 POINTS=15
import { isMainThread } from "node:worker_threads";
import { makeGame, cellScores } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { usePowers, grantAll } from "./corepower.mjs";

const KINDS = ["arc", "frz", "sol", "acd"];
const START = Number(process.env.START || 60), MONEY = Number(process.env.MONEY || 0), POINTS = Number(process.env.POINTS || 15), MAX_WAVE = 100, DT = 0.05;

function run(kinds, seed) {
  const g = makeGame(seed); g.reset();
  g.run(`G.started = true; G.money = ${MONEY}; let prev = "swarm"; for (let n = 1; n < ${START}; n++) { const w = wavePlan(n, prev); if (w.type !== "bonus") prev = w.type; }
    G.lastType = prev; G.wave = ${START - 1};`);
  const sc = cellScores(g, "arc"), open = g.run("CELLS.map((c, i) => i).filter(cellOpen)").sort((a, b) => sc[b] - sc[a]);
  open.forEach((ci, i) => {
    const kind = kinds[i % kinds.length]; g.run("G.money += 1e9"); const t = g.place(kind, ci); g.run("G.money -= 1e9");
    if (!t) return;
    const axes = g.run(`SKILL_TREES[${JSON.stringify(kind)}].map(a => a.id)`), sk = {};
    let left = POINTS; for (let r = 0; r < 5 && left > 0; r++) for (const a of axes) if (left > 0) { sk[a] = (sk[a] || 0) + 1; left--; }
    t.skills = sk; t.lvl = 1 + POINTS;
  });
  grantAll(g);
  g.run("G.nextIn = 0;");
  const mem = {}; let t = 0, tick = 0;
  while (!g.G.over && g.G.wave <= MAX_WAVE && t < 7200) { g.step(DT); g.clearFx(); t += DT; if (++tick % 10 === 0) usePowers(g, mem); }
  return { wave: g.G.wave, lives: g.G.lives, won: !!g.G.won };
}
export default async function task({ kinds, seed }) { return run(kinds, seed); }

if (isMainThread && process.argv[1] && process.argv[1].endsWith("late.mjs")) {
  const SEEDS = Number(process.argv[2] || 2), OUT = process.argv[3] || null;
  const builds = [];
  const rec = (start, left, acc) => { if (!left) { builds.push(acc); return; } for (let i = start; i < 4; i++) rec(i, left - 1, acc.concat(KINDS[i])); };
  rec(0, 6, []);
  const jobs = []; for (const kinds of builds) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kinds, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const rows = builds.map(kinds => { const rs = jobs.map((j, i) => (j.kinds === kinds ? res[i] : null)).filter(Boolean); return { kinds, rs, score: Math.min(...rs.map(r => r.wave * 100 + Math.max(0, r.lives))) }; }).sort((a, b) => b.score - a.score);
  const fmt = r => r.rs.map(x => x.wave + (x.won ? "W" : "") + "/" + x.lives).join(" ");
  const name = k => KINDS.map(x => [x, k.filter(y => y === x).length]).filter(([, n]) => n).map(([x, n]) => n + x).join(" ");
  console.log(`late game: from wave ${START}, ${MONEY} credits, 6 towers at ${POINTS} points each, every core power; ${builds.length} builds x ${SEEDS} seeds\n`);
  console.log("TOP 15"); for (const r of rows.slice(0, 15)) console.log("  " + name(r.kinds).padEnd(22) + fmt(r));
  console.log("\nBOTTOM 10"); for (const r of rows.slice(-10)) console.log("  " + name(r.kinds).padEnd(22) + fmt(r));
  console.log("\nMONO"); for (const r of rows.filter(r => new Set(r.kinds).size === 1)) console.log("  " + name(r.kinds).padEnd(22) + fmt(r));
  console.log("\nWITHOUT ONE KIND (best build lacking it)"); for (const k of KINDS) { const r = rows.find(r => !r.kinds.includes(k)); console.log("  no " + k.padEnd(4) + name(r.kinds).padEnd(22) + fmt(r)); }
  console.log(`\n${rows.filter(r => r.rs.every(x => x.won)).length} of ${rows.length} builds win every seed`);
}
