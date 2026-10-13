// /aspira - the SIMULATOR'S PLAYER dragging towers (2026-10-10): in a real game the
// player drags them (aspira-camera.js) - or ticks AUTO-MOVE (autoGlide, below); the balance
// simulator turns AUTO_POS on, and each tower then jumps, every POS_EVERY s, to the spot
// in its leash that MAXIMISES ANTICIPATED HITS (it was the towers' own spoke-slider from
// 2026-10-04 to 2026-10-09). Loaded after aspira-towers.js (the simulator too).
//
// Each living enemy's path is predicted over the next POS_HORIZON s, sampled every
// POS_DT s along its lane - computed once and shared by every tower. A spot (POS_RINGS x
// POS_ANGLES points over the leash, plus the slot and where it stands) scores each
// predicted sample inside the tower's range, weighed by URGENCY (nearer the core counts
// more), by SOONER, and by the tower's own TARGETING (see bestSpot). It only jumps for a
// spot POS_SWITCH times better than where it stands. A drag is instant, so there is no
// travel time to weigh.
let AUTO_POS = false; // the simulator sets it
const POS_RINGS = [1 / 3, 2 / 3, 1], POS_ANGLES = 12;
const POS_SOON = 1; // s: a hit this far ahead counts 1/e as much
let POS_EVERY = 0.5, POS_HORIZON = 5, POS_DT = 0.5, POS_SWITCH = 1.1;
const POS_HORIZON_SET = h => { POS_HORIZON = h; }; // (the simulator sweeps it)
const POS_STALE = 0.2; // Fresh: what a debuffed enemy's hits are still worth
let POS_URGENCY = 6, POS_MODE_MIX = 1; // FULL targeting (owner: 0.3 barely counted); urgency 6 keeps the lives - swept u 3/6/10/20 x mix 0.3/1. let: the simulator sweeps both
let posPred = null, posPredAt = -1;
// [{ e, pts: [{ x, y, t }] }], recomputed at most once per POS_EVERY of game time
function predictions() {
  // fresh for a NEW GAME too (2026-10-08, owner: "towers stuck positionally"): G.clock restarts at 0, so
  // the last game's posPredAt left the clock "behind" it and the stale predictions (dead enemies) were kept
  if (posPred && posPred.G === G && G.clock >= posPredAt && G.clock - posPredAt < POS_EVERY / 2) return posPred;
  posPredAt = G.clock;
  posPred = [];
  posPred.G = G;
  for (const e of G.enemies) {
    if (e.dead) continue;
    const v = effSpeed(e), pts = [];
    for (let t = 0; t <= POS_HORIZON + 1e-9; t += POS_DT) {
      const s = e.s + v * t, p = pathAt(e.pi, s, e.ang || 0);
      // URGENCY: a hit counts more the nearer that point is to the core (x1 at entry .. x7 at the core)
      // ... and SOONER counts more (owner, 2026-10-06: a tower sat waiting on far
      // future passes while it could reach the action now): x exp(-t / POS_SOON)
      pts.push({ x: p.x, y: p.y, t, w: (1 + POS_URGENCY * Math.min(1, s / PATHS[e.pi].len) ** 2) * Math.exp(-t / POS_SOON) });
    }
    posPred.push({ e, pts });
  }
  posPred.maxHp = Math.max(1, ...posPred.map(q => q.e.hp));
  return posPred;
}
// the spots a tower may jump to: rings over its leash, the slot, and where it stands - each made legal
function posSpots(t) {
  const c = CELLS[t.cell], L = leashR(t), out = [{ x: t.x, y: t.y }, { x: c.x, y: c.y }];
  for (const f of POS_RINGS) for (let k = 0; k < POS_ANGLES; k++) {
    const a = k * 2 * Math.PI / POS_ANGLES;
    out.push({ x: c.x + Math.cos(a) * L * f, y: c.y + Math.sin(a) * L * f });
  }
  return out.slice(0, 1).concat(out.slice(1).map(p => legalSpot(t, p)).filter(Boolean));
}
// where to jump, or null to stay (nothing alive, or nowhere clearly better)
function bestSpot(t, range) {
  const pred = predictions();
  if (!pred.length) return null;
  const spots = posSpots(t), r2 = range * range;
  // each enemy's hits weighed by the tower's TARGETING (owner): Biggest by its
  // HP against the biggest on the field, Fresh full for the undebuffed and
  // POS_STALE for the rest. NEAR is ABSOLUTE (owner, 2026-10-06): only the enemy
  // nearest the core counts - unless no spot reaches it, then every enemy does
  let f = pred.map(({ e }) => POS_MODE_MIX * (t.mode === "biggest" ? (e.arcana ? 1 : e.hp / pred.maxHp) : t.mode === "fresh" ? (debuffed(e) ? POS_STALE : 1) : 1) + 1 - POS_MODE_MIX);
  const all = f;
  if (t.mode === "close") {
    let ni = 0;
    pred.forEach(({ e }, i) => { if (coreD2(e) < coreD2(pred[ni].e)) ni = i; });
    f = pred.map((_, i) => (i === ni ? 1 : 0));
  }
  // NEAR: the same hits, each worth more the CLOSER it passes - only a tie-break
  // (a range covering the whole board scores every spot the same)
  let near = 0;
  const score = s => {
    let n = 0;
    near = 0;
    pred.forEach(({ pts }, i) => {
      for (const p of pts) {
        const d2 = (p.x - s.x) ** 2 + (p.y - s.y) ** 2;
        if (d2 <= r2) { n += p.w * f[i]; near += p.w * f[i] * (1 - Math.sqrt(d2) / range); }
      }
    });
    return n;
  };
  let best = null, bestScore = 0, bestNear = 0;
  for (let pass = 0; pass < 2 && !bestScore; pass++) {
    if (pass) { if (f === all) break; f = all; }
    for (const s of spots) {
      const sc = score(s);
      if (sc > bestScore || (sc === bestScore && sc > 0 && near > bestNear)) { bestScore = sc; best = s; bestNear = near; }
    }
  }
  // nothing in range: the spot CLOSEST to the action (owner, 2026-10-06)
  if (!bestScore) {
    let bd = Infinity;
    for (const s of spots) pred.forEach(({ pts }, i) => { if (f[i] > 0) for (const p of pts) { const d2 = (p.x - s.x) ** 2 + (p.y - s.y) ** 2; if (d2 < bd) { bd = d2; best = s; } } });
    return best;
  }
  // stay put unless the new spot is clearly better
  return score(spots[0]) * POS_SWITCH >= bestScore ? null : best;
}
// AUTO-MOVE (owner, 2026-10-13: "add an auto-move checkbox that uses the simulator movement, but limit the movement speed to
// something a human can process, i.e. avoid teleporting"): the simulator's choice of spot (bestSpot, every POS_EVERY s of
// game time), but the tower GLIDES there at up to HUMAN_V world units a REAL second, so the eye can follow it. The checkbox: aspira-ui.js
let autoMove = false;
try { autoMove = localStorage.getItem("spire.automove") === "1"; } catch (e) { /* not remembered */ }
const HUMAN_V = 600; // a phone's width (500 units) in under a second
function autoGlide(t, dt) {
  t.posT = (t.posT || 0) - dt;
  if (t.posT <= 0) { t.posT = POS_EVERY; const s = bestSpot(t, towerStats(t).range); if (s) t.goal = s; }
  if (!t.goal || (typeof towerHeld === "function" && towerHeld(t)) || t.fling) return;
  const real = dt / Math.max(0.01, typeof speedX === "function" ? speedX() : 1), dx = t.goal.x - t.x, dy = t.goal.y - t.y, d = Math.hypot(dx, dy), step = HUMAN_V * real;
  if (d <= step) { moveTower(t, t.goal); t.goal = null; return; }
  if (!moveTower(t, { x: t.x + dx / d * step, y: t.y + dy / d * step })) t.goal = null; // blocked: think again next time
}
// the simulator's player, every step (aspira-game.js) - GLIDING like auto-move when POS_GLIDE (owner, 2026-10-13: "limit the
// tower movements to the current auto-move settings"; it jumped). let: the simulator sets it
let POS_GLIDE = true;
function autoPosition(t, dt) {
  if (POS_GLIDE) { autoGlide(t, dt); return; }
  t.posT = (t.posT || 0) - dt;
  if (t.posT > 0) return;
  t.posT = POS_EVERY;
  const s = bestSpot(t, towerStats(t).range);
  if (s) moveTower(t, s);
}

// THE PLAY BOX (owner, 2026-10-13: "draw a faint outline of the mobile screen with rounded corners on the map"): the view EVERY
// standard phone shares ("standardize the limit so that it works the same way on all standardish phones") - the tightest of
// PHONES at PHONE_ZOOM, each with the core VIEW_UP_K x as far from the top as from the sides: VIEW_SIDE either side of the core, VIEW_UP
// above, VIEW_DOWN below (world units). EVERY screen zooms so the box fits it ("the zoom should be adjusted so that either the
// top and bottom touch, or the sides"), centred on the other axis (resize, aspira-draw.js); and it is the towers' MOVEMENT
// CAP ("the cap should be that the movement is within this range"): legalSpot (aspira-towers.js)
// PHONES: [w, h] CSS px of the page in the browser (bars taken off), small Android to iPhone 15 Pro Max
const PHONES = [[360, 640], [375, 667], [390, 664], [393, 659], [412, 732], [430, 740]];
// the core sits VIEW_UP_K x its side distance from the top (owner, 2026-10-13: "1.5 side distance, to top"; was 1)
const VIEW_UP_K = 1.5;
const VIEW_SIDE = Math.min(...PHONES.map(([w]) => w / 2)) / PHONE_ZOOM, VIEW_UP = VIEW_SIDE * VIEW_UP_K;
const VIEW_DOWN = Math.min(...PHONES.map(([w, h]) => h - VIEW_UP_K * w / 2)) / PHONE_ZOOM;
const PHONE_CORNER = 40 / PHONE_ZOOM, PHONE_ALPHA = 0.35 /* "less faint" (owner, 2026-10-13; was 0.15) */;
function phoneBox() { // 2D: world units
  return { x0: CX - VIEW_SIDE, y0: CY - VIEW_UP, x1: CX + VIEW_SIDE, y1: CY + VIEW_DOWN, r: PHONE_CORNER };
}
// in 3D it is a SCREEN rectangle (owner, 2026-10-13: "it should be rectangular not trapezoidal"), not a box on the floor: the
// same rectangle on screen as 2D's (it fits the window), in the 3D view's pixels (under the texture camera);
// a spot is on the phone when it PROJECTS inside
const phoneOn3d = () => typeof q3d === "function" && q3d() && typeof warp !== "undefined" && !!warp.p;
function viewCam(fn) { // the 3D maths runs under the texture camera (warp3d sets warp.inFrame); outside a frame scale to it
  if (warp.inFrame) return fn();
  const c0 = { k: cam.k, ox: cam.ox, oy: cam.oy };
  cam.k *= warpRes(); cam.ox *= warpRes(); cam.oy *= warpRes();
  try { return fn(); } finally { Object.assign(cam, c0); }
}
function phoneRect3d() { // 3D: the view's pixels (call under viewCam) - the SAME screen rectangle as 2D's, so it fits the window too
  const k = cam.k;
  return { x0: cam.ox + (CX - VIEW_SIDE) * k, y0: cam.oy + (CY - VIEW_UP) * k, x1: cam.ox + (CX + VIEW_SIDE) * k, y1: cam.oy + (CY + VIEW_DOWN) * k, r: PHONE_CORNER * k };
}
// is (x, y) on the phone, `inset` world units clear of its edge?
function phoneInside(x, y, inset = 0) {
  if (!phoneOn3d()) { const b = phoneBox(); return x >= b.x0 + inset && x <= b.x1 - inset && y >= b.y0 + inset && y <= b.y1 - inset; }
  return viewCam(() => {
    const b = phoneRect3d(), p = warpProject(x, y, 0), e = inset * cam.k;
    return p.s > 0 && p.x >= b.x0 + e && p.x <= b.x1 - e && p.y >= b.y0 + e && p.y <= b.y1 - e;
  });
}
