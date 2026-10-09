// /spire — the ENEMIES AS REAL DICE in the 3D view (owner, 2026-10-09: "the enemies should actually be 3d,
// not just look like it"): each enemy is its die as a solid - d4 tetrahedron, d6 cube, d8 octahedron, d10
// pentagonal trapezohedron, d20 icosahedron - rolling as it goes, lit from above, hovering its own size over
// the floor. Only the faces turned to the camera are drawn (every die is convex, so no sorting). Its
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
  return {
    fast: { V: unit(tet), F: facesByEdge(tet, 3, Math.sqrt(8)) },
    swarm: { V: unit(cube), F: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]] },
    armor: { V: oct, F: facesByEdge(oct, 3, Math.SQRT2) },
    shield: { V: d10, F: d10f },
    bonus: { V: unit(ico), F: facesByEdge(ico, 3, 2) },
  };
})();
const SOLID_LIGHT = unit([[-0.4, -0.5, 0.8]])[0], SOLID_ROLL = 1, SOLID_LEAN = 0.6; // light from up and back-left; ROLL: radians per (distance / size); LEAN: the resting tilt

// one enemy as its die: P its projected floor spot, k / c / s the local scale and the camera's lean
function warpSolid(e) {
  if (e.dead || !SOLIDS[e.type]) return;
  const d = ENEMIES[e.type], f = Math.max(0, e.hp / e.max), size = d.size * (e.arcana ? f : 0.45 + 0.55 * f) * (e.sizeMul || 1);
  if (!(size > 0.5)) return;
  const p = warp.p, P = warpProject(e.x, e.y), k = cam.k * P.s;
  // it ROLLS about its direction of travel (owner: "rotate about the axis of movement, proportional to move
  // speed"): the angle is the distance it has come over its size, so a fast one spins fast and a frozen one stops.
  // Its own resting pose (e.rot about z, a fixed lean about x) varies the dice
  const q = pathAt(e.pi, Math.max(0, e.s - 2), e.ang || 0), ul = Math.hypot(e.x - q.x, e.y - q.y), ux = ul ? (e.x - q.x) / ul : 1, uy = ul ? (e.y - q.y) / ul : 0;
  const th = (e.s || 0) / (d.size * SOLID_ROLL), ct = Math.cos(th), st = Math.sin(th), ca = Math.cos(e.rot), sa = Math.sin(e.rot), cb = Math.cos(SOLID_LEAN), sb = Math.sin(SOLID_LEAN);
  const rot = ([x, y, z]) => {
    const y1 = y * cb - z * sb, z1 = y * sb + z * cb, x2 = x * ca - y1 * sa, y2 = x * sa + y1 * ca; // the resting pose
    const dot = ux * x2 + uy * y2; // Rodrigues about (ux, uy, 0)
    return [x2 * ct + uy * z1 * st + ux * dot * (1 - ct), y2 * ct - ux * z1 * st + uy * dot * (1 - ct), z1 * ct + (ux * y2 - uy * x2) * st];
  };
  const S = SOLIDS[e.type], R = S.V.map(rot);
  // world offset (x, y on the floor, z up) to the screen, the die hovering its own size over the floor
  const scr = ([x, y, z]) => [P.x + k * x * size, P.y + k * (p.c * y * size - p.s * (z + 1) * size)];
  const col = COL[e.slowT > 0 ? "cyan" : d.color];
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineJoin = "round"; ctx.lineWidth = (e.armor ? 2.2 : 1.2) * cam.k;
  for (const face of S.F) {
    const n = [0, 1, 2].map(i => face.reduce((m, v) => m + R[v][i], 0) / face.length), nl = Math.hypot(...n);
    if (n[1] * p.s + n[2] * p.c <= 0) continue; // turned away from the camera
    const lit = Math.max(0, (n[0] * SOLID_LIGHT[0] + n[1] * SOLID_LIGHT[1] + n[2] * SOLID_LIGHT[2]) / nl);
    ctx.beginPath();
    face.forEach((v, i) => { const [x, y] = scr(R[v]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.globalAlpha = 1; ctx.fillStyle = COL.bg; ctx.fill();
    ctx.globalAlpha = (0.2 + 0.7 * lit) * (0.5 + 0.5 * f); ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
