// /spire - what is UNDER a press: a tower or the core, by the WHOLE of what is drawn (owner, 2026-10-10: "the whole
// geometry of the tower and core should invoke the clicking and dragging actions"). In 2D a tower's hex and the core
// out to its outermost ring; in 3D the screen outline of each standing prism (its top, walls and the half below the
// floor) and the core's shields on the floor - before, a press counted only where the ray met the FLOOR, so the
// raised top of a tower, drawn well above its floor spot, missed it. Loaded after aspira-warp.js.
// the core's outermost drawn ring (drawCore, aspira-draw.js): its life rings, a ring per power, the pick waiting
function coreOuterR() {
  const out = LIFE_GAP * LIFE_RINGS / CORE_R, lvl = Math.round(coreLvl() / CORE_TIERS);
  return CORE_R * (1 + out + LEVEL_GAP * (lvl + (corePicks() > 0 ? 1 : 0)));
}
function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// a prism standing h world units on floor hex pts, centred on the floor (warpPrism): its top, its bottom, its walls
function inPrism(pts, h, x, y) {
  const H = h * cam.k / 2, up = pts.map(p => warpProject(p.x, p.y, H)), dn = pts.map(p => warpProject(p.x, p.y, -H));
  if (inPoly(up, x, y) || inPoly(dn, x, y)) return true;
  return pts.some((_, i) => { const j = (i + 1) % pts.length; return inPoly([up[i], up[j], dn[j], dn[i]], x, y); });
}
const hexPts = (x, y, r) => Array.from({ length: 6 }, (_, i) => ({ x: x + r * Math.cos(Math.PI / 6 + i * Math.PI / 3), y: y + r * Math.sin(Math.PI / 6 + i * Math.PI / 3) }));
const towerPts = t => { const c = CELLS[t.cell]; return c.pts.map(p => ({ x: t.x + (p.x - c.x) * TOWER_K, y: t.y + (p.y - c.y) * TOWER_K })); };
// the 3D pick, in the view's own pixels and camera (warp3d): the NEAREST solid under the press wins
function pick3d(ev) {
  const r = cv.getBoundingClientRect(), d = canvasDpr() * WARP_RES, x = (ev.clientX - r.left) * d, y = (ev.clientY - r.top) * d;
  const c0 = { k: cam.k, ox: cam.ox, oy: cam.oy };
  cam.k *= WARP_RES; cam.ox *= WARP_RES; cam.oy *= WARP_RES;
  try {
    const solids = G.towers.map(t => ({ t, at: warpProject(t.x, t.y, 0).s, hit: () => inPrism(towerPts(t), towerH(t), x, y) }));
    solids.push({ core: true, at: warpProject(CX, CY, 0).s, hit: () => inPrism(hexPts(CX, CY, CORE_R), coreH3d(), x, y) || inPoly(hexPts(CX, CY, coreOuterR()).map(p => warpProject(p.x, p.y, 0)), x, y) });
    solids.sort((a, b) => b.at - a.at); // nearer the eye = drawn bigger
    const s = solids.find(o => o.hit());
    return s ? (s.core ? { core: true } : { t: s.t }) : null;
  } finally { Object.assign(cam, c0); }
}
// { t } a tower, { core: true } the core, or null
function pickAt(ev) {
  if (q3d() && warp.p) { const s = pick3d(ev); if (s) return s; }
  const w = toWorld(ev), t = towerAt(w);
  if (t) return { t };
  return Math.hypot(w.x - CX, w.y - CY) <= coreOuterR() ? { core: true } : null;
}
const pickTower = ev => { const s = pickAt(ev); return s && s.t; };
