// /spire — the 3D VIEW (owner, 2026-10-09: "change quality to a slider: low,
// high, 3D"; "curved spacetime ... reverse the dip, so it's a tower").
// A VIEW, never a rule: the 2D canvas still draws the game exactly as on high,
// only hidden (opacity 0), and this WebGL canvas over it lays that picture on a
// BELL: a level plateau under the towers and the core ("the towers and core
// don't rise"), then past the tower ring the ground falls away like a BLACK
// HOLE DIAGRAM turned upside down ("think typical black hole diagrams"): a
// near-vertical drop just outside the ring that flattens toward the rim, depth
// WARP.depth x x / (x + WARP.fall), x the distance past the ring (eased in over
// WARP.knee so the lip is rounded, and exactly level inside the ring). The bell never changes ("I don't want the
// bell shape to change"). Ranges, hits and timing stay 2D. Taps map back
// through the bell (unwarp), so every gesture lands on the 2D spot drawn under
// the finger. Loads after aspira-draw.js and aspira-camera.js, before aspira-ui.js.
//   tilt   the board leans back this far (radians; owner: "more top down", was 0.62)
//   edge   the board fades between these radii (world units from the core)
//   tilt, fov  the board leans back `tilt` (radians) under a `fov` lens (owner, "more top down", then
//          with the bell 5x taller: tilt 0.62 -> 0.35 -> 0.15, fov 0.87 -> 0.45 - a longer lens from further
//          back, so the drop's walls and the lanes below stay in sight)
//   edge   the board's picture fades out between these radii (world units from the core)
//   grid   the BLACK HOLE GRID (owner: "add more rings in the bg to make it look more like a black hole"):
//          rings every `ring` world units and `spokes` radial lines on the bell past the towers, out to
//          `far`, where the bell itself ends; over the board only `onBoard` as strong
const WARP = { tilt: 0.15, fov: 0.45, edge: [760, 840], depth: 2300, fall: 110, knee: 18, grid: { ring: 110, spokes: 24, far: 2400, a: 0.3, onBoard: 0.25 } }; // depth: always a DEEP classic bell (owner), then 5x taller (was 460)
// the tower ring's outer edge, world units from the core: the plateau the towers stand on
const WARP_TOWERS = Math.max(...CELLS.map(c => Math.hypot(c.x - CX, c.y - CY))) + CELL_S * 1.5;
const warp = { gl: null, cv: null, prog: null, buf: null, tex: null, n: 0, p: null };

// the mesh is POLAR, in world units round the core: a = (radius, angle)
const WARP_VS = `
attribute vec2 a;
uniform vec2 core, size; uniform float D, L, r0, kw, c, s, f, k;
varying vec2 uv; varying float sh, rr, th;
void main() {
  float r = a.x * k; vec2 p = r * vec2(cos(a.y), sin(a.y));
  float e0 = max(0.0, r - r0), x = e0 * e0 / (e0 + kw), g = x / (x + L), h = -D * g;
  float qy = -c * p.y + s * h, qz = s * p.y + c * h, w = f - qz;
  vec2 sc = core + vec2(f * p.x, -f * qy) / w;
  uv = (core + p) / size; rr = a.x; th = a.y; sh = 1.0 - 0.45 * g;
  gl_Position = vec4((sc.x / size.x * 2.0 - 1.0) * w, (1.0 - sc.y / size.y * 2.0) * w, (w / (40.0 * size.y) * 2.0 - 1.0) * w, w);
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
  float ring = line(abs(fract(rr / grid.x + 0.5) - 0.5) * grid.x, wd);
  float spoke = line(abs(fract(th / grid.y + 0.5) - 0.5) * grid.y * rr, wd);
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
// the bell's POLAR grid, once: dense across the drop's lip, sparser out to the far rim
const WARP_SEG = 180;
function warpRadii() {
  const r0 = WARP_TOWERS, out = [];
  for (let i = 0; i <= 8; i++) out.push(r0 * i / 8);
  for (let i = 1; i <= 90; i++) out.push(r0 + 500 * Math.pow(i / 90, 1.6));
  for (let i = 1; i <= 50; i++) out.push(r0 + 500 + (WARP.grid.far - r0 - 500) * i / 50);
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
  const f = cv.height / 2 / Math.tan(WARP.fov / 2);
  return { core: [cam.ox + CX * cam.k, cam.oy + CY * cam.k], D: WARP.depth * cam.k, L: WARP.fall * cam.k, r0: WARP_TOWERS * cam.k, kw: WARP.knee * cam.k, c: Math.cos(WARP.tilt), s: Math.sin(WARP.tilt), f, k: cam.k };
}
// the spire's height (<= 0, canvas px) r px from the core - the vertex shader's twin
function warpHeight(p, r) {
  const e0 = Math.max(0, r - p.r0), x = e0 * e0 / (e0 + p.kw);
  return -p.D * x / (x + p.L);
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
  for (const n of ["D", "L", "r0", "kw", "c", "s", "f", "k"]) gl.uniform1f(u(n), p[n]);
  gl.uniform2f(u("edge"), WARP.edge[0], WARP.edge[1]);
  gl.uniform3fv(u("gridCol"), warpGridRgb());
  gl.uniform4f(u("grid"), WARP.grid.ring, Math.PI * 2 / WARP.grid.spokes, WARP.grid.far, WARP.grid.a);
  gl.uniform1f(u("towers"), WARP_TOWERS); gl.uniform1f(u("onBoard"), WARP.grid.onBoard);
  const loc = gl.getAttribLocation(pr, "a");
  gl.bindBuffer(gl.ARRAY_BUFFER, warp.buf);
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, warp.n);
}
// a screen point (2D canvas device px) back to the canvas spot drawn there:
// march the eye's ray down to the bell, then bisect. null off it.
function unwarp(sx, sy) {
  const p = warp.p;
  if (!p) return { x: sx, y: sy };
  const dx = (sx - p.core[0]) / p.f, dy = -(sy - p.core[1]) / p.f;
  const at = t => { // the ray at t, in the bell's frame, and its height above it
    const qx = t * dx, qy = t * dy, qz = p.f - t, py = p.s * qz - p.c * qy, pz = p.s * qy + p.c * qz;
    return { x: qx, y: py, g: pz - warpHeight(p, Math.hypot(qx, py)) };
  };
  const end = p.f * 12, steps = 600;
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
