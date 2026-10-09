// /spire — SHIELDS AS 3D WALLS in the 3D view (owner, 2026-10-09: "make all the shields and stuff 3d objects too,
// this way they occlude where expected"): the core's life segments and level rings and an enemy's shield segments
// are short walls standing on the floor, centred on it, and split at the object they guard - the walls BEHIND it
// drawn before it, the ones IN FRONT after - so the core's prism and a die hide and are hidden as they should.
// Loaded after aspira-warp.js and aspira-solids.js.
const WALL_H = { core: 3, enemy: 2 }; // half heights, world units

// the live segments of a shield (drawSegs's geometry): each { a: [x, y], b: [x, y], r: its ring }
function segPieces(x, y, segs, sides, rot, base, gap) {
  const k = shieldPulse(), out = [];
  segs.forEach((on, i) => {
    if (!on) return;
    const { r: ring, pos } = ringOf(i, sides), r = (base + gap * ring) * k, s = Math.floor(pos / ring), j = pos % ring;
    const a0 = rot + s * Math.PI * 2 / sides, a1 = rot + (s + 1) * Math.PI * 2 / sides;
    const x0 = x + Math.cos(a0) * r, y0 = y + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, y1 = y + Math.sin(a1) * r;
    out.push({ a: [x0 + (x1 - x0) * j / ring, y0 + (y1 - y0) * j / ring], b: [x0 + (x1 - x0) * (j + 1) / ring, y0 + (y1 - y0) * (j + 1) / ring], r: ring });
  });
  return out;
}
// a closed polygon of radius r round (x, y) as pieces of ring `ring`
function hexPieces(x, y, r, n, rot, ring) {
  return Array.from({ length: n }, (_, i) => {
    const a0 = rot + i * Math.PI * 2 / n, a1 = rot + (i + 1) * Math.PI * 2 / n;
    return { a: [x + Math.cos(a0) * r, y + Math.sin(a0) * r], b: [x + Math.cos(a1) * r, y + Math.sin(a1) * r], r: ring };
  });
}
// the pieces on one side of (cx, cy) - the camera looks from +y, so a larger y is IN FRONT - as walls
function warpWalls(pieces, cy, front, hh, col, a0) {
  const H = hh * cam.k;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineJoin = "round"; ctx.lineWidth = 1.2 * cam.k; ctx.strokeStyle = col; ctx.fillStyle = col;
  for (const p of pieces) {
    if (((p.a[1] + p.b[1]) / 2 > cy) !== front) continue;
    const A0 = warpProject(p.a[0], p.a[1], -H), B0 = warpProject(p.b[0], p.b[1], -H), A1 = warpProject(p.a[0], p.a[1], H), B1 = warpProject(p.b[0], p.b[1], H);
    const a = a0 * Math.max(SHIELD_RING_MIN, SHIELD_RING_FADE ** (p.r - 1)) * warpFade;
    const quad = [{ ...A0, z: -hh }, { ...B0, z: -hh }, { ...B1, z: hh }, { ...A1, z: hh }];
    if (!warpPath(quad)) continue; // clipped to the slice being drawn (aspira-fog.js)
    ctx.globalAlpha = a * 0.35; ctx.fill(); warpEdges(quad); ctx.globalAlpha = a; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// the core's shields: its life segments (kept in step here - the 2D drawCore is not called in 3D), its level
// rings and the ring that breathes while a core power waits
function coreWallPieces() {
  G.lifeFlash = G.lifeFlash || [];
  G.lifeSegs = syncSegs(G.lifeSegs || [], Math.max(0, G.lives), 6, G.lifeFlash);
  const out = segPieces(CX, CY, G.lifeSegs, 6, Math.PI / 6, CORE_R, LIFE_GAP), lvl = Math.round(coreLvl() / CORE_TIERS), o = LIFE_GAP * LIFE_RINGS / CORE_R;
  for (let r = 1; r <= lvl; r++) out.push(...hexPieces(CX, CY, CORE_R * (1 + o + LEVEL_GAP * r) * shieldPulse(), 6, Math.PI / 6, r));
  if (corePicks() > 0) out.push(...hexPieces(CX, CY, CORE_R * (1 + o + LEVEL_GAP * (lvl + 1) + 0.08 * Math.sin(performance.now() / 400)), 6, Math.PI / 6, 1));
  return out;
}
// an enemy's shield segments, round its die
function enemyWallPieces(e) {
  if (!e.shSegs || e.dead) return [];
  const d = ENEMIES[e.type];
  return segPieces(e.x, e.y, e.shSegs, d.sides, e.rot, solidSize(e), 2.5);
}
