// /aspira — the CORE's POWERS (owner, 2026-10-06; replaced the Zen / Space
// path tree and the repeatables). Two powers, each owned at its top tier
// (CORE_TIERS), won from bosses (below):
//   Orbital Relay   drag the CORE onto a tower: for a while the tower acts as
//                   THREE (RELAY_MUL) - every bolt, ray, burn line, tick and
//                   moon three times over (owner, 2026-10-07; it replaced BOTH
//                   the core-copy Relay and the every-axis-maxed Overcharge)
//   Temporal        press and HOLD the core: a ring spreads from it and stops
//                   every enemy dead for a while; cooldown
// The gestures live in aspira-camera.js; this file holds the rules and the
// core's card. Loaded after aspira-towers.js / aspira-skills.js (the
// simulator loads it too).
// NO PRICE (owner, 2026-10-07; was 1000 .. 5000 credits a level, 27k in all):
// 0 of 192 scripted games won while saving for it, and the same players won 76%
// without it. Bosses are the reward instead: the falls of CORE_PICKS (Strength
// 30, Lovers 50) each hand the player ONE power, chosen from the ones not yet
// owned, at its TOP tier at once; the corner slots open in between (20, 40, 60
// - CORNER_SLOTS in aspira-defs.js). The last power left is simply given.
// (two powers since the Relay merge, so two picks: the Devil's wave hands out nothing)
const CORE_UNLOCK = 30, CORE_TIERS = 3, CORE_PICKS = [30, 50], CORE_POINTS = CORE_TIERS * CORE_PICKS.length;
const CORE_POWERS = [
  { id: "relay", name: "Orbital Relay", /* planetary defence names (owner, 2026-10-06; was Fortifications) */ how: "drag the core onto a tower",
    desc: "For a while, a tower acts as three: every bolt, ray, burn line and moon, three times over." },
  { id: "temporal", name: "Temporal Drive", /* (owner; was Temporal Manipulation) */ how: "press and hold the core",
    desc: "A ring spreads from the core and stops every enemy dead, briefly." },
];
const TEMPORAL = [null, { dur: 5, cd: 60 }, { dur: 8, cd: 45 }, { dur: 12, cd: 35 }], /* owner 2026-10-06: longer stop, longer cooldown (was 2 / 30, 4 / 20) */ TEMPORAL_GROW = 0.6, TEMPORAL_R = 560;
// the Relay: RELAY_MUL x the tower for `dur` s, the cooldown counted from when
// it wears off (per tier for the dial's sake; only III is ever owned)
const RELAY_MUL = 3, RELAY = [null, { dur: 22.5, cd: 40 }, { dur: 22.5, cd: 40 }, { dur: 22.5, cd: 40 }]; // 22.5 s: halved (owner, 2026-10-07; was 45 s)

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
// (the only one left is given outright; none left: nothing to give)
function grantPick() {
  const left = powersLeft();
  if (!left.length) return null;
  const c = coreState();
  c.picks = (c.picks || 0) + 1;
  if (left.length === 1) pickPower(left[0].id);
  return left.length === 1 ? left[0] : null;
}
const cooldownLeft = id => Math.max(0, (G.core && G.core.cd[id]) || 0);

// ---------- Orbital Relay: the tower acts as three ----------
function relay(t) {
  const lv = RELAY[powerLvl("relay")];
  if (!lv || !t || cooldownLeft("relay") > 0) return false;
  coreState().cd.relay = lv.dur + lv.cd; // the cooldown starts when it wears off
  t.relayUntil = (G.clock || 0) + lv.dur;
  if (typeof banner === "function") banner("ORBITAL RELAY · " + TOWERS[t.kind].ab + " ×" + RELAY_MUL, TOWERS[t.kind].color, 1.5);
  ring(t.x, t.y, 64, "white"); if (typeof sfx === "function") sfx("powerrelay"); // its own sound, not "upgrade complete" (owner); none in the simulator
  return true;
}
const relayed = t => t.relayUntil > (G.clock || 0);
const relayMul = t => (relayed(t) ? RELAY_MUL : 1);
// towerStats (aspira-defs.js) ends with this - what "three of it" means per kind:
//   ARC  the attack itself fires RELAY_MUL times (the tower loop, aspira-game.js)
//   SOL  three times the locks, each charging its own ray
//   ACD  three times the burn lines (and so three times the puddles)
//   FRZ  three times the moons (nine, evenly spaced - moonSpots spaces by
//        count), the tick three times as hard; a plain FRZ: three times the tethers
function relayStats(s, kind, m) {
  if (kind === "sol" || kind === "acd") s.targets *= m;
  if (kind === "frz") { s.dmg *= m; s.targets *= m; if (s.moonN) s.moonN *= m; if (s.moons) s.moons *= m; }
}

// ---------- Temporal Drive: the stopping ring ----------
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

// the core each step: cooldowns and the freeze ring
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
}
// kept for newGame(): the slots go home (the Space push that moved them is gone)
function pushCells() {
  for (const c of CELLS) {
    if (!c.home) c.home = { x: c.x, y: c.y, pts: c.pts.map(p => ({ ...p })), minR: c.minR };
    c.x = c.home.x; c.y = c.home.y; c.pts = c.home.pts.map(p => ({ ...p })); c.minR = c.home.minR;
  }
}

// the core's look (the dial, the freeze, the Relay's beam and halos) lives in
// aspira-core-fx.js (UI only)

// ---------- the core's card (UI only) ----------
function coreBought() { sfx("coreup"); ring(CX, CY, 80, "white"); refreshPanels(); }
function inspectCore(el) {
  const lvl = coreLvl(), picks = corePicks();
  el.innerHTML = '<div class="name">Core · ' + (lvl / CORE_TIERS) + " of " + CORE_POWERS.length + "</div>" +
    '<p class="asp-hint">' + (picks ? "Choose a power. The other comes with a later boss." : coreOpen() ? "Each power arrives at full strength. The other comes with a later boss." : "The heart of the chart. Its first power comes when Strength, the wave-" + CORE_UNLOCK + " boss, falls.") + "</p>" +
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
