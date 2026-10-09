// /spire — the ENEMIES AS REAL DICE in the 3D view (owner, 2026-10-09: "the enemies should actually be 3d,
// not just look like it"): each enemy is its die as a solid - d4 tetrahedron, d6 cube, d8 octahedron, d10
// pentagonal trapezohedron, d20 icosahedron - rolling as it goes, lit from the core, its centre on the floor. Only the faces turned to the camera are drawn (every die is convex, so no sorting). Its
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
    armor: { V: nose(oct, 0), F: facesByEdge(oct, 3, Math.SQRT2) },
    shield: { V: nose(d10, 0), F: d10f },
    bonus: { V: nose(unit(ico), 0), F: facesByEdge(ico, 3, 2) },
  };
})();
const SOLID_ROLL = 10; // ROLL: size x this per radian (owner: "reduce rotation rate by 10x", was 1)

// the die's size (drawEnemy's)
const solidSize = e => { const d = ENEMIES[e.type], f = Math.max(0, e.hp / e.max); return d.size * (e.arcana ? f : 0.45 + 0.55 * f) * (e.sizeMul || 1); };
// one enemy as its die: P its projected floor spot, k / c / s the local scale and the camera's lean
function warpSolid(e) {
  if (e.dead || !SOLIDS[e.type]) return;
  const d = ENEMIES[e.type], f = Math.max(0, e.hp / e.max), size = solidSize(e);
  if (!(size > 0.5)) return;
  const p = warp.p, P = warpProject(e.x, e.y), k = cam.k * P.s;
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
  const col = COL[e.slowT > 0 ? "cyan" : d.color];
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineJoin = "round"; ctx.lineWidth = (e.armor ? 2.2 : 1.2) * cam.k;
  for (const face of S.F) {
    const n = [0, 1, 2].map(i => face.reduce((m, v) => m + R[v][i], 0) / face.length), nl = Math.hypot(...n);
    if (n[1] * p.s + n[2] * p.c <= 0) continue; // turned away from the camera
    const lit = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
    const poly3 = face.map(v => { const [x, y] = scr(R[v]); return { x, y, z: R[v][2] * size }; });
    if (!warpPath(poly3)) continue; // clipped to the slice being drawn (aspira-fog.js)
    ctx.globalAlpha = warpFade; ctx.fillStyle = COL.bg; ctx.fill();
    ctx.globalAlpha = (0.2 + 0.7 * lit) * (0.5 + 0.5 * f) * warpFade; ctx.fillStyle = col; ctx.fill();
    warpEdges(poly3); ctx.globalAlpha = 0.9 * warpFade; ctx.strokeStyle = col; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
