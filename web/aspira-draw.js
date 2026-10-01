// /aspira — canvas rendering. Every colour is a COL key (aspira-defs.js);
// fades are globalAlpha, never a colour with its own alpha.

const cv = document.getElementById("asp-cv"), ctx = cv.getContext("2d");
// The canvas fills the screen; the camera fits the 1000-unit chart into the
// part of it the floating decks leave open (left of the side deck on wide
// screens, above the bottom sheet on phones). cam is in device pixels.
const cam = { k: 1, ox: 0, oy: 0 };
function resize() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const side = document.querySelector(".asp-side").getBoundingClientRect();
  const head = document.querySelector(".asp-head").getBoundingClientRect();
  const wide = side.top - r.top < r.height / 3;
  const x0 = 0, y0 = head.bottom - r.top;
  const x1 = wide ? side.left - r.left : r.width, y1 = wide ? r.height : side.top - r.top;
  const k = Math.min(x1 - x0, y1 - y0) / W;
  cam.k = k * dpr;
  cam.ox = (x0 + (x1 - x0 - W * k) / 2) * dpr;
  cam.oy = (y0 + (y1 - y0 - W * k) / 2) * dpr;
}
new ResizeObserver(resize).observe(cv);
new ResizeObserver(resize).observe(document.querySelector(".asp-side"));

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

function text(str, x, y, size, color) {
  ctx.fillStyle = COL[color]; ctx.font = size + "px " + CANVAS_FONT;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(str, x, y);
}

// The board is drawn as a star chart: a graduated rim in hours, a polar
// graticule, a fixed star field, and the twelve lanes as fine orbit lines
// numbered at their entry like a chart's catalogue labels.
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function drawGraticule() {
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  for (let r = 100; r <= 450; r += 50) { ctx.beginPath(); ctx.arc(CX, CY, r, 0, 6.283); ctx.stroke(); }
  for (let h = 0; h < 24; h++) {
    const a = h * Math.PI / 12 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * BUILD_R, CY + Math.sin(a) * BUILD_R);
    ctx.lineTo(CX + Math.cos(a) * 480, CY + Math.sin(a) * 480);
    ctx.stroke();
  }
  // graduated rim: a tick per degree, longer every 5, hour labels every 2h
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
  for (let h = 0; h < 24; h += 2) {
    const a = h * Math.PI / 12 - Math.PI / 2;
    ctx.globalAlpha = 0.8;
    text(h + "h", CX + Math.cos(a) * 460, CY + Math.sin(a) * 460, 18, "green");
    ctx.globalAlpha = 1;
  }
}

function drawStars() {
  ctx.fillStyle = COL.cyan;
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
function drawLanes() {
  const live = activeLanes();
  ctx.lineJoin = "round";
  PATHS.forEach((path, i) => {
    const col = live.get(i);
    ctx.strokeStyle = COL[col || "cyan"];
    ctx.beginPath(); path.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.setLineDash(LANE_DASH[i >> 1]); ctx.lineCap = "round";
    if (col) {
      ctx.globalAlpha = 0.03; ctx.lineWidth = 6; ctx.stroke();
      ctx.globalAlpha = 0.3; ctx.lineWidth = 1.4; ctx.stroke();
    } else {
      ctx.globalAlpha = 0.05; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.setLineDash([]);
    // a small circle where the lane crosses the rim, catalogue numeral inside it
    const p0 = path.rim, a = Math.atan2(p0.y - CY, p0.x - CX);
    ctx.globalAlpha = col ? 1 : 0.7; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p0.x, p0.y, 4, 0, 6.283); ctx.stroke();
    // numerals sit on an even ring at each lane's nominal 30-degree slot, not
    // at the rim crossing: elliptical lanes cross the rim too close to others
    const na = ((i + 0.5) / N_PATHS) * Math.PI * 2 - Math.PI / 2;
    text(ROMAN[i], CX + Math.cos(na) * 430, CY + Math.sin(na) * 430, 30, col || "cyan");
  });
  ctx.globalAlpha = 1;
}

function drawBoard() {
  drawGraticule();
  drawStars();
  drawLanes();
  drawCells();
  // the build disc: the chart's inner field, dashed boundary
  ctx.strokeStyle = COL.orange; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6;
  ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(CX, CY, BUILD_R, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  // the core, drawn as a sun symbol: circle with a centre dot
  const pulse = 1 + 0.04 * Math.sin(performance.now() / 300);
  ctx.strokeStyle = COL.orange; ctx.lineWidth = 2;
  poly(CX, CY, CORE_R * pulse, 6, Math.PI / 6, false); ctx.stroke();
  text(G.lives, CX, CY + 2, 28, "orange");
}

// A tower is its cell's hexagon, inset a little so neighbours read apart;
// label at the centroid, level pips beneath it.
function drawTower(t, ghost) {
  const b = TOWERS[t.kind], c = CELLS[t.cell], k = 0.88;
  ctx.globalAlpha = ghost ? 0.55 : 1;
  ctx.fillStyle = COL.bg; ctx.strokeStyle = COL[b.color]; ctx.lineWidth = 2; ctx.lineJoin = "round";
  ctx.beginPath();
  c.pts.forEach((p, i) => {
    const x = c.x + (p.x - c.x) * k, y = c.y + (p.y - c.y) * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath(); ctx.fill(); ctx.stroke();
  text(b.ab, c.x, c.y - 3, 15, b.color);
  ctx.fillStyle = COL[b.color];
  for (let i = 0; i < t.lvl; i++) ctx.fillRect(c.x - 11 + i * 4.8, c.y + 8, 3.2, 3.2);
  ctx.globalAlpha = 1;
}

function drawCells() {
  ctx.strokeStyle = COL.orange; ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
  ctx.beginPath();
  for (const c of CELLS) {
    c.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.stroke(); ctx.globalAlpha = 1;
}

// Every tower's reach is always drawn faintly; the selected tower (and the
// build ghost) draws at full strength. dim = the faint pass.
function drawRange(x, y, r, color, dim = false) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
  ctx.fillStyle = COL[color]; ctx.globalAlpha = dim ? 0.025 : 0.08; ctx.fill();
  ctx.strokeStyle = COL[color]; ctx.globalAlpha = dim ? 0.35 : 0.75; ctx.lineWidth = dim ? 1.2 : 2; ctx.stroke();
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
  ctx.strokeStyle = COL[e.slowT > 0 ? "cyan" : d.color]; ctx.lineWidth = 2; ctx.stroke();
  ctx.globalAlpha = 1;
  if (e.stunT > 0) {
    ctx.beginPath(); ctx.arc(e.x, e.y, size + 6, 0, 6.283);
    ctx.strokeStyle = COL.pink; ctx.lineWidth = 1.5; ctx.stroke();
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
      ctx.strokeStyle = COL[f.color]; ctx.lineWidth = f.w + 1;
      ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
    } else if (f.k === "ring") {
      ctx.strokeStyle = COL[f.color]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - k * 0.5), 0, 6.283); ctx.stroke();
    } else if (f.k === "spark") {
      ctx.fillStyle = COL[f.color]; ctx.fillRect(f.x - 1.5, f.y - 1.5, 3, 3);
    } else if (f.k === "text") {
      text(f.text, f.x, f.y, f.size, f.color);
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
  for (const e of G.enemies) drawEnemy(e);
  drawFx("shots");
  for (const t of G.towers) drawTower(t);
  const hc = ui.build && ui.hover ? cellAt(ui.hover.x, ui.hover.y) : -1;
  if (hc >= 0) {
    const b = TOWERS[ui.build], c = CELLS[hc];
    drawRange(c.x, c.y, b.range * (G.power.RNG > 0 ? 1.3 : 1), canPlace(hc) ? b.color : "pink");
    drawTower({ kind: ui.build, cell: hc, lvl: 1 }, true);
  }
  drawFx("text");
  if (bannerT > 0) {
    ctx.globalAlpha = Math.min(1, bannerT);
    text(bannerText, CX, 70, 44, "orange");
    ctx.globalAlpha = 1;
  }
  if (ui.paused && !G.over && G.started) text("paused", CX, CY - BUILD_R - 40, 56, "green");
}
