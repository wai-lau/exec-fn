// Headless /aspira simulator: loads the real game code into a VM with the
// browser bits stubbed, then plays it with a scripted strategy.
// usage: node sim.mjs '<strategy json>' [seed] [maxWave]
import fs from "node:fs";
import vm from "node:vm";

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web") + "/";
const FILES = ["aspira-defs.js", "aspira-upgrades.js", "aspira-game.js", "aspira-waves.js", "aspira-towers.js", "aspira-core.js"];

export function makeGame(seed, patch = "") {
  let a = seed >>> 0 || 1;
  const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const M = Object.create(Math); M.random = rand;
  const ctx = {
    Math: M, console, JSON, Map, Set, Array, Object, Number, String, Infinity, NaN, isFinite, parseInt,
    performance: { now: () => 0 }, Path2D: class { moveTo() {} lineTo() {} },
    document: { querySelectorAll: () => [], querySelector: () => null },
    window: {}, localStorage: { getItem: () => null, setItem: () => {} },
    ui: { speed: 1, paused: false, sel: null, build: null },
    sfx: () => null, shakeScreen: () => {}, showOverlay: () => {}, cam: { k: 1, ox: 0, oy: 0 }, cv: { width: 1000, height: 1000 },
  };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(WEB + f, "utf8"), ctx, { filename: f });
  if (patch) vm.runInContext(patch, ctx, { filename: "patch" }); // balance experiments
  // tower stats depend only on kind / level / path / form (no aura mods remain),
  // so cache them - towerStats runs for every tower on every step
  vm.runInContext(`
    const __ts = towerStats, __cache = new Map();
    towerStats = function (t, noAura) {
      const k = t.kind + "|" + t.lvl + "|" + t.path + "|" + t.form + "|" + (G.core ? [G.core.l1, G.core.l2, G.core.l3, JSON.stringify(G.core.reps || {})].join() : ""); // core upgrades change stats
      let s = __cache.get(k);
      if (!s) { s = __ts(t, true); __cache.set(k, s); }
      return s;
    };`, ctx);
  // strip visual effects: nothing draws, so floats / rings / bursts are
  // no-ops and the fx list is emptied every tick. A beam still leaves a tiny
  // object, because ARC's tree keeps references to its beams (keepLit).
  vm.runInContext(`
    float = function () {}; ring = function () {}; burst = function () {}; banner = function () {};
    beam = function () { fx.push({ t: 0, life: 0 }); };
    // GHOSTS (dead enemies drifting on to the core) cost ~half the run. Drop
    // one once NOTHING TRACKS it (owner): a pending ARC arc launches from its
    // parent node's enemy, ghost or not, so those stay. Nothing can pick up a
    // ghost later (arcs only hop to the living), so results are unchanged.
    // no nose-first turning (drawing only), and each lane copy's rotation trig
    // computed once instead of every enemy every tick - both exact
    FACING = false;
    var __trig = new Map();
    rotAbout = function (p, ang) {
      let t = __trig.get(ang);
      if (!t) { t = [Math.cos(ang), Math.sin(ang)]; __trig.set(ang, t); }
      const dx = p.x - CX, dy = p.y - CY;
      return { x: CX + dx * t[0] - dy * t[1], y: CY + dx * t[1] + dy * t[0] };
    };
    var __se = stepEnemies; stepEnemies = function (dt) {
      const tracked = new Set((G.chains || []).map(p => p.node.e));
      G.enemies = G.enemies.filter(e => !e.dead || tracked.has(e));
      __se(dt);
    };`, ctx);
  vm.runInContext(`
    var api = {
      reset() { G = newGame(); fx = []; },
      clearFx() { fx.length = 0; },
      run(code) { return eval(code); },
      get G() { return G; },
      setG(x) { G = x; }, // restore a snapshot (buildsearch)
      CELLS, TOWERS, UPGRADES, PATHS, CX, CY, RIM_R, MAX_LVL,
      towerStats, upCost, pendingChoice, sendWave, step, stepFx, snapCell,
      place(kind, ci, mode = DEFAULT_MODE[kind]) {
        const c = CELLS[ci];
        const cost = towerCost(kind);
        if (G.money < cost || occupied(ci)) return null;
        G.money -= cost;
        const t = { id: G.id++, kind, cell: ci, x: c.x, y: c.y, lvl: 1, cd: 0,
          mode, spent: cost };
        G.towers.push(t);
        if (!G.started) sendWave();
        return t;
      },
      upgrade(t, choice) {
        if (t.lvl >= MAX_LVL) return false;
        const c = upCost(t); if (G.money < c) return false;
        const need = pendingChoice(t);
        if (need === "path") t.path = choice; else if (need === "form") t.form = choice;
        G.money -= c; t.spent += c; t.lvl++;
        return true;
      },
    };`, ctx);
  // the seeded RNG's state, so a snapshot can be resumed exactly
  ctx.api.rng = { get: () => a, set: v => { a = v; } };
  return ctx.api;
}

// cell scores for one tower kind: how much lane (all 12 lanes, at all
// rotations, inside the rim) lies within its range - weighted toward the core
export function cellScores(g, kind) {
  const st = g.towerStats({ kind, lvl: 1, x: 0, y: 0 }, true), r2 = st.range * st.range;
  const file = path.join(os.tmpdir(), "aspira-sim-cells-" + Math.round(st.range) + "-" + g.CELLS.length + ".json"); // cache
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { /* compute */ }
  const pts = [];
  for (const p of g.PATHS) p.pts.forEach((q, i) => {
    if (i % 8) return; // every 8th point is plenty for a score
    if (Math.hypot(q.x - g.CX, q.y - g.CY) > g.RIM_R) return;
    for (let k = 0; k < 6; k++) { // rotations fill in the copies a split wave rides
      const a = k * Math.PI / 3, c = Math.cos(a), s = Math.sin(a), dx = q.x - g.CX, dy = q.y - g.CY;
      pts.push({ x: g.CX + dx * c - dy * s, y: g.CY + dx * s + dy * c });
    }
  });
  const out = g.CELLS.map(cell => {
    let n = 0;
    for (const p of pts) if ((p.x - cell.x) ** 2 + (p.y - cell.y) ** 2 <= r2) n++;
    return n;
  });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

// strategy: { mix: {kind: weight}, paths: {kind: [path, form]}, up: 0..1 (how
// eager to upgrade vs build), maxTowers, threat }
// threat (owner, 2026-10-02: "measure the nearest an enemy got; upgrade or
// build when units get a bit too close"): the player SAVES (earning interest)
// and only spends once a live enemy comes within \`threat\` of the core.
export function play(strategy, seed = 1, maxWave = 60, dt = 0.02, patch = "") {
  const g = makeGame(seed, patch);
  g.reset();
  let r = (seed * 9301 + 49297) % 233280;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const scores = {};
  const order = {};
  for (const k of Object.keys(g.TOWERS)) { scores[k] = cellScores(g, k); order[k] = scores[k].map((v, i) => i).sort((a, b) => scores[k][b] - scores[k][a]); }
  const kinds = Object.keys(strategy.mix).filter(k => strategy.mix[k] > 0);
  const total = kinds.reduce((s, k) => s + strategy.mix[k], 0);
  const pick = () => { let x = rnd() * total; for (const k of kinds) { x -= strategy.mix[k]; if (x <= 0) return k; } return kinds[0]; };
  // the player commits to its NEXT action (build a kind, or upgrade the
  // cheapest upgradable tower) and saves for it, instead of re-rolling
  const used = {};
  let next = null;
  const choose = () => {
    const G = g.G;
    const ups = G.towers.filter(t => t.lvl < g.MAX_LVL).sort((a, b) => g.upCost(a) - g.upCost(b));
    const full = G.towers.length >= (strategy.maxTowers || 99);
    const opening = strategy.opening || [];
    if (G.towers.length < opening.length) next = { kind: opening[G.towers.length] };
    else if (ups.length && (full || rnd() < (strategy.up ?? 0.5))) next = { up: ups[0] };
    else if (!full) next = { kind: pick() };
    else next = null;
  };
  const act = () => {
    const G = g.G;
    for (let guard = 0; guard < 20; guard++) {
      if (!next || (next.up && (next.up.lvl >= g.MAX_LVL || !G.towers.includes(next.up)))) choose();
      if (!next) return;
      if (next.up) {
        const t = next.up, [p, f] = (strategy.paths || {})[t.kind] || [0, 0];
        if (G.money - g.upCost(t) < (strategy.reserve || 0) * G.wave) return;
        const need = g.pendingChoice(t);
        g.upgrade(t, need === "path" ? p : f);
        used[t.kind] = 1; next = null; continue;
      }
      if (G.money - g.run("towerCost('" + next.kind + "')") < (G.towers.length < 2 ? 0 : (strategy.reserve || 0) * G.wave)) return;
      const best = order[next.kind].find(i => !g.run("occupied(" + i + ")"));
      if (best == null) { next = null; return; }
      g.place(next.kind, best, (strategy.modes || {})[next.kind]); next = null;
    }
  };
  let time = 0, nearest = Infinity;
  const leaks = {}, leakWave = {};
  act();
  while (!g.G.over && g.G.wave < maxWave && time < 60 * 60 * 2) {
    const alive = g.G.enemies.filter(e => !e.dead);
    g.step(dt); g.clearFx(); time += dt;
    for (const e of alive) if (e.dead && e.gone && e.hp > 0) { leaks[e.type] = (leaks[e.type] || 0) + 1; leakWave[g.G.wave] = (leakWave[g.G.wave] || 0) + 1; }
    if (Math.round(time / dt) % 10 === 0) {
      if (!strategy.threat || g.G.towers.length < (strategy.opening || []).length) act();
      else {
        let near = Infinity;
        for (const e of g.G.enemies) if (!e.dead) near = Math.min(near, Math.hypot(e.x - g.CX, e.y - g.CY));
        nearest = Math.min(nearest, near);
        if (near < strategy.threat) act();
      }
    }
  }
  const G = g.G;
  const towers = {};
  for (const t of G.towers) {
    const key = t.kind + (t.path != null ? "/" + g.UPGRADES[t.kind][t.path].name : "") + (t.form != null ? "/" + g.UPGRADES[t.kind][t.path].finals[t.form].name : "");
    towers[key] = towers[key] || { n: 0, dealt: 0, kills: 0 };
    towers[key].n++; towers[key].dealt += t.dealt || 0; towers[key].kills += t.kills || 0;
  }
  return { nearest: Math.round(nearest), wave: G.wave, over: G.over, lives: G.lives, money: Math.round(G.money), time: Math.round(time), towers, leaks, leakWave };
}

if (process.argv[1] && process.argv[1].endsWith("sim.mjs") && process.argv[2]) {
  const s = JSON.parse(process.argv[2]);
  const t0 = Date.now();
  const res = play(s, Number(process.argv[3] || 1), Number(process.argv[4] || 60));
  res.ms = Date.now() - t0;
  console.log(JSON.stringify(res));
}
