// /aspira — canvas rendering. Every colour is a COL key (aspira-defs.js);
// fades are globalAlpha, never a colour with its own alpha.

const cv = document.getElementById("asp-cv"), ctx = cv.getContext("2d");
// The canvas fills the screen; the camera fits the 1000-unit chart into the
// band between the header and the bottom build bar. cam is in device pixels.
const cam = { k: 1, ox: 0, oy: 0 };
function resize() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  // the chart fits between the header (title, stats, controls) and the
  // bottom build bar
  const head = document.querySelector(".asp-head").getBoundingClientRect();
  const foot = document.querySelector(".asp-bottom").getBoundingClientRect();
  const x0 = 0, y0 = head.bottom - r.top, x1 = r.width, y1 = foot.top - r.top;
  const k = Math.min(x1 - x0, y1 - y0) / W;
  cam.k = k * dpr;
  cam.ox = (x0 + (x1 - x0 - W * k) / 2) * dpr;
  cam.oy = (y0 + (y1 - y0 - W * k) / 2) * dpr;
}
new ResizeObserver(resize).observe(cv);
new ResizeObserver(resize).observe(document.querySelector(".asp-head"));
new ResizeObserver(resize).observe(document.querySelector(".asp-bottom"));

function poly(x, y, r, n, rot, star) {
  ctx.beginPath();
  const pts = star ? n * 2 : n;
  for (let i = 0; i < pts; i++) {
    const a = rot + i * Math.PI * 2 / pts, rr = star && i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

// outline: a black stroke under the fill so the text reads over beams/lanes
function text(str, x, y, size, color, outline = false) {
  ctx.font = size + "px " + CANVAS_FONT;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (outline) {
    ctx.strokeStyle = COL.bg; ctx.lineWidth = size * 0.22; ctx.lineJoin = "round";
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = COL[color];
  ctx.fillText(str, x, y);
}

// The board is drawn as a star chart: a graduated rim in hours, a polar
// graticule, a fixed star field, and the twelve lanes as fine orbit lines
// numbered at their entry like a chart's catalogue labels.
function roman(n) {
  const T = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, r] of T) while (n >= v) { out += r; n -= v; }
  return out || "0";
}

function drawGraticule() {
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  for (let r = 125; r <= 375; r += 125) { ctx.beginPath(); ctx.arc(CX, CY, r, 0, 6.283); ctx.stroke(); }
  for (let h = 0; h < 24; h++) {
    const a = h * Math.PI / 12 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * INNER_R, CY + Math.sin(a) * INNER_R);
    ctx.lineTo(CX + Math.cos(a) * 480, CY + Math.sin(a) * 480);
    ctx.stroke();
  }
  // graduated rim: a tick per degree, longer every 5 (no hour labels: owner)
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(CX, CY, 482, 0, 6.283); ctx.stroke();
  ctx.beginPath(); ctx.arc(CX, CY, 494, 0, 6.283); ctx.stroke();
  for (let d = 0; d < 360; d++) {
    const a = d * Math.PI / 180 - Math.PI / 2, len = d % 15 === 0 ? 12 : d % 5 === 0 ? 7 : 3;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * 482, CY + Math.sin(a) * 482);
    ctx.lineTo(CX + Math.cos(a) * (482 + len), CY + Math.sin(a) * (482 + len));
    ctx.stroke();
  }
}

function drawStars() {
  ctx.fillStyle = COL.white;
  for (const st of STARS) {
    ctx.globalAlpha = Math.min(1, 0.25 + st.m * 0.3);
    ctx.beginPath(); ctx.arc(st.x, st.y, st.m, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Lanes in use this wave are drawn bright in the colour of the enemy type
// riding them; idle lanes drop to a faint trace.
// one stroke style per mirror pair (both lanes of a pair match, so the
// pair symmetry holds): solid, dotted, dashed, dash-dot, fine dots, long dash
const LANE_DASH = [[], [0.1, 7], [12, 7], [16, 5, 0.1, 5], [0.1, 4], [28, 9]];
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
  PATHS.forEach((path, i) => {
    const use = live.get(i), col = use && use.color;
    lctx.strokeStyle = COL[col || "cyan"];
    lctx.setLineDash(LANE_DASH[i >> 1]);
    if (col) {
      lctx.globalAlpha = 0.03; lctx.lineWidth = 6; lctx.stroke(path.p2d);
      lctx.globalAlpha = 0.3; lctx.lineWidth = 1.4; lctx.stroke(path.p2d);
    } else {
      lctx.globalAlpha = 0.05; lctx.lineWidth = 1.2; lctx.stroke(path.p2d);
    }
  });
  lctx.setLineDash([]);
  // mask: only alpha matters under destination-in, so transparent -> bg works
  const g = lctx.createRadialGradient(CX, CY, 0, CX, CY, LANE_FADE_R);
  g.addColorStop(0, COL.bg); g.addColorStop(1, "transparent");
  lctx.globalCompositeOperation = "destination-in"; lctx.globalAlpha = 1; lctx.fillStyle = g;
  lctx.fillRect(CX - 4000, CY - 4000, 8000, 8000);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(laneCv, 0, 0); ctx.restore();
}

function drawLanes() {
  const live = activeLanes();
  drawLaneStrokes(live);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  PATHS.forEach((path, i) => {
    const use = live.get(i), col = use && use.color;
    ctx.strokeStyle = COL[col || "cyan"];
    // a small circle where the lane crosses the rim
    const p0 = path.rim;
    ctx.globalAlpha = col ? 1 : 0.7; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p0.x, p0.y, 4, 0, 6.283); ctx.stroke();
    // numerals sit on an even ring at each lane's nominal 30-degree slot, not
    // at the rim crossing: elliptical lanes cross the rim too close to others
    const na = ((i + 0.5) / N_PATHS) * Math.PI * 2 - Math.PI / 2;
    // in use: full size and opacity in the riding type's colour; idle: small, faint
    ctx.globalAlpha = col ? 1 : 0.3;
    // label = wave:track in roman (owner): the riding wave, else the current one
    const label = roman(use ? use.n : Math.max(1, G.wave)) + ":" + roman(i + 1);
    text(label, CX + Math.cos(na) * 430, CY + Math.sin(na) * 430, col ? 30 : 20, col || "cyan");
  });
  ctx.globalAlpha = 1;
}

function drawBoard() {
  drawGraticule();
  drawLanes();
  if (ui.build) drawCells(); // the hex grid shows only while placing a tower
  // the core: a solid white hexagon (gently pulsing), lives in black on it
  const pulse = 1 + 0.04 * Math.sin(performance.now() / 300);
  poly(CX, CY, CORE_R * pulse, 6, Math.PI / 6, false);
  ctx.fillStyle = COL.white; ctx.fill();
  text(G.lives, CX, CY + 2, 28, "bg");
}

// A tower is its cell's hexagon, inset a little so neighbours read apart;
// label at the centroid, level pips beneath it.
// Level reads as CONCENTRIC LAYERS all the way round: each 5-level tier adds
// an outer hex ring. The outermost ring always sits at the cell's usual size
// (TOWER_K) and the main hex shrinks one step per tier, so towers never grow
// into their neighbours. Dots count the levels toward the next ring.
const TOWER_K = 0.88, LAYER_STEP = 0.09;
function towerHex(c, k) {
  ctx.beginPath();
  c.pts.forEach((p, i) => {
    const x = c.x + (p.x - c.x) * k, y = c.y + (p.y - c.y) * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
}
function drawTower(t, ghost) {
  const b = TOWERS[t.kind], c = CELLS[t.cell];
  const tiers = t.lvl - 1, base = ghost ? 0.55 : 1; // one ring per level above L1
  const kMain = TOWER_K - LAYER_STEP * tiers;
  ctx.fillStyle = COL.bg; ctx.strokeStyle = COL[b.color]; ctx.lineJoin = "round";
  ctx.globalAlpha = base;
  towerHex(c, TOWER_K); ctx.fill();
  for (let r = 1; r <= tiers; r++) {
    ctx.globalAlpha = base * (1 - 0.15 * r); ctx.lineWidth = 2.2;
    towerHex(c, kMain + LAYER_STEP * r); ctx.stroke();
  }
  ctx.globalAlpha = base; ctx.lineWidth = 3.5;
  towerHex(c, kMain); ctx.stroke();
  text(b.ab, c.x, c.y + 1, 13, b.color); // centred: no level dots below it any more
  ctx.globalAlpha = 1;
}

function cellPath(c, k = 1) {
  ctx.beginPath();
  c.pts.forEach((p, i) => {
    const x = c.x + (p.x - c.x) * k, y = c.y + (p.y - c.y) * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

// Shown only while placing, and only NEAR THE CURSOR: each cell's opacity is
// (1 - d / 2 tiles)^2, full under the pointer and gone two tiles out. Free
// cells are green, occupied ones orange.
function drawCells() {
  if (!ui.hover) return;
  ctx.lineWidth = 2;
  CELLS.forEach((c, ci) => {
    const w = Math.pow(Math.max(0, 1 - Math.hypot(c.x - ui.hover.x, c.y - ui.hover.y) / (2 * TILE)), 2);
    if (w <= 0.01) return;
    const free = canPlace(ci);
    cellPath(c, 0.94);
    if (free) { ctx.fillStyle = COL.green; ctx.globalAlpha = 0.15 * w; ctx.fill(); }
    ctx.strokeStyle = COL[free ? "green" : "orange"]; ctx.globalAlpha = (free ? 0.8 : 0.4) * w; ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

// pink cross: "can't place here"
function drawBlocked(x, y, r) {
  ctx.strokeStyle = COL.pink; ctx.lineWidth = 3.5; ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.stroke(); ctx.globalAlpha = 1;
}

// Every tower's reach is always drawn faintly; the selected tower (and the
// build ghost) draws at full strength. dim = the faint pass.
function drawRange(x, y, r, color, dim = false) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
  ctx.fillStyle = COL[color]; ctx.globalAlpha = dim ? 0.025 : 0.08; ctx.fill();
  ctx.strokeStyle = COL[color]; ctx.globalAlpha = dim ? 0.35 : 0.75; ctx.lineWidth = dim ? 2 : 3.5; ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawEnemy(e) {
  // damage shows as both size and opacity: full HP = full size, solid;
  // near death = 45% size, faint
  const d = ENEMIES[e.type], f = Math.max(0, e.hp / e.max), size = d.size * (0.45 + 0.55 * f);
  poly(e.x, e.y, size, d.sides, e.rot, d.star);
  ctx.fillStyle = COL[d.color]; ctx.globalAlpha = 0.15 + 0.6 * f; ctx.fill();
  // outlines brighten as the enemy closes on the core (faint beyond the rim,
  // full at the core), still dimmed by lost HP
  const near = 1 - Math.min(1, Math.max(0, (Math.hypot(e.x - CX, e.y - CY) - CORE_R) / (RIM_R - CORE_R)));
  ctx.globalAlpha = (0.1 + 0.9 * near) * (0.7 + 0.3 * f);
  // armor = a thick outline
  ctx.strokeStyle = COL[e.slowT > 0 ? "cyan" : d.color]; ctx.lineWidth = e.armor ? 6.5 : 3; ctx.stroke();
  // shield = up to 3 concentric outlines of the same shape, peeling off as
  // its hits are used up
  if (e.shield > 0) {
    const rings = Math.ceil(3 * e.shield / e.shieldMax);
    ctx.lineWidth = 1.8;
    for (let r = 1; r <= rings; r++) { poly(e.x, e.y, size + 5 * r, d.sides, e.rot, false); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  if (e.stunT > 0) {
    ctx.beginPath(); ctx.arc(e.x, e.y, size + 6, 0, 6.283);
    ctx.strokeStyle = COL.pink; ctx.lineWidth = 2.5; ctx.stroke();
  }
  if (e.markT > 0) {
    ctx.fillStyle = COL.orange; ctx.beginPath(); ctx.arc(e.x + size, e.y - size, 4, 0, 6.283); ctx.fill();
  }
}

// Two passes so towers sit on top of their own shots but under the numbers:
// pass "shots" draws beams/rings/sparks, pass "text" draws floating numbers.
function drawFx(pass) {
  for (const f of fx) {
    if ((f.k === "text") !== (pass === "text")) continue;
    // full strength for the first half of the effect's life, then fade out
    const k = 1 - f.t / f.life;
    ctx.globalAlpha = Math.min(1, k * 2);
    if (f.k === "beam") {
      // glow underlay + core, both widening with the damage behind the shot
      ctx.strokeStyle = COL[f.color]; ctx.lineCap = "round";
      // a following beam reads its endpoints live from the tower/enemy it joins
      ctx.beginPath(); ctx.moveTo(f.a ? f.a.x : f.x1, f.a ? f.a.y : f.y1); ctx.lineTo(f.b ? f.b.x : f.x2, f.b ? f.b.y : f.y2);
      const wm = f.slim ? 0.125 : 1; // slim (RPR): an eighth of a normal beam (owner: 25% of the old half-width), bright glow
      if (f.m) {
        const a = ctx.globalAlpha;
        if (f.slim) {
          // RPR: a hair-thin core inside a big two-layer glow (owner: much
          // more glow) - a wide soft halo, then a brighter inner glow
          ctx.globalAlpha = a * 0.18; ctx.lineWidth = (f.w + 1) * (3 + 5 * f.m); ctx.stroke();
          ctx.globalAlpha = a * 0.5; ctx.lineWidth = (f.w + 1) * (1 + 1.5 * f.m); ctx.stroke();
        } else {
          ctx.globalAlpha = a * 0.22; ctx.lineWidth = (f.w + 1) * (1 + 2 * f.m); ctx.stroke();
        }
        ctx.globalAlpha = a;
      }
      ctx.lineWidth = wm * (f.w + 1) * (0.6 + 0.4 * (f.m || 1)); ctx.stroke();
    } else if (f.k === "hit") {
      const a = ctx.globalAlpha, rr = f.r * (0.5 + 0.5 * (1 - k));
      ctx.fillStyle = COL[f.color]; ctx.globalAlpha = a * 0.3;
      ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, 6.283); ctx.fill();
      ctx.strokeStyle = COL[f.color]; ctx.globalAlpha = a; ctx.lineWidth = 1 + f.m * 0.6; ctx.stroke();
    } else if (f.k === "ring") {
      ctx.strokeStyle = COL[f.color]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - k * 0.5), 0, 6.283); ctx.stroke();
    } else if (f.k === "spark") {
      ctx.fillStyle = COL[f.color]; ctx.fillRect(f.x - 1.5, f.y - 1.5, 3, 3);
    } else if (f.k === "text") {
      ctx.globalAlpha *= f.alpha ?? 1;
      text(f.text, f.x, f.y, f.size, f.color, f.outline);
    }
  }
  ctx.globalAlpha = 1;
}

// The ghost under the pointer: tower + range in its colour when the tap would
// build, a pink cell and cross when it would not (occupied, or too few
// credits), and a bare pink cross off the grid.
function drawPlacement() {
  const hc = snapCell(ui.hover.x, ui.hover.y), b = TOWERS[ui.build];
  if (hc < 0) { drawBlocked(ui.hover.x, ui.hover.y, 12); return; }
  const c = CELLS[hc];
  if (canPlace(hc) && G.money >= b.cost) {
    drawRange(c.x, c.y, towerStats({ kind: ui.build, lvl: 1 }).range, b.color);
    drawTower({ kind: ui.build, cell: hc, lvl: 1 }, true);
    return;
  }
  cellPath(c, 0.94); ctx.fillStyle = COL.pink; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
  drawBlocked(c.x, c.y, 14);
}

// RPR's charge-up: a thin line to the target it is reloading for, fading in
// as the reload fills (alpha ~ progress^2), so the shot is telegraphed.
// It deals nothing; the damage comes with the bright flash on firing.
function drawAims() {
  ctx.lineCap = "round"; ctx.lineWidth = 0.8;
  for (const t of G.towers) {
    if (t.kind !== "reaper" || !t.aim || t.aim.dead || !t.period) continue;
    const p = Math.min(1, Math.max(0, 1 - t.cd / t.period));
    ctx.strokeStyle = COL[TOWERS[t.kind].color]; ctx.globalAlpha = 0.04 + 0.6 * p * p;
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.aim.x, t.aim.y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// SLW's continuous tethers: a live beam from each Slower to every enemy it
// is holding, redrawn each frame so it tracks them; it drops when the enemy
// dies or leaves range. A slow shimmer keeps it reading as a held effect.
function drawTethers() {
  const shimmer = 0.75 + 0.25 * Math.sin(performance.now() / 160);
  ctx.lineCap = "round";
  for (const t of G.towers) {
    if (t.kind !== "slower" || !t.links || !t.links.length) continue;
    const r = towerStats(t, true).range, col = COL[TOWERS[t.kind].color];
    for (const e of t.links) {
      if (e.dead || Math.hypot(e.x - t.x, e.y - t.y) > r) continue;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(e.x, e.y);
      ctx.globalAlpha = 0.15 * shimmer; ctx.lineWidth = 6; ctx.stroke();
      ctx.globalAlpha = 0.7 * shimmer; ctx.lineWidth = 1.6; ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(cam.k, 0, 0, cam.k, cam.ox, cam.oy);
  drawBoard();
  const sel = ui.sel && G.towers.find(t => t.id === ui.sel);
  for (const t of G.towers) if (t !== sel) drawRange(t.x, t.y, towerStats(t).range, TOWERS[t.kind].color, true);
  if (sel) drawRange(sel.x, sel.y, towerStats(sel).range, TOWERS[sel.kind].color);
  // stars go on top of lanes and range fills, which would otherwise tint them
  drawStars();
  for (const e of G.enemies) drawEnemy(e);
  drawTethers();
  drawAims();
  drawFx("shots");
  for (const t of G.towers) drawTower(t);
  if (ui.build && ui.hover) drawPlacement();
  drawFx("text");
  if (bannerT > 0) {
    ctx.globalAlpha = Math.min(1, bannerT);
    text(bannerText, CX, 70, 44, "orange");
    ctx.globalAlpha = 1;
  }
  if (ui.paused && !G.over && G.started) text("paused", CX, CY - INNER_R - 40, 56, "green");
}
