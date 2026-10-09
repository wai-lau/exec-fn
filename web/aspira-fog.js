// /spire — what lies BELOW THE FLOOR FADES in the 3D view (owner, 2026-10-09: "make the floor completely transparent
// again; instead, all of the geometry should just start losing opacity in a gradient when lower than the floor" - it
// was a fog layer of the board's own picture over the parts below). Every shape is cut at the floor and below it into
// WARP_FADE_BANDS slices of depth, each drawn fainter (warpFade) down to nothing at WARP_FADE_Z world units under the
// floor; above the floor it is whole. warpBand is the slice being drawn; warpPath / warpLine clip a shape's polygons
// and edges to it. Each point is a screen point with z, its height over the floor in WORLD units.
// Loaded before aspira-warp.js.
let warpBand = null, warpFade = 1; // null: all of it; { lo, hi }: only lo <= z <= hi; warpFade: that slice's opacity
const WARP_FADE_Z = 30, WARP_FADE_BANDS = 8;
// the LANES (all the floor's light) lie over what is below the floor (owner: "lanes should partially occlude the towers"):
// the board's picture laid over it in SCREEN mode at WARP_LANES_A - its black adds nothing, so the floor stays clear
const WARP_LANES_A = 0.6;
function warpLanesOver() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = WARP_LANES_A;
  ctx.drawImage(warp.cv, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
}
const zCut = (a, b, z) => { const t = (a.z - z) / (a.z - b.z); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z }; };
// Sutherland-Hodgman against one bound: keep points on `keep`'s side of z
function clipZ(pts, z, above) {
  const inn = p => (above ? p.z >= z : p.z <= z), out = [];
  pts.forEach((cur, i) => {
    const prev = pts[(i + pts.length - 1) % pts.length];
    if (inn(cur)) { if (!inn(prev)) out.push(zCut(prev, cur, z)); out.push(cur); } else if (inn(prev)) out.push(zCut(prev, cur, z));
  });
  return out;
}
// a polygon, clipped to the slice being drawn, as the current path; false when nothing of it is left
function warpPath(pts) {
  let P = pts;
  if (warpBand) { if (warpBand.lo > -Infinity) P = clipZ(P, warpBand.lo, true); if (P.length && warpBand.hi < Infinity) P = clipZ(P, warpBand.hi, false); }
  if (P.length < 3) return false;
  ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  return true;
}
// an edge, clipped the same way, added to the current path
function warpLine(a, b) {
  if (warpBand) {
    for (const [z, above] of [[warpBand.lo, true], [warpBand.hi, false]]) {
      if (!isFinite(z)) continue;
      const ia = above ? a.z >= z : a.z <= z, ib = above ? b.z >= z : b.z <= z;
      if (!ia && !ib) return;
      if (ia !== ib) { const m = zCut(a, b, z); if (ia) b = m; else a = m; }
    }
  }
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
}
// a polygon's OWN edges, each clipped to the slice, as the current path - stroke this, never warpPath's outline, or
// every slice's cut shows as a line
function warpEdges(pts) { ctx.beginPath(); pts.forEach((p, i) => warpLine(p, pts[(i + 1) % pts.length])); }
// draw(): every shape, once whole ABOVE the floor and once per fading slice below it
// between(): drawn after the parts below the floor, before those above it
function warpBands(draw, between) {
  for (let i = WARP_FADE_BANDS - 1; i >= 0; i--) {
    warpBand = { lo: -WARP_FADE_Z * (i + 1) / WARP_FADE_BANDS, hi: -WARP_FADE_Z * i / WARP_FADE_BANDS }; warpFade = 1 - (i + 0.5) / WARP_FADE_BANDS;
    draw(false);
  }
  warpBand = null; warpFade = 1; if (between) between();
  warpBand = { lo: 0, hi: Infinity }; draw(true);
  warpBand = null;
}
