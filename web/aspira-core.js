// /aspira — the CORE's own upgrades (owner, 2026-10-02). Click the core to
// open its card (the tower card, in white). From wave CORE_UNLOCK the core can
// be upgraded. L1 is one of three effects; L2 deepens it, two options each:
//   Zen      every ZEN_EVERY s a pulse near-freezes (95%) enemies within ZEN_R for ZEN_T s
//     Stillness  the pulse reaches STILL_R
//     Echo       enemies held by the pulse take ECHO_MUL damage
//   Space    (id "nullify") the six slots (and their towers) move NULL_PUSH
//            further from the core, and every tower gains NULL_RANGE range
//     Expanse    the same again: 2x the push, 2x the range
//     Vacuum     every enemy moves at VACUUM_SPD of its speed
//   Sinter   every tower deals +30% damage
//     Temper     every tower fires TEMPER_RATE faster
//     Quench     Fast enemies at half speed, armor and shield charges halved
// Loaded after aspira-towers.js (the simulator loads it too); the card code
// only runs from the UI.
const CORE_UNLOCK = 30, CORE_COST = [2500, 5000, 10000];
const ZEN_EVERY = 5, ZEN_R = 250, ZEN_SLOW = 0.95, ZEN_T = 1, SINTER_MUL = 1.3, NULL_PUSH = 100, NULL_RANGE = 100;
// Zen's wave TRAVELS (owner: slower): its front spreads from the core to its
// reach over ZEN_WAVE_T seconds and freezes each enemy as it passes
const ZEN_WAVE_T = 3;
const STILL_R = 400, ECHO_MUL = 1.5, VACUUM_SPD = 0.75, TEMPER_RATE = 1.3;
// L3 (owner, 2026-10-02)
const SILENCE_EVERY = 3, RESONANCE_MUL = 2, RESONANCE_T = 1, HORIZON_SPIN = 0.05, VOID_SPD = 0.6;
// the six slots ALWAYS turn slowly round the core (owner: "I really like the
// Horizon look"), at a tenth of Horizon's speed; Horizon turns them at full
const BASE_SPIN = HORIZON_SPIN / 10;
const ANNEAL_P = 0.15, ANNEAL_MUL = 3, BRITTLE_CORE = 1.25;
const CORE_L1 = [
  { id: "zen", name: "Zen", desc: "every 5s a pulse near-freezes enemies within 250 of the core (95% slow) for 1s" },
  { id: "nullify", name: "Space", desc: "towers move 100 further out and gain +100 range" },
  { id: "sinter", name: "Sinter", desc: "every tower deals +30% damage" },
];
const CORE_L2 = {
  zen: [
    { id: "stillness", name: "Stillness", desc: "the pulse reaches 400 (was 250)" },
    { id: "echo", name: "Echo", desc: "enemies held by the pulse take +50% damage" },
  ],
  nullify: [
    { id: "expanse", name: "Expanse", desc: "towers move another 100 out and gain another +100 range" },
    { id: "vacuum", name: "Vacuum", desc: "every enemy moves 25% slower" },
  ],
  sinter: [
    { id: "temper", name: "Temper", desc: "every tower fires 30% faster" },
    { id: "quench", name: "Quench", desc: "Fast enemies at half speed; armor and shields halved" },
  ],
};
const CORE_L3 = {
  stillness: [{ id: "silence", name: "Silence", desc: "a pulse every 3s (was 5)" }],
  echo: [{ id: "resonance", name: "Resonance", desc: "held enemies take +100% (was +50%), for 1s after the freeze ends too" }],
  expanse: [{ id: "horizon", name: "Horizon", desc: "+100 range again (+300 in all), and the slots slowly orbit the core" }],
  vacuum: [{ id: "void", name: "Void", desc: "every enemy moves 40% slower (was 25%)" }],
  temper: [{ id: "anneal", name: "Anneal", desc: "every hit from every tower has a 15% chance to crit for x3" }],
  quench: [{ id: "brittlecore", name: "Brittle Core", desc: "quenched enemies take +25% damage from every tower" }],
};
const CORE_MAX = CORE_COST.length;

const coreLvl = () => (G.core ? G.core.lvl : 0);
const coreHas = id => !!G.core && (G.core.l1 === id || G.core.l2 === id || G.core.l3 === id);
const coreCost = () => CORE_COST[coreLvl()];
const coreOpen = () => G.wave >= CORE_UNLOCK;
// what the next core level offers: L1's three, the two under the L1 taken,
// or the one under the L2 taken
const coreOptions = () => [CORE_L1, G.core && CORE_L2[G.core.l1], G.core && CORE_L3[G.core.l2]][coreLvl()];
const zenR = () => (coreHas("stillness") ? STILL_R : ZEN_R);
const zenEvery = () => (coreHas("silence") ? SILENCE_EVERY : ZEN_EVERY);
// Space's push (doubled by Expanse) and range (that, plus one more for Horizon)
const pushK = () => (coreHas("nullify") ? (coreHas("expanse") ? 2 : 1) : 0);
const spaceK = () => pushK() + (coreHas("horizon") ? 1 : 0);
const vacuumMul = () => (coreHas("void") ? VOID_SPD : coreHas("vacuum") ? VACUUM_SPD : 1);

function buyCore(choice) {
  if (!coreOpen() || coreLvl() >= CORE_MAX || G.money < coreCost()) return false;
  const opt = coreOptions()[choice];
  if (!opt) return false;
  G.money -= coreCost();
  if (!G.core) G.core = { lvl: 1, l1: opt.id, zenT: ZEN_EVERY, clock: 0 };
  else { G.core["l" + (G.core.lvl + 1)] = opt.id; G.core.lvl++; }
  if (coreHas("nullify")) pushCells(NULL_PUSH * pushK(), G.rot || 0);
  if (coreHas("quench")) for (const e of G.enemies) if (!e.dead) quench(e);
  return true;
}
// move every slot d further out from the core and turn them rot radians
// round it (0, 0 = home), towers with them; newGame() calls pushCells(0)
function pushCells(d, rot = 0) {
  const c0 = Math.cos(rot), s0 = Math.sin(rot);
  const turn = (x, y) => ({ x: CX + (x - CX) * c0 - (y - CY) * s0, y: CY + (x - CX) * s0 + (y - CY) * c0 });
  for (const c of CELLS) {
    if (!c.home) c.home = { x: c.x, y: c.y, pts: c.pts.map(p => ({ ...p })) };
    const len = Math.hypot(c.home.x - CX, c.home.y - CY), ox = (c.home.x - CX) / len * d, oy = (c.home.y - CY) / len * d;
    const at = turn(c.home.x + ox, c.home.y + oy);
    c.x = at.x; c.y = at.y;
    c.pts = c.home.pts.map(p => turn(p.x + ox, p.y + oy));
  }
  if (typeof G !== "undefined" && G) for (const t of G.towers) { t.x = CELLS[t.cell].x; t.y = CELLS[t.cell].y; }
}
// Quench, once per enemy: on everything alive when bought, then at spawn
function quench(e) {
  if (e.quenched) return;
  e.quenched = true;
  if (e.shield) { e.shield = Math.ceil(e.shield / 2); e.shieldMax = Math.ceil(e.shieldMax / 2); }
  if (e.armor > 0) e.armor /= 2;
  if (e.type === "fast") e.spd = (e.spd || 1) * 0.5;
}
// the core each step: the slots' slow orbit (Horizon's faster), Zen's wave
function stepCore(dt) {
  G.rot = (G.rot || 0) + (coreHas("horizon") ? HORIZON_SPIN : BASE_SPIN) * dt;
  pushCells(NULL_PUSH * pushK(), G.rot);
  if (!G.core) return;
  G.core.clock += dt;
  if (!coreHas("zen")) return;
  const w = G.core.wave;
  if (w) {
    w.t += dt;
    const front = zenR() * Math.min(1, w.t / ZEN_WAVE_T);
    for (const e of G.enemies) {
      if (e.dead || w.hit.has(e.id) || Math.hypot(e.x - CX, e.y - CY) > front) continue;
      w.hit.add(e.id); applySlow(e, ZEN_SLOW, ZEN_T, "core:zen");
      e.echoUntil = G.core.clock + ZEN_T + (coreHas("resonance") ? RESONANCE_T : 0);
    }
    if (w.t >= ZEN_WAVE_T) G.core.wave = null;
  }
  G.core.zenT -= dt;
  if (G.core.zenT > 0) return;
  G.core.zenT += zenEvery();
  G.core.wave = { t: 0, hit: new Set() };
  fx.push({ k: "zen", r: zenR(), t: 0, life: ZEN_WAVE_T });
}
// Echo / Resonance: extra damage on an enemy the Zen wave froze (from damage())
const echoMul = e => (coreHas("echo") && G.core.clock < (e.echoUntil || 0) ? (coreHas("resonance") ? RESONANCE_MUL : ECHO_MUL) : 1);
// Anneal (a crit on any tower's hit) and Brittle Core (quenched take more),
// from damage(); returns [multiplier, crit]
function coreHitMul(e, t) {
  let m = echoMul(e), crit = false;
  if (coreHas("brittlecore") && e.quenched) m *= BRITTLE_CORE;
  if (t && coreHas("anneal") && Math.random() < ANNEAL_P) { m *= ANNEAL_MUL; crit = true; }
  return [m, crit];
}

// ---------- the core's card (UI only) ----------
function inspectCore(el) {
  const lvl = coreLvl(), pick = ui.pick && ui.pick.tid === "core" ? ui.pick : null;
  const l1 = lvl ? CORE_L1.find(o => o.id === G.core.l1) : null;
  const l2 = G.core && G.core.l2 ? CORE_L2[G.core.l1].find(o => o.id === G.core.l2) : null;
  const l3 = G.core && G.core.l3 ? CORE_L3[G.core.l2].find(o => o.id === G.core.l3) : null;
  const took = [l1, l2, l3].filter(Boolean);
  el.innerHTML = '<div class="name">Core · L' + lvl + " of " + CORE_MAX + took.map(o => " · " + o.name).join("") + "</div>" +
    '<div id="asp-upbox"></div>' +
    '<p class="asp-hint">' + (took.length ? took.map(o => o.desc).join("; ") : "The heart of the chart. Upgrades unlock at wave " + CORE_UNLOCK + ".") + "</p>";
  const box = $("asp-upbox");
  if (lvl >= CORE_MAX) { button(box, "asp-primary asp-up-big", "max level", () => {}); return; }
  if (!coreOpen()) { button(box, "asp-primary asp-up-big", "unlocks at wave " + CORE_UNLOCK, () => {}); return; }
  coreOptions().forEach((o, i) => {
    button(box, "asp-primary asp-choice" + (pick && pick.choice === i ? " on" : ""),
      "<b>" + o.name + " · " + coreCost() + "</b><span>" + o.desc + "</span>", () => { ui.pick = { tid: "core", choice: i }; refreshPanels(); });
  });
  if (pick) {
    button(box, "asp-primary asp-up-big", "confirm · " + coreCost(), () => {
      if (buyCore(pick.choice)) { ui.pick = null; sfx("up"); ring(CX, CY, 80, "white"); }
      refreshPanels();
    }, "asp-up");
  }
}
