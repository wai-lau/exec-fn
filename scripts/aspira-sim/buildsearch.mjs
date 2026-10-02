// Search for the build that BANKS the most money by wave 30 while staying alive
// (owner, 2026-10-02: "the best build path is the one that conserves the most
// money for interest"). A plan is an ordered list of actions - build a kind
// (with its L2 path and L3 form picked up front) or upgrade the i-th tower
// built - plus a threat radius R. The player SAVES by default and takes the
// next action only when it can afford it AND a live enemy is within R of the
// core (the first tower goes down at once: it starts wave 1). Hill-climbs the
// plan by mutation; a plan must survive on every seed, and scores the LOWEST
// bank across seeds at the moment wave TARGET+1 is sent.
//
// usage: node buildsearch.mjs [evals=150] [seeds=2] [target=30] [log.jsonl] [rngSeed]
// With a log path, EVERY plan evaluated is appended as one JSON line (score,
// plan, per-seed result and action timeline) so they can be ranked afterwards.
import fs from "node:fs";
import { makeGame, cellScores } from "./sim.mjs";

const EVALS = Number(process.argv[2] || 150), SEEDS = Number(process.argv[3] || 2), TARGET = Number(process.argv[4] || 30);
const LOG = process.argv[5] || "";
const KINDS = ["chain", "slower", "reaper", "acid"], AB = { chain: "ARC", slower: "FRZ", reaper: "SOL", acid: "ACD" };
const MAX_TOWERS = 6, DT = 0.02;
let rs = Number(process.argv[6] || 12345); // search RNG seed: a second run explores differently
const rnd = () => (rs = (rs * 1103515245 + 12345) % 2147483648) / 2147483648;
const ri = n => Math.floor(rnd() * n);

// drop actions that cannot happen: >6 builds, upgrades of unbuilt towers, past L4
function repair(plan) {
  const out = [], lvl = [];
  for (const a of plan.acts) {
    if (a.b) { if (lvl.length < MAX_TOWERS) { lvl.push(1); out.push(a); } }
    else if (a.u < lvl.length && lvl[a.u] < 4) { lvl[a.u]++; out.push(a); }
  }
  if (!out.length || !out[0].b) out.unshift({ b: KINDS[ri(4)], p: ri(2), f: ri(3) });
  return { R: plan.R, acts: out };
}

function run(plan, seed) {
  const g = makeGame(seed); g.reset();
  const order = {};
  for (const k of KINDS) { const s = cellScores(g, k); order[k] = s.map((v, i) => i).sort((a, b) => s[b] - s[a]); }
  const built = [], log = [];
  let ai = 0, t = 0, tick = 0;
  const act = force => {
    const G = g.G;
    while (ai < plan.acts.length) {
      const a = plan.acts[ai];
      if (a.b) {
        const cost = g.run("towerCost('" + a.b + "')");
        if (G.money < cost) return;
        if (!force && !threat()) return;
        const ci = order[a.b].find(i => !g.run("occupied(" + i + ")"));
        const tw = g.place(a.b, ci); if (!tw) return;
        built.push({ tw, a }); log.push({ w: G.wave, what: "build " + AB[a.b], cost });
      } else {
        const { tw, a: b } = built[a.u], cost = g.upCost(tw);
        if (G.money < cost || !threat()) return;
        const need = g.pendingChoice(tw);
        g.upgrade(tw, need === "path" ? b.p : b.f);
        log.push({ w: G.wave, what: "upgrade #" + (a.u + 1) + " " + AB[b.b] + " -> L" + tw.lvl, cost });
      }
      ai++; force = false;
    }
  };
  const threat = () => g.G.enemies.some(e => !e.dead && Math.hypot(e.x - g.CX, e.y - g.CY) < plan.R);
  act(true);
  while (!g.G.over && g.G.wave <= TARGET && t < 3600) {
    g.step(DT); g.clearFx(); t += DT;
    if (++tick % 10 === 0) act(false);
  }
  const G = g.G, alive = !G.over && G.wave > TARGET;
  return { alive, wave: G.wave, money: Math.round(G.money), lives: G.lives, log };
}

function score(plan) {
  let worst = Infinity, res = [];
  for (let s = 1; s <= SEEDS; s++) {
    const r = run(plan, s); res.push(r);
    // dead plans rank by how far they got, far below any living one
    const v = r.alive ? r.money + r.lives : -1e6 + r.wave * 1000;
    worst = Math.min(worst, v);
    if (!r.alive) break;
  }
  if (LOG) fs.appendFileSync(LOG, JSON.stringify({ v: worst, R: plan.R, acts: plan.acts, res }) + "\n");
  return { v: worst, res };
}

function mutate(plan) {
  const p = { R: plan.R, acts: plan.acts.map(a => ({ ...a })) };
  const n = 1 + ri(2);
  for (let k = 0; k < n; k++) {
    const m = ri(7), i = ri(p.acts.length + 1);
    if (m === 0) p.R = Math.max(60, Math.min(450, p.R + (ri(2) ? 25 : -25)));
    else if (m === 1) p.acts.splice(i, 0, { b: KINDS[ri(4)], p: ri(2), f: ri(3) });
    else if (m === 2) p.acts.splice(i, 0, { u: ri(MAX_TOWERS) });
    else if (m === 3 && p.acts.length > 1) p.acts.splice(ri(p.acts.length), 1);
    else if (m === 4 && p.acts.length > 1) { const j = ri(p.acts.length - 1); [p.acts[j], p.acts[j + 1]] = [p.acts[j + 1], p.acts[j]]; }
    else if (m === 5) { const b = p.acts.filter(a => a.b); if (b.length) { const a = b[ri(b.length)]; a.b = KINDS[ri(4)]; } }
    else { const b = p.acts.filter(a => a.b); if (b.length) { const a = b[ri(b.length)]; if (ri(2)) a.p = ri(2); else a.f = ri(3); } }
  }
  return repair(p);
}

// starting points: each kind opens, a second kind joins, a few upgrades
const starts = [];
for (const k1 of KINDS) for (const k2 of KINDS) {
  starts.push(repair({ R: 200, acts: [{ b: k1, p: 0, f: 0 }, { b: k2, p: 1, f: 1 }, { u: 0 }, { u: 1 }, { u: 0 }, { u: 1 }, { b: KINDS[ri(4)], p: 0, f: 2 }, { u: 2 }, { u: 0 }, { u: 1 }] }));
}
let best = null, bestS = null, evals = 0;
for (const s of starts.sort(() => rnd() - 0.5).slice(0, 8)) {
  const sc = score(s); evals++;
  if (!best || sc.v > bestS.v) { best = s; bestS = sc; }
}
console.log("start best", bestS.v);
while (evals < EVALS) {
  const c = mutate(best), sc = score(c); evals++;
  if (sc.v >= bestS.v) { best = c; if (sc.v > bestS.v) console.log("eval", evals, "score", sc.v); bestS = sc; }
}
const name = a => a.b ? "build " + AB[a.b] + " (path " + a.p + ", form " + a.f + ")" : "upgrade #" + (a.u + 1);
console.log("\nBEST  R =", best.R, " plan:", best.acts.map(name).join(", "));
for (const r of bestS.res) {
  console.log("\nseed: alive", r.alive, "money at W" + (TARGET + 1), r.money, "lives", r.lives);
  for (const l of r.log) console.log("  W" + String(l.w).padStart(2), l.what.padEnd(26), "cost", l.cost);
}
