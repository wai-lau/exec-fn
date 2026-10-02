// /aspira — canvas rendering. Every colour is a COL key (aspira-defs.js);
// fades are globalAlpha, never a colour with its own alpha.

const cv = document.getElementById("asp-cv"), ctx = cv.getContext("2d");
// The canvas fills the screen; the camera fits the 1000-unit chart into the
// band between the header and the bottom build bar. cam is in device pixels.
// The default view sits 25% closer than the whole-chart fit (owner, 2026-10-02);
// cam.fit keeps that whole-chart scale, the furthest you can zoom out.
const DEFAULT_ZOOM = 1.25;
const cam = { k: 1, ox: 0, oy: 0, fit: 1 };
function resize() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  // the chart fits between the header (title, stats, controls) and the
  // bottom build bar
  // the controls row, not the whole header: the ten-wave list hangs below it
  // over the board and must not shrink the fit (it zoomed the game out)
  const head = document.querySelector(".asp-controls").getBoundingClientRect();
  const foot = document.querySelector(".asp-bottom").getBoundingClientRect();
  const x0 = 0, y0 = head.bottom - r.top, x1 = r.width, y1 = foot.top - r.top;
  const fit = Math.min(x1 - x0, y1 - y0) / W, k = fit * DEFAULT_ZOOM;
  cam.fit = fit * dpr; cam.k = k * dpr;
  cam.ox = (x0 + (x1 - x0 - W * k) / 2) * dpr;
  cam.oy = (y0 + (y1 - y0 - W * k) / 2) * dpr;
}
// Re-fit ONLY when the canvas itself changes size (window resize). Nothing in
// the overlays — the placing note, a send-wave label rewrapping — may move the
// board (owner: nothing should bump the game).
// (the zoom/pan view in aspira-camera.js resets to this fit on a resize)
new ResizeObserver(() => { resize(); if (typeof fitK !== "undefined") fitK = cam.fit; }).observe(cv);

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

// outline: a thick black stroke wrapped in a soft dark glow (shadow blur)
// under the fill, so overlapping damage numbers stay separate and readable
function text(str, x, y, size, color, outline = false) {
  ctx.font = size + "px " + CANVAS_FONT;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (outline) {
    ctx.save();
    ctx.shadowColor = COL.bg; ctx.shadowBlur = size * 0.7 * cam.k; // shadow is in device px
    ctx.strokeStyle = COL.bg; ctx.lineWidth = size * 0.32; ctx.lineJoin = "round";
    ctx.strokeText(str, x, y); ctx.strokeText(str, x, y);
    ctx.restore();
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

// Stars TWINKLE (owner): each one's brightness breathes on its own rate and
// phase (fixed per star from its index, so the field never reshuffles), on
// real time so it keeps going while paused. Colour never changes.
function drawStars() {
  ctx.fillStyle = COL.white;
  const now = performance.now() / 1000;
  STARS.forEach((st, i) => {
    const rate = 0.6 + ((i * 0.618) % 1) * 1.8, ph = (i * 2.399) % 6.283;
    const tw = 0.5 + 0.5 * Math.sin(now * rate + ph);
    ctx.globalAlpha = Math.min(1, 0.25 + st.m * 0.3) * (0.35 + 0.65 * tw);
    ctx.beginPath(); ctx.arc(st.x, st.y, st.m * (0.85 + 0.15 * tw), 0, 6.283); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// the lanes (strokes, labels, fades) are drawn by aspira-lanes.js

function drawBoard() {
  drawGraticule();
  drawLanes();
  if (ui.build) drawCells(); // the hex grid shows only while placing a tower
}

// the core: a solid white hexagon (gently pulsing), lives in black on it -
// drawn LAST, over everything else (owner)
function drawCore() {
  const pulse = 1 + 0.04 * Math.sin(performance.now() / 300);
  // a core upgrade is open: a slow white ring breathes around it, so it reads
  // as something to click (owner: show the unlock); ZEN's reach while selected
  // the core's LEVEL shows like a tower's (owner): a bold white ring outside
  // it per level, LEVEL_GAP apart, under a glow that grows with the level
  const lvl = coreLvl();
  if (lvl) {
    ctx.strokeStyle = COL.white; ctx.shadowColor = COL.white; ctx.shadowBlur = TOWER_GLOW[lvl] * cam.k; ctx.lineWidth = 3.5;
    for (let r = 1; r <= lvl; r++) {
      ctx.globalAlpha = 1 - 0.12 * r;
      poly(CX, CY, CORE_R * (1 + LEVEL_GAP * r), 6, Math.PI / 6, false); ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  if (coreOpen() && lvl < CORE_MAX) {
    poly(CX, CY, CORE_R * (1 + LEVEL_GAP * (lvl + 1) + 0.08 * Math.sin(performance.now() / 400)), 6, Math.PI / 6, false);
    ctx.strokeStyle = COL.white; ctx.globalAlpha = 0.6; ctx.lineWidth = 2.5; ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (ui.sel === "core" && coreHas("zen")) drawRange(CX, CY, zenR(), "white");
  poly(CX, CY, CORE_R * pulse, 6, Math.PI / 6, false);
  ctx.fillStyle = COL.white; ctx.globalAlpha = 1; ctx.fill();
  text(G.lives, CX, CY + 2, 28, "bg");
}

// A tower is its cell's hexagon, inset a little; its label at the centroid.
// Level shows as concentric rings OUTSIDE it (drawTower).
const TOWER_K = 0.88;
function towerHex(c, k) {
  ctx.beginPath();
  c.pts.forEach((p, i) => {
    const x = c.x + (p.x - c.x) * k, y = c.y + (p.y - c.y) * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
}
// LEVEL READS AT A GLANCE (owner, 2026-10-02): the main hex stays full size
// and each level past L1 adds a BOLD ring OUTSIDE it, LEVEL_GAP further out
// each (the cells are two tiles apart, so there is room), under a glow that
// grows with the level.
const TOWER_GLOW = [8, 20, 34, 52], LEVEL_GAP = 0.24; // glow: shadow blur per level, world px
function drawTower(t, ghost) {
  const b = TOWERS[t.kind], c = CELLS[t.cell];
  const tiers = t.lvl - 1, base = ghost ? 0.55 : 1; // one ring per level above L1
  ctx.fillStyle = COL.bg; ctx.strokeStyle = COL[b.color]; ctx.lineJoin = "round";
  ctx.globalAlpha = base;
  towerHex(c, TOWER_K); ctx.fill();
  ctx.shadowColor = COL[b.color]; ctx.shadowBlur = TOWER_GLOW[t.lvl - 1] * cam.k;
  for (let r = 1; r <= tiers; r++) {
    ctx.globalAlpha = base * (1 - 0.12 * r); ctx.lineWidth = 3.5;
    towerHex(c, TOWER_K + LEVEL_GAP * r); ctx.stroke();
  }
  // the glow stacks one pass per level, since a lone wide shadow thins out
  ctx.globalAlpha = base; ctx.lineWidth = 4.5;
  towerHex(c, TOWER_K);
  for (let i = 0; i < t.lvl; i++) ctx.stroke();
  ctx.shadowBlur = 0;
  text(towerAb(t), c.x, c.y + 1, 13, b.color);
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

// Shown while placing: all six slots at full strength (owner: "fully show"),
// free cells in the colour of the tower being placed (owner), occupied ones grey.
function drawCells() {
  ctx.lineWidth = 2;
  CELLS.forEach((c, ci) => {
    const free = canPlace(ci);
    cellPath(c, 0.94);
    const col = COL[TOWERS[ui.build].color];
    if (free) { ctx.fillStyle = col; ctx.globalAlpha = 0.15; ctx.fill(); }
    ctx.strokeStyle = free ? col : COL.grid; ctx.globalAlpha = free ? 0.8 : 0.4; ctx.stroke();
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

// a tower's range; the Reaper's outer HOLD ring (2x) is not drawn (owner),
// ARC's REACH ring (how far its arcs may land, chainReach) is, dashed (owner)
function drawTowerRange(t, dim) {
  const st = towerStats(t), r = st.range, col = TOWERS[t.kind].color;
  // Moons / Desolation: each moon's slowing circle INSTEAD of the tower's range (owner)
  if (st.moons) { for (const m of moonSpots(t, st)) drawRange(m.x, m.y, r, col, dim); return; }
  drawRange(t.x, t.y, r, col, dim);
  if (t.kind !== "chain") return;
  ctx.beginPath(); ctx.arc(t.x, t.y, chainReach(st), 0, 6.283);
  ctx.strokeStyle = COL[col]; ctx.setLineDash([8, 10]); ctx.lineWidth = dim ? 1.5 : 2.5;
  ctx.globalAlpha = dim ? 0.2 : 0.5; ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

// an area effect's disc (owner): a radial gradient from nothing at the centre
// to GRAD_EDGE (10%) at the outline - Plague/Bloom, Contagion, Whiteout, Shatter, Supernova
const GRAD_EDGE = 0.1; // owner: 50% -> 10%
function gradDisc(x, y, r, col, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "transparent"); g.addColorStop(1, col);
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
  ctx.fillStyle = g; ctx.globalAlpha = GRAD_EDGE * a; ctx.fill();
}
const TWIN_GAP = 3.5; // Charge's twin beams sit this far either side of the line
// Two passes so towers sit on top of their own shots but under the numbers:
// pass "shots" draws beams/rings/sparks, pass "text" draws floating numbers.
// Passes: "dmg" = damage numbers (`under` text), drawn right over the
// background beneath everything else (owner); "shots" = beams/rings/sparks;
// "text" = every other floating text, on top.
function drawFx(pass) {
  for (const f of fx) {
    const kind = f.k !== "text" ? "shots" : f.under ? "dmg" : "text";
    if (kind !== pass) continue;
    // full strength for the first half of the effect's life, then fade out
    const k = 1 - f.t / f.life;
    ctx.globalAlpha = Math.min(1, k * 2);
    if (f.k === "beam") {
      // glow underlay + core, both widening with the damage behind the shot
      ctx.strokeStyle = COL[f.color]; ctx.lineCap = "round";
      // a following beam reads its endpoints live from the tower/enemy it joins
      const x1 = f.a ? f.a.x : f.x1, y1 = f.a ? f.a.y : f.y1, x2 = f.b ? f.b.x : f.x2, y2 = f.b ? f.b.y : f.y2;
      ctx.beginPath();
      if (f.twin) {
        // Charge: two PARALLEL beams, TWIN_GAP apart (owner)
        const len = Math.hypot(x2 - x1, y2 - y1) || 1, ox = -(y2 - y1) / len * TWIN_GAP, oy = (x2 - x1) / len * TWIN_GAP;
        ctx.moveTo(x1 + ox, y1 + oy); ctx.lineTo(x2 + ox, y2 + oy); ctx.moveTo(x1 - ox, y1 - oy); ctx.lineTo(x2 - ox, y2 - oy);
      } else { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      const wm = f.slim ? 0.25 : 1; // slim (SOL): a quarter of a normal beam (owner: doubled from an eighth; the glow scales with it)
      if (f.m) {
        const a = ctx.globalAlpha;
        if (f.slim) {
          // RPR (owner): a super-bright WHITE core in a pink glow that is a
          // GRADIENT - densest at the core, fading out by twice its width.
          // Four nested strokes, widest first, stack into that falloff.
          const core = wm * (f.w + 1) * (0.6 + 0.4 * f.m);
          for (let i = 4; i >= 1; i--) {
            ctx.globalAlpha = a * 0.3; ctx.lineWidth = core * (1 + i * 0.25); ctx.stroke();
          }
        } else {
          ctx.globalAlpha = a * 0.22; ctx.lineWidth = (f.w + 1) * (1 + 2 * f.m); ctx.stroke();
        }
        ctx.globalAlpha = a;
      }
      if (f.slim) { ctx.strokeStyle = COL.white; ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 1.5); }
      ctx.lineWidth = wm * (f.w + 1) * (0.6 + 0.4 * (f.m || 1)); ctx.stroke();
      // Ion: a thin WHITE core down the middle of the arc - it pierces (owner)
      if (f.pierce) { ctx.strokeStyle = COL.white; ctx.lineWidth = Math.max(1, ctx.lineWidth * 0.35); ctx.stroke(); }
    } else if (f.k === "hit") {
      const a = ctx.globalAlpha, rr = f.r * (0.5 + 0.5 * (1 - k));
      ctx.fillStyle = COL[f.color]; ctx.globalAlpha = a * 0.3;
      ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, 6.283); ctx.fill();
      ctx.strokeStyle = COL[f.color]; ctx.globalAlpha = a; ctx.lineWidth = 1 + f.m * 0.6; ctx.stroke();
    } else if (f.k === "flash") {
      // Execute / Verdict: a white flash where the enemy was (owner)
      ctx.fillStyle = COL.white; ctx.globalAlpha = k;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.3 - 0.3 * k), 0, 6.283); ctx.fill();
    } else if (f.k === "blast") {
      // Supernova / Collapse: a filled blast that lingers (owner)
      const a = ctx.globalAlpha, rr = f.r * (0.85 + 0.15 * (1 - k));
      gradDisc(f.x, f.y, rr, COL[f.color], a); // same gradient fill as the other area discs (owner)
      ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, 6.283);
      ctx.strokeStyle = COL[f.color]; ctx.globalAlpha = a; ctx.lineWidth = 2.5; ctx.stroke();
    } else if (f.k === "zen") {
      // Zen's wave: its front spreads to the pulse's reach and FADES TO
      // NOTHING as it gets there (owner)
      const p = Math.min(1, f.t / f.life);
      gradDisc(CX, CY, Math.max(1, f.r * p), COL.white, 1 - p);
    } else if (f.k === "ring") {
      if (f.grad) { const a = ctx.globalAlpha; gradDisc(f.x, f.y, f.r * (1 - k * 0.5), COL[f.color], a); ctx.globalAlpha = a; }
      if (f.outline === false) continue; // Zen's pulse: the gradient wave alone
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
  if (canPlace(hc) && G.money >= towerCost(ui.build)) {
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
    if (t.kind !== "reaper" || !t.locks || !t.period) continue;
    ctx.strokeStyle = COL[TOWERS[t.kind].color];
    for (const l of t.locks) { // each lock's line brightens on its own charge
      if (l.e.dead) continue;
      const p = Math.min(1, Math.max(0, 1 - l.cd / t.period));
      ctx.globalAlpha = 0.32 + 0.32 * p * p; // never below half its full strength (owner)
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(l.e.x, l.e.y); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ACD: each line thin and faint at first, thicker and brighter as its burn
// ramps (a Residue line, out of range, at half strength); Plague's circle
// round each target; Contagion has no lines - its range glows instead.
function drawAcid() {
  ctx.lineCap = "round"; ctx.strokeStyle = COL.chatsubo;
  for (const t of G.towers) {
    if (t.kind !== "acid" || !t.lines || !t.lines.length) continue;
    const st = towerStats(t, true);
    if (st.allInRange) {
      gradDisc(t.x, t.y, st.range, COL.chatsubo);
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(performance.now() / 200); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(t.x, t.y, st.range, 0, 6.283); ctx.stroke();
      continue;
    }
    for (const l of t.lines) {
      if (l.e.dead) continue;
      // Catalyst: the line THROBS, faster the further its burn has ramped (owner)
      const f = acidFrac(l, st), cat = t.path != null && UPGRADES.acid[t.path].name === "Catalyst";
      const k = (Math.hypot(l.e.x - t.x, l.e.y - t.y) > st.range ? 0.5 : 1) *
        (cat ? 0.7 + 0.3 * Math.sin(performance.now() / 1000 * (4 + 20 * f)) : 1);
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(l.e.x, l.e.y);
      ctx.globalAlpha = (0.1 + 0.2 * f) * k; ctx.lineWidth = 3 + 5 * f; ctx.stroke();
      ctx.globalAlpha = (0.6 + 0.4 * f) * k; ctx.lineWidth = 1 + f; ctx.stroke();
      if (st.plagueR) {
        const pr = plagueRadius(l, st);
        gradDisc(l.e.x, l.e.y, pr, COL.chatsubo, k);
        ctx.globalAlpha = (0.15 + 0.25 * f) * k; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(l.e.x, l.e.y, pr, 0, 6.283); ctx.stroke();
      }
    }
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
    if (t.kind !== "slower") continue;
    const st = towerStats(t, true), r = st.range, col = COL[TOWERS[t.kind].color];
    if (st.moons) { drawMoons(t, st, col, shimmer); continue; } // Moons / Desolation: orbiting moons, always shown
    if (!t.links || !t.links.length) continue;
    // Stasis (the slow path): a much THICKER tether (owner)
    const w = t.path != null && UPGRADES.slower[t.path].name === "Stasis" ? 2 : 1;
    for (const e of t.links) {
      if (e.dead || Math.hypot(e.x - t.x, e.y - t.y) > r) continue;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(e.x, e.y);
      ctx.globalAlpha = 0.15 * shimmer; ctx.lineWidth = 6 * w; ctx.stroke();
      ctx.globalAlpha = 0.7 * shimmer; ctx.lineWidth = 1.6 * w; ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// FRZ's Moons / Desolation: each moon a bright body with a small glow, and a
// Stasis-thick tether from the moon (where it is NOW) to the enemy it holds
const MOON_GLOW = 0.35, MOON_GLOW_R = 26;
function drawMoons(t, st, col, shimmer) {
  const spots = moonSpots(t, st);
  for (const { i, e } of t.moonLinks || []) {
    const m = spots[i];
    if (!m || e.dead || Math.hypot(e.x - m.x, e.y - m.y) > st.range) continue;
    ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(e.x, e.y);
    ctx.globalAlpha = 0.15 * shimmer; ctx.lineWidth = 12; ctx.stroke();
    ctx.globalAlpha = 0.7 * shimmer; ctx.lineWidth = 3.2; ctx.stroke();
  }
  for (const m of spots) {
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, MOON_GLOW_R);
    g.addColorStop(0, col); g.addColorStop(1, "transparent");
    ctx.fillStyle = g; ctx.globalAlpha = MOON_GLOW;
    ctx.beginPath(); ctx.arc(m.x, m.y, MOON_GLOW_R, 0, 6.283); ctx.fill();
    ctx.fillStyle = col; ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(m.x, m.y, 8, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// The core taking damage SHAKES the screen (owner): a jolt that decays over
// SHAKE_LEN real seconds. Leaks in a burst re-arm it rather than stacking.
const SHAKE_LEN = 0.35, SHAKE_PX = 14;
let shakeUntil = 0;
function shakeScreen() { shakeUntil = performance.now() / 1000 + SHAKE_LEN; }
function shakeOffset() {
  const left = shakeUntil - performance.now() / 1000;
  if (left <= 0) return [0, 0];
  const a = SHAKE_PX * (window.devicePixelRatio || 1) * (left / SHAKE_LEN);
  return [(Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a];
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, cv.width, cv.height);
  const [sx, sy] = shakeOffset();
  ctx.setTransform(cam.k, 0, 0, cam.k, cam.ox + sx, cam.oy + sy);
  drawFx("dmg"); // damage numbers sit just above the background, under all else
  drawBoard();
  const sel = ui.sel && G.towers.find(t => t.id === ui.sel);
  for (const t of G.towers) if (t !== sel) drawTowerRange(t, true);
  if (sel) drawTowerRange(sel, false);
  // stars go on top of lanes and range fills, which would otherwise tint them
  drawStars();
  for (const e of G.enemies) drawEnemy(e);
  drawTethers();
  drawAcid();
  drawAims();
  drawFx("shots");
  for (const t of G.towers) drawTower(t);
  if (ui.build && ui.hover) drawPlacement();
  drawFx("text");
  if (bannerT > 0) {
    ctx.globalAlpha = Math.min(1, bannerT);
    text(bannerText, CX, 70, 44, bannerCol, true);
    ctx.globalAlpha = 1;
  }
  drawCore();
}
