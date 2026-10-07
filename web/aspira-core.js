// /aspira — the CORE's POWERS (owner, 2026-10-06; replaced the Zen / Space
// path tree and the repeatables). Three powers, each owned at its top tier
// (CORE_TIERS), won from bosses (below):
//   Fortifications  drag a TOWER onto the core: for a while the core becomes a
//                   full-strength COPY of it, chart picks included (owner: temporary,
//                   like the others; cooldown) (+2 tiers on every axis at III)
//   Temporal        press and HOLD the core: a ring spreads from it and stops
//                   every enemy dead for a while; cooldown
//   Empower         drag the CORE onto a tower: for a while it fights as if
//                   every chart axis were maxed; cooldown
// The gestures live in aspira-camera.js; this file holds the rules, the core's
// copy firing, and its card and drawing. Loaded after aspira-towers.js /
// aspira-skills.js (the simulator loads it too).
// NO PRICE (owner, 2026-10-07; was 1000 .. 5000 credits a level, 27k in all):
// 0 of 192 scripted games won while saving for it, and the same players won 76%
// without it. Bosses are the reward instead: the falls of CORE_PICKS (Strength
// 30, Lovers 50, Devil 70) each hand the player ONE power, chosen from the ones
// not yet owned, at its TOP tier at once; the corner slots open in between (20,
// 40, 60 - CORNER_SLOTS in aspira-defs.js). The last power left is simply given.
const CORE_UNLOCK = 30, CORE_TIERS = 3, CORE_PICKS = [30, 50, 70], CORE_POINTS = CORE_TIERS * CORE_PICKS.length;
const CORE_POWERS = [
  { id: "relay", name: "Orbital Relay", /* planetary defence names (owner, 2026-10-06; was Fortifications) */ how: "drag a tower onto the core",
    desc: "For a while, the core becomes a copy of a tower you drag onto it, two tiers stronger on every axis." },
  { id: "temporal", name: "Temporal Drive", /* (owner; was Temporal Manipulation) */ how: "press and hold the core",
    desc: "A ring spreads from the core and stops every enemy dead, briefly." },
  { id: "overcharge", name: "Overcharge Uplink", /* (was Empower) */ how: "drag the core onto a tower",
    desc: "For a while, a tower fights as if every axis were maxed." },
];
const TEMPORAL = [null, { dur: 5, cd: 60 }, { dur: 8, cd: 45 }, { dur: 12, cd: 35 }], /* owner 2026-10-06: longer stop, longer cooldown (was 2 / 30, 4 / 20) */ TEMPORAL_GROW = 0.6, TEMPORAL_R = 560;
// 3x longer (owner, 2026-10-06; were 6 / 12 and 15 s); their cooldowns now
// count from when the effect ENDS, or Empower II (36 s on, 30 s cooldown)
// would never switch off
const OVERCHARGE = [null, { dur: 18, cd: 45 }, { dur: 36, cd: 30 }, { dur: 54, cd: 20 }];
const RELAY = [null, { dur: 45, cd: 40 }, { dur: 45, cd: 40 }, { dur: 45, cd: 40 }]; // (per tier: a higher tier is a stronger copy, not more time; only III is owned now)

const powerLvl = id => (G.core && G.core.pw ? G.core.pw[id] || 0 : 0);
const coreLvl = () => (G.core && G.core.pw ? Object.values(G.core.pw).reduce((a, b) => a + b, 0) : 0);
const corePicks = () => (G.core && G.core.picks) || 0; // powers won but not yet chosen
// open once a power is owned or waiting to be chosen (Strength, wave 30, first)
const coreOpen = () => coreLvl() > 0 || corePicks() > 0;
const coreState = () => (G.core ||= { pw: {}, cd: {}, clock: 0, picks: 0 });
const powersLeft = () => CORE_POWERS.filter(p => !powerLvl(p.id));
function pickPower(id) {
  if (corePicks() <= 0 || powerLvl(id) || !CORE_POWERS.some(p => p.id === id)) return false;
  const c = coreState();
  c.picks--; c.pw = { ...c.pw, [id]: CORE_TIERS }; // a fresh object: the simulator's stat cache keys on it
  return true;
}
// from bossKilled, the last boss of a CORE_PICKS wave down: one power to choose
// (the only one left is given outright)
function grantPick() {
  const c = coreState();
  c.picks = (c.picks || 0) + 1;
  const left = powersLeft();
  if (left.length === 1) pickPower(left[0].id);
  return left.length === 1 ? left[0] : null;
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
  const lvl = coreLvl(), copy = G.core && G.core.tower, picks = corePicks();
  el.innerHTML = '<div class="name">Core · ' + (lvl / CORE_TIERS) + " of " + CORE_POWERS.length + (copy ? " · copying " + TOWERS[copy.kind].name + " · " + Math.ceil(G.core.copyUntil - G.core.clock) + "s" : "") + "</div>" +
    '<p class="asp-hint">' + (picks ? "Choose a power. The others come with later bosses." : coreOpen() ? "Each power arrives at full strength. More come with later bosses." : "The heart of the chart. Its first power comes when Strength, the wave-" + CORE_UNLOCK + " boss, falls.") + "</p>" +
    '<div id="asp-upbox"></div>'; // (its close is the spend bar's button)
  const box = $("asp-upbox");
  if (!coreOpen()) { button(box, "asp-primary asp-up-big", "unlocks when Strength falls (wave " + CORE_UNLOCK + ")", () => {}); return; }
  CORE_POWERS.forEach(p => {
    const owned = !!powerLvl(p.id);
    if (!owned && !picks) return; // not yet won: nothing to show
    const cd = cooldownLeft(p.id), state = owned ? (cd ? " · " + Math.ceil(cd) + "s" : " · ready") : " · choose";
    const b = button(box, "asp-primary asp-choice", "<b>" + p.name + state + "</b><span>" +
      p.desc + " (" + p.how + ")</span>", () => { if (!owned && pickPower(p.id)) coreBought(); });
    if (owned) b.disabled = true;
  });
}
