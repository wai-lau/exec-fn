// /aspira — the view: zoom in and drag to look around (owner). Loads after
// aspira-draw.js (which fits `cam` to the window in resize) and before
// aspira-ui.js (whose onTap this calls).
//
// Mouse: the wheel zooms about the cursor; a drag pans. Touch: one finger
// drags, two fingers pinch-zoom (and pan with their midpoint). A press that
// moves less than DRAG_PX is a TAP and goes to onTap (select / place). Zoom
// runs from the fitted view (1x) to ZOOM_MAX, and the core is kept on screen.
// Double-click / double-tap snaps back to the fitted view.
const ZOOM_MAX = 4, DRAG_PX = 6;
const ptrs = new Map(); // pointerId -> { x, y } in device pixels
let fitK = 0, dragged = false, downAt = null, pinch = null;

function devXY(ev) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  return { x: (ev.clientX - r.left) * dpr, y: (ev.clientY - r.top) * dpr };
}
// scale the view by f about device point (sx, sy), within [fit, fit x ZOOM_MAX]
function zoomAt(sx, sy, f) {
  const k = Math.max(fitK, Math.min(fitK * ZOOM_MAX, cam.k * f)), r = k / cam.k;
  cam.ox = sx - (sx - cam.ox) * r; cam.oy = sy - (sy - cam.oy) * r; cam.k = k;
  clampView();
}
function panBy(dx, dy) { cam.ox += dx; cam.oy += dy; clampView(); }
// keep the core (the chart's centre) somewhere on the canvas
function clampView() {
  const cx = cam.ox + CX * cam.k, cy = cam.oy + CY * cam.k;
  cam.ox += Math.max(0, Math.min(cv.width, cx)) - cx;
  cam.oy += Math.max(0, Math.min(cv.height, cy)) - cy;
}
function refit() { resize(); fitK = cam.k; }

cv.addEventListener("wheel", ev => {
  ev.preventDefault();
  if (!fitK) fitK = cam.k;
  const p = devXY(ev);
  zoomAt(p.x, p.y, Math.exp(-ev.deltaY * 0.0015));
}, { passive: false });

cv.addEventListener("pointerdown", ev => {
  if (!fitK) fitK = cam.k;
  cv.setPointerCapture(ev.pointerId);
  ptrs.set(ev.pointerId, devXY(ev));
  if (ptrs.size === 1) { dragged = false; downAt = devXY(ev); }
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    dragged = true; // a pinch never ends in a tap
  }
});
cv.addEventListener("pointermove", ev => {
  ui.hover = toWorld(ev);
  if (!ptrs.has(ev.pointerId)) return;
  const prev = ptrs.get(ev.pointerId), now = devXY(ev);
  ptrs.set(ev.pointerId, now);
  if (ptrs.size >= 2 && pinch) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    panBy(m.x - pinch.m.x, m.y - pinch.m.y);
    if (pinch.d > 0) zoomAt(m.x, m.y, d / pinch.d);
    pinch = { d, m };
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  if (!dragged && Math.hypot(now.x - downAt.x, now.y - downAt.y) > DRAG_PX * dpr) dragged = true;
  if (dragged) panBy(now.x - prev.x, now.y - prev.y);
});
function endPointer(ev, tap) {
  if (!ptrs.has(ev.pointerId)) return;
  ptrs.delete(ev.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (tap && !ptrs.size && !dragged) onTap(ev);
}
cv.addEventListener("pointerup", ev => endPointer(ev, true));
cv.addEventListener("pointercancel", ev => endPointer(ev, false));
cv.addEventListener("pointerleave", () => { if (!ptrs.size) ui.hover = null; });
cv.addEventListener("dblclick", refit);
