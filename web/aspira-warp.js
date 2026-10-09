// /spire — the 3D VIEW (owner, 2026-10-09: "change quality to a slider: low,
// high, 3D"; "curved spacetime ... reverse the dip, so it's a tower").
// A VIEW, never a rule: the 2D canvas still draws the board exactly as on high,
// only hidden (opacity 0), and this WebGL canvas over it lays that picture on a
// FUNNEL - a GRAVITY WELL flipped upside down (owner, 2026-10-09: a black hole diagram's funnel,
// "flipped, towers like angels dancing on the top"): the towers and core stand on a level HEAD
// (out to WARP_TOWERS), then the neck falls away, steep first and flattening to the floor at the
// lanes' mouths (R0): height -WARP.depth x (1 - (1 - t)^WARP.pow), t = 0 at the head's rim, 1 at R0.
// Enemies come in on the level floor and climb the spire to the core.
// SEMI-TRANSPARENT (owner: "should not occlude"): no depth test, the whole surface at WARP.alpha,
// and the board's own background is clear - only what is drawn on it shows, front and back.
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
// ISOMETRIC (owner, 2026-10-09, after the funnel: "keep everything on the flat plane, but in 3D just have a
// camera pointed isometrically to the core"): the board stays FLAT (depth 0, head 1 - the funnel's knobs
// left at rest), seen from 35.3 deg above it (tilt = atan(sqrt 2), the isometric elevation) through a lens
// so long (fov 0.02) it is all but orthographic, centred on the core (anchor 0); the surface opaque again
const WARP = { tilt: 0.55 /* owner: "much more top down instead" (was 0.9553, isometric), then "a little bit less top down" (was 0.4) */, fov: 0.9 /* owner: "increase size changes based on distance from camera" (was 0.02, near-orthographic); the scale AT the core is the same for any fov */, edge: [760, 840], depth: 0, pow: 2, zoom: 1, anchor: 0, alpha: 1, bgA: 1, prism: { tower: 6 /* a fresh tower and an empty slot (was 24) */, perPoint: 4, below: 1 /* centred on the plane (owner, was 3) */ } /* the core's height: towerH's sum / 6 + the tallest (warpEntities) */, head: 1, shoulder: 0.12, grid: { ring: 110, neck: 0, spokes: 24, far: 2400, a: 0, onBoard: 0.8 } }; // grid.a 0: no gravity-well grid (owner: "get rid of gravity well curvature indicators")
// the tower ring's outer edge, world units from the core: the plateau the towers stand on
const WARP_TOWERS = Math.max(...CELLS.map(c => Math.hypot(c.x - CX, c.y - CY))) + CELL_S * 1.5;
const warp = { gl: null, cv: null, prog: null, buf: null, tex: null, n: 0, p: null, ent: null };

// the mesh is POLAR, in world units round the core: a = (radius, angle)
const WARP_VS = `
attribute vec2 a;
uniform vec2 core, size; uniform vec3 texCam; uniform float D, L, P, T, c, s, f, k, z, oy, hc, e; // texCam: the picture's own core (px) and scale
varying vec2 uv; varying float sh, rr, th;
void main() {
  float r = a.x * k; vec2 dir = vec2(cos(a.y), sin(a.y)), wp = r * dir;
  float v = r < T ? hc * r : r < L ? hc * T + (r - T) * (L - hc * T) / (L - T) : r; // warpView's twin
  vec2 p = v * dir;
  float t = (v - hc * T) / (L - hc * T), sm = e * log(1.0 + exp(t / e)) / (e * log(1.0 + exp(1.0 / e)));
  float g = 1.0 - pow(1.0 - clamp(sm, 0.0, 1.0), P), h = -D * g;
  float qy = -c * p.y + s * h, qz = s * p.y + c * h, w = f - qz;
  vec2 sc = core + vec2(0.0, oy) + z * vec2(f * p.x, -f * qy) / w;
  uv = (texCam.xy + a.x * texCam.z * dir) / size; rr = a.x; th = a.y; sh = 1.0 - 0.45 * g;
  gl_Position = vec4((sc.x / size.x * 2.0 - 1.0) * w, (1.0 - sc.y / size.y * 2.0) * w, (w / (80.0 * size.y) * 2.0 - 1.0) * w, w);
}`;
const WARP_FS = `
precision mediump float;
uniform sampler2D tex; uniform vec2 edge; uniform vec3 gridCol; uniform vec4 grid; // grid: ring, spoke angle, far, alpha
uniform float towers, onBoard, op, neck, bgA, invR; uniform vec3 bgCol, shape; // shape: the funnel's head rim, foot (world units), power // op: the whole bell SEMI-TRANSPARENT, nothing occluded (owner)
varying vec2 uv; varying float sh, rr, th;
float line(float d, float wd) { return 1.0 - smoothstep(wd * 0.5, wd * 1.5, d); }
void main() {
  vec2 inUv = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  float board = inUv.x * inUv.y * (1.0 - smoothstep(edge.x, edge.y, rr));
  float wd = 0.8 + rr * 0.0025;
  float out2 = 1.0 + step(edge.y, rr), rs = grid.x * out2, as = grid.y * out2; // half as many lines outside the board
  float ring = line(abs(fract(rr / rs + 0.5) - 0.5) * rs, wd);
  // up the NECK the rings are spaced by HEIGHT, not radius - neck of them, crowding where it is steep (owner: "dense near the top")
  float t = clamp((rr - shape.x) / (shape.y - shape.x), 0.0, 1.0), gi = floor((1.0 - pow(1.0 - t, shape.z)) * neck + 0.5) / neck;
  float ri = shape.x + (shape.y - shape.x) * (1.0 - pow(1.0 - gi, 1.0 / shape.z));
  if (neck > 0.0 && rr < shape.y) ring = line(abs(rr - ri), wd);
  float hs = grid.x * 0.5; // the level HEAD carries rings too, every half ring (owner: "have the curvature lines continue all the way up")
  if (neck > 0.0 && rr < shape.x) ring = line(abs(fract(rr / hs + 0.5) - 0.5) * hs, wd);
  float spoke = line(abs(fract(th / as + 0.5) - 0.5) * as * rr, wd);
  // up to the core (the spokes fade where they crowd it), half as strong over the head
  float gk = max(ring, spoke * smoothstep(20.0, 60.0, rr)) * grid.w * (0.5 + 0.5 * smoothstep(towers, towers + 30.0, rr)) * (1.0 - smoothstep(grid.z * 0.7, grid.z, rr));
  gk *= 1.0 - board * (1.0 - onBoard); // faint over the board itself: the lanes stay readable
  vec3 raw = texture2D(tex, uv).rgb;
  // a BOSS SKY inverts the board (white ground, dark ink): back to the plain palette here, or its white reads as ink
  // and the bell turns into a grey slab (owner, 2026-10-09)
  // only INSIDE the sky's circle round the core (invR, world units; the 2D view inverts exactly there): a guess by colour
  // flipped every white beam and orange ring
  if (rr < invR) raw = 1.0 - raw;
  vec3 col = raw * sh * board;
  vec3 ink = max(col - bgCol * sh * board, 0.0); // what is DRAWN on the board, over its background
  float lit = clamp(max(max(ink.r, ink.g), ink.b) * 3.0, 0.0, 1.0); // the background itself is see-through: seen from above, the wall stacks a hundred layers of it over the top
  float A = max(lit, bgA * board); // the board's background TRANSLUCENT, not clear (owner): it dims what lies behind it
  vec3 c = col * lit + bgCol * sh * (A - lit); // premultiplied: the ink over a translucent fill of the plain background
  gl_FragColor = vec4(mix(c, gridCol * sh, gk), max(A, gk)) * op;
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
  // OUTSIDE IN: with no depth test the last drawn wins, and the head (nearest the eye) must come last (owner: "flat part is occluding everything?")
  for (let i = R.length - 2; i >= 0; i--) for (let j = 0; j < WARP_SEG; j++) {
    const a0 = j * da, a1 = (j + 1) * da;
    v.push(R[i], a0, R[i + 1], a0, R[i], a1, R[i + 1], a0, R[i + 1], a1, R[i], a1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, warp.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  warp.n = v.length / 2;
}
// the grid's colour, the chart's own grid swatch (COL.grid, "rgb(r, g, b)") as 0..1
const warpGridRgb = (key = "grid") => (String(COL[key] || COL.green).match(/[\d.]+/g) || [0, 255, 0]).slice(0, 3).map(n => n / 255);
// this frame's bell, centred on the core's canvas spot
function warpParams() {
  const f = cv.height / 2 / Math.tan(WARP.fov / 2), D = WARP.depth * cam.k, c = Math.cos(WARP.tilt), s = Math.sin(WARP.tilt);
  const oy = -WARP.anchor * WARP.zoom * f * s * D / (f + c * D); // the bell's foot sits this far below the tip on screen
  return { core: [cam.ox + CX * cam.k, cam.oy + CY * cam.k], D, L: R0 * cam.k, T: WARP_TOWERS * cam.k, hc: WARP.head, e: WARP.shoulder, P: WARP.pow, c, s, f, k: cam.k, z: WARP.zoom, oy };
}
// the spire's height (<= 0, canvas px) r px from the core - the vertex shader's twin
// r is a VIEW radius (warpView). The shoulder is SOFT (owner: "don't have a sharp shoulder"): a
// softplus `shoulder` wide eases the level head into the neck, so the head dips a hair at its rim
function warpHeight(p, r) {
  const sp = t => p.e * Math.log(1 + Math.exp(t / p.e)), t = (r - p.hc * p.T) / (p.L - p.hc * p.T);
  return -p.D * (1 - Math.pow(1 - Math.min(1, Math.max(0, sp(t) / sp(1))), p.P));
}
// the 3D view draws the HEAD smaller (owner: "move towers closer to core"): world radius r (canvas
// px) -> view radius, x WARP.head inside the tower ring, the neck stretched to meet R0, the same past
// it; a view, so ranges and the game keep the world's. warpUnview is its inverse.
function warpView(p, r) { return r < p.T ? p.hc * r : r < p.L ? p.hc * p.T + (r - p.T) * (p.L - p.hc * p.T) / (p.L - p.T) : r; }
function warpUnview(p, v) { return v < p.hc * p.T ? v / p.hc : v < p.L ? p.T + (v - p.hc * p.T) * (p.L - p.T) / (p.L - p.hc * p.T) : v; }
// the PICTURE for the 3D view (owner, 2026-10-09: "render randomly cuts off at the top"): leaned back, the view shows
// far more of the board than the 2D screen held, so the frame is drawn for the texture with a camera of its own that
// fits the WHOLE board (WARP_TEX_R world units round the core) in the canvas; the view keeps the player's camera
const WARP_TEX_R = 860;
function warpRender() {
  const view = { ...cam }, k = Math.min(cv.width, cv.height) / (2 * WARP_TEX_R);
  Object.assign(cam, { k, ox: cv.width / 2 - CX * k, oy: cv.height / 2 - CY * k });
  try { render(); } finally { warp.texCam = { ...cam }; Object.assign(cam, view); }
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
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // no depth: the far side shows through the near (owner: "should not occlude")
  gl.useProgram(pr);
  gl.bindTexture(gl.TEXTURE_2D, warp.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  const u = n => gl.getUniformLocation(pr, n);
  gl.uniform2f(u("core"), p.core[0], p.core[1]); gl.uniform2f(u("size"), cv.width, cv.height);
  const tc = warp.texCam || cam; gl.uniform3f(u("texCam"), tc.ox + CX * tc.k, tc.oy + CY * tc.k, tc.k);
  for (const n of ["D", "L", "P", "T", "hc", "e", "c", "s", "f", "k", "z", "oy"]) gl.uniform1f(u(n), p[n]);
  gl.uniform2f(u("edge"), WARP.edge[0], WARP.edge[1]);
  gl.uniform3fv(u("gridCol"), warpGridRgb()); gl.uniform3fv(u("bgCol"), warpGridRgb("bg"));
  gl.uniform4f(u("grid"), WARP.grid.ring, Math.PI * 2 / WARP.grid.spokes, WARP.grid.far, WARP.grid.a);
  gl.uniform1f(u("towers"), WARP_TOWERS); gl.uniform1f(u("onBoard"), WARP.grid.onBoard); gl.uniform1f(u("op"), WARP.alpha); gl.uniform1f(u("neck"), WARP.grid.neck); gl.uniform1f(u("bgA"), WARP.bgA); gl.uniform1f(u("invR"), bossInv.phase === "off" ? -1 : bossInv.full || lowQ ? 1e9 : bossInv.r); gl.uniform3f(u("shape"), WARP_TOWERS, R0, WARP.pow);
  const loc = gl.getAttribLocation(pr, "a");
  gl.bindBuffer(gl.ARRAY_BUFFER, warp.buf);
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, warp.n);
  warpEntities();
}
// a world point to the screen: its canvas spot lifted onto the bell and seen by the camera;
// s is the perspective scale there (1 at the core's height)
function warpProject(x, y, hAt) { // hAt: a height of your own (canvas px) instead of the surface's
  const p = warp.p, wx = cam.ox + x * cam.k - p.core[0], wy = cam.oy + y * cam.k - p.core[1];
  const r = Math.hypot(wx, wy), m = r ? warpView(p, r) / r : p.hc;
  return warpProjectV(wx * m, wy * m, hAt);
}
// the same from a VIEW spot (canvas px from the core, after warpView)
function warpProjectV(px, py, hAt) {
  const p = warp.p, h = hAt ?? warpHeight(p, Math.hypot(px, py)), qy = -p.c * py + p.s * h, qz = p.s * py + p.c * h, w = p.f - qz;
  return { x: p.core[0] + p.z * p.f * px / w, y: p.core[1] + p.oy - p.z * p.f * qy / w, s: p.z * p.f / w, h };
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
  // FACING UP (owner: "render towers and enemies as if facing up, not toward the camera"), and ONE SHAPE
  // everywhere ("towers should not change shape based on distance from core"): the camera's lean squashes
  // every sprite alike (cos tilt) and only its size follows the perspective - no per-spot skew
  // then (owner: "tower movement indicators and towers not following the same perspective?"): the board's own
  // PERSPECTIVE at the spot - one world unit along x and y on the level plane at that height - so a top lines up
  // with the floor under it; the funnel's anisotropic squeeze that once warped them is gone
  const up = (x, y, fn, h) => { // h: raised this high (world units) - a prism's top
    const [a, b, c2, d, e, f] = warpFrame(x, y, h || 0);
    ctx.setTransform(a, b, c2, d, e, f);
    ctx.save(); fn(); ctx.restore();
  };
  const atCell = (cell, fn) => up(cell.x, cell.y, fn);
  const all = () => {
    // the slots: each one's drawing caught here, drawn on the top of its own DOTTED prism below (owner: "empty tower slots
    // should have prisms too, just use dotted lines")
    const cellDraw = new Map(); drawCells((c, fn) => cellDraw.set(c, fn));
    if (ui.build && ui.hover) up(ui.hover.x, ui.hover.y, drawPlacement);
    // the bodies as real dice, the farthest first (aspira-solids.js), each inside its shield's walls (aspira-walls.js)
    const dice = [...G.enemies].sort((a, b) => a.y - b.y).map(e => ({ e, w: enemyWallPieces(e), col: COL[ENEMIES[e.type].color] }));
    const drawDice = () => { for (const { e, w, col } of dice) { if (w.length) warpWalls(w, e.y, false, WALL_H.enemy, col, 0.8); warpSolid(e); if (w.length) warpWalls(w, e.y, true, WALL_H.enemy, col, 0.8); } };
    // the towers and the core STAND UP as hexagonal prisms (owner: "core taller than towers"), the farthest
    // first, each one's usual drawing on its raised top; over the enemies, which walk on the floor
    const solids = G.towers.map(t => {
      const c0 = CELLS[t.cell], x = t.x ?? c0.x, y = t.y ?? c0.y;
      const h = towerH(t);
      return { x, y, h, col: COL[TOWERS[t.kind].color], pts: c0.pts.map(p => ({ x: x + (p.x - c0.x) * TOWER_K, y: y + (p.y - c0.y) * TOWER_K })),
        top: () => ownColours(() => up(x, y, () => drawTower(t), h / 2)) };
    });
    CELLS.forEach((c, ci) => {
      if (!cellOpen(ci) || G.towers.some(t => t.cell === ci)) return;
      const hh = WARP.prism.tower / 2;
      solids.push({ x: c.x, y: c.y, h: WARP.prism.tower, col: ui.build && canPlace(ci) ? COL[TOWERS[ui.build].color] : COL.white, dash: true,
        pts: c.pts.map(p => ({ x: c.x + (p.x - c.x) * TOWER_K, y: c.y + (p.y - c.y) * TOWER_K })),
        top: () => { up(c.x, c.y, cellDraw.get(c), hh); if (!G.towers.length && !ui.build) drawSlotArrow((cc, fn) => (cc === c ? up(c.x, c.y, fn, hh) : null)); } });
    });
    const hs = G.towers.map(towerH), coreH = hs.length ? hs.reduce((a, b) => a + b, 0) / 6 + Math.max(...hs) : WARP.prism.tower;
    warp.lightZ = coreH / 2; // the dice are lit from the core's top (aspira-solids.js)
    solids.push({ x: CX, y: CY, h: coreH, col: COL.white, pts: Array.from({ length: 6 }, (_, i) => ({ x: CX + CORE_R * Math.cos(Math.PI / 6 + i * Math.PI / 3), y: CY + CORE_R * Math.sin(Math.PI / 6 + i * Math.PI / 3) })),
      // the core's SHIELDS (its life and level rings) stand on the FLOOR (owner: "core shields on plane level") as walls,
      // the ones behind the core before its prism and the ones in front after (aspira-walls.js); the top is the plain
      // white hex and the credits
      pre: () => { warpWalls(warp.coreWalls, CY, false, WALL_H.core, COL.white, 1); },
      post: () => warpWalls(warp.coreWalls, CY, true, WALL_H.core, COL.white, 1),
      top: () => { up(CX, CY, () => { poly(CX, CY, CORE_R, 6, Math.PI / 6, false); ctx.fillStyle = COL.white; ctx.globalAlpha = 1; ctx.fill(); drawCredits("count"); }, coreH / 2); up(CX, CY, drawCoreHud, coreH / 2); } });
    solids.sort((a, b) => warpProject(a.x, a.y).y - warpProject(b.x, b.y).y);
    const drawSolids = tops => { for (const o of solids) { if (o.pre) o.pre(); warpPrism(o); if (tops) o.top(); if (o.post) o.post(); } };
    // BELOW the floor, fading slice by slice, then the tracers and marks on it, then ABOVE (aspira-fog.js; owner: "geometry
    // should just start losing opacity in a gradient when lower than the floor")
    warp.coreWalls = coreWallPieces(); // once a frame (it keeps the life segments in step)
    warpBands(above => { if (above) for (const e of G.enemies) up(e.x, e.y, () => drawEnemy(e, true)); drawDice(); drawSolids(above); }); // (the tracers and marks: flat on the floor, through the die's centre)
    // every POP-UP text over all of it (owner: "make sure all pop up text, like interest, is above the rendering"),
    // facing the camera (at) so it stays readable: damage numbers, the floating texts, the banner and the boss's title
    // and with NO perspective (owner: "no perspective effects on that"): at its spot, the board's plain scale
    // - except the DAMAGE numbers, smaller the farther off (owner: "have them smaller if further away"): the perspective's
    // size there, never its skew
    const pop = (x, y, fn, far) => { const P = warpProject(x, y), k = cam.k * (far ? P.s : 1); ctx.setTransform(k, 0, 0, k, P.x - x * k, P.y - y * k); ctx.save(); fn(); ctx.restore(); };
    drawFx("dmg", (x, y, fn) => pop(x, y, fn, true)); drawFx("text", pop);
    if (bannerT > 0) pop(CX, 70, () => { ctx.globalAlpha = Math.min(1, bannerT); text(bannerText, CX, 70, 30, bannerCol, true); ctx.globalAlpha = 1; });
    pop(CX, CY, drawBossTitle); pop(CX, CY, () => drawCredits("pop")); // (the interest pop-up too)
  };
  // the BOSS SKY's inversion is the TOP LAYER (owner: "color inversion is broken, have it as the top layer"): this canvas
  // carries the bell's picture under everything it draws, and the sky's circle - projected onto the floor, the whole
  // view once it is full - is laid over all of it as a DIFFERENCE with white. So no sprite is drawn in the
  // inverted palette any more, and the bell's own picture is plain (the shader turns the 2D sky back)
  try {
    ctx.drawImage(warp.cv, 0, 0);
    all();
    if (bossInv.phase !== "off" && (bossInv.full || bossInv.r > 1)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "difference"; ctx.fillStyle = COL.white; ctx.beginPath();
      if (bossInv.full) ctx.rect(0, 0, c.width, c.height);
      else for (let i = 0; i < 64; i++) { const a = i * Math.PI / 32, Q = warpProject(bossInv.x + Math.cos(a) * bossInv.r, bossInv.y + Math.sin(a) * bossInv.r, 0); if (i) ctx.lineTo(Q.x, Q.y); else ctx.moveTo(Q.x, Q.y); }
      ctx.fill(); ctx.globalCompositeOperation = "source-over";
    }
  } finally { ctx = main; }
}
// a tower's height: as TALL as its level (owner: "make towers shorter, but make their height proportional to their level"):
// every chart POINT (t.lvl - 1) adds WARP.prism.perPoint - the look's own level (shownLvl) moves only every five points.
// The CORE stands (all towers' heights) / 6 + the tallest's (owner, 2026-10-09), a fresh tower's with none built
const towerH = t => WARP.prism.tower + WARP.prism.perPoint * (t.lvl - 1);
// the canvas transform that lays world (x, y) on the level plane h world units up, as seen at (x, y): its
// projection there and one world unit along x and along y
function warpFrame(x, y, h) {
  const H = h * cam.k, P = warpProject(x, y, H), X = warpProject(x + 1, y, H), Y = warpProject(x, y + 1, H);
  const a = X.x - P.x, b = X.y - P.y, c = Y.x - P.x, d = Y.y - P.y;
  return [a, b, c, d, P.x - a * x - c * y, P.y - b * x - d * y];
}
// one hexagonal PRISM's walls: its floor hex `pts` raised `h` world units, the walls farthest first, each
// filled with the background and tinted by how squarely it faces the camera, its edges in the colour
function warpPrism(o) {
  // CENTRED on the floor (owner: "their center is on the plane, not the bottom"): half below it, half above
  // its top and bottom outlines in the SAME frame the top's drawing gets (up: one squash for all), so the drawing
  // sits exactly on the walls (owner: "tower tops are not sitting on top")
  const H = o.h * cam.k / 2, n = o.pts.length, frame = h => { const [a, b, c2, d, e, f] = warpFrame(o.x, o.y, h / cam.k); return p => ({ x: a * p.x + c2 * p.y + e, y: b * p.x + d * p.y + f }); };
  // ... and it comes to a POINT below (owner: "instead of hexagonal prisms, make them all come to a point at the bottom")
  // (a POINTED bottom was tried and dropped: "change the towers and core back to prisms instead of pointy")
  const ft = frame(H), fb = frame(-H * WARP.prism.below), B = o.pts.map(p => ({ ...fb(p), z: -o.h / 2 * WARP.prism.below })), T = o.pts.map(p => ({ ...ft(p), z: o.h / 2 })); // z in world units (aspira-fog.js) // below: x the half height under the floor (owner: "3x the distance below plane")
  const walls = o.pts.map((p, i) => { const q = o.pts[(i + 1) % n], mx = (p.x + q.x) / 2 - o.x, my = (p.y + q.y) / 2 - o.y; const ml = Math.hypot(mx, my) || 1, lx = CX - o.x, ly = CY - o.y, ll = Math.hypot(lx, ly); return { i, j: (i + 1) % n, face: my / ml, lit: ll < 1 ? 1 : Math.max(0, (mx * lx + my * ly) / (ml * ll)) }; }); // lit: the wall faces the core (the core's own: all lit)
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineJoin = "round"; ctx.lineWidth = 1.5 * cam.k;
  if (o.dash) { // an empty slot: a DOTTED wireframe, nothing filled
    ctx.setLineDash([2 * cam.k, 3 * cam.k]); ctx.strokeStyle = o.col; ctx.globalAlpha = 0.45 * warpFade; ctx.beginPath();
    for (let i = 0; i < n; i++) { warpLine(B[i], B[(i + 1) % n]); warpLine(B[i], T[i]); } // (the top ring is the slot's own outline, drawn on it)
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; return;
  }
  for (const w of walls.sort((a, b) => a.face - b.face)) { // +y faces the camera
    const quad = [B[w.i], B[w.j], T[w.j], T[w.i]];
    if (!warpPath(quad)) continue;
    ctx.globalAlpha = warpFade; ctx.fillStyle = COL.bg; ctx.fill();
    ctx.globalAlpha = (0.12 + 0.28 * w.lit) * warpFade; ctx.fillStyle = o.col; ctx.fill(); // lit from the CORE (owner: "the light source should come from the core")
    warpEdges(quad); ctx.globalAlpha = 0.8 * warpFade; ctx.strokeStyle = o.col; ctx.stroke();
  }
  ctx.globalAlpha = 1;
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
      const hit = at((lo + hi) / 2), v = Math.hypot(hit.x, hit.y), m = v ? warpUnview(p, v) / v : 1 / p.hc; // back to the world's radius
      return { x: p.core[0] + hit.x * m, y: p.core[1] + hit.y * m };
    }
    lo = t; prev = cur;
  }
  return null;
}
