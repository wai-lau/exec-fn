// /spire - TEXT AS STAMPS (owner, 2026-10-14: "a 10x improvement on perf ... avoid lowering resolution or reducing visual
// clarity"). A late 3D wave drew ~350 damage numbers a frame, each a fresh outline stroke and fill of glyphs on the
// full-density layer - 16 of a 26 ms frame on a desktop RTX (profiled with the GPU synced). Each text (its string, colour,
// outline, weight) is drawn ONCE at its real size in device pixels onto a small canvas of its own, and stamped from then
// on: one image a number, still at its exact pixel size, so it is as sharp as before. Sizes are kept in TEXT_Q px steps
// (a 1-2% scale at most). text() (aspira-draw.js) asks here first; under a skewed or rotated transform, before the font has
// loaded, or with the cache off, it draws the old way. Loaded after aspira-draw.js.
const TEXT_Q = 0.5, TEXT_CACHE_MAX = 900;
const textSprites = new Map();
let textCacheOn = true, textBuilding = false; // textBuilding: text() drawing a stamp - the old way, no recursion
function textSprite(str, x, y, size, color, outline, bold) {
  if (!textCacheOn || textBuilding || !(size > 0) || (document.fonts && document.fonts.status !== "loaded") || !(ctx instanceof CanvasRenderingContext2D)) return false; // (not the GPU stand-in - aspira-glctx.js)
  const m = ctx.getTransform();
  if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || m.a <= 0 || Math.abs(m.a - m.d) > 1e-6 * m.a) return false; // only a plain scale
  const dev = size * m.a, q = Math.max(TEXT_Q, Math.round(dev / TEXT_Q) * TEXT_Q);
  const col = COL[color] || color, oc = outline ? COL[outline === true ? "bg" : outline] : "", blur = size >= TEXT_BLUR_MIN && outline ? Math.min(size * 0.7, TEXT_BLUR_MAX) * cam.k * (ctx.__ent ? warp.entScale || 1 : 1) : 0; // device px (the full-density layer scales its blurs - entCtx)
  const key = str + "|" + col + "|" + oc + "|" + (bold ? 1 : 0) + "|" + q + "|" + (lowQ ? 1 : 0) + "|" + blur.toFixed(1);
  let sp = textSprites.get(key);
  if (!sp) {
    if (textSprites.size >= TEXT_CACHE_MAX) textSprites.clear();
    sp = textStamp(str, q, color, outline, bold, m.a, blur);
    textSprites.set(key, sp);
  }
  const k = dev / q, X = m.a * x + m.e, Y = m.d * y + m.f;
  ctx.save(); CanvasRenderingContext2D.prototype.setTransform.call(ctx, 1, 0, 0, 1, 0, 0); // device px (the full-density layer's own setTransform would scale it - entCtx)
  ctx.drawImage(sp.c, X - sp.ox * k, Y - sp.oy * k, sp.c.width * k, sp.c.height * k);
  ctx.restore();
  return true;
}
// draw the text the old way (text(), aspira-draw.js) at q device px onto a canvas just big enough: its outline, its glow
function textStamp(str, q, color, outline, bold, sc, blur) {
  const c = document.createElement("canvas"), x = c.getContext("2d"), main = ctx;
  if (main.__ent) { const sb = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "shadowBlur"), bk = warp.entScale || 1; Object.defineProperty(x, "shadowBlur", { configurable: true, get() { return sb.get.call(this) / bk; }, set(v) { sb.set.call(this, v * bk); } }); } // the glow as the full-density layer draws it
  const sz = q / sc; // the size in the caller's units, so the outline's caps (TEXT_STROKE_MAX, in those units) scale as before
  x.font = (bold ? "bold " : "") + q + "px " + CANVAS_FONT;
  const w = x.measureText(str).width, pad = Math.ceil(Math.min(sz * 0.32, TEXT_STROKE_MAX) * sc + blur * 2 + 2);
  c.width = Math.ceil(w + 2 * pad); c.height = Math.ceil(q * 1.3 + 2 * pad);
  const ox = c.width / 2, oy = c.height / 2;
  ctx = x; textBuilding = true;
  try { x.setTransform(sc, 0, 0, sc, ox, oy); text(str, 0, 0, sz, color, outline, bold); } finally { ctx = main; textBuilding = false; }
  return { c, ox, oy };
}
