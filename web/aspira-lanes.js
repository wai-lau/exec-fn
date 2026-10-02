// /aspira — the twelve lanes on the chart: their strokes (masked to fade out
// past the rim), lit copies in their riders' colours, the wave:track labels
// (placed so they never overlap) and the fade in/out of lit lanes. Loaded
// right after aspira-draw.js, whose drawBoard calls drawLanes.

// Lanes in use this wave are drawn bright in the colour of the enemy type
// riding them; idle lanes drop to a faint trace.
// every lane is a SOLID line (owner; the per-pair dash styles are gone)
// Lane STROKES go to an offscreen layer that is then masked by a radial
// gradient: full at the centre, fading linearly to nothing just beyond the
// white rim (LANE_FADE_R), so lanes do not trail across the open sky.
// Labels are drawn unmasked.
const LANE_FADE_R = 550; // just past the rim circle (482-494)
const laneCv = document.createElement("canvas"), lctx = laneCv.getContext("2d");
function drawLaneStrokes(live) {
  if (laneCv.width !== cv.width || laneCv.height !== cv.height) { laneCv.width = cv.width; laneCv.height = cv.height; }
  lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.globalCompositeOperation = "source-over";
  lctx.clearRect(0, 0, laneCv.width, laneCv.height);
  lctx.setTransform(cam.k, 0, 0, cam.k, cam.ox, cam.oy);
  lctx.lineJoin = "round"; lctx.lineCap = "round";
  // every lane faint, then each lane IN USE lit in its rider's colour - drawn
  // rotated when a split wave rides a rotated copy of it (u.ang)
  PATHS.forEach(path => {
    lctx.strokeStyle = COL.cyan;
    lctx.globalAlpha = 0.05; lctx.lineWidth = 1.2; lctx.stroke(path.p2d);
  });
  for (const u of live) {
    lctx.save();
    lctx.translate(CX, CY); lctx.rotate(u.ang); lctx.translate(-CX, -CY);
    lctx.strokeStyle = COL[u.color];
    lctx.globalAlpha = 0.03 * u.a; lctx.lineWidth = 6; lctx.stroke(PATHS[u.pi].p2d);
    lctx.globalAlpha = 0.3 * u.a; lctx.lineWidth = 1.4; lctx.stroke(PATHS[u.pi].p2d);
    lctx.restore();
  }
  // mask: only alpha matters under destination-in, so transparent -> bg works
  const g = lctx.createRadialGradient(CX, CY, 0, CX, CY, LANE_FADE_R);
  g.addColorStop(0, COL.bg); g.addColorStop(1, "transparent");
  lctx.globalCompositeOperation = "destination-in"; lctx.globalAlpha = 1; lctx.fillStyle = g;
  lctx.fillRect(CX - 4000, CY - 4000, 8000, 8000);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(laneCv, 0, 0); ctx.restore();
}

// numerals sit on an even ring at each lane's nominal 30-degree slot, not
// at the rim crossing: elliptical lanes cross the rim too close to others
const slotAng = i => ((i + 0.5) / N_PATHS) * Math.PI * 2 - Math.PI / 2;
const LABEL_R = 430;
// Labels never overlap (owner): each is placed at its slot, and while its box
// hits one already placed it steps one line DOWN (lower half of the circle)
// or UP (upper half), so crowded slots read as a short list. Lit labels go
// first and keep their spot; idle ones under an identical lit slot are skipped.
function placeLabels(items) {
  const boxes = [];
  for (const it of items) {
    const w = it.text.length * it.size * 0.58, h = it.size * 1.05, dir = it.y < CY ? -1 : 1;
    let y = it.y;
    const hits = () => boxes.some(b => Math.abs(b.x - it.x) * 2 < b.w + w && Math.abs(b.y - y) * 2 < b.h + h);
    for (let n = 0; n < 12 && hits(); n++) y += dir * h;
    boxes.push({ x: it.x, y, w, h });
    ctx.globalAlpha = it.alpha;
    text(it.text, it.x, y, it.size, it.color);
  }
}
// Lit lanes FADE in and out (owner) over LANE_FADE_T real seconds: each
// lane key keeps an alpha `a` easing toward 1 while it has an enemy on it and
// toward 0 after; it is forgotten once fully faded.
const LANE_FADE_T = 0.4, laneFade = new Map();
let laneFadeAt = 0;
function fadeLanes() {
  const now = performance.now() / 1000, step = Math.min(0.1, now - (laneFadeAt || now)) / LANE_FADE_T;
  laneFadeAt = now;
  const live = activeLanes();
  for (const [k, u] of live) {
    const f = laneFade.get(k);
    if (f) Object.assign(f, u, { on: true }); else laneFade.set(k, { ...u, a: 0, on: true });
  }
  for (const [k, f] of laneFade) {
    if (!live.has(k)) f.on = false;
    f.a = Math.max(0, Math.min(1, f.a + (f.on ? step : -step)));
    if (!f.on && f.a <= 0) laneFade.delete(k);
  }
  return [...laneFade.values()];
}
function drawLanes() {
  const live = fadeLanes();
  drawLaneStrokes(live);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // an idle label fades out as a lit one fades in over its slot (and back)
  const litAt = a => live.reduce((m, u) => {
    const b = slotAng(u.pi) + u.ang;
    return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.05 ? Math.max(m, u.a) : m;
  }, 0);
  const items = [];
  // in use: full size and opacity, at the (rotated) slot, in the rider's colour;
  // rim circles are WHITE (owner), labels stay coloured (owner);
  // label = wave:track in roman (owner)
  for (const u of live) {
    const rim = rotAbout(PATHS[u.pi].rim, u.ang), na = slotAng(u.pi) + u.ang;
    ctx.strokeStyle = COL.white; ctx.globalAlpha = u.a; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(rim.x, rim.y, 4, 0, 6.283); ctx.stroke();
    items.push({ text: roman(u.n) + ":" + roman(u.pi + 1), x: CX + Math.cos(na) * LABEL_R, y: CY + Math.sin(na) * LABEL_R, size: 30, alpha: u.a, color: u.color });
  }
  // idle: a small faint label + rim circle per lane
  PATHS.forEach((path, i) => {
    const idle = 1 - litAt(slotAng(i));
    if (idle <= 0.01) return;
    ctx.strokeStyle = COL.white; ctx.globalAlpha = 0.7 * idle; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(path.rim.x, path.rim.y, 4, 0, 6.283); ctx.stroke();
    const na = slotAng(i);
    items.push({ text: roman(Math.max(1, G.wave)) + ":" + roman(i + 1), x: CX + Math.cos(na) * LABEL_R, y: CY + Math.sin(na) * LABEL_R, size: 20, alpha: 0.3 * idle, color: "cyan" });
  });
  placeLabels(items);
  ctx.globalAlpha = 1;
}
