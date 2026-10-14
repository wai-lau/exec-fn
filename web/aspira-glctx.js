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
    if (!uni) { odd = "arc:skewed"; return; }
    if (!full) { // a PART arc (the threat ring): short straight pieces on from the current point, as the canvas would join it
      const span = ccw ? -(((a0 - a1) % GLCTX_TAU + GLCTX_TAU) % GLCTX_TAU) : ((a1 - a0) % GLCTX_TAU + GLCTX_TAU) % GLCTX_TAU, n = Math.max(8, Math.min(160, Math.round(Math.abs(span) * r * sc() / 3)));
      if (!cur || cur.circle) { cur = { pts: [] }; parts.push(cur); }
      for (let i = 0; i <= n; i++) { const t = a0 + span * i / n; cur.pts.push(T(x + r * Math.cos(t), y + r * Math.sin(t))); }
      return;
    }
    if (cur && cur.pts.length === 1 && !cur.circle) parts.pop(); // a moveTo just before a whole circle (its start): no line
    const [cx, cy] = T(x, y);
    cur = { circle: [cx, cy, r * sc()] }; parts.push(cur);
  };
  for (const name of ["rect", "quadraticCurveTo", "bezierCurveTo", "arcTo", "roundRect"]) g[name] = (...a) => { op(name, a); odd = name; };
  g.ellipse = (x, y, rx, ry, rot, a0, a1, ccw) => { // a whole one: a closed line of short straight pieces (the moons' orbit)
    op("ellipse", [x, y, rx, ry, rot, a0, a1, ccw]);
    if (Math.abs(a1 - a0) < GLCTX_TAU - 1e-3) { odd = "ellipse:part"; return; }
    const n = Math.max(48, Math.min(160, Math.round(Math.max(rx, ry) * sc() / 3))), c = Math.cos(rot), sn = Math.sin(rot); // a piece every ~3 px
    cur = { pts: [], closed: true }; parts.push(cur);
    for (let i = 0; i < n; i++) { const t = i / n * GLCTX_TAU, ex = rx * Math.cos(t), ey = ry * Math.sin(t); cur.pts.push(T(x + ex * c - ey * sn, y + ex * sn + ey * c)); }
  };
  const replay = why => { // the path onto the real context, each op under its own transform
    glcWhy(why);
    const m0 = real.getTransform();
    real.beginPath();
    for (const [name, a, m] of ops) { real.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); real[name](...a); }
    real.setTransform(m0); g.used = true;
  };
  const plain = s => typeof s === "string";
  g.fill = (...a) => {
    const st = real.fillStyle, grad = st && st.__disc;
    const why = odd ? "fill:" + odd : a.length ? "fill:rule" : real.globalCompositeOperation !== "source-over" ? "fill:" + real.globalCompositeOperation : real.shadowBlur > 0 ? "fill:shadow" : (real.filter || "none") !== "none" ? "fill:filter" : !plain(st) && !grad ? "fill:style" : !glcFill(g, parts, st, grad) ? "fill:shape" + parts.map(p => (p.circle ? "o" : p.pts.length)).join("") : null;
    if (why) { replay(why); real.fill(...a); }
  };
  g.stroke = (...a) => {
    const st = real.strokeStyle, dash = g.dash ? real.getLineDash() : null, glow = real.shadowBlur > 0 && real.shadowColor === st; // a glow in its own colour: soft rings under it (glcGlow)
    const why = odd ? "stroke:" + odd : a.length ? "stroke:path" : dash && dash.length !== 2 ? "stroke:dash" + dash.length : real.globalCompositeOperation !== "source-over" ? "stroke:" + real.globalCompositeOperation :
      real.shadowBlur > 0 && !glow ? "stroke:shadow" : (real.filter || "none") !== "none" ? "stroke:filter" : !plain(st) ? "stroke:style" :
      real.lineJoin !== "round" && parts.some(p => !p.circle && p.pts.length + (p.closed ? 1 : 0) > 2 && !glcRegular(p, g.w2)) ? "stroke:join-" + real.lineJoin : null; // (a mitred corner: the canvas - but a regular polygon's is the batch's shape 5)
    if (why) { replay(why); real.stroke(...a); return; }
    glcStroke(g, parts, st, dash, sc(), glow);
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
  for (const name of ["fillText", "strokeText", "drawImage", "fillRect", "strokeRect", "putImageData"]) g[name] = (...a) => { g.used = true; glcWhy(name); return real[name](...a); };
  g.clearRect = (...a) => real.clearRect(...a);
  g.clip = (...a) => { replay("clip"); real.clip(...a); };
  for (const name of ["measureText", "createLinearGradient", "createPattern", "isPointInPath", "getImageData", "createImageData", "createConicGradient"]) g[name] = (...a) => real[name](...a);
  return g;
}
// the batch's fills: whole circles (a plain colour or the gradDisc) and REGULAR POLYGONS (FRZ's moons, poly() - the canvas
// fallback sent the whole moving layer up every frame on a phone, 2026-10-14); false: something else, the canvas draws it
function glcFill(g, parts, st, grad) {
  const shapes = parts.map(p => p.circle ? null : glcRegular(p, g.w2) || glcTri(p, g.w2));
  if (parts.some((p, i) => !p.circle && !shapes[i]) || (grad && shapes.some(Boolean))) return false;
  const A = g.real.globalAlpha;
  parts.forEach((p, i) => {
    if (shapes[i] && shapes[i].tri) { const [[ax, ay], [bx, by], [cx, cy]] = shapes[i].tri; fxGlPush(ax, ay, bx, by, 1, 0, st, A, st, 0, 6, cx, cy); return; } // (shape 6: the third corner in the joint slot)
    if (shapes[i]) { const q = shapes[i]; fxGlPush(q.x, q.y, q.x + Math.cos(q.rot) * q.n, q.y + Math.sin(q.rot) * q.n, q.r, 0, st, A, st, 0, 5); return; } // (shape 5: p1 - p0 its direction, its length the sides)
    const [x, y] = g.w2(p.circle[0], p.circle[1]), r = p.circle[2] / g.w2.k;
    if (grad) fxGlPush(x, y, x, y, r, 0, grad.col, A, grad.col, 0, 3); // the gradDisc: clear at the centre to its colour at the rim
    else fxGlPush(x, y, x, y, r, 0, st, A, st, 0);
  });
  return true;
}
// any THREE corners (a fill closes its path): {tri} in world units - the threat marks (aspira-threat.js)
function glcTri(p, w2) { return p.pts.length === 3 ? { tri: p.pts.map(q => w2(q[0], q[1])) } : null; }
// a closed path of 3-12 corners all as far from their middle and as far apart round it: {x, y, r, rot, n} in world units
function glcRegular(p, w2) {
  const n = p.pts.length;
  if (!p.closed || n < 3 || n > 12) return null;
  const P = p.pts.map(q => w2(q[0], q[1])), x = P.reduce((s, q) => s + q[0], 0) / n, y = P.reduce((s, q) => s + q[1], 0) / n;
  const r = Math.hypot(P[0][0] - x, P[0][1] - y), rot = Math.atan2(P[0][1] - y, P[0][0] - x);
  if (!(r > 0)) return null;
  for (let i = 0; i < n; i++) {
    const a = rot + i * GLCTX_TAU / n;
    if (Math.hypot(P[i][0] - (x + r * Math.cos(a)), P[i][1] - (y + r * Math.sin(a))) > r * 0.01 + 0.01) return null;
  }
  return { x, y, r, rot, n };
}
// the batch's strokes: whole circles (with a glow, soft rings under it) and polylines cut at their joints
function glcStroke(g, parts, st, dash, scale, glow) {
  const real = g.real, lw = real.lineWidth * scale / g.w2.k, A = real.globalAlpha, dk = scale / g.w2.k, butt = real.lineCap === "butt";
  const dOn = dash ? dash[0] * dk : 0, dOff = dash ? dash[1] * dk : 0, dAt0 = dash ? real.lineDashOffset * dk : 0; // (a dash: on, off, its offset - world units)
  for (const p of parts) {
    if (p.circle) {
      const [x, y] = g.w2(p.circle[0], p.circle[1]), r = p.circle[2] / g.w2.k;
      if (glow) { const b = real.shadowBlur / g.w2.k; fxGlPush(x, y, x, y, r, lw + b, st, 0, st, A * 0.18); fxGlPush(x, y, x, y, r, lw + b * 0.45, st, 0, st, A * 0.3); } // a canvas glow, as two soft rings
      fxGlPush(x, y, x, y, r, lw, st, 0, st, A, 0, 0, 0, 0, 0, dOn, dOff, dAt0);
      continue;
    }
    const reg = real.lineJoin !== "round" && glcRegular(p, g.w2); // a sharp-cornered regular polygon (Temporal Drive's octagons): shape 5, its corners exact
    if (reg) { fxGlPush(reg.x, reg.y, reg.x + Math.cos(reg.rot) * reg.n, reg.y + Math.sin(reg.rot) * reg.n, reg.r, lw, st, 0, st, A, 5); continue; }
    const closed = p.closed && p.pts.length > 2, P = (closed ? [...p.pts, p.pts[0]] : p.pts).map(q => g.w2(q[0], q[1])), n = P.length - 1;
    const dir = i => { const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    const D = Array.from({ length: n }, (_, i) => dir(i));
    // each segment cut at its joints (the bisector of its direction and its neighbour's): seen-through lines never overlap
    const joint = (u, w) => { const x = u[0] + w[0], y = u[1] + w[1], l = Math.hypot(x, y); return l > 1e-6 ? [x / l, y / l] : [0, 0]; };
    let along = 0; // the dash carries on round the corners
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? D[i - 1] : closed ? D[n - 1] : null, next = i < n - 1 ? D[i + 1] : closed ? D[0] : null;
      const [b0x, b0y] = prev ? joint(prev, D[i]) : [0, 0], [b1x, b1y] = next ? joint(D[i], next) : [0, 0];
      const seg = trimToTowers(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]); // nothing of a line inside a tower's hexagon (aspira-fxgl.js)
      if (seg) {
        const cutA = seg[0] !== P[i][0] || seg[1] !== P[i][1], cutB = seg[2] !== P[i + 1][0] || seg[3] !== P[i + 1][1], j0x = cutA ? 0 : b0x, j0y = cutA ? 0 : b0y, j1x = cutB ? 0 : b1x, j1y = cutB ? 0 : b1y; // (a cut end is a plain end)
        if (glow) { const b = real.shadowBlur / g.w2.k; for (const [wk, ak] of [[b, 0.18], [b * 0.45, 0.3]]) fxGlPush(seg[0], seg[1], seg[2], seg[3], (lw + wk) / 2, 0, st, A * ak, st, 0, 0, j0x, j0y, j1x, j1y); } // a glow: two soft wider strokes under it (the Relay's beam)
        fxGlPush(seg[0], seg[1], seg[2], seg[3], lw / 2, 0, st, A, st, 0, butt && !prev && !next ? 2 : 0, j0x, j0y, j1x, j1y, dOn, dOff, dAt0 + along + (cutA ? Math.hypot(seg[0] - P[i][0], seg[1] - P[i][1]) : 0));
      }
      along += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    }
  }
}
// WHY the moving layer went to the canvas (and up to the GPU) - counted for the slow logs (perfSplit, aspira-perflog.js): a phone
// still sent it every frame on 2026-10-14 after every known case was moved to the batch
const glcWhyN = {};
function glcWhy(why) { if (why) glcWhyN[why] = (glcWhyN[why] || 0) + 1; }
