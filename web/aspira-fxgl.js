// /spire - THE HITS ON THE GPU (owner, 2026-10-14: "a 10x improvement on perf ... avoid lowering resolution or reducing visual
// clarity"). In 3D, a late wave's effects were ~5300 separate 2D canvas fills and strokes a frame (2000 hit rings at 63
// enemies, each a fill AND a stroke), and the GPU drew every one of them alone - ~20 ms of raster on a desktop RTX. Here
// the HITS, SPARKS, FLASHES and plain RINGS of the shots pass (drawFx, aspira-draw.js) are gathered instead and drawn as ONE
// batch of quads into a texture of the board picture's own size (sharper than the moving layer they used to ride, which is
// WARP_DYN_K of it); each still blends on its own, so stacked hits brighten exactly as they did. The bell's shader lays
// this texture over the moving layer (WARP_FS `fxt`). 2D draws them as before. Loaded after aspira-warplayers.js.
const fxGl = { on: false, list: [], rgb: new Map() };
const FXGL_FLOATS = 17, FXGL_IN = 10; // per vertex: corner, p0, p1 (px), radius, half line width, square, fill rgba, stroke rgba (premultiplied); FXGL_IN: floats a pushed shape
// this frame's shots pass gathers for the GPU: 3D, with WebGL up (warpRender draws the moving layer just before warpDraw)
function fxGlTake() { fxGl.on = !fxGl.broken && typeof q3d === "function" && q3d() && !!(typeof warp !== "undefined" && warp.gl); if (!fxGl.on) fxGl.list.length = 0; return fxGl.on; } // (broken: the 2D way)
// a palette colour as 0..1 rgb, read once per colour string through a 1 px canvas
function fxGlRgb(css) {
  let c = fxGl.rgb.get(css);
  if (c) return c;
  const x = (fxGl.px ||= Object.assign(document.createElement("canvas"), { width: 1, height: 1 })).getContext("2d", { willReadFrequently: true });
  x.clearRect(0, 0, 1, 1); x.fillStyle = css; x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  c = [d[0] / 255, d[1] / 255, d[2] / 255]; fxGl.rgb.set(css, c);
  return c;
}
// one shape (world units): the round-ended segment x0,y0 - x1,y1 (a disc when they meet) r round it, filled at fillA in
// fillCss and outlined lw wide at strokeA in strokeCss; square: a fillRect's square instead
function fxGlPush(x0, y0, x1, y1, r, lw, fillCss, fillA, strokeCss, strokeA, square) {
  if (fxGl.list.length > 4e6) return; // (a runaway: never in play)
  fxGl.list.push(x0, y0, x1, y1, r, lw, fillCss, fillA, strokeCss, square ? -strokeA - 1 : strokeA);
}
const fxGlDisc = (x, y, r, lw, css, fillA, strokeA, square) => fxGlPush(x, y, x, y, r, lw, css, fillA, css, strokeA, square);
const FXGL_VS = `
attribute vec2 corner, p0, p1; attribute vec3 rws; attribute vec4 fillC, strokeC;
uniform vec2 S; varying vec2 loc; varying vec4 v; varying vec4 fc, sc;
void main() {
  vec2 d = p1 - p0; float len = length(d); vec2 u = len > 0.001 ? d / len : vec2(1.0, 0.0), nrm = vec2(-u.y, u.x);
  float ext = rws.x + rws.y + 1.5, hl = len * 0.5;
  loc = vec2(corner.x * (hl + ext), corner.y * ext); v = vec4(rws, hl); fc = fillC; sc = strokeC;
  vec2 p = (p0 + p1) * 0.5 + u * loc.x + nrm * loc.y;
  gl_Position = vec4(p.x / S.x * 2.0 - 1.0, p.y / S.y * 2.0 - 1.0, 0.0, 1.0);
}`;
const FXGL_FS = `
precision mediump float;
varying vec2 loc; varying vec4 v; varying vec4 fc, sc;
void main() {
  float d = v.z > 0.5 ? max(abs(loc.x), abs(loc.y)) : length(vec2(max(abs(loc.x) - v.w, 0.0), loc.y));
  float r = max(v.x, 0.5), h = max(v.y, 0.5); /* under a pixel: drawn a pixel wide at its coverage, as a canvas does */
  float fa = (1.0 - smoothstep(r - 0.5, r + 0.5, d)) * min(1.0, v.x * 2.0);
  float sa = v.y > 0.0 ? (1.0 - smoothstep(h - 0.5, h + 0.5, abs(d - v.x))) * min(1.0, v.y * 2.0) : 0.0;
  vec4 s = sc * sa, f = fc * fa;
  gl_FragColor = s + f * (1.0 - s.a);
}`;
function fxGlInit(gl) {
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const tex = fxGl.tex = gl.createTexture(); // (made first: a broken program still leaves the bell a clear texture to read)
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // nothing yet
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, FXGL_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FXGL_FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { fxGl.broken = true; return null; }
  const loc = {}; for (const n of ["corner", "p0", "p1", "rws", "fillC", "strokeC"]) loc[n] = gl.getAttribLocation(pr, n);
  Object.assign(fxGl, { gl, pr, tex, fb: gl.createFramebuffer(), buf: gl.createBuffer(), loc, S: 1, data: new Float32Array(0) });
  return fxGl;
}
// the gathered effects into fxGl.tex (S px a side, the board picture's camera - warp.texCam), before the bell is drawn
function fxGlRender(gl) {
  if (fxGl.broken || (!fxGl.pr && !fxGlInit(gl))) { fxGl.list.length = 0; return; }
  const L = fxGl.list, n = L.length / FXGL_IN, S = cv.width, tc = warp.texCam || cam;
  if (fxGl.S !== S) { gl.bindTexture(gl.TEXTURE_2D, fxGl.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); fxGl.S = S; fxGl.drawn = true; }
  if (!n && !fxGl.drawn) return; // still clear from last frame
  gl.bindFramebuffer(gl.FRAMEBUFFER, fxGl.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fxGl.tex, 0);
  gl.viewport(0, 0, S, S); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  fxGl.drawn = n > 0;
  if (n) {
    const need = n * 6 * FXGL_FLOATS;
    if (fxGl.data.length < need) fxGl.data = new Float32Array(need * 1.5 | 0);
    const D = fxGl.data, k = tc.k, CORNERS = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    let o = 0;
    for (let i = 0; i < L.length; i += FXGL_IN) {
      const sq = L[i + 9] < 0, sa = sq ? -L[i + 9] - 1 : L[i + 9], fa = L[i + 7], [fr, fg, fb] = fxGlRgb(L[i + 6]), [sr, sg, sb] = fxGlRgb(L[i + 8]);
      const x0 = tc.ox + L[i] * k, y0 = tc.oy + L[i + 1] * k, x1 = tc.ox + L[i + 2] * k, y1 = tc.oy + L[i + 3] * k, r = L[i + 4] * k, h = L[i + 5] * k / 2;
      for (let j = 0; j < 12; j += 2) {
        D[o++] = CORNERS[j]; D[o++] = CORNERS[j + 1]; D[o++] = x0; D[o++] = y0; D[o++] = x1; D[o++] = y1; D[o++] = r; D[o++] = h; D[o++] = sq ? 1 : 0;
        D[o++] = fr * fa; D[o++] = fg * fa; D[o++] = fb * fa; D[o++] = fa; D[o++] = sr * sa; D[o++] = sg * sa; D[o++] = sb * sa; D[o++] = sa;
      }
    }
    gl.useProgram(fxGl.pr);
    gl.uniform2f(gl.getUniformLocation(fxGl.pr, "S"), S, S);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, fxGl.buf); gl.bufferData(gl.ARRAY_BUFFER, D.subarray(0, o), gl.STREAM_DRAW);
    const st = FXGL_FLOATS * 4, at = (name, size, off) => { const l = fxGl.loc[name]; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, st, off * 4); };
    at("corner", 2, 0); at("p0", 2, 2); at("p1", 2, 4); at("rws", 3, 6); at("fillC", 4, 9); at("strokeC", 4, 13);
    gl.drawArrays(gl.TRIANGLES, 0, o / FXGL_FLOATS);
    for (const name of ["corner", "p0", "p1", "rws", "fillC", "strokeC"]) gl.disableVertexAttribArray(fxGl.loc[name]); // (the bell's program has its own)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  L.length = 0;
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
