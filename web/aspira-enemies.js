// /aspira — drawing an ENEMY: its body, outlines, tracer, and the marks the
// towers' upgrades leave on it. Split out of aspira-draw.js (500-line cap);
// same global scope, loaded right after it.

// the bonus STAR trails a shooting-star tracer (owner): ONE filled shape, so
// nothing overlaps and compounds (layered strokes banded where they stacked).
// The tail tapers from the star's width to a point TRAIL behind it along its
// lane, filled with a radial gradient fading out from the star. Fast enemies
// trail a much SHORTER one (owner); only the star adds a shadow-blur glow (a
// whole Fast wave blurring would cost too much).
const TRAIL = { bonus: 160, fast: 48 }, TRAIL_STEP = 6, TRAIL_ALPHA = 0.55;
function drawStarTrail(e, size) {
  const tail = TRAIL[e.type], pts = [];
  for (let d = 0; d <= tail; d += TRAIL_STEP) pts.push(d ? pathAt(e.pi, Math.max(0, e.s - d), e.ang || 0) : { x: e.x, y: e.y });
  const n = pts.length - 1, L = [], R = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const w = size * 0.55 * (1 - i / n), nx = -(b.y - a.y) / len * w, ny = (b.x - a.x) / len * w;
    L.push({ x: pts[i].x + nx, y: pts[i].y + ny }); R.push({ x: pts[i].x - nx, y: pts[i].y - ny });
  }
  const col = COL[ENEMIES[e.type].color], g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, tail);
  g.addColorStop(0, col); g.addColorStop(1, "transparent");
  ctx.beginPath(); ctx.moveTo(L[0].x, L[0].y);
  for (const p of L) ctx.lineTo(p.x, p.y);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i].x, R[i].y);
  ctx.closePath();
  ctx.fillStyle = g; ctx.globalAlpha = TRAIL_ALPHA;
  ctx.shadowColor = col; ctx.shadowBlur = e.type === "bonus" ? size * cam.k : 0;
  ctx.fill();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}
function drawEnemy(e) {
  // damage shows as both size and opacity: full HP = full size, solid;
  // near death = 45% size, faint
  // a ghost (dead enemy) is INVISIBLE: it only carries the beams that follow it
  if (e.dead) return;
  // a boss shrinks all the way with its HP, to nothing at 0% (owner); others keep 45%
  const d = ENEMIES[e.type], f = Math.max(0, e.hp / e.max), size = d.size * (e.arcana ? f : 0.45 + 0.55 * f) * (e.sizeMul || 1);
  if (TRAIL[e.type]) {
    drawStarTrail(e, size);
    // the body is see-through, so blank its shape first: the tracer must not
    // show through the enemy it trails (owner)
    poly(e.x, e.y, size, d.sides, e.rot, d.pointy); ctx.fillStyle = COL.bg; ctx.globalAlpha = 1; ctx.fill();
  }
  poly(e.x, e.y, size, d.sides, e.rot, d.pointy);
  // a boss GLOWS in its colour (owner); the tracer is the boss type's own
  if (e.arcana) { ctx.shadowColor = COL[d.color]; ctx.shadowBlur = 28 * cam.k; }
  ctx.fillStyle = COL[d.color]; ctx.globalAlpha = 0.15 + 0.6 * f; ctx.fill();
  ctx.shadowBlur = 0;
  if (e.arcana) drawBossEye(e, size);
  // outlines brighten as the enemy closes on the core (faint beyond the rim,
  // full at the core), still dimmed by lost HP
  const near = 1 - Math.min(1, Math.max(0, (Math.hypot(e.x - CX, e.y - CY) - CORE_R) / (RIM_R - CORE_R)));
  ctx.globalAlpha = (0.1 + 0.9 * near) * (0.7 + 0.3 * f);
  // armor = a thick outline
  // Permafrost (a slow that never ends) draws the freeze outline thicker (owner)
  const perma = e.slowT === Infinity;
  ctx.strokeStyle = COL[e.slowT > 0 ? "cyan" : d.color]; ctx.lineWidth = (e.armor ? 6.5 : 3) + (perma ? 3 : 0); ctx.stroke();
  // shield = SEGMENTS (owner): one per charge, on rings of its own shape
  if (e.shield > 0 || e.shSegs) {
    e.shSegs = syncSegs(e.shSegs || [], Math.max(0, e.shield), d.sides);
    ctx.lineWidth = 1.8;
    drawSegs(e.x, e.y, e.shSegs, d.sides, e.rot, size, 5);
  }
  ctx.globalAlpha = 1;
  if (e.charged) { // ARC's Static charge: a border in ARC's colour just outside the outline (owner)
    poly(e.x, e.y, size + 4, d.sides, e.rot, false);
    ctx.strokeStyle = COL[TOWERS.chain.color]; ctx.lineWidth = 2; ctx.stroke(); // ARC's colour, whatever it is
  }
  if (e.stunT > 0) {
    ctx.beginPath(); ctx.arc(e.x, e.y, size + 6, 0, 6.283);
    ctx.strokeStyle = COL.pink; ctx.lineWidth = 2.5; ctx.stroke();
  }
  if (e.markT > 0) {
    ctx.fillStyle = COL.orange; ctx.beginPath(); ctx.arc(e.x + size, e.y - size, 4, 0, 6.283); ctx.fill();
  }
  drawStatus(e, d, size);
}

// what the upgrades are doing to an enemy, drawn on it (owner, 2026-10-02):
//   Frostbite  a frost TINT over the body (biteT)
//   Brittle    a white CRACK across it while it is slowed
//   Deep Freeze a frost HEXAGON around it while the 95% chill holds
//   Corrosion  a DOTTED ring tight around it while its armor is being eaten
// (Permafrost's thicker freeze outline is drawn with the outline itself)
function drawStatus(e, d, size) {
  if (e.biteT > 0) {
    poly(e.x, e.y, size, d.sides, e.rot, d.pointy);
    ctx.fillStyle = COL.cyan; ctx.globalAlpha = 0.45 * Math.min(1, e.biteT * 2); ctx.fill();
  }
  // the core's marks (owner: clear animations): Vacuum a dashed white ring;
  // Echo / Resonance a white glow while the bonus holds
  if (e.quenched) {
    ctx.beginPath(); ctx.arc(e.x, e.y, size + 6, 0, 6.283); ctx.setLineDash([3, 4]);
    ctx.strokeStyle = COL.white; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
  }
  if (G.core && coreHas("echo") && G.core.clock < (e.echoUntil || 0)) {
    poly(e.x, e.y, size, d.sides, e.rot, d.pointy);
    ctx.fillStyle = COL.white; ctx.globalAlpha = 0.35 + 0.15 * Math.sin(performance.now() / 90); ctx.fill();
  }
  if (e.brittle > 1 && e.slowT > 0) {
    const s = size * 0.7, c = Math.cos(e.rot), n = Math.sin(e.rot);
    const pt = (u, v) => [e.x + c * u - n * v, e.y + n * u + c * v];
    ctx.beginPath(); ctx.moveTo(...pt(-s, -s * 0.2)); ctx.lineTo(...pt(-s * 0.3, s * 0.25));
    ctx.lineTo(...pt(s * 0.2, -s * 0.25)); ctx.lineTo(...pt(s, s * 0.15));
    ctx.strokeStyle = COL.white; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (e.slows && Object.keys(e.slows).some(k => k.endsWith(":chill"))) {
    poly(e.x, e.y, size + 9, 6, Math.PI / 6, false);
    ctx.strokeStyle = COL.cyan; ctx.globalAlpha = 0.9; ctx.lineWidth = 2.5; ctx.stroke();
  }
  // BLEED (SOL's Impale): a pink outline, for good (owner)
  if (e.bleedCrit > 0) {
    poly(e.x, e.y, size + 4, d.sides, e.rot, d.pointy);
    ctx.strokeStyle = COL.pink; ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.stroke();
  }
  if (e.corrodeT > 0) {
    ctx.beginPath(); ctx.arc(e.x, e.y, size + 3, 0, 6.283);
    ctx.setLineDash([2, 4]); ctx.strokeStyle = COL.chatsubo; ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

// a boss is ringed by a static EYE (owner): an OCTAGON round it, flat sides
// up and down, with its left and right sides left open, so the top and
// bottom halves read as lids; in the boss's colour (red once inverted); it
// never turns with the boss
const EYE_R = 1.9;
function drawBossEye(e, size) {
  const r = size * EYE_R, pts = [];
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; pts.push([e.x + Math.cos(a) * r, e.y + Math.sin(a) * r]); }
  ctx.strokeStyle = COL[ENEMIES[e.type].color]; ctx.globalAlpha = 0.95; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
  // vertices 0..7 from just below the right side, clockwise; sides 7-0 (right) and 3-4 (left) stay open
  for (const lid of [[0, 1, 2, 3], [4, 5, 6, 7]]) {
    ctx.beginPath(); ctx.moveTo(...pts[lid[0]]);
    for (const k of lid.slice(1)) ctx.lineTo(...pts[k]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}


// ---------- SEGMENTED shields (owner, 2026-10-04) ----------
// A shield - an enemy's charges, the core's lives - is SEGMENTS: one per
// charge, each a side of a ring in the shape's own outline, rings stacked
// outward. A lost charge removes a RANDOM remaining segment (a gap stays); a
// gained one goes in at the innermost slot and PUSHES every other segment one
// slot outward. A ring left wholly empty at the outside is dropped. The rings
// breathe with the core's pulse (shieldPulse).
// segs: [true|false, ...], slot 0 = the innermost ring's first side
function syncSegs(segs, n, sides) {
  let have = segs.reduce((a, v) => a + (v ? 1 : 0), 0);
  while (have > n) {
    const live = []; segs.forEach((v, i) => { if (v) live.push(i); });
    segs[live[Math.floor(Math.random() * live.length)]] = false; have--;
  }
  while (have < n) { segs.unshift(true); have++; }
  while (segs.length && segs.slice(-((segs.length - 1) % sides + 1)).every(v => !v)) segs.length -= (segs.length - 1) % sides + 1;
  return segs;
}
const shieldPulse = () => 1 + 0.04 * Math.sin(performance.now() / 300); // the core's own breath
// ring r (0 = inner) has radius base + gap * (r + 1); slot i is side i % sides of ring floor(i / sides)
function drawSegs(x, y, segs, sides, rot, base, gap) {
  const k = shieldPulse();
  ctx.beginPath();
  segs.forEach((on, i) => {
    if (!on) return;
    const r = (base + gap * (Math.floor(i / sides) + 1)) * k, s = i % sides;
    const a0 = rot + s * Math.PI * 2 / sides, a1 = rot + (s + 1) * Math.PI * 2 / sides;
    ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r); ctx.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
  });
  ctx.stroke();
}
