// /aspira — the CORE's POWERS (shown to the player as the ASCENDANT, owner; 2026-10-06; replaced the Zen / Space
// path tree and the repeatables). From wave CORE_UNLOCK the core buys up to
// CORE_POINTS levels across three powers, two levels each - so you max two,
// or take all three and level one:
//   Fortifications  drag a TOWER onto the core: the core becomes a full-strength
//                   COPY of it, chart picks included, until another is dragged
//                   on (L2: the copy gets +1 tier on every axis)
//   Temporal        press and HOLD the core: a ring spreads from it and stops
//                   every enemy dead for a while; cooldown
//   Empower         drag the CORE onto a tower: for a while it fights as if
//                   every chart axis were maxed; cooldown
// The gestures live in aspira-camera.js; this file holds the rules, the core's
// copy firing, and its card and drawing. Loaded after aspira-towers.js /
// aspira-skills.js (the simulator loads it too).
const CORE_UNLOCK = 30, CORE_COST = [1000, 2000, 3500, 5000], CORE_POINTS = CORE_COST.length;
const CORE_POWERS = [
  { id: "fortify", name: "Fortifications", how: "drag a tower onto the Ascendant",
    lv: ["The Ascendant becomes a full copy of a tower you drag onto it.", "The copy gains a tier on every axis."] },
  { id: "temporal", name: "Temporal Manipulation", how: "press and hold the Ascendant",
    lv: ["A ring spreads from the Ascendant and stops every enemy dead, briefly.", "A longer stop, a shorter cooldown."] },
  { id: "empower", name: "Empower", how: "drag the Ascendant onto a tower",
    lv: ["For a while, a tower fights as if every axis were maxed.", "Longer, with a shorter cooldown."] },
];
const TEMPORAL = [null, { dur: 2, cd: 30 }, { dur: 4, cd: 20 }], TEMPORAL_GROW = 0.6, TEMPORAL_R = 560;
const EMPOWER = [null, { dur: 6, cd: 45 }, { dur: 12, cd: 30 }];

const powerLvl = id => (G.core && G.core.pw ? G.core.pw[id] || 0 : 0);
const coreLvl = () => (G.core && G.core.pw ? Object.values(G.core.pw).reduce((a, b) => a + b, 0) : 0);
const coreCost = () => CORE_COST[coreLvl()];
// open once STRENGTH (the wave-30 boss) is beaten (owner) - a boss that gets
// through ends the game, so being past wave 30 means it fell
const coreOpen = () => G.wave > CORE_UNLOCK;
const coreState = () => (G.core ||= { pw: {}, cd: {}, clock: 0 });
function buyPower(id) {
  if (!coreOpen() || coreLvl() >= CORE_POINTS || powerLvl(id) >= 2 || G.money < coreCost()) return false;
  G.money -= coreCost();
  const c = coreState();
  c.pw[id] = powerLvl(id) + 1;
  if (id === "fortify" && c.copy) c.tower = coreCopy(c.copy); // a level-2 copy grows at once
  return true;
}
const cooldownLeft = id => Math.max(0, (G.core && G.core.cd[id]) || 0);

// ---------- Fortifications: the core's copy ----------
// the copy is a tower-shaped object that is NOT in G.towers (it holds no slot
// and does not raise build prices); stepCore drives it like the tower loop
function coreCopy(src) {
  const sk = { ...src.skills };
  if (powerLvl("fortify") >= 2 && SKILL_TREES[src.kind]) for (const ax of SKILL_TREES[src.kind]) sk[ax.id] = Math.min(SKILL_TIERS, (sk[ax.id] || 0) + 1);
  const pts = Object.values(sk).reduce((a, b) => a + b, 0);
  return { id: "core", isCore: true, kind: src.kind, skills: sk, lvl: 1 + pts, x: CX, y: CY, cell: -1, cd: 0, mode: DEFAULT_MODE[src.kind], spent: 0 };
}
function fortify(t) {
  if (!powerLvl("fortify") || !t || t.isCore) return false;
  const c = coreState();
  c.copy = { kind: t.kind, skills: { ...t.skills } };
  c.tower = coreCopy(c.copy);
  ring(CX, CY, 70, TOWERS[t.kind].color); if (typeof sfxFor === "function") sfxFor("up", t.kind); // (no sound in the simulator)
  return true;
}
const coreTowers = () => (G.core && G.core.tower ? [G.core.tower] : []);
function stepCoreTower(t, dt) {
  t.spin = (t.spin || 0) + dt;
  if (t.kind === "reaper") { stepReaper(t, dt); return; }
  if (t.kind === "acid") { stepAcid(t, dt); return; }
  if (t.kind === "slower" && hasSkills(t)) { frzStep(t, dt); return; }
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
  if (typeof sfx === "function") sfx("coreup");
  return true;
}
// ---------- Empower ----------
function empower(t) {
  const lv = EMPOWER[powerLvl("empower")];
  if (!lv || !t || t.isCore || cooldownLeft("empower") > 0) return false;
  coreState().cd.empower = lv.cd;
  t.empowerUntil = (G.clock || 0) + lv.dur;
  ring(t.x, t.y, 64, "white"); if (typeof sfxFor === "function") sfxFor("up", t.kind);
  return true;
}
const empowered = t => t.empowerUntil > (G.clock || 0);
// towerStats reads an EMPOWERED tower as this: every chart axis at its top tier
function empoweredView(t) {
  const sk = {};
  for (const ax of SKILL_TREES[t.kind] || []) sk[ax.id] = SKILL_TIERS;
  return { ...t, skills: sk, empowerUntil: 0 };
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
  if (c.tower) stepCoreTower(c.tower, dt);
}
// kept for newGame(): the slots go home (the Space push that moved them is gone)
function pushCells() {
  for (const c of CELLS) {
    if (!c.home) c.home = { x: c.x, y: c.y, pts: c.pts.map(p => ({ ...p })), minR: c.minR };
    c.x = c.home.x; c.y = c.home.y; c.pts = c.home.pts.map(p => ({ ...p })); c.minR = c.home.minR;
  }
}

// ---------- the core's look (UI only; aspira-draw.js calls it under the towers) ----------
// the freeze ring, a cooldown arc per power round the core, the empowered
// towers' halos, and the line of a power being dragged
const CD_R = 58;
function drawCoreFx() {
  if (!G.core && !ui.drag) return;
  const now = performance.now();
  ctx.lineCap = "round";
  if (G.core && G.core.freeze) {
    const f = G.core.freeze, p = Math.min(1, f.t / TEMPORAL_GROW);
    ctx.strokeStyle = COL.cyan; ctx.lineWidth = 6; ctx.globalAlpha = 0.8 * (1 - Math.max(0, f.t - TEMPORAL_GROW) / 0.4);
    ctx.beginPath(); ctx.arc(CX, CY, Math.max(1, TEMPORAL_R * p), 0, 6.283); ctx.stroke();
  }
  // cooldowns: Temporal top-left, Empower top-right, each arc emptying as it recharges
  [["temporal", -Math.PI * 0.75], ["empower", -Math.PI * 0.25]].forEach(([id, mid]) => {
    if (!powerLvl(id)) return;
    const left = cooldownLeft(id), full = (id === "temporal" ? TEMPORAL : EMPOWER)[powerLvl(id)].cd;
    ctx.strokeStyle = COL.white; ctx.lineWidth = 4;
    ctx.globalAlpha = left ? 0.35 : 0.85 + 0.15 * Math.sin(now / 300);
    const span = 0.55 * (left ? 1 - left / full : 1);
    ctx.beginPath(); ctx.arc(CX, CY, CD_R, mid - span / 2, mid + span / 2); ctx.stroke();
  });
  ctx.strokeStyle = COL.white; ctx.lineWidth = 3;
  for (const t of G.towers) {
    if (!empowered(t)) continue;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 120);
    ctx.beginPath(); ctx.arc(t.x, t.y, CELL_S * 1.6, 0, 6.283); ctx.stroke();
  }
  if (ui.drag && ui.drag.at) {
    ctx.strokeStyle = COL.white; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(ui.drag.from.x, ui.drag.from.y); ctx.lineTo(ui.drag.at.x, ui.drag.at.y); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}
// the copied tower's colour, as a ring on the core (drawCore)
const coreCopyColor = () => (G.core && G.core.tower ? COL[TOWERS[G.core.tower.kind].color] : null);

// ---------- the core's card (UI only) ----------
function coreBought() { sfx("coreup"); ring(CX, CY, 80, "white"); refreshPanels(); }
function inspectCore(el) {
  const lvl = coreLvl(), copy = G.core && G.core.tower;
  el.innerHTML = '<div class="name">Ascendant · ' + lvl + " of " + CORE_POINTS + (copy ? " · copying " + TOWERS[copy.kind].name : "") + "</div>" +
    '<p class="asp-hint">' + (coreOpen() ? "Three powers, two levels each; buy " + CORE_POINTS + " in all." : "The heart of the chart. Its powers unlock when Strength, the wave-" + CORE_UNLOCK + " boss, falls.") + "</p>" +
    '<div id="asp-upbox"></div>';
  const box = $("asp-upbox");
  if (!coreOpen()) { button(box, "asp-primary asp-up-big", "unlocks when Strength falls (wave " + CORE_UNLOCK + ")", () => {}); return; }
  CORE_POWERS.forEach(p => {
    const l = powerLvl(p.id), maxed = l >= 2 || lvl >= CORE_POINTS;
    const cd = cooldownLeft(p.id), state = l ? " · L" + l + (cd ? " · " + Math.ceil(cd) + "s" : "") : "";
    const b = button(box, "asp-primary asp-choice", "<b>" + p.name + state + (maxed ? "" : " · " + cr(coreCost())) + "</b><span>" +
      (l < 2 ? p.lv[l] : p.lv[1]) + " (" + p.how + ")</span>", () => { if (!maxed && buyPower(p.id)) coreBought(); });
    if (maxed) b.disabled = true; else b.dataset.cost = coreCost();
  });
}
