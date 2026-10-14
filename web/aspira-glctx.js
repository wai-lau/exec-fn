// /spire - THE MOVING LAYER ON THE GPU (owner, 2026-10-14: "a 10x improvement on perf ... avoid lowering resolution or
// reducing visual clarity"). In 3D the moving layer (drawSceneTop: ranges, tethers, acid lines and pools, aims, the boss
// bar, leashes...) was drawn on a 2D canvas and that canvas sent up to the GPU EVERY frame - the cost the iPhone felt most.
// warpRender now hands drawSceneTop this stand-in for the 2D context instead: it keeps the same state (it sets every style
// and transform on the real one too) and turns what the batch can draw - full circles filled or stroked, the radial
// gradient discs (gradDisc), straight strokes - into GPU shapes (fxGlPush, aspira-fxgl.js), at the board picture's full
// size. Anything else (text, dashes, glows, clips, polygons filled, part arcs, images, blend modes) is drawn on the real
// canvas exactly as before, and only a frame that drew something there sends it up. Loaded after aspira-fxgl.js.
const GLCTX_PASS = ["globalAlpha", "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalCompositeOperation",
  "shadowBlur", "shadowColor", "font", "textAlign", "textBaseline", "lineDashOffset", "miterLimit", "filter", "imageSmoothingEnabled", "shadowOffsetX", "shadowOffsetY"];
const GLCTX_TAU = 6.283;
function glCtx(real, toWorld) { // toWorld: the real canvas's pixels -> world units (the camera the layer was drawn under)
  if (real.__glc) return Object.assign(real.__glc, { used: false, dash: false, m: [1, 0, 0, 1, 0, 0], stack: [], w2: toWorld }); // one a canvas, made once
  const g = real.__glc = { real, used: false, dash: false, m: [1, 0, 0, 1, 0, 0], stack: [], w2: toWorld };
  for (const k of GLCTX_PASS) Object.defineProperty(g, k, { get: () => real[k], set: v => { real[k] = v; } });
  g.canvas = real.canvas;
  const T = (x, y) => [g.m[0] * x + g.m[2] * y + g.m[4], g.m[1] * x + g.m[3] * y + g.m[5]];
  const sc = () => Math.sqrt(Math.abs(g.m[0] * g.m[3] - g.m[1] * g.m[2]));
  // the path as recorded (user units, under the transform of the moment) and as GPU parts (device px)
  let ops = [], parts = [], odd = false, cur = null;
  const op = (name, a) => { ops.push([name, a, g.m]); }; // (g.m is replaced, never changed in place: safe to keep)
  g.beginPath = () => { ops = []; parts = []; odd = false; cur = null; };
  g.moveTo = (x, y) => { op("moveTo", [x, y]); cur = { pts: [T(x, y)] }; parts.push(cur); };
  g.lineTo = (x, y) => { op("lineTo", [x, y]); if (!cur) { cur = { pts: [] }; parts.push(cur); } cur.pts.push(T(x, y)); };
  g.closePath = () => { op("closePath", []); if (cur) cur.closed = true; };
  g.arc = (x, y, r, a0, a1, ccw) => {
    op("arc", [x, y, r, a0, a1, ccw]);
    const full = Math.abs(a1 - a0) >= GLCTX_TAU - 1e-3, uni = Math.abs(g.m[1]) < 1e-9 && Math.abs(g.m[2]) < 1e-9 && Math.abs(g.m[0] - g.m[3]) < 1e-9;
    if (!full || !uni) { odd = true; return; }
    if (cur && cur.pts.length === 1 && !cur.circle) parts.pop(); // a moveTo just before a whole circle (its start): no line
    const [cx, cy] = T(x, y);
    cur = { circle: [cx, cy, r * sc()] }; parts.push(cur);
  };
  for (const name of ["rect", "ellipse", "quadraticCurveTo", "bezierCurveTo", "arcTo", "roundRect"]) g[name] = (...a) => { op(name, a); odd = true; };
  const replay = () => { // the path onto the real context, each op under its own transform
    const m0 = real.getTransform();
    real.beginPath();
    for (const [name, a, m] of ops) { real.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); real[name](...a); }
    real.setTransform(m0); g.used = true;
  };
  const plain = s => typeof s === "string";
  g.fill = (...a) => {
    const st = real.fillStyle, grad = st && st.__disc;
    if (odd || a.length || real.globalCompositeOperation !== "source-over" || real.shadowBlur > 0 || real.filter !== "none" || parts.some(p => !p.circle) || (!plain(st) && !grad)) { replay(); real.fill(...a); return; }
    for (const p of parts) {
      const [x, y] = g.w2(p.circle[0], p.circle[1]), r = p.circle[2] / g.w2.k;
      if (grad) fxGlPush(x, y, x, y, r, 0, grad.col, real.globalAlpha, grad.col, 0, 3); // the gradDisc: clear at the centre to its colour at the rim
      else fxGlPush(x, y, x, y, r, 0, st, real.globalAlpha, st, 0);
    }
  };
  g.stroke = (...a) => {
    const st = real.strokeStyle, lw = real.lineWidth * sc() / g.w2.k;
    if (odd || a.length || g.dash || real.globalCompositeOperation !== "source-over" || real.shadowBlur > 0 || real.filter !== "none" || !plain(st) ||
      (real.lineJoin !== "round" && parts.some(p => !p.circle && p.pts.length + (p.closed ? 1 : 0) > 2))) { replay(); real.stroke(...a); return; } // (a mitred corner: the canvas)
    const butt = real.lineCap === "butt";
    for (const p of parts) {
      if (p.circle) { const [x, y] = g.w2(p.circle[0], p.circle[1]); fxGlPush(x, y, x, y, p.circle[2] / g.w2.k, lw, st, 0, st, real.globalAlpha); continue; }
      const closed = p.closed && p.pts.length > 2, P = (closed ? [...p.pts, p.pts[0]] : p.pts).map(q => g.w2(q[0], q[1])), n = P.length - 1;
      const dir = i => { const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
      const D = Array.from({ length: n }, (_, i) => dir(i));
      // each segment cut at its joints (the bisector of its direction and its neighbour's): seen-through lines never overlap
      const joint = (u, w) => { const x = u[0] + w[0], y = u[1] + w[1], l = Math.hypot(x, y); return l > 1e-6 ? [x / l, y / l] : [0, 0]; };
      for (let i = 0; i < n; i++) {
        const prev = i > 0 ? D[i - 1] : closed ? D[n - 1] : null, next = i < n - 1 ? D[i + 1] : closed ? D[0] : null;
        const [b0x, b0y] = prev ? joint(prev, D[i]) : [0, 0], [b1x, b1y] = next ? joint(D[i], next) : [0, 0];
        fxGlPush(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], lw / 2, 0, st, real.globalAlpha, st, 0, butt && !prev && !next ? 2 : 0, b0x, b0y, b1x, b1y);
      }
    }
  };
  g.setLineDash = d => { g.dash = !!(d && d.length); real.setLineDash(d); };
  g.getLineDash = () => real.getLineDash();
  g.setTransform = (a, b, c, d, e, f) => { if (typeof a === "object") { const M = a; g.m = [M.a, M.b, M.c, M.d, M.e, M.f]; real.setTransform(M); } else { g.m = [a, b, c, d, e, f]; real.setTransform(a, b, c, d, e, f); } };
  g.getTransform = () => real.getTransform();
  g.transform = (a, b, c, d, e, f) => { real.transform(a, b, c, d, e, f); const M = real.getTransform(); g.m = [M.a, M.b, M.c, M.d, M.e, M.f]; };
  g.translate = (x, y) => g.transform(1, 0, 0, 1, x, y);
  g.scale = (x, y) => g.transform(x, 0, 0, y, 0, 0);
  g.rotate = a => g.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0);
  g.resetTransform = () => g.setTransform(1, 0, 0, 1, 0, 0);
  g.save = () => { g.stack.push([g.m.slice(), g.dash]); real.save(); };
  g.restore = () => { const s = g.stack.pop(); if (s) [g.m, g.dash] = s; real.restore(); };
  // a radial gradient from clear at its centre to one colour at the rim (gradDisc) is drawn by the batch; any other by the canvas
  g.createRadialGradient = (x0, y0, r0, x1, y1, r1) => {
    const gr = real.createRadialGradient(x0, y0, r0, x1, y1, r1), add = gr.addColorStop.bind(gr), stops = [];
    gr.addColorStop = (o, c) => { stops.push([o, c]); add(o, c); gr.__disc = r0 === 0 && x0 === x1 && y0 === y1 && stops.length === 2 && stops[0][0] === 0 && stops[0][1] === "transparent" && stops[1][0] === 1 ? { col: stops[1][1] } : null; };
    return gr;
  };
  // everything else straight to the canvas (and the layer is then sent up this frame)
  for (const name of ["fillText", "strokeText", "drawImage", "fillRect", "strokeRect", "putImageData"]) g[name] = (...a) => { g.used = true; return real[name](...a); };
  g.clearRect = (...a) => real.clearRect(...a);
  g.clip = (...a) => { replay(); real.clip(...a); };
  for (const name of ["measureText", "createLinearGradient", "createPattern", "isPointInPath", "getImageData", "createImageData", "createConicGradient"]) g[name] = (...a) => real[name](...a);
  return g;
}
