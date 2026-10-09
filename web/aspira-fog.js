// /spire — the PLANE IS A FOG LAYER in the 3D view (owner, 2026-10-09: "the plane should be a thick fog layer"):
// every 3D shape is cut at the floor; the parts BELOW it are drawn first, then the board's own picture over them at
// WARP_FOG (so they show faintly, as through fog), then the parts ABOVE. warpHalf says which half is being drawn;
// warpPath / warpLine clip a shape's polygons and edges to it. Each point is a screen point with z, its height over
// the floor (any unit, only its sign and ratio matter). Loaded before aspira-warp.js.
let warpHalf = null; // null: all of it; "below" / "above": that half
const WARP_FOG = 0.8;
const zIn = p => (warpHalf === "above" ? p.z >= 0 : p.z <= 0);
const zCut = (a, b) => { const t = a.z / (a.z - b.z); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: 0 }; };
// a polygon, clipped to the half being drawn, as the current path; false when nothing of it is left
function warpPath(pts) {
  let P = pts;
  if (warpHalf) {
    P = [];
    pts.forEach((cur, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length];
      if (zIn(cur)) { if (!zIn(prev)) P.push(zCut(prev, cur)); P.push(cur); } else if (zIn(prev)) P.push(zCut(prev, cur));
    });
  }
  if (P.length < 3) return false;
  ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  return true;
}
// an edge, clipped the same way, added to the current path
function warpLine(a, b) {
  if (warpHalf && !zIn(a) && !zIn(b)) return;
  if (warpHalf && zIn(a) !== zIn(b)) { const m = zCut(a, b); if (zIn(a)) b = m; else a = m; }
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
}
