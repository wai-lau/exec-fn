// /aspira — the view: zoom in and drag to look around (owner). Loads after
// aspira-draw.js (which fits `cam` to the window in resize) and before
// aspira-ui.js (whose onTap this calls).
//
// THE VIEW IS FIXED (owner, 2026-10-11): no zoom (FIXED_ZOOM, aspira-defs.js) and no pan
// ("don't allow camera pan either") - a drag on open board does nothing; a drag on a tower moves it. A press that moves less than DRAG_PX is a TAP and goes
// to onTap (select / place); the core is kept on screen. Double-click /
// double-tap recentres.
const DRAG_PX = 6;
const ptrs = new Map(); // pointerId -> { x, y } in device pixels
let fitK = 0, dragged = false, downAt = null, pinch = null;
// THE CORE'S POWER GESTURES (owner, 2026-10-06; aspira-core.js), only once the
// power is owned - otherwise a drag pans and a press taps, as ever:
//   press and HOLD the core HOLD_MS -> Temporal's freeze
//   drag from the CORE onto a tower -> the Orbital Relay: it acts as three
// ui.drag = { kind: "core" | "tower", t, from, at } while one is held (drawn by drawCoreFx)
// DRAGGING A TOWER (owner, 2026-10-10): a press on a tower and a drag MOVES it - it follows the
// finger, firing all the while, held to its leash (moveTo, aspira-towers.js); ui.drag = { kind:
// "move", t, dx, dy } (the grab's offset, so the tower does not jump to the fingertip). A short
// press is still a tap (its card). Not while placing or with the Relay armed - those taps pick.
// a held finger always wobbles: the hold survives HOLD_SLOP css px of drift
// (owner: hold did nothing on a phone - DRAG_PX 6 was too tight for a thumb)
const HOLD_MS = 400, CORE_GRAB = 1.8, HOLD_SLOP = 18; // the core grabs within CORE_GRAB x its radius
let holdTimer = 0, holdFired = false, holdMoved = false;
function grabPower(ev) {
  if (!G.core) return grabTower(ev); // a power is owned only once a boss handed it out (pickPower), so the levels below are the gate
  const w = toWorld(ev), pk = pickAt(ev), onCore = (pk && pk.core) || (!(pk && pk.t) && Math.hypot(w.x - CX, w.y - CY) <= CORE_R * CORE_GRAB);
  // only a power that is READY grabs (owner, 2026-10-07: no drag line for an
  // Overcharge still cooling down); otherwise the press pans and taps as ever
  const ready = id => powerLvl(id) && !cooldownLeft(id), rel = ready("relay");
  if (onCore && (ready("temporal") || rel)) {
    if (ready("temporal")) holdTimer = setTimeout(() => {
      if (ui.drag && ui.drag.kind === "core" && !holdMoved && temporalFreeze()) { holdFired = true; ui.drag = null; refreshPanels(); }
    }, HOLD_MS);
    return { kind: "core", from: { x: CX, y: CY }, at: null, drop: rel }; // drop: the drag line shows (drawCoreFx)
  }
  return grabTower(ev);
}
// towers STAY PUT while the game is paused or the boss sky turns over (owner, 2026-10-12: "no tower movement during game pause
// and inversion change"): no grab, no drag, no coasting (stepFlings)
const towersFrozen = () => ui.paused || (G.started && typeof skyTurning === "function" && skyTurning());
function grabTower(ev) {
  const w = toWorld(ev), t = !ui.build && !ui.relayArm && !towersFrozen() && pickTower(ev);
  return t ? { kind: "move", t, dx: t.x - w.x, dy: t.y - w.y } : null;
}
// a power drag let go: the Relay on the tower under it
function dropPower(d) {
  if (!d.at) return;
  if (d.kind === "core" && powerLvl("relay")) relay(pickTower(d.ev));
  refreshPanels();
}

function devXY(ev) {
  const r = cv.getBoundingClientRect(), dpr = canvasDpr();
  return { x: (ev.clientX - r.left) * dpr, y: (ev.clientY - r.top) * dpr };
}
// keep the core (the chart's centre) somewhere on the canvas
function clampView() {
  const cx = cam.ox + CX * cam.k, cy = cam.oy + CY * cam.k;
  const w = q3d() ? warpScreenFull().w : cv.width, h = q3d() ? warpScreenFull().h : cv.height; // (3D: the canvas is the picture's square)
  cam.ox += Math.max(0, Math.min(w, cx)) - cx;
  cam.oy += Math.max(0, Math.min(h, cy)) - cy;
}
function refit() { resize(); fitK = cam.fit; }

cv.addEventListener("wheel", ev => ev.preventDefault(), { passive: false }); // (no zoom: the page must not scroll either)

// TWO TOWERS AT ONCE (owner, 2026-10-11: "now that zoom is fixed, allow moving two towers at once"): every finger that
// lands on a tower holds that tower (moves: pointerId -> { t, dx, dy, down, dragged }), each following its own finger;
// two fingers on open board still pan. ui.drag stays the FIRST finger's grab (a power, or a move) for everything else.
const moves = new Map();
const towerHeld = t => [...moves.values()].some(m => m.t === t); // (drawLeash / the held tower's look, aspira-towers.js)
cv.addEventListener("pointerdown", ev => {
  if (!fitK) fitK = cam.fit;
  cv.setPointerCapture(ev.pointerId);
  ptrs.set(ev.pointerId, devXY(ev));
  if (ptrs.size === 1) { dragged = false; downAt = devXY(ev); holdFired = holdMoved = false; ui.drag = grabPower(ev); if (ui.drag && ui.drag.kind === "move") { ui.drag.t.fling = null; moves.set(ev.pointerId, { ...ui.drag, down: devXY(ev), dragged: false }); } }
  if (ptrs.size === 2 && (moves.size || pickTower(ev))) { // a second tower in the other hand - never a pinch
    const g = grabTower(ev);
    if (g && !towerHeld(g.t)) { g.t.fling = null; moves.set(ev.pointerId, { ...g, down: devXY(ev), dragged: false }); }
    dragged = true; // two fingers never end in a tap
    return;
  }
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
  const mv = moves.get(ev.pointerId);
  if (mv) { // this finger holds a tower: it follows the finger, held to its leash (moveTo), no pan
    if (!mv.dragged && Math.hypot(now.x - mv.down.x, now.y - mv.down.y) > DRAG_PX * canvasDpr()) mv.dragged = dragged = true;
    if (mv.dragged && !towersFrozen()) { const w = toWorld(ev); moveTo(mv.t, { x: w.x + mv.dx, y: w.y + mv.dy }); relayFollow(mv.t); flingTrack(mv); } // the Relay follows the tower last dragged (aspira-core.js)
    return;
  }
  if (moves.size) return; // the other finger holds a tower: this one does nothing
  if (ptrs.size >= 2 && pinch) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = { d, m }; // (no pan: the view is fixed)
    return;
  }
  const dpr = canvasDpr();
  if (!dragged && Math.hypot(now.x - downAt.x, now.y - downAt.y) > DRAG_PX * dpr) dragged = true;
  if (ui.drag) { // a power drag: no pan; the hold only breaks past HOLD_SLOP
    if (Math.hypot(now.x - downAt.x, now.y - downAt.y) > HOLD_SLOP * dpr) { holdMoved = true; clearTimeout(holdTimer); }
    if (dragged) { ui.drag.at = toWorld(ev); ui.drag.ev = { clientX: ev.clientX, clientY: ev.clientY }; }
    return;
  }
  // (a drag on open board does nothing: NO PAN - owner, 2026-10-11: "don't allow camera pan either")
});
function endPointer(ev, tap) {
  if (!ptrs.has(ev.pointerId)) return;
  ptrs.delete(ev.pointerId);
  if (ptrs.size < 2) pinch = null;
  const mv = moves.get(ev.pointerId);
  moves.delete(ev.pointerId);
  if (mv) { // a held tower let go
    if (ui.drag && ui.drag.t === mv.t) ui.drag = null;
    if (mv.dragged) flingRelease(mv);
    if (tap && !ptrs.size && !mv.dragged && !dragged) onTap(ev); // a press without a drag: its card
    return;
  }
  clearTimeout(holdTimer);
  const d = ui.drag;
  ui.drag = null;
  if (d && d.kind === "move") return;
  if (holdFired) { holdFired = false; return; } // the hold already froze: no tap
  if (d && holdMoved) { if (tap) dropPower(d); return; }
  if (d && !holdMoved) { if (tap && !ptrs.size) onTap(ev); return; } // a short wobble on a grab is still a TAP
  if (tap && !ptrs.size && !dragged) onTap(ev);
}
cv.addEventListener("pointerup", ev => endPointer(ev, true));
cv.addEventListener("pointercancel", ev => endPointer(ev, false));
cv.addEventListener("pointerleave", () => { if (!ptrs.size) ui.hover = null; });
cv.addEventListener("dblclick", refit); // (with zoom and pan fixed, only a stale view needs it)
// iOS: a long press would open the callout / magnifier / a text selection and
// CANCEL the pointer (owner: the core's hold and drags were finicky) - so the
// canvas swallows the touch itself; pointer events still arrive
cv.addEventListener("contextmenu", ev => ev.preventDefault());
cv.addEventListener("touchstart", ev => ev.preventDefault(), { passive: false });
cv.addEventListener("selectstart", ev => ev.preventDefault());
// THE CURSOR SHOWS ON ANY SKY (owner, 2026-10-12: "during boss, cannot see cursor" - the system crosshair vanished on the
// inverted boss sky): a crosshair of the light line laid over a dark outline, both from the palette (COL), so one of the
// two always stands out; the system crosshair is the fallback. ui.js calls it once the palette is read
function contrastCursor() {
  const line = (c, w) => `<path d="M12 2v8M12 14v8M2 12h8M14 12h8" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${line(COL.bg, 4)}${line(COL.white, 1.6)}</svg>`;
  cv.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
}
