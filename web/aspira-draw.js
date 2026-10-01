// /aspira — canvas rendering. Every colour is a COL key (aspira-defs.js);
// fades are globalAlpha, never a colour with its own alpha.

const cv = document.getElementById("asp-cv"), ctx = cv.getContext("2d");
let scale = 1;
function resize() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  scale = cv.width / W;
}
new ResizeObserver(resize).observe(cv);

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
    text(h + "h", CX + Math.cos(a) * 466, CY + Math.sin(a) * 466, 11, "grid");
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
function drawLanes() {
  const live = activeLanes();
  ctx.lineJoin = "round";
  PATHS.forEach((path, i) => {
    const col = live.get(i);
    ctx.strokeStyle = COL[col || "cyan"];
    ctx.beginPath(); path.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (col) {
      ctx.globalAlpha = 0.06; ctx.lineWidth = 6; ctx.stroke();
      ctx.globalAlpha = 0.45; ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      ctx.globalAlpha = 0.08; ctx.lineWidth = 1; ctx.stroke();
    }
    // a small circle at entry, catalogue numeral just outside it
    const p0 = path.pts[0], a = Math.atan2(p0.y - CY, p0.x - CX);
    ctx.globalAlpha = col ? 0.7 : 0.3; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p0.x, p0.y, 4, 0, 6.283); ctx.stroke();
    text(ROMAN[i], CX + Math.cos(a) * 448, CY + Math.sin(a) * 448, 12, col || "cyan");
  });
  ctx.globalAlpha = 1;
}

function drawBoard() {
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, W);
  drawGraticule();
  drawStars();
  drawLanes();
  // the build disc: the chart's inner field, dashed boundary
  ctx.strokeStyle = COL.orange; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6;
  ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(CX, CY, BUILD_R, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  // the core, drawn as a sun symbol: circle with a centre dot
  const pulse = 1 + 0.04 * Math.sin(performance.now() / 300);
  ctx.strokeStyle = COL.orange; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(CX, CY, CORE_R * pulse, 0, 6.283); ctx.stroke();
  text(G.lives, CX, CY + 1, 24, "orange");
}

function drawTower(t, ghost) {
  const b = TOWERS[t.kind];
  ctx.globalAlpha = ghost ? 0.55 : 1;
  ctx.fillStyle = COL.bg; ctx.strokeStyle = COL[b.color]; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(t.x - 18, t.y - 18, 36, 36, 6); ctx.fill(); ctx.stroke();
  text(b.ab, t.x, t.y - 3, 12, b.color);
  ctx.fillStyle = COL[b.color];
  for (let i = 0; i < t.lvl; i++) ctx.fillRect(t.x - 12 + i * 5.6, t.y + 9, 3.5, 3.5);
  ctx.globalAlpha = 1;
}

function drawRange(x, y, r, color) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
  ctx.fillStyle = COL[color]; ctx.globalAlpha = 0.08; ctx.fill();
  ctx.strokeStyle = COL[color]; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawEnemy(e) {
  const d = ENEMIES[e.type], f = Math.max(0, e.hp / e.max);
  poly(e.x, e.y, d.size, d.sides, e.rot, d.star);
  ctx.fillStyle = COL[d.color]; ctx.globalAlpha = 0.15 + 0.6 * f; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = COL[e.slowT > 0 ? "cyan" : d.color]; ctx.lineWidth = 2; ctx.stroke();
  if (e.stunT > 0) {
    ctx.beginPath(); ctx.arc(e.x, e.y, d.size + 6, 0, 6.283);
    ctx.strokeStyle = COL.pink; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (e.markT > 0) {
    ctx.fillStyle = COL.orange; ctx.beginPath(); ctx.arc(e.x + d.size, e.y - d.size, 4, 0, 6.283); ctx.fill();
  }
}

function drawFx() {
  for (const f of fx) {
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
      text(f.text, f.x, f.y, 18, f.color);
    }
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawBoard();
  const sel = ui.sel && G.towers.find(t => t.id === ui.sel);
  if (sel) drawRange(sel.x, sel.y, towerStats(sel).range, TOWERS[sel.kind].color);
  for (const t of G.towers) drawTower(t);
  for (const e of G.enemies) drawEnemy(e);
  if (ui.build && ui.hover) {
    const ok = canPlace(ui.hover.x, ui.hover.y), b = TOWERS[ui.build];
    drawRange(ui.hover.x, ui.hover.y, b.range * (G.power.RNG > 0 ? 1.3 : 1), ok ? b.color : "pink");
    drawTower({ kind: ui.build, x: ui.hover.x, y: ui.hover.y, lvl: 1 }, true);
  }
  drawFx();
  if (bannerT > 0) {
    ctx.globalAlpha = Math.min(1, bannerT);
    text(bannerText, CX, 60, 30, "orange");
    ctx.globalAlpha = 1;
  }
  if (ui.paused && !G.over && G.started) text("paused", CX, CY - 100, 40, "green");
}
