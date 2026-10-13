// /spire - a tower let go MOVES ON (owner, 2026-10-11: "when not dragged, give the towers some momentum, initial
// velocity and direction depending on last drag, slowly dampen to still"). UI only (the simulator never drags).
// While a finger drags a tower (aspira-camera.js) its velocity is tracked - world units a REAL second, smoothed over
// the last moves; on release the tower keeps it as t.fling and coasts, the speed falling by e every FLING_TAU s, held
// to its leash and clear of the others by moveTower (aspira-towers.js) - a wall it meets it bounces off. A new grab stops it.
const FLING_BOUNCE = 0.6; // the share of its speed a tower keeps off a wall
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
  if (towersFrozen()) return; // (aspira-camera.js)
  // a leash that SHRANK (a resize, a zoom, a tier) pulls its tower back inside: the dashed circle always holds it (owner)
  for (const t of G.towers) { const c = CELLS[t.cell]; if (!t.fling && !towerHeld(t) && Math.hypot(t.x - c.x, t.y - c.y) > leashR(t) + 0.5) moveTower(t, t); }
  for (const t of G.towers) {
    const f = t.fling;
    if (!f) continue;
    const want = { x: t.x + f.vx * dt, y: t.y + f.vy * dt }, x0 = t.x, y0 = t.y;
    if (!moveTower(t, want)) { t.fling = null; continue; }
    // stopped short: it BOUNCES (owner, 2026-10-11: "make the towers bounce off the movement limits") - off its leash, a
    // neighbour or the core, the velocity mirrored about that wall's normal and FLING_BOUNCE of it kept
    const got = Math.hypot(t.x - x0, t.y - y0), meant = Math.hypot(want.x - x0, want.y - y0);
    if (meant > 0 && got < meant * 0.98) bounce(t, f);
    const keep = Math.exp(-dt / FLING_TAU);
    f.vx *= keep; f.vy *= keep;
    if (Math.hypot(f.vx, f.vy) < FLING_STOP) t.fling = null;
  }
}
// the wall t just met: the phone screen's edge, its leash's rim (normal outward from the slot), else the nearest neighbour or the core (normal
// toward it) - the velocity's part INTO the wall is mirrored, and the whole kept at FLING_BOUNCE
function bounce(t, f) {
  const c = CELLS[t.cell], dl = Math.hypot(t.x - c.x, t.y - c.y);
  // the phone's screen is a wall too (aspira-camera.js, legalSpot): its normal found by probing a step each way
  const e = CELL_S * TOWER_K + MOVE_EDGE, off = (dx, dy) => !phoneInside(t.x + dx, t.y + dy, e), P = 3;
  let nx = off(P, 0) ? 1 : off(-P, 0) ? -1 : 0, ny = off(0, P) ? 1 : off(0, -P) ? -1 : 0;
  if (nx || ny) { const n = Math.hypot(nx, ny); nx /= n; ny /= n; } else if (dl >= leashR(t) - 1) { nx = (t.x - c.x) / dl; ny = (t.y - c.y) / dl; } else {
    const walls = G.towers.filter(o => o !== t).map(o => ({ x: o.x, y: o.y, r: towerGap() })).concat([{ x: CX, y: CY, r: coreKeep(Math.atan2(t.y - CY, t.x - CX)) }]);
    let best = null, gap = Infinity;
    for (const w of walls) { const d = Math.hypot(t.x - w.x, t.y - w.y) - w.r; if (d < gap) { gap = d; best = w; } }
    if (!best) return;
    const d = Math.hypot(best.x - t.x, best.y - t.y) || 1; nx = (best.x - t.x) / d; ny = (best.y - t.y) / d;
  }
  const into = f.vx * nx + f.vy * ny;
  if (into <= 0) return; // already moving away
  f.vx = (f.vx - 2 * into * nx) * FLING_BOUNCE; f.vy = (f.vy - 2 * into * ny) * FLING_BOUNCE;
}
