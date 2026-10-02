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
// the FAINT trace of all twelve lanes never changes, so it is drawn once into
// baseCv and only redrawn when the camera or the canvas size moves (it was
// most of every frame: ~300ms of ~1s in headless WebKit, 2026-10-02)
const baseCv = document.createElement("canvas"), bctx = baseCv.getContext("2d");
let baseKey = "";
function laneLayer(c, x, w, h) {
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over";
  x.clearRect(0, 0, w, h);
  x.setTransform(cam.k, 0, 0, cam.k, cam.ox, cam.oy);
  x.lineJoin = "round"; x.lineCap = "round";
}
// mask: only alpha matters under destination-in, so transparent -> bg works
function laneMask(x) {
  const g = x.createRadialGradient(CX, CY, 0, CX, CY, LANE_FADE_R);
  g.addColorStop(0, COL.bg); g.addColorStop(1, "transparent");
  x.globalCompositeOperation = "destination-in"; x.globalAlpha = 1; x.fillStyle = g;
  x.fillRect(CX - 4000, CY - 4000, 8000, 8000);
}
function blit(c) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(c, 0, 0); ctx.restore(); }
function drawLaneStrokes(live) {
  const key = [cv.width, cv.height, cam.k, cam.ox, cam.oy].join();
  if (key !== baseKey) {
    baseKey = key;
    laneLayer(baseCv, bctx, cv.width, cv.height);
    bctx.strokeStyle = COL.cyan; bctx.globalAlpha = 0.05; bctx.lineWidth = 1.2;
    for (const path of PATHS) bctx.stroke(path.p2d);
    laneMask(bctx);
  }
  blit(baseCv);
  if (!live.length) return;
  // each lane IN USE lit in its rider's colour - drawn rotated when a split
  // wave rides a rotated copy of it (u.ang)
  laneLayer(laneCv, lctx, cv.width, cv.height);
  for (const u of live) {
    lctx.save();
    lctx.translate(CX, CY); lctx.rotate(u.ang); lctx.translate(-CX, -CY);
    // the bonus STAR's lane burns three times as bright as the rest (owner)
    const k = u.star ? 3 : 1;
    lctx.strokeStyle = COL[u.color];
    lctx.globalAlpha = 0.03 * k * u.a; lctx.lineWidth = 6; lctx.stroke(PATHS[u.pi].p2d);
    lctx.globalAlpha = 0.3 * k * u.a; lctx.lineWidth = 1.4; lctx.stroke(PATHS[u.pi].p2d);
    lctx.restore();
  }
  laneMask(lctx);
  blit(laneCv);
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
// Lit lanes are as bright as the share of their group still alive (owner:
// alive / sent, from activeLanes) - no timed fade any more.
function litLanes() { return [...activeLanes().values()]; }
function drawLanes() {
  const live = litLanes();
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
