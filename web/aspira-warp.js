// /spire — the 3D VIEW (owner, 2026-10-09: "change quality to a slider: low,
// high, 3D"; "curved spacetime ... reverse the dip, so it's a tower"; "all
// floors are angled upwards like a spiral - whenever there is a new floor the
// angle gets steeper (and speeds adjusted) for existing enemies so that they
// reach the core at the same time").
// A VIEW, never a rule: the 2D canvas still draws the game exactly as on high,
// only hidden (opacity 0), and this WebGL canvas over it lays that picture on a
// CONE whose peak is the core - the spiral lanes ramp up the spire. Every wave
// is a new floor: the slope steepens (SLOPE_AT), eased over WARP.ease seconds.
// An enemy keeps its 2D place and pace, so it still reaches the core on the same
// beat - it just climbs a steeper ramp, faster in 3D. Taps map back through the
// cone (unwarp), so every gesture lands on the 2D spot drawn under the finger.
// Loads after aspira-draw.js and aspira-camera.js, before aspira-ui.js.
// Past the TOWERS the ramp falls away far steeper (owner: "make the curvature
// way steeper after the towers"): +WARP.outer degrees beyond the tower ring,
// at most WARP.maxDeg, blended in over WARP.knee world units.
//   tilt   the board leans back this far (radians; owner: "more top down", was 0.62)
//   round  the peak's rounding (world units); edge the board fades between these radii
const WARP = { tilt: 0.35, fov: 0.87, round: 60, edge: [760, 840], ease: 1, slope: [5, 25], outer: 35, maxDeg: 60, knee: 40 };
// the tower ring's outer edge, world units from the core: the plateau the towers stand on
const WARP_TOWERS = Math.max(...CELLS.map(c => Math.hypot(c.x - CX, c.y - CY))) + CELL_S * 1.5;
// the ramp's angle on wave n, degrees: WARP.slope[0] at wave 1 to [1] at the last
const SLOPE_AT = n => WARP.slope[0] + (WARP.slope[1] - WARP.slope[0]) * Math.min(1, Math.max(0, (n - 1) / (WIN_WAVE - 1)));
const warp = { gl: null, cv: null, prog: null, buf: null, tex: null, n: 0, size: "", deg: null, p: null };

const WARP_VS = `
attribute vec2 a;
uniform vec2 core, size; uniform float m, m2, r0, kw, b, c, s, f, k;
varying vec2 uv; varying float sh, rr;
void main() {
  vec2 p = a - core; float r = length(p);
  float x = (r - r0) / kw, h = m * (b - sqrt(r * r + b * b)) - m2 * kw * (x > 20.0 ? x : log(1.0 + exp(x)));
  float qy = -c * p.y + s * h, qz = s * p.y + c * h, w = f - qz;
  vec2 sc = core + vec2(f * p.x, -f * qy) / w;
  uv = a / size; rr = r / k; sh = 1.0 - 0.35 * min(1.0, rr / 800.0);
  gl_Position = vec4((sc.x / size.x * 2.0 - 1.0) * w, (1.0 - sc.y / size.y * 2.0) * w, (w / (20.0 * size.y) * 2.0 - 1.0) * w, w);
}`;
const WARP_FS = `
precision mediump float;
uniform sampler2D tex; uniform vec2 edge;
varying vec2 uv; varying float sh, rr;
void main() {
  float e = 1.0 - smoothstep(edge.x, edge.y, rr);
  gl_FragColor = vec4(texture2D(tex, uv).rgb * sh, 1.0) * e;
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
// the cone's grid, in 2D canvas pixels - rebuilt when the canvas resizes
const WARP_GRID = 96;
function warpMesh(w, h) {
  const gl = warp.gl, v = [];
  const at = (i, j) => v.push(i / WARP_GRID * w, j / WARP_GRID * h);
  for (let j = 0; j < WARP_GRID; j++) for (let i = 0; i < WARP_GRID; i++) {
    at(i, j); at(i + 1, j); at(i, j + 1); at(i + 1, j); at(i + 1, j + 1); at(i, j + 1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, warp.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  warp.n = v.length / 2; warp.size = w + "x" + h;
}
// this frame's cone: the peak on the core's canvas spot, the slope eased
// toward the wave's angle (a new floor steepens it)
function warpParams(dt) {
  const goal = SLOPE_AT(Math.max(1, G.wave));
  warp.deg = warp.deg == null ? goal : warp.deg + (goal - warp.deg) * Math.min(1, dt / WARP.ease * 3);
  const f = cv.height / 2 / Math.tan(WARP.fov / 2);
  const rad = Math.PI / 180, m = Math.tan(warp.deg * rad), m2 = Math.tan(Math.min(WARP.maxDeg, warp.deg + WARP.outer) * rad) - m;
  return { core: [cam.ox + CX * cam.k, cam.oy + CY * cam.k], m, m2, r0: WARP_TOWERS * cam.k, kw: WARP.knee * cam.k, b: WARP.round * cam.k, c: Math.cos(WARP.tilt), s: Math.sin(WARP.tilt), f, k: cam.k };
}
// the spire's height (<= 0, canvas px) r px from the core - the vertex shader's twin
function warpHeight(p, r) {
  const x = (r - p.r0) / p.kw;
  return p.m * (p.b - Math.hypot(r, p.b)) - p.m2 * p.kw * (x > 20 ? x : Math.log1p(Math.exp(x)));
}
// one frame: the 2D picture onto the cone (aspira-ui.js frame calls this after render)
function warpDraw(dt) {
  const gl = warpInit();
  if (!gl) return;
  if (warp.cv.width !== cv.width || warp.cv.height !== cv.height) { warp.cv.width = cv.width; warp.cv.height = cv.height; }
  if (warp.size !== cv.width + "x" + cv.height) warpMesh(cv.width, cv.height);
  const p = warp.p = warpParams(dt), pr = warp.prog;
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(pr);
  gl.bindTexture(gl.TEXTURE_2D, warp.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  const u = n => gl.getUniformLocation(pr, n);
  gl.uniform2f(u("core"), p.core[0], p.core[1]); gl.uniform2f(u("size"), cv.width, cv.height);
  for (const n of ["m", "m2", "r0", "kw", "b", "c", "s", "f", "k"]) gl.uniform1f(u(n), p[n]);
  gl.uniform2f(u("edge"), WARP.edge[0], WARP.edge[1]);
  const loc = gl.getAttribLocation(pr, "a");
  gl.bindBuffer(gl.ARRAY_BUFFER, warp.buf);
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, warp.n);
}
// a screen point (2D canvas device px) back to the canvas spot drawn there:
// march the eye's ray down to the cone, then bisect. null off the cone.
function unwarp(sx, sy) {
  const p = warp.p;
  if (!p) return { x: sx, y: sy };
  const dx = (sx - p.core[0]) / p.f, dy = -(sy - p.core[1]) / p.f;
  const at = t => { // the ray at t, in the cone's frame, and its height above the cone
    const qx = t * dx, qy = t * dy, qz = p.f - t, py = p.s * qz - p.c * qy, pz = p.s * qy + p.c * qz;
    return { x: qx, y: py, g: pz - warpHeight(p, Math.hypot(qx, py)) };
  };
  const end = p.f * 4, steps = 200;
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
