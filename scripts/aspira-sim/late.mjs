// Late game (owner, 2026-10-07; replaces latesearch.mjs, which climbed the old
// path/form tree): start at wave START with MONEY credits, fill every slot open
// at that wave (the corners whose boss has fallen) with a MAXED tower, grant
// every core power and use them (corepower.mjs), then play until the
// core falls or the 10th boss does. A build is one (kind, 6-point chart spend)
// per slot. Ten independent hill-climbs run in parallel (one per worker), from
// the four mono builds, an even mix and random starts; each reports its start
// and its best, so the mono starts double as "where does every mono build wall".
// Score = the WORST seed's wave x 100 + lives.
// usage: node late.mjs [evals per climb=25] [seeds=2] [out.jsonl]   env START=60 MONEY=300000
import { isMainThread } from "node:worker_threads";
import { makeGame, cellScores } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { usePowers, grantAll } from "./corepower.mjs";
import { DISTS } from "./chartvalue.mjs";

const KINDS = ["arc", "frz", "sol", "acd"];
const START = Number(process.env.START || 60), MONEY = Number(process.env.MONEY || 300000), MAX_WAVE = 100, DT = 0.05;
const EVEN = DISTS.findIndex(d => d.join("") === "222");

function run(build, seed) {
  const g = makeGame(seed); g.reset();
  g.run(`G.started = true; G.money = ${MONEY}; G.opened = {}; CELLS.forEach((c, i) => { if (c.unlock && c.unlock < ${START}) G.opened[i] = true; });
    let prev = "swarm"; for (let n = 1; n < ${START}; n++) { const w = wavePlan(n, prev); if (w.type !== "bonus") prev = w.type; }
    G.lastType = prev; G.wave = ${START - 1};`);
  const sc = cellScores(g, "arc"), open = g.run("CELLS.map((c, i) => i).filter(cellOpen)").sort((a, b) => sc[b] - sc[a]);
  open.forEach((ci, i) => {
    const b = build.slots[i % build.slots.length], t = g.place(b.kind, ci);
    if (!t) return;
    const axes = g.run(`SKILL_TREES[${JSON.stringify(b.kind)}].map(a => a.id)`), sk = {};
    DISTS[b.d].forEach((n, k) => { if (n) sk[axes[k]] = n; });
    t.skills = sk; t.lvl = 1 + 6;
  });
  grantAll(g); // every power (the picks come at 30 / 50 / 70; START is past most of them)
  g.run("G.nextIn = 0;");
  const mem = {}; let t = 0, tick = 0;
  while (!g.G.over && g.G.wave <= MAX_WAVE && t < 7200) {
    g.step(DT); g.clearFx(); t += DT;
    if (++tick % 10 === 0) usePowers(g, mem);
  }
  return { wave: g.G.wave, lives: g.G.lives, won: !!g.G.won, secs: Math.round(t) };
}
const name = b => b.slots.map(s => s.kind + DISTS[s.d].join("")).join(" ");

export default async function task({ start, evals, seeds, rng }) {
  let r = rng >>> 0 || 1;
  const rnd = () => (r = (r * 1103515245 + 12345) >>> 0) / 4294967296, ri = n => Math.floor(rnd() * n);
  const score = b => { let worst = Infinity; const res = []; for (let s = 1; s <= seeds; s++) { const x = run(b, s); res.push(x); worst = Math.min(worst, x.wave * 100 + Math.max(0, x.lives)); } return { v: worst, res }; };
  const mutate = b => { const c = { slots: b.slots.map(s => ({ ...s })) }, i = ri(c.slots.length); if (ri(2)) c.slots[i].kind = KINDS[ri(4)]; else c.slots[i].d = ri(DISTS.length); return c; };
  const s0 = score(start);
  let best = { build: start, ...s0 }, n = 1;
  const trace = [{ n, v: s0.v, name: name(start) }];
  while (n < evals) {
    const c = mutate(best.build), sc = score(c); n++;
    if (sc.v >= best.v) { if (sc.v > best.v) trace.push({ n, v: sc.v, name: name(c) }); best = { build: c, ...sc }; }
  }
  return { start: name(start), startV: s0.v, startRes: s0.res, best: name(best.build), bestV: best.v, bestRes: best.res, trace };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("late.mjs")) {
  const EVALS = Number(process.argv[2] || 25), SEEDS = Number(process.argv[3] || 2), OUT = process.argv[4] || null;
  const slots = n => Array(n).fill(0);
  const starts = KINDS.map(k => ({ slots: slots(8).map(() => ({ kind: k, d: EVEN })) }));
  starts.push({ slots: KINDS.concat(KINDS).map(k => ({ kind: k, d: EVEN })) });
  let r = 7; const rnd = () => (r = (r * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 5; i++) starts.push({ slots: slots(8).map(() => ({ kind: KINDS[Math.floor(rnd() * 4)], d: Math.floor(rnd() * DISTS.length) })) });
  const jobs = starts.map((start, i) => ({ start, evals: EVALS, seeds: SEEDS, rng: 100 + i }));
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const fmt = rs => rs.map(x => x.wave + (x.won ? "W" : "") + "/" + x.lives).join(" ");
  console.log(`from wave ${START} with ${MONEY}, every open slot maxed, every core power; ${EVALS} evals x ${SEEDS} seeds per climb\n`);
  for (const c of res) console.log("start " + c.start.padEnd(40) + " -> " + fmt(c.startRes));
  console.log("\nCLIMBS (best per climb, ranked)");
  for (const c of [...res].sort((a, b) => b.bestV - a.bestV)) console.log((c.bestV / 100).toFixed(2).padStart(7), c.best.padEnd(40), fmt(c.bestRes));
}
