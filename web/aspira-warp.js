// /spire — the 3D VIEW (owner, 2026-10-09: "change quality to a slider: low,
// high, 3D"; "curved spacetime ... reverse the dip, so it's a tower").
// A VIEW, never a rule: the 2D canvas still draws the board exactly as on high,
// only hidden (opacity 0), and this WebGL canvas over it lays that picture on a
// BELL - a BLACK HOLE DIAGRAM turned upside down ("think typical black hole
// diagrams"; "always a deep classic bell"), peaking at the core and never
// changing: a BELL CURVE, height -WARP.depth x (1 - exp(-(r / L)^WARP.pow)), L =
// R0 / WARP.flat - still a bell, with a gentler top (pow 3.5: "a little too
// pointy" at 2, "reduce the curve near the top so the towers don't look super
// far" at 3, too flat at 5) and level by the lanes' mouths (R0), so enemies come in on the
// level floor and climb the wall to the core (owner: "when the bottom curvature
// flattens that should be where the enemies spawn").
// The TOWERS (and their slots), the CORE and the ENEMIES are not stretched with it (owner: "use
// positions based on the bell, but the enemies and towers are drawn separately,
// as if on a flat plane"): each is drawn undistorted on a 2D canvas over the
// bell, at its spot's projected point, smaller the deeper it sits
// (warpEntities). Lanes, ranges and beams stay on the bell; a beam's ends land
// on the same projected points, so it still meets its tower and its enemy.
// Ranges, hits and timing stay 2D. Taps map back through the bell (unwarp).
// Loads after aspira-draw.js and aspira-camera.js, before aspira-ui.js.
//   tilt, fov  the board leans back `tilt` (radians) under a `fov` lens (owner, "more top down", then
//          with the bell 5x taller: tilt 0.62 -> 0.35 -> 0.15, fov 0.87 -> 0.45 - a longer lens from further
//          back, so the drop's walls and the lanes below stay in sight)
//   zoom   the 3D view's magnification (owner: "zoom in"); anchor  the view rides up this fraction of
//          the way from the core's tip to the bell's foot, so the tip and the floor both fit
//   edge   the board's picture fades out between these radii (world units from the core)
//   grid   the BLACK HOLE GRID (owner: "add more rings in the bg to make it look more like a black hole"):
//          rings every `ring` world units and `spokes` radial lines on the bell past the towers, out to
//          `far`, where the bell itself ends; over the board only `onBoard` as strong, and outside
//          the board's circle half as many (owner: "fewer curvature lines outside the circle")
const WARP = { tilt: 0.15, fov: 0.45, edge: [760, 840], depth: 9000, flat: 1.873, pow: 3.5, zoom: 2, anchor: 0.25, grid: { ring: 110, spokes: 24, far: 2400, a: 0.3, onBoard: 0.25 } }; // depth: a DEEP classic bell (owner), 5x taller (was 460), then 3x again (was 2300), then x2 (was 6900), then a more gradual slope (owner, was 13800)
// the tower ring's outer edge, world units from the core: the plateau the towers stand on
const WARP_TOWERS = Math.max(...CELLS.map(c => Math.hypot(c.x - CX, c.y - CY))) + CELL_S * 1.5;
const warp = { gl: null, cv: null, prog: null, buf: null, tex: null, n: 0, p: null, ent: null };

// the mesh is POLAR, in world units round the core: a = (radius, angle)
const WARP_VS = `
attribute vec2 a;
uniform vec2 core, size; uniform float D, L, P, c, s, f, k, z, oy;
varying vec2 uv; varying float sh, rr, th;
void main() {
  float r = a.x * k; vec2 p = r * vec2(cos(a.y), sin(a.y));
  float g = 1.0 - exp(-pow(r / L, P)), h = -D * g;
  float qy = -c * p.y + s * h, qz = s * p.y + c * h, w = f - qz;
  vec2 sc = core + vec2(0.0, oy) + z * vec2(f * p.x, -f * qy) / w;
  uv = (core + p) / size; rr = a.x; th = a.y; sh = 1.0 - 0.45 * g;
  gl_Position = vec4((sc.x / size.x * 2.0 - 1.0) * w, (1.0 - sc.y / size.y * 2.0) * w, (w / (80.0 * size.y) * 2.0 - 1.0) * w, w);
}`;
const WARP_FS = `
precision mediump float;
uniform sampler2D tex; uniform vec2 edge; uniform vec3 gridCol; uniform vec4 grid; // grid: ring, spoke angle, far, alpha
uniform float towers, onBoard;
varying vec2 uv; varying float sh, rr, th;
float line(float d, float wd) { return 1.0 - smoothstep(wd * 0.5, wd * 1.5, d); }
void main() {
  vec2 inUv = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  float board = inUv.x * inUv.y * (1.0 - smoothstep(edge.x, edge.y, rr));
  float wd = 0.8 + rr * 0.0025;
  float out2 = 1.0 + step(edge.y, rr), rs = grid.x * out2, as = grid.y * out2; // half as many lines outside the board
  float ring = line(abs(fract(rr / rs + 0.5) - 0.5) * rs, wd);
  float spoke = line(abs(fract(th / as + 0.5) - 0.5) * as * rr, wd);
  float gk = max(ring, spoke) * grid.w * smoothstep(towers, towers + 30.0, rr) * (1.0 - smoothstep(grid.z * 0.7, grid.z, rr));
  gk *= 1.0 - board * (1.0 - onBoard); // faint over the board itself: the lanes stay readable
  vec3 col = texture2D(tex, uv).rgb * sh * board;
  gl_FragColor = vec4(mix(col, gridCol * sh, gk), max(board, gk));
}`;

function warpShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  return sh;
}
// the GL canvas and its one program, made the first time 3D is chosen; null
// when the browser has no WebGL (3D then shows high's flat picture)
function warpInit() {
  if (warp.gl) return warp.gl;
  const c = document.createElement("canvas");
  c.id = "asp-gl"; c.setAttribute("aria-hidden", "true");
  cv.after(c);
  const gl = c.getContext("webgl", { premultipliedAlpha: true, antialias: true });
  if (!gl) { c.remove(); return null; }
  const pr = gl.createProgram();
  gl.attachShader(pr, warpShader(gl, gl.VERTEX_SHADER, WARP_VS));
  gl.attachShader(pr, warpShader(gl, gl.FRAGMENT_SHADER, WARP_FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { c.remove(); return null; }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  Object.assign(warp, { gl, cv: c, prog: pr, tex: t, buf: gl.createBuffer() });
  return gl;
}
// the bell's POLAR grid, once: dense over the board, sparser out to the far rim
const WARP_SEG = 180;
function warpRadii() {
  const near = 900, out = [];
  for (let i = 0; i <= 140; i++) out.push(near * Math.pow(i / 140, 1.3));
  for (let i = 1; i <= 50; i++) out.push(near + (WARP.grid.far - near) * i / 50);
  return out;
}
function warpMesh() {
  const gl = warp.gl, v = [], R = warpRadii(), da = Math.PI * 2 / WARP_SEG;
  for (let i = 0; i + 1 < R.length; i++) for (let j = 0; j < WARP_SEG; j++) {
    const a0 = j * da, a1 = (j + 1) * da;
    v.push(R[i], a0, R[i + 1], a0, R[i], a1, R[i + 1], a0, R[i + 1], a1, R[i], a1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, warp.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  warp.n = v.length / 2;
}
// the grid's colour, the chart's own grid swatch (COL.grid, "rgb(r, g, b)") as 0..1
const warpGridRgb = () => (String(COL.grid || COL.green).match(/[\d.]+/g) || [0, 255, 0]).slice(0, 3).map(n => n / 255);
// this frame's bell, centred on the core's canvas spot
function warpParams() {
  const f = cv.height / 2 / Math.tan(WARP.fov / 2), D = WARP.depth * cam.k, c = Math.cos(WARP.tilt), s = Math.sin(WARP.tilt);
  const oy = -WARP.anchor * WARP.zoom * f * s * D / (f + c * D); // the bell's foot sits this far below the tip on screen
  return { core: [cam.ox + CX * cam.k, cam.oy + CY * cam.k], D, L: R0 / WARP.flat * cam.k, P: WARP.pow, c, s, f, k: cam.k, z: WARP.zoom, oy };
}
// the spire's height (<= 0, canvas px) r px from the core - the vertex shader's twin
function warpHeight(p, r) {
  return -p.D * (1 - Math.exp(-Math.pow(r / p.L, p.P)));
}
// one frame: the 2D picture onto the bell (aspira-ui.js frame calls this after render)
function warpDraw() {
  const gl = warpInit();
  if (!gl) return;
  if (warp.cv.width !== cv.width || warp.cv.height !== cv.height) { warp.cv.width = cv.width; warp.cv.height = cv.height; }
  if (!warp.n) warpMesh();
  const p = warp.p = warpParams(), pr = warp.prog;
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(pr);
  gl.bindTexture(gl.TEXTURE_2D, warp.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  const u = n => gl.getUniformLocation(pr, n);
  gl.uniform2f(u("core"), p.core[0], p.core[1]); gl.uniform2f(u("size"), cv.width, cv.height);
  for (const n of ["D", "L", "P", "c", "s", "f", "k", "z", "oy"]) gl.uniform1f(u(n), p[n]);
  gl.uniform2f(u("edge"), WARP.edge[0], WARP.edge[1]);
  gl.uniform3fv(u("gridCol"), warpGridRgb());
  gl.uniform4f(u("grid"), WARP.grid.ring, Math.PI * 2 / WARP.grid.spokes, WARP.grid.far, WARP.grid.a);
  gl.uniform1f(u("towers"), WARP_TOWERS); gl.uniform1f(u("onBoard"), WARP.grid.onBoard);
  const loc = gl.getAttribLocation(pr, "a");
  gl.bindBuffer(gl.ARRAY_BUFFER, warp.buf);
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, warp.n);
  warpEntities();
}
// a world point to the screen: its canvas spot lifted onto the bell and seen by the camera;
// s is the perspective scale there (1 at the core's height)
function warpProject(x, y) {
  const p = warp.p, px = cam.ox + x * cam.k - p.core[0], py = cam.oy + y * cam.k - p.core[1];
  const h = warpHeight(p, Math.hypot(px, py)), qy = -p.c * py + p.s * h, qz = p.s * py + p.c * h, w = p.f - qz;
  return { x: p.core[0] + p.z * p.f * px / w, y: p.core[1] + p.oy - p.z * p.f * qy / w, s: p.z * p.f / w };
}
// the TOWERS, the CORE and the ENEMIES, flat, each at its projected point (owner: "drawn separately,
// as if on a flat plane"): the usual draw calls on a 2D canvas over the bell, each under a transform
// that puts its world point on the projected one at the perspective's scale
function warpEntities() {
  if (!warp.ent) {
    const c = document.createElement("canvas");
    c.id = "asp-ent"; c.setAttribute("aria-hidden", "true");
    warp.cv.after(c);
    warp.ent = c;
  }
  const c = warp.ent, main = ctx;
  if (c.width !== cv.width || c.height !== cv.height) { c.width = cv.width; c.height = cv.height; }
  ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
  const at = (x, y, fn) => {
    const P = warpProject(x, y), k = cam.k * P.s;
    ctx.setTransform(k, 0, 0, k, P.x - x * k, P.y - y * k);
    ctx.save(); fn(); ctx.restore();
  };
  const atCell = (cell, fn) => at(cell.x, cell.y, fn);
  const all = () => {
    drawFx("dmg", at); // damage numbers flat too (owner), under everything as in 2D
    drawCells(atCell); if (!G.towers.length && !ui.build) drawSlotArrow(atCell); // the slots too, flat
    ownColours(() => { for (const t of G.towers) at(t.x, t.y, () => drawTower(t)); });
    if (ui.build && ui.hover) at(ui.hover.x, ui.hover.y, drawPlacement);
    at(CX, CY, () => { drawCore(); drawCredits(); });
    for (const e of G.enemies) at(e.x, e.y, () => drawEnemy(e));
    at(CX, CY, drawCoreHud);
    drawFx("text", at);
  };
  try { if (bossInv.full) withPalette(all); else all(); } finally { ctx = main; }
}
// a screen point (2D canvas device px) back to the canvas spot drawn there:
// march the eye's ray down to the bell, then bisect. null off it.
function unwarp(sx, sy) {
  const p = warp.p;
  if (!p) return { x: sx, y: sy };
  const dx = (sx - p.core[0]) / (p.f * p.z), dy = -(sy - p.core[1] - p.oy) / (p.f * p.z);
  const at = t => { // the ray at t, in the bell's frame, and its height above it
    const qx = t * dx, qy = t * dy, qz = p.f - t, py = p.s * qz - p.c * qy, pz = p.s * qy + p.c * qz;
    return { x: qx, y: py, g: pz - warpHeight(p, Math.hypot(qx, py)) };
  };
  const end = p.f * 30, steps = 1200;
  let lo = 0, prev = at(0);
  for (let i = 1; i <= steps; i++) {
    const t = end * i / steps, cur = at(t);
    if (Math.sign(cur.g) !== Math.sign(prev.g)) {
      let hi = t;
      for (let j = 0; j < 24; j++) { const mid = (lo + hi) / 2, m = at(mid); if (Math.sign(m.g) === Math.sign(prev.g)) lo = mid; else hi = mid; }
      const hit = at((lo + hi) / 2);
      return { x: p.core[0] + hit.x, y: p.core[1] + hit.y };
    }
    lo = t; prev = cur;
  }
  return null;
}
