// /spire - THE HITS ON THE GPU (owner, 2026-10-14: "a 10x improvement on perf ... avoid lowering resolution or reducing visual
// clarity"). In 3D, a late wave's effects were ~5300 separate 2D canvas fills and strokes a frame (2000 hit rings at 63
// enemies, each a fill AND a stroke), and the GPU drew every one of them alone - ~20 ms of raster on a desktop RTX. Here
// the HITS, SPARKS, FLASHES and plain RINGS of the shots pass (drawFx, aspira-draw.js) are gathered instead and drawn as ONE
// batch of quads into a texture of the board picture's own size (sharper than the moving layer they used to ride, which is
// WARP_DYN_K of it); each still blends on its own, so stacked hits brighten exactly as they did. The bell's shader lays
// this texture over the moving layer (WARP_FS `fxt`). 2D draws them as before. Loaded after aspira-warplayers.js.
const fxGl = { on: false, n: 0, inst: new Float32Array(19 * 4096), rgb: new Map() };
const FXGL_IN = 19; // per shape (one GPU instance): p0, p1 (world), radius, line width, shape, fill rgba, stroke rgba, the two joint planes
// this frame's shots pass gathers for the GPU: 3D, with WebGL up (warpRender draws the moving layer just before warpDraw)
function fxGlTake() { fxGl.on = !fxGl.broken && typeof q3d === "function" && q3d() && !!(typeof warp !== "undefined" && warp.gl); if (!fxGl.on) fxGl.n = 0; return fxGl.on; } // (broken: the 2D way)
// a palette colour as 0..1 rgb, read once per colour string through a 1 px canvas
function fxGlRgb(css) {
  let c = fxGl.rgb.get(css);
  if (c) return c;
  const x = (fxGl.px ||= Object.assign(document.createElement("canvas"), { width: 1, height: 1 })).getContext("2d", { willReadFrequently: true });
  x.clearRect(0, 0, 1, 1); x.fillStyle = css; x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  c = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255]; fxGl.rgb.set(css, c); // (a colour with its own alpha keeps it)
  return c;
}
// one shape (world units): the round-ended segment x0,y0 - x1,y1 (a disc when they meet) r round it, filled at fillA in
// fillCss and outlined lw wide at strokeA in strokeCss; shape: 0 round, 1 (or true) a fillRect's square, 2 a butt-ended
// segment (lineCap "butt"), 3 a disc clear at its centre to its colour at the rim (gradDisc), 4 a light cone (fxGlCone).
// b0 / b1: a polyline's JOINTS - the segment is cut where it meets its neighbour (the bisector, normal b pointing along
// the line) so two segments seen through never overlap there; 0, 0: an open end. Written straight into the instance
// array the GPU reads
function fxGlPush(x0, y0, x1, y1, r, lw, fillCss, fillA, strokeCss, strokeA, shape, b0x = 0, b0y = 0, b1x = 0, b1y = 0) {
  if (fxGl.n >= 1e6) return; // (a runaway: never in play)
  if ((fxGl.n + 1) * FXGL_IN > fxGl.inst.length) { const g = new Float32Array(fxGl.inst.length * 2); g.set(fxGl.inst); fxGl.inst = g; }
  const D = fxGl.inst, f = fxGlRgb(fillCss), c = strokeCss === fillCss ? f : fxGlRgb(strokeCss);
  let o = fxGl.n++ * FXGL_IN;
  D[o++] = x0; D[o++] = y0; D[o++] = x1; D[o++] = y1; D[o++] = r; D[o++] = lw; D[o++] = shape === true ? 1 : shape || 0;
  D[o++] = f[0]; D[o++] = f[1]; D[o++] = f[2]; D[o++] = fillA * f[3]; D[o++] = c[0]; D[o++] = c[1]; D[o++] = c[2]; D[o++] = strokeA * c[3]; D[o++] = b0x; D[o++] = b0y; D[o++] = b1x; D[o] = b1y;
}
const fxGlDisc = (x, y, r, lw, css, fillA, strokeA, square) => fxGlPush(x, y, x, y, r, lw, css, fillA, css, strokeA, square);
// tcam: the board picture's camera (ox, oy px, k px a world unit); the colours premultiplied here
const FXGL_VS = `
attribute vec2 corner, p0, p1; attribute vec3 rws; attribute vec4 fillC, strokeC, clipB;
uniform vec2 S; uniform vec3 tcam; varying vec2 loc; varying vec4 v, fc, sc, cb;
void main() {
  vec2 a = tcam.xy + p0 * tcam.z, b = tcam.xy + p1 * tcam.z;
  vec2 d = b - a; float len = length(d); vec2 u = len > 0.001 ? d / len : vec2(1.0, 0.0), nrm = vec2(-u.y, u.x);
  float r = rws.x * tcam.z, h = rws.y * tcam.z * 0.5, ext = r + h + 1.5, hl = len * 0.5;
  loc = vec2(corner.x * (hl + ext), corner.y * ext); v = vec4(r, h, rws.z, hl);
  cb = vec4(dot(clipB.xy, u), dot(clipB.xy, nrm), dot(clipB.zw, u), dot(clipB.zw, nrm)); /* the joint planes, in the segment's own frame */
  if (rws.z > 3.5) { u = normalize(d); nrm = vec2(-u.y, u.x); loc = corner * (r + 1.5); v.w = len / tcam.z; } /* 4, a cone: round its tip, p1 - p0 its direction, its length the half angle */
  vec2 mid = rws.z > 3.5 ? a : (a + b) * 0.5;
  fc = vec4(fillC.rgb * fillC.a, fillC.a); sc = vec4(strokeC.rgb * strokeC.a, strokeC.a);
  vec2 p = mid + u * loc.x + nrm * loc.y;
  gl_Position = vec4(p.x / S.x * 2.0 - 1.0, p.y / S.y * 2.0 - 1.0, 0.0, 1.0);
}`;
const FXGL_FS = `
precision mediump float;
varying vec2 loc; varying vec4 v, fc, sc, cb;
void main() {
  if ((dot(cb.xy, cb.xy) > 0.0 && dot(loc + vec2(v.w, 0.0), cb.xy) < 0.0) || (dot(cb.zw, cb.zw) > 0.0 && dot(loc - vec2(v.w, 0.0), cb.zw) > 0.0)) discard;
  float sh = floor(v.z + 0.5);
  float d = sh == 1.0 ? max(abs(loc.x), abs(loc.y)) : sh == 2.0 ? max(abs(loc.x) - v.w + v.x, abs(loc.y)) : length(vec2(max(abs(loc.x) - v.w, 0.0), loc.y)); /* square, butt segment, round */
  float r = max(v.x, 0.5), h = max(v.y, 0.5); /* under a pixel: drawn a pixel wide at its coverage, as a canvas does */
  float fa = (1.0 - smoothstep(r - 0.5, r + 0.5, d)) * min(1.0, v.x * 2.0), g = 1.0; /* g: a gradient's share of the colour */
  float sa = v.y > 0.0 ? (1.0 - smoothstep(h - 0.5, h + 0.5, abs(d - v.x))) * min(1.0, v.y * 2.0) : 0.0;
  if (sh == 3.0) g = clamp(d / max(v.x, 0.001), 0.0, 1.0); /* the gradient disc: clear at the centre to its colour at the rim */
  if (sh == 4.0) { float dd = length(loc), ang = abs(atan(loc.y, loc.x)); fa = (1.0 - smoothstep(v.x - 0.5, v.x + 0.5, dd)) * (1.0 - smoothstep(-0.5, 0.5, (ang - v.w) * dd)); g = clamp(1.0 - dd / max(2.0 * v.y, 0.001), 0.0, 1.0); sa = 0.0; } /* the cone: its colour at the tip to clear at 2h */
  /* a canvas gradient to "transparent" (black at alpha 0) runs through the dark between: colour x g x g, alpha x g */
  vec4 s = sc * sa, f = vec4(fc.rgb * g * g, fc.a * g) * fa;
  gl_FragColor = s + f * (1.0 - s.a);
}`;
function fxGlInit(gl) {
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const tex = fxGl.tex = gl.createTexture(); // (made first: a broken program still leaves the bell a clear texture to read)
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // nothing yet
  const ext = gl.getExtension("ANGLE_instanced_arrays"), pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, FXGL_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FXGL_FS)); gl.linkProgram(pr);
  if (!ext || !gl.getProgramParameter(pr, gl.LINK_STATUS)) { fxGl.broken = true; return null; } // (no instancing: the 2D way)
  const loc = {}; for (const n of ["corner", "p0", "p1", "rws", "fillC", "strokeC", "clipB"]) loc[n] = gl.getAttribLocation(pr, n);
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  Object.assign(fxGl, { gl, pr, ext, tex, quad, fb: gl.createFramebuffer(), buf: gl.createBuffer(), loc, S: 1, u: { S: gl.getUniformLocation(pr, "S"), tcam: gl.getUniformLocation(pr, "tcam") } });
  return fxGl;
}
// the gathered effects into fxGl.tex (S px a side, the board picture's camera - warp.texCam), before the bell is drawn
function fxGlRender(gl) {
  if (fxGl.broken || (!fxGl.pr && !fxGlInit(gl))) { fxGl.n = 0; return; }
  const n = fxGl.n, S = cv.width, tc = warp.texCam || cam, X = fxGl.ext, L = fxGl.loc;
  if (fxGl.S !== S) { gl.bindTexture(gl.TEXTURE_2D, fxGl.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); fxGl.S = S; fxGl.drawn = true; }
  if (!n && !fxGl.drawn) return; // still clear from last frame
  gl.bindFramebuffer(gl.FRAMEBUFFER, fxGl.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fxGl.tex, 0);
  gl.viewport(0, 0, S, S); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  fxGl.drawn = n > 0;
  if (n) {
    gl.useProgram(fxGl.pr);
    gl.uniform2f(fxGl.u.S, S, S); gl.uniform3f(fxGl.u.tcam, tc.ox, tc.oy, tc.k);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, fxGl.quad); gl.enableVertexAttribArray(L.corner); gl.vertexAttribPointer(L.corner, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, fxGl.buf); gl.bufferData(gl.ARRAY_BUFFER, fxGl.inst.subarray(0, n * FXGL_IN), gl.STREAM_DRAW);
    const st = FXGL_IN * 4, at = (name, size, off) => { const l = L[name]; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, st, off * 4); X.vertexAttribDivisorANGLE(l, 1); };
    at("p0", 2, 0); at("p1", 2, 2); at("rws", 3, 4); at("fillC", 4, 7); at("strokeC", 4, 11); at("clipB", 4, 15);
    X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, n);
    for (const name of ["corner", "p0", "p1", "rws", "fillC", "strokeC", "clipB"]) { X.vertexAttribDivisorANGLE(L[name], 0); gl.disableVertexAttribArray(L[name]); } // (the bell's program shares the attribute slots)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  fxGl.n = 0;
}
// drawFx's shots pass hands each effect here first (3D): true when it was gathered for the GPU - the same sizes, alphas and
// order its 2D drawing (drawFx, aspira-draw.js) uses (a = the fade, globalAlpha at that point)
function fxGlFx(f, k, a) {
  if (f.k === "hit") { fxGlDisc(f.x, f.y, f.r * (0.5 + 0.5 * (1 - k)), 1 + (f.m || 0) * 0.6, COL[f.color], a * 0.3, a); return true; }
  if (f.k === "spark") { fxGlDisc(f.x, f.y, 1.5, 0, COL[f.color], a, 0, true); return true; }
  if (f.k === "flash") { fxGlDisc(f.x, f.y, f.r * (1.3 - 0.3 * k), 0, COL.white, k, 0); return true; }
  if (f.k === "ring" && !f.grad && f.outline !== false) { fxGlDisc(f.x, f.y, f.r * (1 - k * 0.5), f.w || 2, COL[f.color], 0, Math.min(1, a * (f.a || 1))); return true; }
  if (f.k === "beam") { fxGlBeam(f, Math.min(1, a * (f.alpha ?? 1) * BEAM_BRIGHT)); return true; }
  return false;
}
// a BEAM: each stroke of drawFx's, widest glow first, as round-ended segments (one per beam of a multi-beam shot)
function fxGlBeam(f, a) {
  const x1 = f.a ? f.a.x : f.x1, y1 = f.a ? f.a.y : f.y1, x2 = f.b ? f.b.x : f.x2, y2 = f.b ? f.b.y : f.y2, segs = [];
  if (f.beams > 1) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, px = -(y2 - y1) / len, py = (x2 - x1) / len;
    for (let i = 0; i < f.beams; i++) { const o = (i - (f.beams - 1) / 2) * 2 * TWIN_GAP; segs.push([x1 + px * o, y1 + py * o]); }
  } else segs.push([x1, y1]);
  const line = (w, css, al) => { for (const [sx, sy] of segs) fxGlPush(sx, sy, x2, y2, w / 2, 0, css, al, css, 0); };
  const core = (f.soft ? BEAM_MIN + (beamWidth(f.d || 0) - BEAM_MIN) * ARC_W_CORR : beamWidth(f.d || 0)) * (f.thin || 1), col = COL[f.color];
  if (f.m && !lowQ) {
    if (f.slim) for (let i = 4; i >= 1; i--) line(core * SOL_BEAM_W * (1 + i * 0.25), col, Math.min(1, a * SOL_GLOW_A * BEAM_BRIGHT));
    else line(core * (f.soft ? ARC_GLOW_W : 3), col, Math.min(1, a * (f.soft ? ARC_GLOW_A : 0.22) * BEAM_BRIGHT));
  }
  const ca = f.slim ? Math.min(1, a * 1.5) : a, cw = f.slim ? core * SOL_BEAM_W : core;
  line(cw, f.slim ? COL.white : col, ca);
  if (f.pierce) line(Math.max(1, cw * 0.35), COL.white, ca);
}
// the COINS (drawCoins, aspira-floats.js) in 3D: a disc in its fill, ringed in its ring colour when the two differ
function fxGlCoin(x, y, r, ring, fill, a) { fxGlPush(x, y, x, y, r, ring !== fill ? 1.1 : 0, COL[fill], a, COL[ring], ring !== fill ? a : 0); }
// SOL's light CONE (drawCone, aspira-skills.js) through the GPU stand-in: a sector f.half either side of f.a, f.len long,
// its colour at the tip fading to clear at f.len x SOL_CONE_FADE
function fxGlCone(f, a) {
  fxGlPush(f.x, f.y, f.x + Math.cos(f.a) * f.half, f.y + Math.sin(f.a) * f.half, f.len, f.len * SOL_CONE_FADE, COL[f.color], a, COL[f.color], 0, 4);
}
