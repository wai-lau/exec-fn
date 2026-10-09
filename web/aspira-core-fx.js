// /aspira — the CORE POWERS' LOOK (UI only; owner, 2026-10-06: "cooldowns and
// effects need to be extremely more visible"). Loaded after aspira-core.js.
//   the BUTTONS   cooldowns moved off the board (owner, 2026-10-08; was a
//                 dial of arcs round the core) - aspira-powers.js
//   TIME STOP     AT-field pulses: nested white octagons sweeping out (owner, 2026-10-08)
//   RELAY         a THICK pulsing beam from the core to the tower it has made
//                 three of, a glowing halo round it and "RELAY x3" with its
//                 seconds left above it
// drawCoreFx goes under the towers (beams), drawCoreHud over the enemies.
// sized for a PHONE (the board shows at ~0.54 css px per unit there): text
// 26 units reads as ~14px
const READY_POP = 15, RELAY_TEXT = 26;
const DIAL = [ // the owned powers' buttons (aspira-powers.js) read this; colours are palette keys
  { id: "temporal", label: "TEMPORAL DRIVE", color: "white", /* white (owner, 2026-10-08; was cyan) */ mid: Math.PI, tab: () => TEMPORAL, active: c => c.freezeUntil - c.clock }, // the left half
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
  if (!q3d()) drawTimeStop(c); // (3D: on the floor, in the board's picture - owner, 2026-10-09: "temporal drive should be on the plane in 3d")
  if (!q3d()) drawRelayHalos(true);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
// a Relayed tower's HALO; label: with "RELAY x3 . 5s" over it. In 3D it lies ON THE FLOOR, in the board's picture,
// with no label (owner, 2026-10-09: "relay circle should be on plane, also no need for text")
function drawRelayHalos(label) {
  for (const t of G.towers) {
    const left = (t.relayUntil || 0) - (G.clock || 0);
    if (left <= 0) continue;
    ctx.strokeStyle = COL.white; glow(COL.white, 20); ctx.lineWidth = 6;
    ctx.globalAlpha = 0.5 + 0.5 * blinkWave(); // softer (was 0.4 + 0.6) // the one blink (2026-10-08; was its own 2.5s sine)
    ctx.beginPath(); ctx.arc(t.x, t.y, CELL_S * 1.7, 0, 6.283); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    if (label) text("RELAY ×" + RELAY_MUL + " · " + Math.ceil(left) + "s", t.x, t.y - CELL_S * 2.4, RELAY_TEXT, "white", true, true);
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
// each pulse an EVANGELION AT FIELD (owner, 2026-10-08): nested WHITE OCTAGONS, the power's colour (owner: field and button both white; was orange, then cyan) sweeping out together,
// the outer one brightest, a faint fill inside it, the whole field shimmering fast; pulses still come
// every TEMPORAL_RING_EVERY s for the whole freeze (owner, same day; it was one plain cyan ring)
const AT_LAYERS = 5, AT_STEP = 0.12, AT_FILL = 0.06, AT_EDGE = Math.cos(Math.PI / 8); // AT_EDGE: an octagon's side distance / its corner distance
function drawTimeStop(c) {
  if (!c.freeze) return;
  const f = c.freeze, shimmer = 0.85 + 0.15 * Math.sin(performance.now() / 40);
  ctx.strokeStyle = ctx.fillStyle = COL.white; ctx.lineJoin = "miter";
  for (let t0 = 0; t0 < f.dur && t0 <= f.t; t0 += TEMPORAL_RING_EVERY) {
    const a = f.t - t0; // this pulse's age
    if (a > TEMPORAL_GROW + TEMPORAL_FADE) continue;
    const A = 0.85 * shimmer * (1 - Math.max(0, a - TEMPORAL_GROW) / TEMPORAL_FADE), R = Math.max(1, TEMPORAL_R * Math.min(1, a / TEMPORAL_GROW)) / AT_EDGE; // the octagon's FLAT SIDES on the freeze front (owner: cover what the ring did)
    poly(CX, CY, R, 8, Math.PI / 8, false); ctx.globalAlpha = A * AT_FILL; ctx.fill();
    glow(COL.white, 22);
    for (let k = 0; k < AT_LAYERS; k++) {
      const r = R * (1 - k * AT_STEP);
      if (r <= CORE_R) break;
      poly(CX, CY, r, 8, Math.PI / 8, false);
      ctx.globalAlpha = A * (1 - k / AT_LAYERS); ctx.lineWidth = 7 - k; ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1; ctx.lineJoin = "round";
}
