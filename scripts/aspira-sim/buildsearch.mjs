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
//
// SPEED (owner, 2026-10-02), none of which changes a result:
//  - worker threads (WORKERS, default 1) each evaluate a mutation at once;
//  - a run SNAPSHOTS the game each time it finishes an action, and a later
//    plan with the same R and the same first k actions RESUMES from the k-th
//    snapshot instead of replaying the shared opening (the game, the seeded
//    RNG, the clock and the timeline are all restored);
//  - a plan whose first seed already scores below the best skips the rest
//    (its score is the worst seed, so it cannot win).
import fs from "node:fs";
import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { makeGame, cellScores } from "./sim.mjs";

const KINDS = ["chain", "slower", "reaper", "acid"], AB = { chain: "ARC", slower: "FRZ", reaper: "SOL", acid: "ACD" };
const MAX_TOWERS = 6, DT = 0.02, SNAP_PLANS = 12;

// ---------------- worker: evaluates plans ----------------
function workerMain({ SEEDS, TARGET }) {
  const games = {}, orders = {};
  const gameFor = seed => {
    if (!games[seed]) {
      const g = makeGame(seed);
      g.reset();
      orders[seed] = {};
      for (const k of KINDS) { const s = cellScores(g, k); orders[seed][k] = s.map((v, i) => i).sort((a, b) => s[b] - s[a]); }
      games[seed] = g;
    }
    return games[seed];
  };
  // snapshots of recent plans: key "seed|R|json(first k acts)" -> state after action k
  const snaps = new Map(), planSnaps = [];
  const prefixKey = (seed, plan, k) => seed + "|" + plan.R + "|" + JSON.stringify(plan.acts.slice(0, k));

  function run(plan, seed) {
    const g = gameFor(seed), order = orders[seed];
    let ai = 0, t = 0, tick = 0, log = [];
    // resume from the longest cached prefix of this plan
    let from = null;
    for (let k = plan.acts.length; k >= 1 && !from; k--) from = snaps.get(prefixKey(seed, plan, k)) || null;
    if (process.env.SNAP_STATS) process.stdout.write(from ? "r" + Math.round(from.t) + " " : "f ");
    if (from) {
      g.setG(structuredClone(from.G)); g.rng.set(from.rng); g.clearFx();
      ai = from.ai; t = from.t; tick = from.tick; log = from.log.slice();
    } else { g.reset(); g.rng.set(seed >>> 0 || 1); }
    const mine = [];
    const save = () => {
      const key = prefixKey(seed, plan, ai);
      if (!snaps.has(key)) { snaps.set(key, { G: structuredClone(g.G), rng: g.rng.get(), ai, t, tick, log: log.slice() }); mine.push(key); }
    };
    const threat = () => g.G.enemies.some(e => !e.dead && Math.hypot(e.x - g.CX, e.y - g.CY) < plan.R);
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
          log.push({ w: G.wave, what: "build " + AB[a.b], cost });
        } else {
          // the i-th tower BUILT is G.towers[i] (towers are never sold here)
          const builds = plan.acts.filter(x => x.b), tw = G.towers[a.u], b = builds[a.u], cost = g.upCost(tw);
          if (G.money < cost || !threat()) return;
          const need = g.pendingChoice(tw);
          g.upgrade(tw, need === "path" ? b.p : b.f);
          log.push({ w: G.wave, what: "upgrade #" + (a.u + 1) + " " + AB[b.b] + " -> L" + tw.lvl, cost });
        }
        ai++; force = false;
        save();
      }
    };
    act(!from);
    while (!g.G.over && g.G.wave <= TARGET && t < 3600) {
      g.step(DT); g.clearFx(); t += DT;
      if (++tick % 10 === 0) act(false);
    }
    // keep snapshots for the last SNAP_PLANS plans only (memory)
    planSnaps.push(mine);
    while (planSnaps.length > SNAP_PLANS) for (const k of planSnaps.shift()) snaps.delete(k);
    const G = g.G, alive = !G.over && G.wave > TARGET;
    return { alive, wave: G.wave, money: Math.round(G.money), lives: G.lives, log };
  }

  parentPort.on("message", ({ id, plan, threshold }) => {
    let worst = Infinity;
    const res = [];
    for (let s = 1; s <= SEEDS; s++) {
      const r = run(plan, s); res.push(r);
      // SNAP_CHECK=1: re-run from scratch and insist the resumed result matches
      if (process.env.SNAP_CHECK) {
        const keep = new Map(snaps); snaps.clear();
        const f = run(plan, s);
        for (const [k, v] of keep) snaps.set(k, v);
        if (JSON.stringify(f) !== JSON.stringify(r)) console.log("SNAP MISMATCH seed", s, JSON.stringify(r).slice(0, 200), "VS", JSON.stringify(f).slice(0, 200));
        else process.stdout.write(".");
      }
      // dead plans rank by how far they got, far below any living one
      const v = r.alive ? r.money + r.lives : -1e6 + r.wave * 1000;
      worst = Math.min(worst, v);
      if (!r.alive || worst < threshold) break; // cannot beat the best any more
    }
    parentPort.postMessage({ id, v: worst, res });
  });
}

// ---------------- main: the hill-climb ----------------
function mainSearch() {
  const EVALS = Number(process.argv[2] || 150), SEEDS = Number(process.argv[3] || 2), TARGET = Number(process.argv[4] || 30);
  const LOG = process.argv[5] || "";
  let rs = Number(process.argv[6] || 12345); // search RNG seed: a second run explores differently
  const rnd = () => (rs = (rs * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ri = n => Math.floor(rnd() * n);
  // ONE worker by default (owner, 2026-10-02: two ran the droplet out of
  // memory alongside the site); WORKERS=2 to opt back in
  const NW = Math.max(1, Math.min(Number(process.env.WORKERS || 1), os.cpus().length));

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

  const workers = [...Array(NW)].map(() => new Worker(new URL(import.meta.url), { workerData: { SEEDS, TARGET } }));
  let nextId = 0;
  const pending = new Map();
  for (const w of workers) w.on("message", m => { pending.get(m.id)(m); pending.delete(m.id); });
  const evalOn = (w, plan, threshold) => new Promise(res => {
    const id = nextId++;
    pending.set(id, m => {
      if (LOG) fs.appendFileSync(LOG, JSON.stringify({ v: m.v, R: plan.R, acts: plan.acts, res: m.res }) + "\n");
      res({ plan, v: m.v, res: m.res });
    });
    w.postMessage({ id, plan, threshold });
  });

  (async () => {
    // starting points: each kind opens, a second kind joins, a few upgrades
    const starts = [];
    for (const k1 of KINDS) for (const k2 of KINDS) {
      starts.push(repair({ R: 200, acts: [{ b: k1, p: 0, f: 0 }, { b: k2, p: 1, f: 1 }, { u: 0 }, { u: 1 }, { u: 0 }, { u: 1 }, { b: KINDS[ri(4)], p: 0, f: 2 }, { u: 2 }, { u: 0 }, { u: 1 }] }));
    }
    const picked = starts.sort(() => rnd() - 0.5).slice(0, 8);
    let best = null, evals = 0;
    // CHECKPOINT (owner): a log from an earlier, interrupted run is picked up -
    // its best plan becomes the start and its evaluations count toward EVALS
    if (LOG && fs.existsSync(LOG)) {
      for (const line of fs.readFileSync(LOG, "utf8").split("\n")) {
        if (!line) continue;
        const r = JSON.parse(line); evals++;
        if (r.res.length === SEEDS && (!best || r.v > best.v)) best = { plan: { R: r.R, acts: r.acts }, v: r.v, res: r.res };
      }
      if (best) console.log("resumed", evals, "evals, best", best.v);
    }
    const resumed = !!best;
    for (let i = 0; !resumed && i < picked.length; i += NW) {
      const out = await Promise.all(picked.slice(i, i + NW).map((p, j) => evalOn(workers[j], p, -Infinity)));
      for (const o of out) { evals++; if (!best || o.v > best.v) best = o; }
    }
    console.log("start best", best.v);
    while (evals < EVALS) {
      const cands = workers.map(() => mutate(best.plan));
      const out = await Promise.all(cands.map((c, j) => evalOn(workers[j], c, best.v)));
      evals += out.length;
      for (const o of out.sort((a, b) => b.v - a.v)) {
        if (o.v >= best.v) { if (o.v > best.v) console.log("eval", evals, "score", o.v); best = o; break; }
      }
    }
    const name = a => a.b ? "build " + AB[a.b] + " (path " + a.p + ", form " + a.f + ")" : "upgrade #" + (a.u + 1);
    console.log("\nBEST  R =", best.plan.R, " plan:", best.plan.acts.map(name).join(", "));
    for (const r of best.res) {
      console.log("\nseed: alive", r.alive, "money at W" + (TARGET + 1), r.money, "lives", r.lives);
      for (const l of r.log) console.log("  W" + String(l.w).padStart(2), l.what.padEnd(26), "cost", l.cost);
    }
    for (const w of workers) w.terminate();
  })();
}

if (isMainThread) mainSearch(); else workerMain(workerData);
