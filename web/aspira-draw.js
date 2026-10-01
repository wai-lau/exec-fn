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

function drawBoard() {
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, W);
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 1; ctx.globalAlpha = 0.25;
  for (let r = 80; r < 500; r += 70) { ctx.beginPath(); ctx.arc(CX, CY, r, 0, 6.283); ctx.stroke(); }
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(CX + Math.cos(a) * 500, CY + Math.sin(a) * 500); ctx.stroke();
  }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); PATH.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = COL.orange; ctx.globalAlpha = 0.08; ctx.lineWidth = 44; ctx.stroke();
  ctx.globalAlpha = 0.4; ctx.lineWidth = 1.5; ctx.setLineDash([6, 10]); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const pulse = 1 + 0.04 * Math.sin(performance.now() / 300);
  poly(CX, CY, CORE_R * pulse, 8, Math.PI / 8, false);
  ctx.fillStyle = COL.orange; ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = COL.orange; ctx.lineWidth = 2.5; ctx.stroke();
  text(G.lives, CX, CY + 1, 26, "orange");
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
    const k = 1 - f.t / f.life;
    ctx.globalAlpha = k;
    if (f.k === "beam") {
      ctx.strokeStyle = COL[f.color]; ctx.lineWidth = f.w;
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
