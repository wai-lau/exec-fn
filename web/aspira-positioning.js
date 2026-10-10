// /aspira - the SIMULATOR'S PLAYER dragging towers (2026-10-10): in a real game the
// player drags them (aspira-camera.js) and they never move themselves; the balance
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
  let f = pred.map(({ e }) => POS_MODE_MIX * (t.mode === "biggest" ? e.hp / pred.maxHp : t.mode === "fresh" ? (debuffed(e) ? POS_STALE : 1) : 1) + 1 - POS_MODE_MIX);
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
// the simulator's player, every step (aspira-game.js)
function autoPosition(t, dt) {
  t.posT = (t.posT || 0) - dt;
  if (t.posT > 0) return;
  t.posT = POS_EVERY;
  const s = bestSpot(t, towerStats(t).range);
  if (s) moveTo(t, s);
}
