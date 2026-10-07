// /aspira — the CORE POWERS' LOOK (UI only; owner, 2026-10-06: "cooldowns and
// effects need to be extremely more visible"). Loaded after aspira-core.js.
//   the DIAL      three thick arcs round the core, one per owned power, each
//                 in its own colour and named: a dim track that fills as the
//                 power recharges, a pulsing glow when it is up (and a
//                 "TEMPORAL DRIVE READY" pop-up where the interest's pops up the
//                 moment it comes up - owner; the dial carries no labels), and
//                 while the power RUNS a white-hot arc draining with its time
//   TIME STOP     the plain cyan ring sweeping out (owner: enough as it was)
//   OVERCHARGE       a THICK pulsing beam from the core to the tower, a glowing
//                 halo round it and its seconds left above it
//   RELAY       the core itself takes on the copied tower's colour (drawCore);
//                 its dial label reads "ARC 12s"
// drawCoreFx goes under the towers (beams), drawCoreHud over the enemies, and
// the dial (drawCoreDial) under everything, pop-up text included.
// sized for a PHONE (the board shows at ~0.54 css px per unit there): text
// 26 units reads as ~14px
// closer and thinner (owner): just outside a level-4 core's outermost ring (~75)
// hugging the core (owner: "much closer to the credit count"; was 90, then 118)
const DIAL_R = 62, DIAL_W = 7, DIAL_GAP = 0.2, READY_POP = 15, OVERCHARGE_TEXT = 26;
const DIAL = [ // clockwise from the top-left; colours are palette keys
  { id: "temporal", label: "TEMPORAL DRIVE", color: "cyan", mid: -Math.PI * 0.833, tab: () => TEMPORAL, active: c => c.freezeUntil - c.clock },
  { id: "overcharge", label: "OVERCHARGE UPLINK", color: "white", mid: -Math.PI * 0.167, tab: () => OVERCHARGE, active: () => overchargeLeft() },
  { id: "relay", label: "ORBITAL RELAY", color: "orange", mid: Math.PI / 2, tab: () => RELAY, active: c => (c.tower ? c.copyUntil - c.clock : 0) },
];
const overchargeLeft = () => Math.max(0, ...G.towers.map(t => (t.overchargeUntil || 0) - (G.clock || 0)));
const glow = (col, blur) => { ctx.shadowColor = col; ctx.shadowBlur = blur * cam.k; };

// under the towers: Empower's beam, a power being dragged
function drawCoreFx() {
  if (!G.core && !ui.drag) return;
  const now = performance.now();
  ctx.lineCap = "round";
  for (const t of G.towers) {
    if (!overcharged(t)) continue;
    const pulse = 0.6 + 0.4 * Math.sin(now / 400);
    ctx.strokeStyle = COL.white; glow(COL.white, 18);
    ctx.globalAlpha = 0.3 * pulse; ctx.lineWidth = 44; ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(t.x, t.y); ctx.stroke();
    ctx.globalAlpha = pulse; ctx.lineWidth = 14; ctx.stroke(); // thick (owner)
    ctx.shadowBlur = 0;
  }
  if (ui.drag && ui.drag.at) {
    ctx.strokeStyle = COL.white; ctx.lineWidth = 4; ctx.globalAlpha = 0.9; ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.moveTo(ui.drag.from.x, ui.drag.from.y); ctx.lineTo(ui.drag.at.x, ui.drag.at.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(ui.drag.at.x, ui.drag.at.y, CELL_S, 0, 6.283); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// over everything but the banner: the freeze, the copy, Empower's halos
function drawCoreHud() {
  if (!G.core) return;
  const c = G.core, now = performance.now();
  ctx.lineCap = "round";
  drawTimeStop(c);
  for (const t of G.towers) {
    const left = (t.overchargeUntil || 0) - (G.clock || 0);
    if (left <= 0) continue;
    ctx.strokeStyle = COL.white; glow(COL.white, 20); ctx.lineWidth = 6;
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / 400);
    ctx.beginPath(); ctx.arc(t.x, t.y, CELL_S * 1.7, 0, 6.283); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    text("OVERCHARGE " + Math.ceil(left) + "s", t.x, t.y - CELL_S * 2.4, OVERCHARGE_TEXT, "white", true, true);
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
// the cooldown dial goes UNDER every pop-up text, damage numbers included
// (owner, 2026-10-07): render draws it first, right over the background
function drawCoreDial() {
  if (!G.core) return;
  ctx.lineCap = "round";
  drawDial(G.core, performance.now());
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
function drawTimeStop(c) { // the ring sweeping out (owner: the plain ring is enough)
  if (!c.freeze) return;
  const f = c.freeze, p = Math.min(1, f.t / TEMPORAL_GROW);
  ctx.strokeStyle = COL.cyan; ctx.lineWidth = 6; ctx.globalAlpha = 0.8 * (1 - Math.max(0, f.t - TEMPORAL_GROW) / 0.4);
  ctx.beginPath(); ctx.arc(CX, CY, Math.max(1, TEMPORAL_R * p), 0, 6.283); ctx.stroke();
  ctx.globalAlpha = 1;
}

// the dial: one arc per OWNED power
function drawDial(c, now) {
  const seg = (2 * Math.PI) / DIAL.length - DIAL_GAP;
  for (const d of DIAL) {
    const lv = powerLvl(d.id);
    if (!lv) continue;
    const a0 = d.mid - seg / 2, col = COL[d.color], cd = cooldownLeft(d.id), full = d.tab()[lv].cd, run = d.active(c);
    ctx.lineWidth = DIAL_W; ctx.strokeStyle = col;
    ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(CX, CY, DIAL_R, a0, a0 + seg); ctx.stroke(); // the track
    if (run > 0) { // RUNNING: white-hot, draining with its time
      ctx.strokeStyle = COL.white; glow(COL.white, 16); ctx.globalAlpha = 1;
      const dur = d.id === "temporal" ? d.tab()[lv].dur + TEMPORAL_GROW : d.tab()[lv].dur;
      ctx.beginPath(); ctx.arc(CX, CY, DIAL_R, a0, a0 + seg * Math.min(1, run / dur)); ctx.stroke();
    } else if (cd > 0) { // RECHARGING: fills
      ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(CX, CY, DIAL_R, a0, a0 + seg * (1 - cd / full)); ctx.stroke();
    } else { // READY: full, glowing, pulsing
      glow(col, 18 + 10 * Math.sin(now / 500)); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(CX, CY, DIAL_R, a0, a0 + seg); ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    // NO labels on the dial (owner): a power coming off cooldown pops up
    // "<NAME> READY" in its colour WHERE THE INTEREST POPS UP, under the core
    const was = (c.cdSeen ||= {})[d.id];
    if (was > 0 && cd <= 0) float(CX, CY + CORE_R + LIFE_GAP * LIFE_RINGS + 16, d.label + " READY", d.color, READY_POP, 1.6, 1, 30);
    c.cdSeen[d.id] = cd;
  }
}
