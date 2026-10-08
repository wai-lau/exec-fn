// /aspira — the CORE POWERS' LOOK (UI only; owner, 2026-10-06: "cooldowns and
// effects need to be extremely more visible"). Loaded after aspira-core.js.
//   the BUTTONS   cooldowns moved off the board (owner, 2026-10-08; was a
//                 dial of arcs round the core) - aspira-powers.js
//   TIME STOP     the plain cyan ring sweeping out (owner: enough as it was)
//   RELAY         a THICK pulsing beam from the core to the tower it has made
//                 three of, a glowing halo round it and "RELAY x3" with its
//                 seconds left above it
// drawCoreFx goes under the towers (beams), drawCoreHud over the enemies.
// sized for a PHONE (the board shows at ~0.54 css px per unit there): text
// 26 units reads as ~14px
const READY_POP = 15, RELAY_TEXT = 26;
const DIAL = [ // the owned powers' buttons (aspira-powers.js) read this; colours are palette keys
  { id: "temporal", label: "TEMPORAL DRIVE", color: "cyan", mid: Math.PI, tab: () => TEMPORAL, active: c => c.freezeUntil - c.clock }, // the left half
  { id: "relay", label: "ORBITAL RELAY", color: "white", mid: 0, tab: () => RELAY, active: () => relayLeft() }, // the right half
];
const relayLeft = () => Math.max(0, ...G.towers.map(t => (t.relayUntil || 0) - (G.clock || 0)));
const glow = (col, blur) => { ctx.shadowColor = col; ctx.shadowBlur = blur * cam.k; };

// under the towers: Empower's beam, a power being dragged
function drawCoreFx() {
  if (!G.core && !ui.drag) return;
  const now = performance.now();
  ctx.lineCap = "round";
  for (const t of G.towers) {
    if (!relayed(t)) continue;
    const pulse = 0.6 + 0.4 * Math.sin(now / 400);
    ctx.strokeStyle = COL.white; glow(COL.white, 18);
    ctx.globalAlpha = 0.3 * pulse; ctx.lineWidth = 44; ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(t.x, t.y); ctx.stroke();
    ctx.globalAlpha = pulse; ctx.lineWidth = 14; ctx.stroke(); // thick (owner)
    ctx.shadowBlur = 0;
  }
  if (ui.drag && ui.drag.at && ui.drag.drop) { // only a drag that can land (a held core with Overcharge cooling shows none)
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
    const left = (t.relayUntil || 0) - (G.clock || 0);
    if (left <= 0) continue;
    ctx.strokeStyle = COL.white; glow(COL.white, 20); ctx.lineWidth = 6;
    ctx.globalAlpha = 0.4 + 0.6 * blinkWave(); // the one blink (2026-10-08; was its own 2.5s sine)
    ctx.beginPath(); ctx.arc(t.x, t.y, CELL_S * 1.7, 0, 6.283); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    text("RELAY ×" + RELAY_MUL + " · " + Math.ceil(left) + "s", t.x, t.y - CELL_S * 2.4, RELAY_TEXT, "white", true, true);
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
function drawTimeStop(c) { // the ring sweeping out (owner: the plain ring is enough)
  if (!c.freeze) return;
  const f = c.freeze, p = Math.min(1, f.t / TEMPORAL_GROW);
  ctx.strokeStyle = COL.cyan; ctx.lineWidth = 6; ctx.globalAlpha = 0.8 * (1 - Math.max(0, f.t - TEMPORAL_GROW) / 0.4);
  ctx.beginPath(); ctx.arc(CX, CY, Math.max(1, TEMPORAL_R * p), 0, 6.283); ctx.stroke();
  ctx.globalAlpha = 1;
}
