// /aspira — the CORE's own upgrades (owner, 2026-10-02). Click the core to
// open its card (the tower card, in white). From wave CORE_UNLOCK the core
// levels L1 -> L2 -> L3, each choice opening its own next options:
//   Zen      every few seconds a wave spreads from the core, near-freezing (95%) what it passes
//     Stillness  reach STILL_R           -> Silence    a pulse every 3s
//     Echo       frozen enemies x1.5     -> Resonance  x2, and 1s past the freeze
//   Space    (id "nullify") slots and towers move NULL_PUSH out, +NULL_RANGE range
//     Expanse    the same again          -> Horizon    +range again; the slots orbit the core
//     Vacuum     Quench: Fast half speed, armor and shields halved -> Infinity  every tower +30% damage
// Past L3, once every open slot has an L4 tower: the repeatables (Overclock, Amplifier,
// Lens). Loaded after aspira-towers.js (the simulator loads it too); the card
// and drawing code only run from the UI.
const CORE_UNLOCK = 30, CORE_COST = [1500, 3000, 6000]; // owner: was 2500 / 5000 / 10000
const ZEN_EVERY = 5, ZEN_R = 250, ZEN_SLOW = 0.95, ZEN_T = 1, SINTER_MUL = 1.3, NULL_PUSH = 100, NULL_RANGE = 75; // Space range bonus at 75%, with every range (owner)
// Zen's wave TRAVELS (owner: slower): its front spreads from the core to its
// reach over ZEN_WAVE_T seconds and freezes each enemy as it passes
const ZEN_WAVE_T = 3;
const STILL_R = 400, ECHO_MUL = 1.5;
// L3 (owner, 2026-10-02)
const SILENCE_EVERY = 3, RESONANCE_MUL = 2, RESONANCE_T = 1, HORIZON_SPIN = 0.05;
const CORE_L1 = [
  { id: "zen", name: "Zen", desc: "every 5s a pulse near-freezes enemies within 250 of the core (95% slow) for 1s" },
  { id: "nullify", name: "Space", desc: "towers move 100 further out and gain +75 range" },
];
// (the Sinter path - Sinter, Temper, Quench, Anneal, Brittle Core - was cut,
// owner 2026-10-02; its two effects live on under Space as Vacuum and Infinity)
const CORE_L2 = {
  zen: [
    { id: "stillness", name: "Stillness", desc: "the pulse reaches 400 (was 250)" },
    { id: "echo", name: "Echo", desc: "enemies held by the pulse take +50% damage" },
  ],
  nullify: [
    { id: "expanse", name: "Expanse", desc: "towers move another 100 out and gain another +75 range" },
    // Vacuum carries Quench's effect (owner, 2026-10-02; was 25% slower)
    { id: "vacuum", name: "Vacuum", desc: "Fast enemies at half speed; armor and shields halved" },
  ],
};
const CORE_L3 = {
  stillness: [{ id: "silence", name: "Silence", desc: "a pulse every 3s (was 5)" }],
  echo: [{ id: "resonance", name: "Resonance", desc: "held enemies take +100% (was +50%), for 1s after the freeze ends too" }],
  expanse: [{ id: "horizon", name: "Horizon", desc: "+75 range again (+225 in all), and the slots slowly orbit the core" }],
  // Infinity carries Sinter's effect (owner; replaced Void)
  vacuum: [{ id: "infinity", name: "Infinity", desc: "every tower deals +30% damage" }],
};
const CORE_MAX = CORE_COST.length;

const coreLvl = () => (G.core ? G.core.lvl : 0);
const coreHas = id => !!G.core && (G.core.l1 === id || G.core.l2 === id || G.core.l3 === id);
const coreCost = () => CORE_COST[coreLvl()];
// open once STRENGTH (the wave-30 boss) is beaten (owner) - a boss that gets
// through ends the game, so being past wave 30 means it fell
const coreOpen = () => G.wave > CORE_UNLOCK;
// what the next core level offers: L1's three, the two under the L1 taken,
// or the one under the L2 taken
const coreOptions = () => [CORE_L1, G.core && CORE_L2[G.core.l1], G.core && CORE_L3[G.core.l2]][coreLvl()];
const zenR = () => (coreHas("stillness") ? STILL_R : ZEN_R);
const zenEvery = () => (coreHas("silence") ? SILENCE_EVERY : ZEN_EVERY);
// Space's push (doubled by Expanse) and range (that, plus one more for Horizon)
const pushK = () => (coreHas("nullify") ? (coreHas("expanse") ? 2 : 1) : 0);
const spaceK = () => pushK() + (coreHas("horizon") ? 1 : 0);
// Vacuum quenches (Fast half speed, armor and shields halved); Infinity adds
// +30% damage to every tower
const quenching = () => coreHas("vacuum");
const sintering = () => coreHas("infinity");

// REPEATABLES (owner, 2026-10-02: Overclock / Amplifier / Lens), open once the
// core is L3 AND every open slot has an L4 tower; each buy adds its step again and
// doubles that upgrade's price
const REPS = [
  { id: "overclock", name: "Overclock", desc: "every tower fires 10% faster (not ACD's burn ticks)", step: 1.1 },
  { id: "amplifier", name: "Amplifier", desc: "every tower deals 10% more damage", step: 1.1 },
  { id: "lens", name: "Lens", desc: "every tower reaches 5% further", step: 1.05 },
];
const REP_BASE = 6000;
const repN = id => (G.core && G.core.reps ? G.core.reps[id] || 0 : 0);
const repCost = id => REP_BASE * Math.pow(2, repN(id));
const repMul = id => Math.pow(REPS.find(r => r.id === id).step, repN(id));
const repsOpen = () => coreLvl() >= CORE_MAX && G.towers.length === openCells() && G.towers.every(t => t.lvl >= MAX_LVL);
function buyRep(id) {
  if (!repsOpen() || G.money < repCost(id)) return false;
  G.money -= repCost(id);
  G.core.reps = G.core.reps || {};
  G.core.reps[id] = repN(id) + 1;
  return true;
}

function buyCore(choice) {
  if (!coreOpen() || coreLvl() >= CORE_MAX || G.money < coreCost()) return false;
  const opt = coreOptions()[choice];
  if (!opt) return false;
  G.money -= coreCost();
  if (!G.core) G.core = { lvl: 1, l1: opt.id, zenT: ZEN_EVERY, clock: 0 };
  else { G.core["l" + (G.core.lvl + 1)] = opt.id; G.core.lvl++; }
  if (coreHas("nullify")) pushCells(NULL_PUSH * pushK(), G.rot || 0);
  if (quenching()) for (const e of G.enemies) if (!e.dead) quench(e);
  return true;
}
// move every slot d further out from the core and turn them rot radians
// round it (0, 0 = home), towers with them; newGame() calls pushCells(0)
function pushCells(d, rot = 0) {
  const c0 = Math.cos(rot), s0 = Math.sin(rot);
  const turn = (x, y) => ({ x: CX + (x - CX) * c0 - (y - CY) * s0, y: CY + (x - CX) * s0 + (y - CY) * c0 });
  for (const c of CELLS) {
    if (!c.home) c.home = { x: c.x, y: c.y, pts: c.pts.map(p => ({ ...p })), minR: c.minR };
    if (c.home.minR != null) c.minR = c.home.minR + d; // a corner slot's inner limit moves out with it
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
// the core each step: Horizon's slow orbit of the slots, Zen's wave (the
// slots stand still otherwise - an always-on slow orbit was tried and dropped)
function stepCore(dt) {
  if (!G.core) return;
  G.core.clock += dt;
  if (coreHas("horizon")) { G.rot = (G.rot || 0) + HORIZON_SPIN * dt; pushCells(NULL_PUSH * pushK(), G.rot); }
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
// the core's damage multiplier on a hit, from damage(); returns [multiplier,
// crit] (no crit source left since Anneal was cut, kept for the call shape)
function coreHitMul(e) {
  return [echoMul(e), false];
}

// ---------- the core's look (UI only; aspira-draw.js calls it under the towers) ----------
// every core effect shows on the board (owner: clear animations):
//   Space / Expanse / Horizon  thin white struts from the core to every slot
//   Infinity                   a steady thick white beam to every tower
// (Zen's wave, and the enemy marks for Vacuum / Echo, are drawn
// elsewhere: fx "zen", and drawStatus in aspira-enemies.js)
function drawCoreFx() {
  if (!G.core) return;
  const now = performance.now();
  ctx.strokeStyle = COL.white; ctx.lineCap = "round";
  if (coreHas("nullify")) {
    ctx.globalAlpha = 0.25; ctx.lineWidth = 2;
    CELLS.forEach((c, i) => { if (cellOpen(i)) { ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(c.x, c.y); ctx.stroke(); } });
  }
  if (sintering()) {
    const pulse = 0.7 + 0.3 * Math.sin(now / 400);
    for (const t of G.towers) {
      ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(t.x, t.y);
      ctx.globalAlpha = 0.12 * pulse; ctx.lineWidth = 12; ctx.stroke();
      ctx.globalAlpha = 0.5 * pulse; ctx.lineWidth = 3; ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- the core's card (UI only) ----------
// One click buys a core option (owner, 2026-10-02: no confirm step); an
// option it cannot afford is disabled (updateHud, by its data-cost).
function coreBought() { sfx("coreup"); ring(CX, CY, 80, "white"); refreshPanels(); }
// past L3: the repeatables, once every open slot has an L4 tower too
function coreReps(box) {
  if (!repsOpen()) { button(box, "asp-primary asp-up-big", "max level · more once every slot has an L4 tower", () => {}); return; }
  REPS.forEach(r => {
    button(box, "asp-primary asp-choice", "<b>" + r.name + " " + (repN(r.id) + 1) + " · " + cr(repCost(r.id)) + "</b><span>" + r.desc + "</span>",
      () => { if (buyRep(r.id)) coreBought(); }).dataset.cost = repCost(r.id);
  });
}
function inspectCore(el) {
  const lvl = coreLvl();
  const l1 = lvl ? CORE_L1.find(o => o.id === G.core.l1) : null;
  const l2 = G.core && G.core.l2 ? CORE_L2[G.core.l1].find(o => o.id === G.core.l2) : null;
  const l3 = G.core && G.core.l3 ? CORE_L3[G.core.l2].find(o => o.id === G.core.l3) : null;
  const took = [l1, l2, l3].filter(Boolean);
  el.innerHTML = '<div class="name">Core · L' + lvl + " of " + CORE_MAX + took.map(o => " · " + o.name).join("") + "</div>" +
    '<div id="asp-upbox"></div>' +
    '<p class="asp-hint">' + (took.length ? took.map(o => o.desc).join("; ") : "The heart of the chart. Upgrades unlock when Strength, the wave-" + CORE_UNLOCK + " boss, falls.") + "</p>";
  const box = $("asp-upbox");
  if (lvl >= CORE_MAX) { coreReps(box); return; }
  if (!coreOpen()) { button(box, "asp-primary asp-up-big", "unlocks when Strength falls (wave " + CORE_UNLOCK + ")", () => {}); return; }
  coreOptions().forEach((o, i) => {
    button(box, "asp-primary asp-choice", "<b>" + o.name + " · " + cr(coreCost()) + "</b><span>" + o.desc + "</span>",
      () => { if (buyCore(i)) coreBought(); }).dataset.cost = coreCost();
  });
}
