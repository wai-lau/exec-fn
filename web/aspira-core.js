// /aspira — the CORE's POWERS (owner, 2026-10-06; replaced the Zen / Space
// path tree and the repeatables). From wave CORE_UNLOCK the core buys up to
// CORE_POINTS levels across three powers, CORE_TIERS each (all of them, owner),
// or take all three and level one:
//   Fortifications  drag a TOWER onto the core: for a while the core becomes a
//                   full-strength COPY of it, chart picks included (owner: temporary,
//                   like the others; cooldown) (L2: the copy gets +1 tier on every axis)
//   Temporal        press and HOLD the core: a ring spreads from it and stops
//                   every enemy dead for a while; cooldown
//   Empower         drag the CORE onto a tower: for a while it fights as if
//                   every chart axis were maxed; cooldown
// The gestures live in aspira-camera.js; this file holds the rules, the core's
// copy firing, and its card and drawing. Loaded after aspira-towers.js /
// aspira-skills.js (the simulator loads it too).
// every power can be bought to its top, THREE tiers each (owner, 2026-10-06;
// was 4 buys across 2-tier powers): the price is by how many you already own
// a FLATTER ladder (owner, 2026-10-06; was 1000 .. 20000, 76.5k in all - tiers
// 6-9 were out of reach in 100 waves): 27k in all, +500 a buy
const CORE_UNLOCK = 30, CORE_TIERS = 3, CORE_COST = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000], CORE_POINTS = CORE_COST.length;
// the card lists them in this order: the one for sale from the start first
const CORE_POWERS = [
  { id: "overcharge", name: "Overcharge Uplink", /* (was Empower) */ how: "drag the core onto a tower",
    lv: ["For a while, a tower fights as if every axis were maxed.", "Longer, with a shorter cooldown.", "The longest, with the shortest cooldown."] },
  { id: "relay", name: "Orbital Relay", /* planetary defence names (owner, 2026-10-06; was Fortifications) */ how: "drag a tower onto the core",
    lv: ["For a while, the core becomes a full copy of a tower you drag onto it.", "The copy gains a tier on every axis.", "The copy gains another tier on every axis."] },
  { id: "temporal", name: "Temporal Drive", /* (owner; was Temporal Manipulation) */ how: "press and hold the core",
    lv: ["A ring spreads from the core and stops every enemy dead, briefly.", "A longer stop, a shorter cooldown.", "The longest stop, the shortest cooldown."] },
];
const TEMPORAL = [null, { dur: 5, cd: 60 }, { dur: 8, cd: 45 }, { dur: 12, cd: 35 }], /* owner 2026-10-06: longer stop, longer cooldown (was 2 / 30, 4 / 20) */ TEMPORAL_GROW = 0.6, TEMPORAL_R = 560;
// 3x longer (owner, 2026-10-06; were 6 / 12 and 15 s); their cooldowns now
// count from when the effect ENDS, or Empower II (36 s on, 30 s cooldown)
// would never switch off
const OVERCHARGE = [null, { dur: 18, cd: 45 }, { dur: 36, cd: 30 }, { dur: 54, cd: 20 }];
const RELAY = [null, { dur: 45, cd: 40 }, { dur: 45, cd: 40 }, { dur: 45, cd: 40 }]; // L2 / L3 buy a stronger copy, not more time

const powerLvl = id => (G.core && G.core.pw ? G.core.pw[id] || 0 : 0);
const coreLvl = () => (G.core && G.core.pw ? Object.values(G.core.pw).reduce((a, b) => a + b, 0) : 0);
const coreCost = () => CORE_COST[coreLvl()];
// open once STRENGTH (the wave-30 boss) is beaten (owner) - a boss that gets
// through ends the game, so being past wave 30 means it fell
const coreOpen = () => G.wave > CORE_UNLOCK;
// OVERCHARGE is for sale from the first wave (owner, 2026-10-07: something to
// DO during a wave long before Strength falls); Relay and Temporal still wait
const EARLY_POWERS = ["overcharge"];
const powerOpen = id => EARLY_POWERS.includes(id) || coreOpen();
// the core has something to SELL: a point left, and an open power below its top
const coreForSale = () => coreLvl() < CORE_POINTS && CORE_POWERS.some(p => powerOpen(p.id) && powerLvl(p.id) < CORE_TIERS);
const coreState = () => (G.core ||= { pw: {}, cd: {}, clock: 0 });
function buyPower(id) {
  if (!powerOpen(id) || coreLvl() >= CORE_POINTS || powerLvl(id) >= CORE_TIERS || G.money < coreCost()) return false;
  G.money -= coreCost();
  const c = coreState();
  c.pw[id] = powerLvl(id) + 1;
  if (id === "relay" && c.tower) c.tower = coreCopy(c.copy); // a copy already out grows at once
  return true;
}
const cooldownLeft = id => Math.max(0, (G.core && G.core.cd[id]) || 0);

// ---------- Fortifications: the core's copy ----------
// the copy is a tower-shaped object that is NOT in G.towers (it holds no slot
// and does not raise build prices); stepCore drives it like the tower loop
function coreCopy(src) {
  const sk = { ...src.skills };
  const up = powerLvl("relay") - 1; // +1 tier on every axis at L2, +2 at L3
  if (up > 0 && SKILL_TREES[src.kind]) for (const ax of SKILL_TREES[src.kind]) sk[ax.id] = Math.min(SKILL_TIERS, (sk[ax.id] || 0) + up);
  const pts = Object.values(sk).reduce((a, b) => a + b, 0);
  return { id: "core", isCore: true, kind: src.kind, skills: sk, lvl: 1 + pts, x: CX, y: CY, cell: -1, cd: 0, mode: DEFAULT_MODE[src.kind], spent: 0 };
}
function relay(t) {
  const lv = RELAY[powerLvl("relay")];
  if (!lv || !t || t.isCore || cooldownLeft("relay") > 0) return false;
  const c = coreState();
  c.cd.relay = lv.dur + lv.cd; // the cooldown starts when the copy wears off
  c.copyUntil = c.clock + lv.dur;
  c.copy = { kind: t.kind, skills: { ...t.skills } };
  c.tower = coreCopy(c.copy);
  if (typeof banner === "function") banner("ORBITAL RELAY · " + TOWERS[t.kind].ab, TOWERS[t.kind].color, 1.5);
  ring(CX, CY, 70, TOWERS[t.kind].color); if (typeof sfx === "function") sfx("powerrelay"); // its own sound, not "upgrade complete" (owner); none in the simulator
  return true;
}
const coreTowers = () => (G.core && G.core.tower ? [G.core.tower] : []);
function stepCoreTower(t, dt) {
  t.spin = (t.spin || 0) + dt;
  if (t.kind === "sol") { stepSol(t, dt); return; }
  if (t.kind === "acd") { stepAcd(t, dt); return; }
  if (t.kind === "frz" && hasSkills(t)) { frzStep(t, dt); return; }
  t.cd -= dt;
  if (t.cd > 0) return;
  const st = towerStats(t);
  if (fire(t, st)) t.cd = 1 / st.rate; else t.cd = 0.1;
}

// ---------- Temporal Manipulation: the stopping ring ----------
function temporalFreeze() {
  const lv = TEMPORAL[powerLvl("temporal")];
  if (!lv || cooldownLeft("temporal") > 0) return false;
  const c = coreState();
  c.cd.temporal = lv.cd;
  c.freeze = { t: 0, dur: lv.dur, hit: new Set() };
  c.frozenIds = c.freeze.hit; c.freezeUntil = c.clock + TEMPORAL_GROW + lv.dur; // for the look (aspira-core-fx.js)
  if (typeof sfx === "function") sfx("powertemporal");
  return true;
}
// ---------- Empower ----------
function overcharge(t) {
  const lv = OVERCHARGE[powerLvl("overcharge")];
  if (!lv || !t || t.isCore || cooldownLeft("overcharge") > 0) return false;
  coreState().cd.overcharge = lv.dur + lv.cd; // the cooldown starts when it wears off
  t.overchargeUntil = (G.clock || 0) + lv.dur;
  if (typeof banner === "function") banner("OVERCHARGE UPLINK", "white", 1.5);
  ring(t.x, t.y, 64, "white"); if (typeof sfx === "function") sfx("powerovercharge");
  return true;
}
const overcharged = t => t.overchargeUntil > (G.clock || 0);
// towerStats reads an EMPOWERED tower as this: every chart axis at its top tier
function overchargedView(t) {
  const sk = {};
  for (const ax of SKILL_TREES[t.kind] || []) sk[ax.id] = SKILL_TIERS;
  return { ...t, skills: sk, overchargeUntil: 0 };
}

// the core each step: cooldowns, the freeze ring, the copy firing
function stepCore(dt) {
  if (!G.core) return;
  const c = G.core;
  c.clock += dt;
  for (const k in c.cd) c.cd[k] = Math.max(0, c.cd[k] - dt);
  if (c.freeze) {
    const f = c.freeze;
    f.t += dt;
    const front = TEMPORAL_R * Math.min(1, f.t / TEMPORAL_GROW);
    for (const e of G.enemies) {
      if (e.dead || f.hit.has(e.id) || Math.hypot(e.x - CX, e.y - CY) > front) continue;
      f.hit.add(e.id); applySlow(e, 1, f.dur, "core:time"); // a 100% slow: stopped dead (bosses' own rules still apply)
    }
    if (f.t >= TEMPORAL_GROW + 0.4) c.freeze = null;
  }
  if (c.tower && c.clock >= c.copyUntil) { c.tower.puddles = null; c.tower = null; } // the copy wears off
  if (c.tower) stepCoreTower(c.tower, dt);
}
// kept for newGame(): the slots go home (the Space push that moved them is gone)
function pushCells() {
  for (const c of CELLS) {
    if (!c.home) c.home = { x: c.x, y: c.y, pts: c.pts.map(p => ({ ...p })), minR: c.minR };
    c.x = c.home.x; c.y = c.home.y; c.pts = c.home.pts.map(p => ({ ...p })); c.minR = c.home.minR;
  }
}

// the core's look (the dial, the freeze, Empower's beam, the copy) lives in
// aspira-core-fx.js (UI only)
// the copied tower's colour, as a ring on the core (drawCore)
const coreCopyColor = () => (G.core && G.core.tower ? COL[TOWERS[G.core.tower.kind].color] : null);

// ---------- the core's card (UI only) ----------
function coreBought() { sfx("coreup"); ring(CX, CY, 80, "white"); refreshPanels(); }
function inspectCore(el) {
  const lvl = coreLvl(), copy = G.core && G.core.tower;
  el.innerHTML = '<div class="name">Core · ' + lvl + " of " + CORE_POINTS + (copy ? " · copying " + TOWERS[copy.kind].name + " · " + Math.ceil(G.core.copyUntil - G.core.clock) + "s" : "") + "</div>" +
    '<p class="asp-hint">' + (coreOpen() ? "Three powers, " + CORE_TIERS + " levels each." : "The heart of the chart. Overcharge is for sale now; the other powers unlock when Strength, the wave-" + CORE_UNLOCK + " boss, falls.") + "</p>" +
    '<div id="asp-upbox"></div>'; // (its close is the spend bar's button)
  const box = $("asp-upbox");
  CORE_POWERS.forEach(p => { // a power still locked shows as a dead row, so the ladder is in view from the start
    const l = powerLvl(p.id), maxed = l >= CORE_TIERS, locked = !powerOpen(p.id);
    const cd = cooldownLeft(p.id), state = l ? " · L" + l + (cd ? " · " + Math.ceil(cd) + "s" : "") : "";
    const b = button(box, "asp-primary asp-choice", "<b>" + p.name + state + (maxed || locked ? "" : " · " + cr(coreCost())) + "</b><span>" +
      (locked ? "unlocks when Strength falls (wave " + CORE_UNLOCK + ")" : p.lv[Math.min(l, CORE_TIERS - 1)] + " (" + p.how + ")") + "</span>", () => { if (!maxed && !locked && buyPower(p.id)) coreBought(); });
    if (maxed || locked) b.disabled = true; else b.dataset.cost = coreCost();
  });
}
