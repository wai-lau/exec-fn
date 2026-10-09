// /spire — the ENEMIES AS REAL DICE in the 3D view (owner, 2026-10-09: "the enemies should actually be 3d,
// not just look like it"): each enemy is its die as a solid - d4 tetrahedron, d6 cube, d8 octahedron (shield), d10
// pentagonal trapezohedron (armor), d20 icosahedron - rolling as it goes, lit from the core, its centre on the floor. Only the faces turned to the camera are drawn (every die is convex, so no sorting). Its
// tracer, shield segments and status marks stay flat on the floor (drawEnemy(e, true)).
// Loaded after aspira-warp.js; warpEntities calls warpSolid.

// unit solids (radius 1): vertices, then faces as vertex lists (any winding: a face's normal is the
// direction of its centroid, true for these centred solids)
const PHI = (1 + Math.sqrt(5)) / 2;
// every triple (or quad) of vertices whose pairwise distances are all the edge length is a face
function facesByEdge(V, n, edge) {
  const near = (a, b) => Math.abs(Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1], V[a][2] - V[b][2]) - edge) < 1e-6, out = [];
  for (let a = 0; a < V.length; a++) for (let b = a + 1; b < V.length; b++) for (let c = b + 1; c < V.length; c++) {
    if (n === 3 && near(a, b) && near(b, c) && near(a, c)) out.push([a, b, c]);
  }
  return out;
}
const unit = V => V.map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
const SOLIDS = (() => {
  const tet = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  const cube = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const oct = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const ico = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) ico.push([0, a, b], [a, b, 0], [b, 0, a]);
  // d10: two apexes and a zigzag ring of ten, five up and five down, faces are kites
  const d10 = [[0, 0, 1], [0, 0, -1]];
  for (let i = 0; i < 10; i++) d10.push([0.9 * Math.cos(i * Math.PI / 5), 0.9 * Math.sin(i * Math.PI / 5), i % 2 ? -0.1 : 0.1]);
  const d10f = [];
  for (let i = 0; i < 10; i += 2) {
    const r = j => 2 + (j % 10);
    d10f.push([0, r(i), r(i + 1), r(i + 2)], [1, r(i + 1), r(i + 2), r(i + 3)]);
  }
  // each die turned so the corner on its axis of symmetry - `apex` - lies on +x: that is its FRONT (owner, 2026-10-09:
  // "the point which causes the shape to be radially symmetric pointed forward"), and it rolls about that axis
  const nose = (V, apex) => {
    const A = V[apex], ax = [0, A[2], -A[1]], al = Math.hypot(...ax), th = Math.acos(Math.max(-1, Math.min(1, A[0]))); // A x X, angle A.X
    if (al < 1e-9) return V;
    const k = ax.map(c => c / al), c = Math.cos(th), s = Math.sin(th);
    return V.map(v => { const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2], cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; return v.map((x, i) => x * c + cr[i] * s + k[i] * dot * (1 - c)); });
  };
  return {
    fast: { V: nose(unit(tet), 0), F: facesByEdge(tet, 3, Math.sqrt(8)) },
    swarm: { V: nose(unit(cube), 6), F: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]] },
    shield: { V: nose(oct, 0), F: facesByEdge(oct, 3, Math.SQRT2) }, // armor and shield SWAPPED (owner, 2026-10-09: "swap shield and armor shape")
    armor: { V: nose(d10, 0), F: d10f },
    bonus: { V: nose(unit(ico), 0), F: facesByEdge(ico, 3, 2) },
  };
})();
const SOLID_ROLL = 10, SOLID_FAR_MIN = 0.2, SOLID_BREACH_LEN = 0.25, SOLID_BREACH_W = 0.15, SOLID_FROZEN_A = 0.5; // BREACH_*: the spike's half length (x size) and width (px) added per stack // ROLL: size x this per radian (owner: "reduce rotation rate by 10x", was 1)

// the die's size (drawEnemy's)
const solidSize = e => { const d = ENEMIES[e.type], f = Math.max(0, e.hp / e.max); return d.size * (e.arcana ? f : 0.45 + 0.55 * f) * (e.sizeMul || 1); };
// one enemy as its die: P its projected floor spot, k / c / s the local scale and the camera's lean
// its GEOMETRY is built once a frame (solidGeom, cached on the enemy by warp.frame) and only DRAWN per floor slice -
// it was rebuilt in each of warpBands' nine passes, half the 3D frame with 130 enemies (profiled 2026-10-09)
function solidGeom(e) {
  const d = ENEMIES[e.type], f = Math.max(0, e.hp / e.max), size = solidSize(e);
  if (!(size > 0.5) || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return null; // (a NaN spot would make a gradient throw)
  const p = warp.p, P = warpProject(e.x, e.y), k = cam.k * P.s;
  // FAINTER FARTHER from the camera (owner, 2026-10-09: "enemy opacity should also be relative to their distance to camera"):
  // its perspective size against the core's, squared, never under SOLID_FAR_MIN
  const fa = Math.max(SOLID_FAR_MIN, Math.min(1, P.s / p.z) ** 2);
  // it ROLLS about its direction of travel (owner: "rotate about the axis of movement, proportional to move
  // speed"): the angle is the distance it has come over its size, so a fast one spins fast and a frozen one stops.
  // Its own resting pose (e.rot about z, a fixed lean about x) varies the dice
  // the heading is its lane's tangent (a swarmer's wander does not turn it)
  const q = pathAt(e.pi, Math.max(0, e.s - 2), e.ang || 0), h = pathAt(e.pi, e.s || 0, e.ang || 0), hx = Math.atan2(h.y - q.y, h.x - q.x) || 0;
  const th = (e.s || 0) / (d.size * SOLID_ROLL) + (e.rot || 0), ct = Math.cos(th), st = Math.sin(th), ch = Math.cos(hx), sh = Math.sin(hx);
  // roll about the nose (+x), then turn the nose to the heading
  const rot = ([x, y, z]) => { const y1 = y * ct - z * st, z1 = y * st + z * ct; return [x * ch - y1 * sh, x * sh + y1 * ch, z1]; };
  const S = SOLIDS[e.type], R = S.V.map(rot);
  // LIT FROM THE CORE (owner: "the light source should come from the core"): toward the core's top from this die
  const L = unit([[CX - e.x, CY - e.y, (warp.lightZ || 1)]])[0];
  // world offset (x, y on the floor, z up) to the screen, the die's CENTRE on the floor (owner: "their center is on the plane")
  const scr = ([x, y, z]) => [P.x + k * x * size, P.y + k * (p.c * y * size - p.s * z * size)];
  const faces = [], slot = new Array(S.F.length).fill(-1); // slot: a face of S.F -> its index in faces (visible), or -1
  const Q = R.map(v => { const [x, y] = scr(v); return { x, y, z: v[2] * size }; }); // every corner projected once
  for (const [fi, face] of S.F.entries()) {
    const n = [0, 1, 2].map(i => face.reduce((m, v) => m + R[v][i], 0) / face.length), nl = Math.hypot(...n);
    if (n[1] * p.s + n[2] * p.c <= 0) continue; // turned away from the camera
    const lit = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
    const poly3 = face.map(v => Q[v]);
    slot[fi] = faces.length;
    faces.push({ poly3, lo: Math.min(...poly3.map(v => v.z)), hi: Math.max(...poly3.map(v => v.z)), fA: (0.2 + 0.7 * lit) * (0.5 + 0.5 * f) });
  }
  // BREACH in 3D (owner, 2026-10-09: "breach effect should look like vertical spoke going through the enemy center of
  // mass, increasing in size the more breach"): one upright spike through the die's centre, longer and thicker per stack
  // (to BREACH_SPOKES), drawn before the faces so the die hides its middle
  let spike = null;
  if (e.bleedCrit > 0) {
    const n = Math.min(BREACH_SPOKES, Math.max(1, e.breachN || 1)), H = size * (1.3 + SOLID_BREACH_LEN * n);
    const [x0, y0] = scr([0, 0, -H / size]), [x1, y1] = scr([0, 0, H / size]);
    spike = { a: { x: x0, y: y0, z: -H }, b: { x: x1, y: y1, z: H }, w: (1.2 + SOLID_BREACH_W * n) * cam.k };
  }
  // FROZEN: its own colour with FRZ's cyan laid over at SOLID_FROZEN_A (owner, 2026-10-09: "FRZ color change should just be
  // 50% opaque, not 100" - it was all cyan)
  // its EDGES once: each with how many visible faces share it (1: the outline, 2: an inner edge)
  // (the die's edge TOPOLOGY is fixed per kind - solidEdges - so only which faces show changes)
  const edges = [];
  for (const [i, j, a, b] of solidEdges(e.type)) {
    const f = [slot[a], slot[b]].filter(x => x >= 0);
    if (f.length) edges.push({ v: Q[i], w: Q[j], n: f.length, f });
  }
  return { faces, edges, spike, size, fa, col: COL[d.color], frz: e.slowT > 0 ? SOLID_FROZEN_A : 0, lw: (e.armor ? 2.2 : 1.2) * cam.k };
}
// the opacity the floor's slices give depth z (aspira-fog.js warpBands): 1 at the floor, down to the deepest slice's
const belowFade = z => Math.max(1 - (WARP_FADE_BANDS - 0.5) / WARP_FADE_BANDS, Math.min(1, 1 + z / WARP_FADE_Z));
// everything of a die BELOW the floor in one go (warpBand clips it to z <= 0): each face at ONE fade, its clipped part's
// mean depth's - the slices stepped a face 2-4 times; a face is small against WARP_FADE_Z, so it reads the same
function warpSolidBelow(g) {
  const col = g.col, frz = g.frz, bgR = rgbOf(COL.bg), colR = rgbOf(col), cyR = rgbOf(COL.cyan);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineJoin = "round"; ctx.globalAlpha = 1;
  ctx.lineWidth = g.lw;
  for (const F of g.faces) {
    if (F.lo > 0 || !warpPath(F.poly3)) continue;
    const fa = g.fa * belowFade((F.lo + Math.min(0, F.hi)) / 2), fA = F.fA * fa;
    ctx.fillStyle = blendFill([[bgR, fa], [colR, fA], [cyR, fA * frz]]); ctx.fill();
    warpEdges(F.poly3); ctx.strokeStyle = blendFill([[colR, 0.9 * fa], [cyR, 0.9 * fa * frz]]); ctx.stroke();
  }
}
// a die kind's edges, once: [corner i, corner j, face a, face b] (every edge of these closed solids has two faces)
const solidEdgeCache = {};
function solidEdges(type) {
  if (solidEdgeCache[type]) return solidEdgeCache[type];
  const m = new Map();
  SOLIDS[type].F.forEach((face, fi) => face.forEach((v, k) => { const w = face[(k + 1) % face.length], key = Math.min(v, w) + "," + Math.max(v, w); const had = m.get(key); if (had) had[3] = fi; else m.set(key, [v, w, fi, -1]); }));
  return (solidEdgeCache[type] = [...m.values()]);
}
// layers [[css colour, alpha], ...] composited source-over onto nothing, as ONE rgba (cached by its rounded inputs)
const rgbOf = (() => { const m = new Map(); return c => { let v = m.get(c); if (!v) { const n = (c || "").match(/[\d.]+/g) || [0, 0, 0]; v = n.slice(0, 3).map(Number); m.set(c, v); } return v; }; })();
const blendCache = new Map();
function blendFill(layers) {
  let r = 0, g = 0, b = 0, A = 0;
  for (const [c, a0] of layers) {
    const a = Math.max(0, Math.min(1, a0));
    if (!(a > 0)) continue;
    const [cr, cg, cb] = typeof c === "string" ? rgbOf(c) : c, na = a + A * (1 - a);
    r = (cr * a + r * A * (1 - a)) / na; g = (cg * a + g * A * (1 - a)) / na; b = (cb * a + b * A * (1 - a)) / na; A = na;
  }
  const a = Math.round(A * 1000), key = (((r | 0) * 256 + (g | 0)) * 256 + (b | 0)) * 1001 + a; // a number: no string built per call
  let s = blendCache.get(key);
  if (!s) { if (blendCache.size > 4000) blendCache.clear(); s = "rgba(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + "," + a / 1000 + ")"; blendCache.set(key, s); }
  return s;
}
function warpSolid(e) {
  if (e.dead || !SOLIDS[e.type]) return;
  if (e.geomAt !== warp.frame) { e.geomAt = warp.frame; e.geom = solidGeom(e); }
  const g = e.geom, band = warpBand;
  if (!g) return;
  // TWO passes, not one per floor slice (perf, 2026-10-09): deeper slices skip it, and the slice AT the floor (hi -0)
  // draws all of it below the floor at once (warpSolidBelow)
  if (band && band.hi < 0) return;
  if (band && band.hi === 0 && band.lo > -Infinity) { warpBand = { lo: -Infinity, hi: 0 }; try { warpSolidBelow(g); } finally { warpBand = band; } return; }
  const H = g.spike ? g.spike.b.z : g.size;
  if (band && (H < band.lo || -H > band.hi)) return; // nothing of it in this slice
  const fa = warpFade * g.fa, col = g.col, frz = g.frz, bgR = rgbOf(COL.bg), colR = rgbOf(col), cyR = rgbOf(COL.cyan);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineJoin = "round";
  // the breach spike WHOLE, at full strength, in the pass above the floor: centred on the floor (owner, 2026-10-09: "SOL
  // breach effect should be centered on floor" - its lower half faded with the floor, so it read as rising from the die)
  if (g.spike && band && band.lo === 0) { ctx.beginPath(); ctx.moveTo(g.spike.a.x, g.spike.a.y); ctx.lineTo(g.spike.b.x, g.spike.b.y); ctx.strokeStyle = COL[TOWERS.sol.color]; ctx.globalAlpha = 0.9 * fa; ctx.lineWidth = g.spike.w; ctx.stroke(); }
  // PERF (2026-10-09): each face ONE fill of its layers blended up front (background, colour, frost - source-over
  // is associative, so it is the same colour), and the edges stroked once for the whole die: the outline (an edge of
  // one face) once, the inner edges (shared by two faces) as their two strokes blended
  ctx.lineWidth = g.lw; ctx.globalAlpha = 1;
  const drawn = g.faces.map(F => {
    if (band && (F.hi < band.lo || F.lo > band.hi)) return false;
    if (!warpPath(F.poly3)) return false; // clipped to the slice being drawn (aspira-fog.js)
    const fA = F.fA * fa;
    ctx.fillStyle = blendFill([[bgR, fa], [colR, fA], [cyR, fA * frz]]); ctx.fill();
    return true;
  });
  if (drawn.some(Boolean)) {
    const sa = 0.9 * fa;
    for (const n of [1, 2]) {
      ctx.beginPath(); let any = false;
      for (const E of g.edges) if (E.n === n && E.f.some(fi => drawn[fi])) { warpLine(E.v, E.w); any = true; }
      if (!any) continue;
      const one = [[colR, sa], [cyR, sa * frz]];
      ctx.strokeStyle = blendFill(n === 1 ? one : one.concat(one)); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
