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
// THE CORE'S POWER GESTURES (owner, 2026-10-06; aspira-core.js), only once the
// power is owned - otherwise a drag pans and a press taps, as ever:
//   press and HOLD the core HOLD_MS -> Temporal's freeze
//   drag from the CORE onto a tower -> the Orbital Relay: it acts as three
// ui.drag = { kind: "core" | "tower", t, from, at } while one is held (drawn by drawCoreFx)
// a held finger always wobbles: the hold survives HOLD_SLOP css px of drift
// (owner: hold did nothing on a phone - DRAG_PX 6 was too tight for a thumb)
const HOLD_MS = 400, CORE_GRAB = 1.8, HOLD_SLOP = 18; // the core grabs within CORE_GRAB x its radius
let holdTimer = 0, holdFired = false, holdMoved = false;
function grabPower(ev) {
  if (!G.core) return null; // a power is owned only once a boss handed it out (pickPower), so the levels below are the gate
  const w = toWorld(ev), onCore = Math.hypot(w.x - CX, w.y - CY) <= CORE_R * CORE_GRAB;
  // only a power that is READY grabs (owner, 2026-10-07: no drag line for an
  // Overcharge still cooling down); otherwise the press pans and taps as ever
  const ready = id => powerLvl(id) && !cooldownLeft(id), rel = ready("relay");
  if (onCore && (ready("temporal") || rel)) {
    if (ready("temporal")) holdTimer = setTimeout(() => {
      if (ui.drag && ui.drag.kind === "core" && !holdMoved && temporalFreeze()) { holdFired = true; ui.drag = null; refreshPanels(); }
    }, HOLD_MS);
    return { kind: "core", from: { x: CX, y: CY }, at: null, drop: rel }; // drop: the drag line shows (drawCoreFx)
  }
  return null;
}
// a power drag let go: the Relay on the tower under it
function dropPower(d) {
  if (!d.at) return;
  if (d.kind === "core" && powerLvl("relay")) relay(towerAt(d.at));
  refreshPanels();
}

function devXY(ev) {
  const r = cv.getBoundingClientRect(), dpr = canvasDpr();
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
  const w = q3d() ? warpScreen().w : cv.width, h = q3d() ? warpScreen().h : cv.height; // (3D: the canvas is the picture's square)
  cam.ox += Math.max(0, Math.min(w, cx)) - cx;
  cam.oy += Math.max(0, Math.min(h, cy)) - cy;
}
function refit() { resize(); fitK = cam.fit; }

cv.addEventListener("wheel", ev => {
  ev.preventDefault();
  if (!fitK) fitK = cam.fit;
  const p = devXY(ev);
  zoomAt(p.x, p.y, Math.exp(-ev.deltaY * 0.0015));
}, { passive: false });

cv.addEventListener("pointerdown", ev => {
  if (!fitK) fitK = cam.fit;
  cv.setPointerCapture(ev.pointerId);
  ptrs.set(ev.pointerId, devXY(ev));
  if (ptrs.size === 1) { dragged = false; downAt = devXY(ev); holdFired = holdMoved = false; ui.drag = grabPower(ev); }
  if (ptrs.size === 2) {
    clearTimeout(holdTimer); ui.drag = null; // a pinch is never a power gesture
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
  const dpr = canvasDpr();
  if (!dragged && Math.hypot(now.x - downAt.x, now.y - downAt.y) > DRAG_PX * dpr) dragged = true;
  if (ui.drag) { // a power drag: no pan; the hold only breaks past HOLD_SLOP
    if (Math.hypot(now.x - downAt.x, now.y - downAt.y) > HOLD_SLOP * dpr) { holdMoved = true; clearTimeout(holdTimer); }
    if (dragged) ui.drag.at = toWorld(ev);
    return;
  }
  if (dragged) panBy(now.x - prev.x, now.y - prev.y);
});
function endPointer(ev, tap) {
  if (!ptrs.has(ev.pointerId)) return;
  ptrs.delete(ev.pointerId);
  if (ptrs.size < 2) pinch = null;
  clearTimeout(holdTimer);
  const d = ui.drag;
  ui.drag = null;
  if (holdFired) { holdFired = false; return; } // the hold already froze: no tap
  if (d && holdMoved) { if (tap) dropPower(d); return; }
  if (d && !holdMoved) { if (tap && !ptrs.size) onTap(ev); return; } // a short wobble on a grab is still a TAP
  if (tap && !ptrs.size && !dragged) onTap(ev);
}
cv.addEventListener("pointerup", ev => endPointer(ev, true));
cv.addEventListener("pointercancel", ev => endPointer(ev, false));
cv.addEventListener("pointerleave", () => { if (!ptrs.size) ui.hover = null; });
cv.addEventListener("dblclick", refit);
// iOS: a long press would open the callout / magnifier / a text selection and
// CANCEL the pointer (owner: the core's hold and drags were finicky) - so the
// canvas swallows the touch itself; pointer events still arrive
cv.addEventListener("contextmenu", ev => ev.preventDefault());
cv.addEventListener("touchstart", ev => ev.preventDefault(), { passive: false });
cv.addEventListener("selectstart", ev => ev.preventDefault());
