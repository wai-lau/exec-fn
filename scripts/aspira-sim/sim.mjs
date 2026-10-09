// Headless /aspira simulator: loads the real game code into a VM with the
// browser bits stubbed, then plays it with a scripted strategy.
// usage: node sim.mjs '<strategy json>' [seed] [maxWave]
import fs from "node:fs";
import vm from "node:vm";

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickNext, usePowers } from "./corepower.mjs";
// ASPIRA_WEB=<dir> pins a run to a SNAPSHOT of the game files: every game
// re-reads them, so a balance commit landing mid-run would otherwise mix two
// versions (2026-10-07)
const WEB = (process.env.ASPIRA_WEB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web")) + "/";
const FILES = ["aspira-defs.js", "aspira-upgrades.js", "aspira-game.js", "aspira-floats.js", "aspira-waves.js", "aspira-bosses.js", "aspira-towers.js", "aspira-acid.js", "aspira-skills.js", "aspira-frz.js", "aspira-desc.js", "aspira-positioning.js", "aspira-core.js"];

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
    sfx: () => null, sfxSeq: () => null, bossVoice: () => "", shakeScreen: () => {}, showOverlay: () => {}, cam: { k: 1, ox: 0, oy: 0 }, cv: { width: 1000, height: 1000 },
  };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(WEB + f, "utf8"), ctx, { filename: f });
  if (patch) vm.runInContext(patch, ctx, { filename: "patch" }); // balance experiments
  // tower stats depend only on kind / level / path / form (no aura mods remain),
  // so cache them - towerStats runs for every tower on every step
  vm.runInContext(`
    const __ts = towerStats, __cache = new Map();
    // the key covers EVERYTHING stats read: chart picks (t.skills - two towers
    // of one kind and level can differ), Overcharge, and the core's powers.
    // The skills / powers strings are rebuilt only when the OBJECT changes
    // (withSkill and pickPower replace them), not stringified per call - the
    // stringify was 13% of a game (profiled 2026-10-07).
    let __pwObj = null, __pwStr = "";
    towerStats = function (t, noAura) {
      if (t.__skObj !== (t.skills || null)) { t.__skObj = t.skills || null; t.__skStr = JSON.stringify(t.skills || {}); }
      const pw = G.core ? G.core.pw : null;
      if (pw !== __pwObj) { __pwObj = pw; __pwStr = JSON.stringify(pw || {}); }
      const k = t.kind + "|" + t.lvl + "|" + t.path + "|" + t.form + "|" + t.__skStr + "|" + (t.relayUntil > (G.clock || 0) ? "R" : "") + "|" + __pwStr;
      let s = __cache.get(k);
      if (!s) { s = __ts(t, true); __cache.set(k, s); }
      return s;
    };
    // (pickPower gives G.core.pw a fresh object itself, so the cache notices)`, ctx);
  // strip visual effects: nothing draws, so floats / rings / bursts are
  // no-ops and the fx list is emptied every tick. A beam still leaves a tiny
  // object, because ARC's tree keeps references to its beams (keepLit).
  vm.runInContext(`
    float = function () { fx.push({ t: 0, life: 0 }); }; ring = function () {}; // float leaves an entry: kill() marks the last fx (.shrink) burst = function () {}; banner = function () {};
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
    // the economy's own ledger (players.mjs): what interest paid in all
    var __sw = sendWave; sendWave = function () { const m = G.money; __sw(); G.interestTotal = (G.interestTotal || 0) + Math.max(0, G.money - m); };
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
      CELLS, TOWERS, UPGRADES, PATHS, CX, CY, RIM_R, MAX_LVL, maxLvl,
      towerStats, upCost, pendingChoice, sendWave, step, stepFx, snapCell, cellOpen,
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
        if (t.lvl >= maxLvl(t)) return false;
        const c = upCost(t); if (G.money < c) return false;
        const need = pendingChoice(t);
        // a chart tower: the named axis, else (a path / form index from an old
        // strategy) the lowest open axis, so builds spread evenly
        if (need === "skill") {
          const ids = SKILL_TREES[t.kind].map(a => a.id).filter(id => skillOf(t, id) < SKILL_TIERS);
          t.skills = withSkill(t, ids.includes(choice) ? choice : ids.sort((a, b) => skillOf(t, a) - skillOf(t, b))[0]);
        }
        if (need === "path") t.path = choice;
        else if (need === "form") { t.form = choice; t.mode = UPGRADES[t.kind][t.path].finals[choice].mode || t.mode; }
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
// eager to upgrade vs build), maxTowers, threat, core: [power ids in pick
// order] (each boss pick is taken at once - the core is free), useCore: true (corepower.mjs fires them),
//   skills: {kind: [axis ids]}    a chart tower's SPEND ORDER: the first axis in it not yet full takes the
//                                 point (absent, or all full = the lowest open axis, so builds spread evenly)
//   upPrio: [kinds]               which kind's towers to upgrade FIRST (then the cheapest); absent = cheapest
//   relayKind: kind               fire the Orbital Relay on the hottest tower of THIS kind (corepower.mjs)
//   econ: "smart"                 the interest-aware saver (players.mjs, 2026-10-07): hold what earns the
//                                 capped interest (INTEREST_PER_WAVE x (wave+1) / rate) and spend only the
//                                 surplus - unless THREATENED (an enemy within `threat` of the core, a life
//                                 lost since the last look, a boss wave now / next, or 6 lives left), when it
//                                 spends it all; threat 0 = never by proximity, noBossPrep = never for a boss
//   queue: [kinds]                builds taken next, before anything else (a pivot's "build a SOL now")
//   pivots: [{ name, when(obs, s), do(s, obs, game) }]  the player's INTUITION (players.mjs): at every
//                                 wave's send it looks at the board (observe(): wave, lives, lost5, lostBy
//                                 (leaks by type over the last 5 waves), near (closest approach last wave),
//                                 nearBoss (closest the last boss came), share (damage by kind, last 5 waves),
//                                 towers, money) and each rule whose `when` holds fires ONCE, editing the live
//                                 strategy; game.setMode(kind, mode) retargets the towers it already has
//   mind(s, obs, game)            called at EVERY wave's send after the pivots (mbti.mjs's cognitive stacks):
//                                 obs also carries dealtAll / spentBy / leaksAll, the whole game so far }
// threat (owner, 2026-10-02: "measure the nearest an enemy got; upgrade or
// build when units get a bit too close"): the player SAVES (earning interest)
// and only spends once a live enemy comes within `threat` of the core.
//
// makePlayer (2026-10-07, players.mjs's search): the same player as a RESUMABLE
// object - runTo(wave) plays until that wave is sent (or the game ends),
// snapshot() / restore() branch the game (G, the seeded RNG, the player's own
// state and the strategy's live knobs), result() is play()'s return value.
export function makePlayer(strategy, seed = 1, maxWave = 60, dt = 0.02, patch = "") {
  const g = makeGame(seed, patch);
  g.reset();
  const scores = {}, order = {};
  for (const k of Object.keys(g.TOWERS)) { scores[k] = cellScores(g, k); order[k] = scores[k].map((v, i) => i).sort((a, b) => scores[k][b] - scores[k][a]); }
  const interestPerWave = g.run("INTEREST_PER_WAVE");
  // every mutable bit of the player, so a snapshot is one clone
  const S = { r: (seed * 9301 + 49297) % 233280, used: {}, time: 0, nearest: Infinity, lastLives: g.G.lives, hurtUntil: -1,
    leaks: {}, leakWave: {}, coreMem: {}, trace: [], pivoted: [], hist: [], lastWave: -1, waveNear: Infinity, bossNear: Infinity, fired: [],
    econ: [], builtAt: null, fullAt: null }; // the economy's ledger: a line every 10 waves, the wave every slot was filled / every tower maxed
  let next = null; // the committed next action (holds a tower: snapshotted by id)
  const rnd = () => (S.r = (S.r * 9301 + 49297) % 233280) / 233280;
  const pick = () => { // the mix is read live: a pivot may change it mid-game
    const kinds = Object.keys(strategy.mix).filter(k => strategy.mix[k] > 0), total = kinds.reduce((s, k) => s + strategy.mix[k], 0);
    let x = rnd() * total; for (const k of kinds) { x -= strategy.mix[k]; if (x <= 0) return k; } return kinds[0];
  };
  // the player commits to its NEXT action (build a kind, or upgrade the
  // cheapest upgradable tower of the kind it favours) and saves for it, instead of re-rolling
  const choose = () => {
    const G = g.G;
    const prio = strategy.upPrio || [], pr = t => { const i = prio.indexOf(t.kind); return i < 0 ? 99 : i; };
    const ups = G.towers.filter(t => t.lvl < g.maxLvl(t)).sort((a, b) => pr(a) - pr(b) || g.upCost(a) - g.upCost(b));
    const full = G.towers.length >= (strategy.maxTowers || 99);
    const opening = strategy.opening || [];
    if (G.towers.length < opening.length) next = { kind: opening[G.towers.length] };
    else if (!full && strategy.queue && strategy.queue.length) next = { kind: strategy.queue.shift() };
    else if (ups.length && (full || rnd() < (strategy.up ?? 0.5))) next = { up: ups[0] };
    else if (!full) next = { kind: pick() };
    else next = null;
  };
  // floor: what the player keeps in the bank (the reserve, or the smart saver's interest bank)
  const act = (floor = (strategy.reserve || 0) * g.G.wave) => {
    const G = g.G;
    for (let guard = 0; guard < 20; guard++) {
      if (!next || (next.up && (next.up.lvl >= g.maxLvl(next.up) || !G.towers.includes(next.up)))) choose();
      if (!next) return;
      if (next.up) {
        const t = next.up, [p, f] = (strategy.paths || {})[t.kind] || [0, 0];
        if (G.money - g.upCost(t) < floor) return;
        const need = g.pendingChoice(t);
        const axis = need === "skill" ? ((strategy.skills || {})[t.kind] || []).find(id => ((t.skills || {})[id] || 0) < g.run("SKILL_TIERS")) : null;
        g.upgrade(t, axis || (need === "path" ? p : f));
        S.used[t.kind] = 1; next = null; continue;
      }
      if (G.money - g.run("towerCost('" + next.kind + "')") < (G.towers.length < 2 ? 0 : floor)) return;
      const best = order[next.kind].find(i => g.cellOpen(i) && !g.run("occupied(" + i + ")"));
      if (best == null) { next = null; return; }
      g.place(next.kind, best, (strategy.modes || {})[next.kind]); next = null;
    }
  };
  const game = { setMode(kind, mode) { for (const t of g.G.towers) if (t.kind === kind) t.mode = mode; strategy.modes = { ...strategy.modes, [kind]: mode }; } };
  // the board as the player sees it at a wave's send (the pivots' `obs`)
  const observe = (record = true) => {
    const G = g.G, dealt = {}, towers = {}, spentBy = {};
    for (const t of G.towers) { dealt[t.kind] = (dealt[t.kind] || 0) + (t.dealt || 0); towers[t.kind] = (towers[t.kind] || 0) + 1; spentBy[t.kind] = (spentBy[t.kind] || 0) + (t.spent || 0); }
    const now = { wave: G.wave, lives: G.lives, leaks: { ...S.leaks }, dealt, near: S.waveNear };
    const then = S.hist[Math.max(0, S.hist.length - 5)] || { lives: 18, leaks: {}, dealt: {} };
    if (record) S.hist.push(now);
    const lostBy = {}; for (const k of Object.keys(S.leaks)) lostBy[k] = (S.leaks[k] || 0) - (then.leaks[k] || 0);
    const d5 = {}; let tot = 0; for (const k of Object.keys(dealt)) { d5[k] = dealt[k] - (then.dealt[k] || 0); tot += d5[k]; }
    const share = {}; for (const k of Object.keys(d5)) share[k] = tot ? d5[k] / tot : 0;
    return { wave: G.wave, lives: G.lives, lost5: then.lives - G.lives, lostBy, near: S.waveNear, nearBoss: S.bossNear, share, towers, money: G.money, slots: g.run("openCells()"),
      dealtAll: dealt, spentBy, leaksAll: { ...S.leaks } }; // (dealtAll / spentBy / leaksAll: the whole game so far, for a mind)
  };
  const onWave = () => { // a wave's send: the trace, the ledger, the player's look at the board, its pivots
    const G = g.G, spent = Math.round(G.towers.reduce((a, t) => a + (t.spent || 0), 0)), maxed = G.towers.filter(t => t.lvl >= g.maxLvl(t)).length;
    if (strategy.trace) S.trace.push({ wave: G.wave, money: Math.round(G.money), spent, towers: G.towers.length, lives: G.lives, interest: G.interest, time: Math.round(S.time) });
    if (S.builtAt == null && G.towers.length >= Math.min(strategy.maxTowers || 99, g.run("CELLS.length"))) S.builtAt = G.wave;
    if (S.fullAt == null && S.builtAt != null && maxed === G.towers.length) S.fullAt = G.wave;
    if (G.wave % 10 === 1) S.econ.push({ wave: G.wave, money: Math.round(G.money), spent, interest: Math.round(G.interestTotal || 0), rate: G.interest, towers: G.towers.length, maxed, lives: G.lives });
    if (S.lastWave > 0) {
      const obs = observe();
      for (const pv of strategy.pivots || []) {
        if (S.fired.includes(pv.name) || !pv.when(obs, strategy)) continue;
        S.fired.push(pv.name); pv.do(strategy, obs, game); S.pivoted.push({ wave: obs.wave, name: pv.name });
      }
      if (strategy.mind) strategy.mind(strategy, obs, game); // a MIND (mbti.mjs): reasons over the board EVERY wave, editing the live knobs
      if (S.lastWave % 10 === 0) S.bossNear = S.waveNear;
    }
    S.lastWave = g.G.wave; S.waveNear = Infinity;
  };
  const tick = () => {
    if (g.G.wave !== S.lastWave) onWave();
    const alive = g.G.enemies.filter(e => !e.dead);
    g.step(dt); g.clearFx(); S.time += dt;
    for (const e of alive) if (e.dead && e.gone && e.hp > 0) { S.leaks[e.type] = (S.leaks[e.type] || 0) + 1; S.leakWave[g.G.wave] = (S.leakWave[g.G.wave] || 0) + 1; }
    const n = Math.round(S.time / dt);
    if (strategy.core && n % 25 === 0) pickNext(g, strategy.core); // a boss's pick costs nothing: take it at once
    if (strategy.useCore && n % 25 === 0) usePowers(g, S.coreMem, strategy.relayKind);
    if (n % 10) return;
    let near = Infinity;
    for (const e of g.G.enemies) if (!e.dead) near = Math.min(near, Math.hypot(e.x - g.CX, e.y - g.CY));
    S.nearest = Math.min(S.nearest, near); S.waveNear = Math.min(S.waveNear, near);
    const opened = g.G.towers.length >= (strategy.opening || []).length;
    if (strategy.econ === "smart" && opened) {
      // the interest-aware saver: the bank that earns the capped payout, the rest is surplus;
      // a threat (an enemy close, a life just lost, a boss now or next, few lives) opens the whole bank
      const G = g.G, bank = Math.floor(interestPerWave * (G.wave + 1) / G.interest);
      const boss = !strategy.noBossPrep && (G.wave % 10 === 0 || (G.wave + 1) % 10 === 0);
      const hurt = G.lives < S.lastLives; S.lastLives = G.lives;
      if (hurt) S.hurtUntil = S.time + 20; // stay open for a while after a leak
      const open = near < (strategy.threat ?? 220) || boss || S.time < S.hurtUntil || G.lives <= 6; // threat 0: never by proximity
      act(open ? 0 : bank);
    }
    else if (!strategy.threat || !opened) act();
    else if (near < strategy.threat) act();
  };
  // the strategy's live knobs (a pivot edits them), kept with a snapshot
  const KNOBS = ["mix", "skills", "modes", "upPrio", "relayKind", "threat", "queue", "core", "up", "maxTowers"];
  const live = () => { const o = {}; for (const k of KNOBS) if (k in strategy) o[k] = strategy[k]; return structuredClone(o); };
  act();
  return {
    g, strategy, S, game, look: () => observe(false),
    // through wave `w`: play until that wave is sent (at 100 the 10th boss is fought and the game can be WON)
    runTo(w) { while (!g.G.over && g.G.wave < w && g.G.wave <= maxWave && S.time < 60 * 60 * 2) tick(); return !g.G.over; },
    done: () => g.G.over || g.G.wave > maxWave || S.time >= 60 * 60 * 2,
    // `next` rides along by tower id: re-choosing it would roll the player's RNG and fork the build order
    // the game's own state outside G: the positioning cache (posPred holds enemy refs - stale after a
    // restore, and it fed the branch's enemies into the replay) and the debuff key counter
    snapshot() { return { G: structuredClone(g.G), rng: g.rng.get(), S: structuredClone(S), knobs: live(), next: next && (next.up ? { upId: next.up.id } : { kind: next.kind }), seq: g.run("debuffSeq") }; },
    restore(snap) {
      g.setG(structuredClone(snap.G)); g.rng.set(snap.rng); g.clearFx();
      g.run(`posPred = null; posPredAt = -1; debuffSeq = ${snap.seq};`);
      Object.assign(S, structuredClone(snap.S));
      next = !snap.next ? null : snap.next.upId ? { up: g.G.towers.find(t => t.id === snap.next.upId) } : { kind: snap.next.kind };
      for (const k of KNOBS) delete strategy[k];
      Object.assign(strategy, structuredClone(snap.knobs));
    },
    result() {
      const G = g.G, towers = {}, build = [];
      for (const t of G.towers) {
        const key = t.kind + (t.path != null ? "/" + g.UPGRADES[t.kind][t.path].name : "") + (t.form != null ? "/" + g.UPGRADES[t.kind][t.path].finals[t.form].name : "");
        towers[key] = towers[key] || { n: 0, dealt: 0, kills: 0 };
        towers[key].n++; towers[key].dealt += t.dealt || 0; towers[key].kills += t.kills || 0;
        build.push({ kind: t.kind, lvl: t.lvl, skills: t.skills || null, mode: t.mode });
      }
      return { nearest: Math.round(S.nearest), wave: G.wave, over: G.over, won: !!G.won, lives: G.lives, core: G.core ? G.core.pw : null, fires: S.coreMem.fired || null, money: Math.round(G.money), spent: Math.round(G.towers.reduce((a, t) => a + (t.spent || 0), 0)), interest: Math.round(G.interestTotal || 0), econ: S.econ, builtAt: S.builtAt, fullAt: S.fullAt, time: Math.round(S.time), towers, build, leaks: S.leaks, leakWave: S.leakWave, pivots: strategy.pivots ? S.pivoted : undefined, trace: strategy.trace ? S.trace : undefined };
    },
  };
}

export function play(strategy, seed = 1, maxWave = 60, dt = 0.02, patch = "") {
  const p = makePlayer(strategy, seed, maxWave, dt, patch);
  p.runTo(maxWave + 1);
  return p.result();
}

if (process.argv[1] && process.argv[1].endsWith("sim.mjs") && process.argv[2]) {
  const s = JSON.parse(process.argv[2]);
  const t0 = Date.now();
  const res = play(s, Number(process.argv[3] || 1), Number(process.argv[4] || 60));
  res.ms = Date.now() - t0;
  console.log(JSON.stringify(res));
}
