// /aspira - where a tower sits on its spoke (owner, 2026-10-04): the spot that
// MAXIMISES ANTICIPATED HITS, re-scored live. Loaded after aspira-towers.js
// (the simulator too).
//
// Every POS_EVERY s each living enemy's path is predicted over the next
// POS_HORIZON s, sampled every POS_DT s along its lane - computed once and
// shared by every tower. A spot on the spoke (every POS_STEP units) scores
// each predicted sample inside the tower's range, weighed by URGENCY (nearer
// the core counts more) and by the tower's own TARGETING (see bestSpot). Samples sooner than the
// tower could reach that spot do not count, since it would not be there yet.
// The tower heads for the best spot, and only switches for a spot POS_SWITCH
// times better than the one it is heading to. With nothing reachable in time,
// or no enemy alive, it RESTS at the OUTER end of its spoke (owner).
const POS_EVERY = 0.25, POS_HORIZON = 3, POS_DT = 0.5, POS_STEP = 10, POS_SWITCH = 1.1;
const POS_STALE = 0.2; // Fresh: what a debuffed enemy's hits are still worth
let POS_URGENCY = 6, POS_MODE_MIX = 1; // FULL targeting (owner: 0.3 barely counted); urgency 6 keeps the lives - swept u 3/6/10/20 x mix 0.3/1. let: the simulator sweeps both
let posPred = null, posPredAt = -1;
// [{ e, pts: [{ x, y, t }] }], recomputed at most once per POS_EVERY of game time
function predictions() {
  if (posPred && G.clock - posPredAt < POS_EVERY / 2) return posPred;
  posPredAt = G.clock;
  posPred = [];
  for (const e of G.enemies) {
    if (e.dead) continue;
    const v = effSpeed(e), pts = [];
    for (let t = 0; t <= POS_HORIZON + 1e-9; t += POS_DT) {
      const s = e.s + v * t, p = pathAt(e.pi, s, e.ang || 0);
      // URGENCY: a hit counts more the nearer that point is to the core (x1 at entry .. x7 at the core)
      pts.push({ x: p.x, y: p.y, t, w: 1 + POS_URGENCY * Math.min(1, s / PATHS[e.pi].len) ** 2 });
    }
    posPred.push({ e, pts });
  }
  posPred.maxHp = Math.max(1, ...posPred.map(q => q.e.hp));
  return posPred;
}
// the spoke offset to head for, or null with nothing alive
function bestSpot(t, k, range) {
  const pred = predictions();
  if (!pred.length) return null;
  // spots from the inner limit (k.min, below the slot) out to k.max
  const off = t.off || 0, r2 = range * range, first = Math.ceil(k.min / POS_STEP), steps = Math.floor(k.max / POS_STEP);
  // each enemy's hits weighed by the tower's TARGETING (owner): Biggest by its
  // HP against the biggest on the field, Fresh full for the undebuffed and
  // POS_STALE for the rest, Near plain (the urgency weight already favours the core)
  const f = pred.map(({ e }) => POS_MODE_MIX * (t.mode === "biggest" ? e.hp / pred.maxHp : t.mode === "fresh" ? (debuffed(e) ? POS_STALE : 1) : 1) + 1 - POS_MODE_MIX);
  const score = oi => {
    const o = oi * POS_STEP, x = k.c.x + k.ux * o, y = k.c.y + k.uy * o, eta = Math.abs(o - off) / moveSpeed(t);
    let n = 0;
    pred.forEach(({ pts }, i) => { for (const p of pts) if (p.t >= eta && (p.x - x) ** 2 + (p.y - y) ** 2 <= r2) n += p.w * f[i]; });
    return n;
  };
  let best = 0, bestScore = 0;
  for (let oi = first; oi <= steps; oi++) {
    const sc = score(oi);
    if (sc > bestScore || (sc === bestScore && sc > 0 && Math.abs(oi * POS_STEP - off) < Math.abs(best * POS_STEP - off))) { bestScore = sc; best = oi; }
  }
  // nothing reachable in time: REST outermost (owner) - enemies enter at the rim
  if (!bestScore) return k.max;
  // stay with the current mark unless the new one is clearly better
  const cur = t.want != null ? Math.round(t.want / POS_STEP) : null;
  if (cur != null && cur >= first && cur <= steps && score(cur) * POS_SWITCH >= bestScore) return cur * POS_STEP;
  return best * POS_STEP;
}
