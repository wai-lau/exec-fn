// /spire - a tower let go MOVES ON (owner, 2026-10-11: "when not dragged, give the towers some momentum, initial
// velocity and direction depending on last drag, slowly dampen to still"). UI only (the simulator never drags).
// While a finger drags a tower (aspira-camera.js) its velocity is tracked - world units a REAL second, smoothed over
// the last moves; on release the tower keeps it as t.fling and coasts, the speed falling by e every FLING_TAU s, held
// to its leash and clear of the others by moveTo (aspira-towers.js) - a wall it meets stops it. A new grab stops it.
const FLING_TAU = 0.35, FLING_SMOOTH = 0.35, FLING_MAX = 1400, FLING_STOP = 8, FLING_STALE_MS = 80;
// a drag move: blend this move's velocity into the running estimate
function flingTrack(mv) {
  const now = performance.now(), t = mv.t;
  if (mv.flAt != null) {
    const dt = (now - mv.flAt) / 1000;
    if (dt > 0) {
      const vx = (t.x - mv.flX) / dt, vy = (t.y - mv.flY) / dt, k = Math.min(1, dt / FLING_SMOOTH * 4);
      mv.vx = (mv.vx || 0) + (vx - (mv.vx || 0)) * k; mv.vy = (mv.vy || 0) + (vy - (mv.vy || 0)) * k;
    }
  }
  mv.flAt = now; mv.flX = t.x; mv.flY = t.y;
}
// let go: a finger that had stopped before lifting throws nothing
function flingRelease(mv) {
  if (mv.flAt == null || performance.now() - mv.flAt > FLING_STALE_MS) return;
  const s = Math.hypot(mv.vx || 0, mv.vy || 0), k = s > FLING_MAX ? FLING_MAX / s : 1;
  if (s * k > FLING_STOP) mv.t.fling = { vx: (mv.vx || 0) * k, vy: (mv.vy || 0) * k };
}
// every frame (frame, aspira-ui.js), in real seconds
function stepFlings(dt) {
  for (const t of G.towers) {
    const f = t.fling;
    if (!f) continue;
    const want = { x: t.x + f.vx * dt, y: t.y + f.vy * dt }, x0 = t.x, y0 = t.y;
    if (!moveTo(t, want)) { t.fling = null; continue; }
    // stopped short (the leash, a neighbour): what it could not travel, it loses
    const got = Math.hypot(t.x - x0, t.y - y0), meant = Math.hypot(want.x - x0, want.y - y0);
    const keep = Math.exp(-dt / FLING_TAU) * (meant > 0 ? Math.min(1, got / meant) : 0);
    f.vx *= keep; f.vy *= keep;
    if (Math.hypot(f.vx, f.vy) < FLING_STOP) t.fling = null;
  }
}
