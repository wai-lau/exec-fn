// /aspira — canvas rendering. Every colour is a COL key (aspira-defs.js);
// fades are globalAlpha, never a colour with its own alpha.

const cv = document.getElementById("asp-cv");
let ctx = cv.getContext("2d"); // let: tower sprites and other offscreen draws borrow it
// The canvas fills the screen; the camera fits the 1000-unit chart into the
// band between the header and the bottom build bar. cam is in device pixels.
// The default view sits 25% closer than the whole-chart fit (owner, 2026-10-02);
// cam.fit keeps that whole-chart scale, the furthest you can zoom out.
const DEFAULT_ZOOM = 1.953; // +25% (owner, 2026-10-06; was 1.5625) // 25% closer (owner, 2026-10-04; was 1.25)
// on a PHONE (a portrait band, width the limit) the default view instead fits
// PHONE_HALF units either side of the core across the width (owner, 2026-10-05)
// CORE_TOP: world units from the BOTTOM OF THE STATS ROW down to the core
// (owner, 2026-10-06, from a phone screenshot: was 400 from the top of the
// canvas, which on an iPhone sits under the status bar, so the core rode high)
const PHONE_HALF = 320, CORE_TOP = 416; // zoom +25% (owner, 2026-10-06; were 400 / 520 - the core keeps its spot on screen)
const cam = { k: 1, ox: 0, oy: 0, fit: 1 };
// the canvas draws at most RES_CAP device pixels per CSS pixel (owner: "need
// more perf"): a phone at 3x drew 3.4 million pixels a frame; 2x is 2.25x fewer
// for a barely softer line. EVERY dpr use in the game reads canvasDpr().
const RES_CAP = 2;
const canvasDpr = () => Math.min(window.devicePixelRatio || 1, RES_CAP) * (lowQ ? LOW_RES : 1); // low quality: far fewer pixels (aspira-quality.js)
function resize() {
  const r = cv.getBoundingClientRect(), dpr = canvasDpr();
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  // the chart fits between the header (title, stats, controls) and the
  // bottom build bar
  // the controls row, not the whole header: the ten-wave list hangs below it
  // over the board and must not shrink the fit (it zoomed the game out)
  const head = document.querySelector(".asp-head").getBoundingClientRect(); // the stats row (the speed controls moved to the bottom)
  const foot = document.querySelector(".asp-bottom").getBoundingClientRect();
  const x0 = 0, y0 = head.bottom - r.top, x1 = r.width, y1 = foot.top - r.top;
  const fit = Math.min(x1 - x0, y1 - y0) / W;
  const k = x1 - x0 < y1 - y0 ? (x1 - x0) / (2 * PHONE_HALF) : fit * DEFAULT_ZOOM;
  cam.fit = fit * dpr; cam.k = k * dpr;
  cam.ox = (x0 + (x1 - x0 - W * k) / 2) * dpr;
  // the CORE sits CORE_TOP world units below the stats row (owner) - never
  // LOWER than the middle
  const coreY = Math.min(r.height / 2, y0 + CORE_TOP * k);
  cam.oy = (coreY - CY * k) * dpr;
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
// outline: true = the background colour, or a palette key (the credits' white halo)
const TEXT_BLUR_MIN = 30, TEXT_BLUR_MAX = 8, TEXT_STROKE_MAX = 5;
function text(str, x, y, size, color, outline = false, bold = false) {
  ctx.font = (bold ? "bold " : "") + size + "px " + CANVAS_FONT;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (outline && !(lowQ && size < TEXT_BLUR_MIN)) { // low quality: small text unoutlined
    ctx.save();
    const oc = COL[outline === true ? "bg" : outline];
    // the soft shadow only on BIG text (titles, banners): on the hundreds of
    // small damage numbers a frame it was a large share of late-game frame
    // time (profiled 2026-10-05); the stroked outline stays on all
    // halo and stroke CAPPED (owner: big titles carried a slab of shadow)
    if (size >= TEXT_BLUR_MIN) { ctx.shadowColor = oc; ctx.shadowBlur = Math.min(size * 0.7, TEXT_BLUR_MAX) * cam.k; } // shadow is in device px
    ctx.strokeStyle = oc; ctx.lineWidth = Math.min(size * 0.32, TEXT_STROKE_MAX); ctx.lineJoin = "round";
    ctx.strokeText(str, x, y);
    if (size >= TEXT_BLUR_MIN) ctx.strokeText(str, x, y); // a second, darker pass only on big text (perf: damage numbers)
    ctx.restore();
  }
  ctx.fillStyle = COL[color] || color; // a palette key, or a colour already resolved (the boss title's red)
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

// the GRATICULE (rings, hour spokes, the graduated rim, the ruler) never
// changes for a given camera and palette, so it is drawn ONCE into a cached
// layer and stamped each frame (2026-10-05: it stroked 384 separate paths a
// frame); one cache per palette, the boss sky drawing it inverted
const gratSets = {};
function drawGraticule() {
  const key = [cv.width, cv.height, cam.k, cam.ox, cam.oy].join();
  let g = gratSets[COL.bg];
  if (!g || g.key !== key) {
    g = gratSets[COL.bg] ||= { cv: document.createElement("canvas") };
    g.key = key;
    g.cv.width = cv.width; g.cv.height = cv.height;
    const gx = g.cv.getContext("2d"), main = ctx;
    gx.setTransform(cam.k, 0, 0, cam.k, cam.ox, cam.oy);
    ctx = gx;
    try { drawGraticuleLive(); } finally { ctx = main; }
  }
  const m = ctx.getTransform(); // carries the screen shake: stamp the layer shaken too
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  ctx.drawImage(g.cv, m.e - cam.ox, m.f - cam.oy);
  ctx.restore();
}
function drawGraticuleLive() {
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (let r = 125; r <= 375; r += 125) { ctx.moveTo(CX + r, CY); ctx.arc(CX, CY, r, 0, 6.283); }
  for (let h = 0; h < 24; h++) {
    const a = h * Math.PI / 12 - Math.PI / 2;
    ctx.moveTo(CX + Math.cos(a) * INNER_R, CY + Math.sin(a) * INNER_R);
    ctx.lineTo(CX + Math.cos(a) * 480, CY + Math.sin(a) * 480);
  }
  ctx.stroke();
  // graduated rim: a tick per degree, longer every 5 (no hour labels: owner)
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(CX + 482, CY); ctx.arc(CX, CY, 482, 0, 6.283);
  ctx.moveTo(CX + 494, CY); ctx.arc(CX, CY, 494, 0, 6.283);
  for (let d = 0; d < 360; d++) {
    const a = d * Math.PI / 180 - Math.PI / 2, len = d % 15 === 0 ? 12 : d % 5 === 0 ? 7 : 3;
    ctx.moveTo(CX + Math.cos(a) * 482, CY + Math.sin(a) * 482);
    ctx.lineTo(CX + Math.cos(a) * (482 + len), CY + Math.sin(a) * (482 + len));
  }
  ctx.stroke();
  drawScaleBar();
}
// the chart's ruler (drawScaleBar) lives in aspira-lanes.js

// the lanes (strokes, labels, fades) are drawn by aspira-lanes.js

function drawBoard() {
  drawGraticule();
  drawLanes();
  drawCells(); if (!G.towers.length && !ui.build) drawSlotArrow(); // slot outlines (owner); before the first tower an arrow points at one (aspira-chooser.js)
}

// the core: a solid white hexagon (gently pulsing), lives in black on it -
// drawn LAST, over everything else (owner)
function drawCore() {
  const pulse = 1 + 0.04 * Math.sin(performance.now() / 300);
  // Fortifications: the core takes on the copied tower's colour, every ring of it (owner)
  const cw = COL.white;
  // a core power waits to be chosen: a slow white ring breathes around it, so it
  // reads as something to click (owner: show the unlock)
  // the core's LEVEL shows like a tower's (owner): a bold white ring outside
  // it per level, LEVEL_GAP apart, under a glow that grows with the level
  const lvl = Math.round(coreLvl() / CORE_TIERS); // one ring per power owned
  // LIVES drawn like an enemy's shield (owner): SEGMENTS of the core's own hex,
  // one per life, no number (aspira-enemies.js syncSegs / drawSegs)
  G.lifeFlash = G.lifeFlash || [];
  G.lifeSegs = syncSegs(G.lifeSegs || [], Math.max(0, G.lives), 6, G.lifeFlash);
  ctx.strokeStyle = cw; ctx.lineWidth = 2.6; // thicker (owner; was 1.8)
  drawSegs(CX, CY, G.lifeSegs, 6, Math.PI / 6, CORE_R, LIFE_GAP, G.lifeFlash); // a lost life flashes red
  const out = LIFE_GAP * LIFE_RINGS / CORE_R; // the level rings sit outside the life rings
  if (lvl) {
    ctx.strokeStyle = cw; ctx.shadowColor = cw; ctx.shadowBlur = TOWER_GLOW[lvl] * cam.k; ctx.lineWidth = 3.5;
    for (let r = 1; r <= lvl; r++) {
      ctx.globalAlpha = 1 - 0.12 * r;
      poly(CX, CY, CORE_R * (1 + out + LEVEL_GAP * r) * shieldPulse(), 6, Math.PI / 6, false); ctx.stroke(); // breathes with the life rings (owner)
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  if (corePicks() > 0) {
    poly(CX, CY, CORE_R * (1 + out + LEVEL_GAP * (lvl + 1) + 0.08 * Math.sin(performance.now() / 400)), 6, Math.PI / 6, false);
    ctx.strokeStyle = cw; ctx.globalAlpha = 0.6; ctx.lineWidth = 2.5; ctx.stroke(); ctx.globalAlpha = 1;
  }
  poly(CX, CY, CORE_R * pulse, 6, Math.PI / 6, false);
  ctx.fillStyle = cw; ctx.globalAlpha = 1; ctx.fill();
}
const LIFE_RINGS = 5, LIFE_GAP = 3.75; // (5 before the 25% shrink) // room kept for 5 rings of life segments (20 lives fill 3 and a bit)

function drawTower(t, ghost) {
  // drawn where the tower IS (it slides along its spoke), its slot's hex moved with it
  const b = TOWERS[t.kind], c0 = CELLS[t.cell], x = t.x ?? c0.x, y = t.y ?? c0.y;
  // its glowing body is a cached SPRITE (towerSprite): the glow is a shadow blur
  // stroked once per level, and at max level that was by far the costliest
  // draw of a late-game frame (profiled 2026-10-05). Stamped here 1:1 with the
  // canvas's pixels, then the label on top.
  const sp = towerSprite(t.kind, shownLvl(t), c0), w = sp.width / cam.k; // a chart tower's 9 points drawn as 4 glows
  ctx.globalAlpha = ghost ? 0.55 : 1;
  ctx.drawImage(sp, x - w / 2, y - w / 2, w, w);
  // as BIG as fits (owner): every label is 3 monospace letters, 1.5 em wide, and
  // the hex is ~44 across inside its outline: 28 fits, 23 sits easier (owner: "reduce a bit"; was 12)
  // after TWO chart points the label gives way to the tower's STAT TRIANGLE
  // (owner, 2026-10-06; boardChart, aspira-skills.js) - the build at a glance
  if (hasSkills(t)) boardChart(t, x, y, ghost ? 0.55 : 1, c0); // ALWAYS the triangle, never the label (owner; was from the first point)
  else text(towerAb(t), x, y + 1, TOWER_LABEL_PX, b.color, false, true);
  ctx.globalAlpha = 1;
}
// one sprite per kind + level + colours + zoom + the hex's turn (Horizon orbits
// the slots), drawn exactly as the tower used to be drawn each frame
const SOL_BEAM_W = 0.9, SOL_GLOW_A = 0.45 /* (bolder 1.2 / 0.7 tried 2026-10-07 and reverted - owner: "SOL was OK before") */, TOWER_LINE = 2.6, towerSprites = new Map(), TOWER_LABEL_PX = 23;
function towerSprite(kind, lvl, c0) {
  const b = TOWERS[kind], turn = Math.round(Math.atan2(c0.pts[0].y - c0.y, c0.pts[0].x - c0.x) * 90 / Math.PI); // 2-degree steps
  const key = [kind, lvl, COL[b.color], COL.bg, cam.k.toFixed(4), turn].join("|");
  let sp = towerSprites.get(key);
  if (sp) return sp;
  if (towerSprites.size > 300) towerSprites.clear();
  // ONE hex, no level rings and no max-level spokes (owner, 2026-10-07): the level
  // shows only in the glow, the build in the chart drawn on it (boardChart)
  const reach = CELL_S * TOWER_K + 4 + TOWER_GLOW[lvl - 1] * 1.6;
  sp = document.createElement("canvas");
  sp.width = sp.height = Math.ceil(2 * reach * cam.k);
  const sx = sp.getContext("2d"), main = ctx;
  sx.setTransform(cam.k, 0, 0, cam.k, sp.width / 2, sp.height / 2);
  const c = { x: 0, y: 0, pts: c0.pts.map(p => ({ x: p.x - c0.x, y: p.y - c0.y })) };
  ctx = sx;
  try {
    ctx.fillStyle = COL.bg; ctx.strokeStyle = COL[b.color]; ctx.lineJoin = "round"; ctx.globalAlpha = 1;
    towerHex(c, TOWER_K); ctx.fill(); // the background colour under the tower (owner)
    ctx.shadowColor = COL[b.color]; ctx.shadowBlur = TOWER_GLOW[lvl - 1] * cam.k;
    // the glow stacks one pass per level, since a lone wide shadow thins out
    ctx.globalAlpha = 1; ctx.lineWidth = TOWER_LINE; // thinner (owner, 2026-10-06; was 4.5)
    towerHex(c, TOWER_K);
    for (let i = 0; i < lvl; i++) ctx.stroke();
  } finally { ctx = main; }
  towerSprites.set(key, sp);
  return sp;
}

function cellPath(c, k = 1) {
  ctx.beginPath();
  c.pts.forEach((p, i) => {
    const x = c.x + (p.x - c.x) * k, y = c.y + (p.y - c.y) * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

// Shown while placing: every OPEN slot at full strength (owner: "fully show"),
// free cells in the colour of the tower being placed (owner), occupied ones grey.
const SLOT_POOR_A = 0.3; // a free slot's outline and price when the bank cannot cover a tower
function drawCells() {
  ctx.lineWidth = 2;
  CELLS.forEach((c, ci) => {
    if (!cellOpen(ci)) return; // a corner slot shows once its wave opens it
    const free = canPlace(ci);
    // before the first tower the free slots FLASH (owner; the build buttons used to)
    // a slot the bank cannot fill is FADED (owner, 2026-10-07), its price too
    if (!ui.build) { if (free) { const poor = G.money < towerCost("arc"), fade = poor ? SLOT_POOR_A : 1; cellPath(c, TOWER_K); ctx.strokeStyle = COL.white; ctx.lineWidth = 3.5; ctx.globalAlpha = fade * (G.towers.length ? 0.55 : 0.6 + 0.4 * Math.sin(performance.now() / 250)); ctx.stroke(); ctx.lineWidth = 2; ctx.globalAlpha = 0.9 * fade; text(towerCost("arc") + "c", c.x, c.y, 14, "white"); } return; } // thicker, more opaque; the build price inside (owner)
    cellPath(c, TOWER_K);
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
  if (dim && lowQ) return; // low quality: no faint rings
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
  // only the SELECTED tower's disc is filled: a dim one's 2.5% fill was all
  // but invisible, and nine big discs (three a moon tower) were the costliest
  // single draw of a late frame (2026-10-05)
  if (!dim) { ctx.fillStyle = COL[color]; ctx.globalAlpha = 0.08; ctx.fill(); }
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
  // a chart FRZ's moon ORBIT, drawn like its range (owner, 2026-10-08): faint always, bright when selected
  if (st.moonN && !(dim && lowQ)) { const o = moonOrbit(t, st.moonN); ctx.beginPath(); ctx.ellipse(o.x, o.y, o.a, o.b, o.phi, 0, 6.283); ctx.strokeStyle = COL[col]; ctx.globalAlpha = dim ? 0.35 : 0.75; ctx.lineWidth = dim ? 2 : 3.5; ctx.stroke(); ctx.globalAlpha = 1; }
  if (t.kind !== "arc") return;
  if (st.skill) return; // a chart ARC has no reach from the tower: each jump reaches from its own enemy (owner)
  ctx.beginPath(); ctx.arc(t.x, t.y, chainReach(st), 0, 6.283);
  ctx.strokeStyle = COL[col]; ctx.setLineDash([8, 10]); ctx.lineWidth = dim ? 1.5 : 2.5;
  ctx.globalAlpha = dim ? 0.2 : 0.5; ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

// an area effect's disc (owner): a radial gradient from nothing at the centre
// to GRAD_EDGE (10%) at the outline - Plague/Bloom, Contagion, Whiteout, Shatter, Supernova
const GRAD_EDGE = 0.1; // owner: 50% -> 10%
function gradDisc(x, y, r, col, a = 1) {
  if (lowQ) return; // low quality: no gradient discs
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "transparent"); g.addColorStop(1, col);
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
  ctx.fillStyle = g; ctx.globalAlpha = GRAD_EDGE * a; ctx.fill();
}
const DMG_HOLD = 0.1; // s a damage number stays whole before it shrinks + fades (owner: 0.5 was too long)
const TWIN_GAP = 3.5; // Charge's parallel beams sit 2 x this apart
// Two passes so towers sit on top of their own shots but under the numbers:
// pass "shots" draws beams/rings/sparks, pass "text" draws floating numbers.
// Passes: "dmg" = damage numbers (`under` text), drawn right over the
// background beneath everything else (owner); "shots" = beams/rings/sparks;
// "text" = every other floating text, on top.
function drawFx(pass) {
  for (const f of fx) {
    const kind = f.k !== "text" ? "shots" : f.under ? "dmg" : "text";
    if (kind !== pass || f.t >= f.life || (lowQ && (kind === "dmg" || LOW_SKIP_FX[f.k]))) continue; // a retired damage number (dmgNumber) is not drawn; low quality skips the decoration
    // full strength for the first half of the effect's life, then fade out
    const k = 1 - f.t / f.life;
    ctx.globalAlpha = Math.min(1, k * 2);
    if (f.k === "beam") {
      ctx.globalAlpha = Math.min(1, ctx.globalAlpha * (f.alpha ?? 1) * BEAM_BRIGHT); // ARC: an arc as opaque as its damage share; x BEAM_BRIGHT (owner)
      // glow underlay + core, both widening with the damage behind the shot
      ctx.strokeStyle = COL[f.color]; ctx.lineCap = "round";
      // a following beam reads its endpoints live from the tower/enemy it joins
      const x1 = f.a ? f.a.x : f.x1, y1 = f.a ? f.a.y : f.y1, x2 = f.b ? f.b.x : f.x2, y2 = f.b ? f.b.y : f.y2;
      ctx.beginPath();
      if (f.beams > 1) {
        // Charge / Quad / Horizon: n beams, 2 x TWIN_GAP apart at the tower,
        // CONVERGING on the enemy (owner)
        const len = Math.hypot(x2 - x1, y2 - y1) || 1, px = -(y2 - y1) / len, py = (x2 - x1) / len;
        for (let i = 0; i < f.beams; i++) {
          const o = (i - (f.beams - 1) / 2) * 2 * TWIN_GAP;
          ctx.moveTo(x1 + px * o, y1 + py * o); ctx.lineTo(x2, y2);
        }
      } else { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      // the core's width is the DAMAGE of this hit (owner: every tower) - a
      // multi-beam shot's beams each carry the whole hit (rayHit)
      const core = (f.soft ? BEAM_MIN + (beamWidth(f.d || 0) - BEAM_MIN) * ARC_W_CORR : beamWidth(f.d || 0)) * (f.thin || 1); // (soft: a chart ARC's, flatter with damage - aspira-skills.js; thin: its leaps)
      if (f.m && !lowQ) { // low quality: the beam's core only, no glow passes
        const a = ctx.globalAlpha;
        if (f.slim) {
          // RPR (owner): a super-bright WHITE core in a pink glow that is a
          // GRADIENT - densest at the core, fading out by twice its width.
          // Four nested strokes, widest first, stack into that falloff.
          for (let i = 4; i >= 1; i--) {
            ctx.globalAlpha = Math.min(1, a * SOL_GLOW_A * BEAM_BRIGHT); ctx.lineWidth = core * SOL_BEAM_W * (1 + i * 0.25); ctx.stroke(); // SOL: thicker, more opaque (owner, 2026-10-06; was 0.5 wide, 0.3)
          }
        } else {
          ctx.globalAlpha = Math.min(1, a * (f.soft ? ARC_GLOW_A : 0.22) * BEAM_BRIGHT); ctx.lineWidth = core * (f.soft ? ARC_GLOW_W : 3); ctx.stroke(); // soft: a chart ARC's (aspira-skills.js)
        }
        ctx.globalAlpha = a;
      }
      if (f.slim) { ctx.strokeStyle = COL.white; ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 1.5); }
      ctx.lineWidth = f.slim ? core * SOL_BEAM_W : core; ctx.stroke();
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
      ctx.strokeStyle = COL[f.color]; ctx.lineWidth = f.w || 2; if (f.a) ctx.globalAlpha *= f.a; // a: a fainter ring (Capacitance's burst)
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - k * 0.5), 0, 6.283); ctx.stroke();
    } else if (f.k === "cone") {
      drawCone(f, k); // SOL's Refract light cone (aspira-skills.js)
    } else if (f.k === "spark") {
      ctx.fillStyle = COL[f.color]; ctx.fillRect(f.x - 1.5, f.y - 1.5, 3, 3);
    } else if (f.k === "text") {
      // a DAMAGE number holds DMG_HOLD s, then shrinks and fades together, at
      // the same rate, to nothing at the end of its life (owner)
      const sh = f.under || f.shrink; // the kill's "+Nc" too (owner)
      const g = sh ? (f.t < DMG_HOLD ? 1 : Math.max(0, (f.life - f.t) / Math.max(0.01, f.life - DMG_HOLD))) : 1;
      if (sh) ctx.globalAlpha = g;
      ctx.globalAlpha *= f.alpha ?? 1;
      text(f.text, f.x, f.y, f.size * g, f.color, f.outline);
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
  cellPath(c, TOWER_K); ctx.fillStyle = COL.pink; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
  drawBlocked(c.x, c.y, 14);
}

// The core taking damage SHAKES the screen (owner): a jolt that decays over
// SHAKE_LEN real seconds. Leaks in a burst re-arm it rather than stacking.
const SHAKE_LEN = 0.35, SHAKE_PX = 14;
let shakeUntil = 0;
function shakeScreen() { shakeUntil = performance.now() / 1000 + SHAKE_LEN; }
function shakeOffset() {
  const left = shakeUntil - performance.now() / 1000;
  if (left <= 0) return [0, 0];
  const a = SHAKE_PX * canvasDpr() * (left / SHAKE_LEN);
  return [(Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a];
}

// The BOSS SKY (owner, round 3, 2026-10-05: the overlay was still "very
// laggy"): no blending or filters at all. With the sky full the frame is simply
// DRAWN in inverted colours (withPalette); while it spreads or collapses, the
// normal frame is drawn and then the inverted one again, CLIPPED to the circle
// - two plain draws, nothing composited. Towers and their tracks keep their
// own colours either way (ownColours).
function render() {
  bossSkyStep(); // the sky's state: phase, radius, full (aspira-bosses.js)
  const shake = shakeOffset(), sky = bossInv.phase !== "off";
  if (sky && (bossInv.full || (lowQ && bossInv.r > 1))) { withPalette(() => drawScene(shake, 0)); return; } // low quality: the sky snaps, one draw
  drawScene(shake, 0);
  if (sky && bossInv.r > 1) withPalette(() => drawScene(shake, bossInv.r));
}
function drawScene([sx, sy], clipR) {
  ctx.setTransform(cam.k, 0, 0, cam.k, cam.ox + sx, cam.oy + sy);
  ctx.save();
  if (clipR) { ctx.beginPath(); ctx.arc(bossInv.x, bossInv.y, clipR, 0, 6.283); ctx.clip(); }
  ctx.fillStyle = COL.bg; ctx.globalAlpha = 1; ctx.fillRect(CX - 4000, CY - 4000, 8000, 8000);
  drawFx("dmg"); // damage numbers just above the background, under all else (the cooldown dial moved to buttons above the title - aspira-powers.js)
  drawBoard();
  drawBossBar(); // a live boss's HP line along the horizon, UNDER the towers and their effects (owner)
  const sel = ui.sel && G.towers.find(t => t.id === ui.sel);
  for (const t of G.towers) if (t !== sel) drawTowerRange(t, true);
  if (sel) drawTowerRange(sel, false);
  // stars go on top of lanes and range fills, which would otherwise tint them
  if (!lowQ) drawStars(); // low quality: no star field
  drawTethers();
  drawAcd();
  drawAims();
  drawFx("shots");
  drawCoreFx(); // the core's struts and beams, under the towers (aspira-core.js)
  ownColours(() => { drawSpokes(); for (const t of G.towers) drawTower(t); drawRelayArm(); }); // towers keep their colours on a boss sky (owner); an armed Relay rings them (aspira-powers.js)
  drawSlotFlash(); // a corner slot that just opened (aspira-waves.js)
  if (ui.build && ui.hover) drawPlacement();
  drawCore();
  drawCredits(); // ON the core, so after it (aspira-waves.js)
  // ENEMIES over the towers and the core (owner)
  for (const e of G.enemies) drawEnemy(e);
  drawCoreHud(); // the core powers' dial, freeze, copy and halos, over everything (aspira-core-fx.js)
  drawFx("text");
  if (bannerT > 0) {
    ctx.globalAlpha = Math.min(1, bannerT);
    text(bannerText, CX, 70, 30, bannerCol, true); // smaller (owner, 2026-10-06; was 44)
    ctx.globalAlpha = 1;
  }
  drawBossTitle(); // the boss's name + subtitle, over the towers (owner)
  ctx.restore();
}
// the whole palette inverted while fn draws (invertColor keeps alpha); the
// inverted set is built once, COL being fixed after resolveColors
let colOwn = null, colInv = null, inverted = false;
function withPalette(fn) {
  colOwn ||= { ...COL };
  colInv ||= Object.fromEntries(Object.entries(colOwn).map(([k, v]) => [k, invertColor(v)]));
  Object.assign(COL, colInv); inverted = true;
  try { fn(); } finally { Object.assign(COL, colOwn); inverted = false; }
}
function ownColours(fn) {
  if (!inverted) { fn(); return; }
  Object.assign(COL, colOwn);
  try { fn(); } finally { Object.assign(COL, colInv); }
}
