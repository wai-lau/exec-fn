// /aspira - ACD, the acid tower: its burning LINES and their ramp, Rain's
// chain, and (the skill chart) Seep's PUDDLES. Split from aspira-towers.js at
// its 500-line cap; same global scope, loaded right after it (the simulator too).

// ACD (owner): continuous LINES on enemies whose burn RAMPS EXPONENTIALLY
// while held - doubling every st.double seconds (1s; Catalyst 0.6s), capped at
// st.cap (x64). It starts LOW (3 dmg/s at x1). Damage lands in st.rate ticks a
// second, each a real hit (armor cuts it, a shield eats it). Each line keeps
// its own ramp, which resets when its enemy dies or leaves range.
//   st.targets    lines at once (Pour 3)
//   st.residue    seconds a line keeps burning after its enemy leaves range
//   st.plagueR    each tick also burns everyone within this radius of the
//                 line's enemy (Plague); st.bloom grows it with the ramp
//   st.corrode    armor stripped from everything a tick burns, below zero
//   st.allInRange no lines: every enemy in range burns on its own ramp
// ACD_BASE_MAX 64 -> 32 (overnight phase 3, 2026-10-06): ACD dealt 52-99% of a late team's damage
const ACD_BASE_DOUBLE = 1, ACD_BASE_MAX = 32;
const acdMulOf = (held, st) => Math.min(st.cap, 2 ** (held / st.double));
const acdFrac = (l, st) => Math.log2(acdMulOf(l.held, st)) / Math.log2(st.cap); // 0 fresh .. 1 full burn
function plagueRadius(l, st) {
  return st.plagueR * (st.bloom ? 1 + (st.bloom - 1) * acdFrac(l, st) : 1);
}
function acdLines(t, st) {
  const r2 = st.range ** 2, inRange = e => !e.dead && (e.x - t.x) ** 2 + (e.y - t.y) ** 2 <= r2;
  // Chain Reaction (st.carry): a line whose enemy DIED hands that share of its ramp to the next new line
  for (const l of t.lines || []) if (l.e.dead && st.carry) t.spare = Math.max(t.spare || 0, l.held * st.carry);
  let lines = (t.lines || []).filter(l => !l.e.dead);
  if (st.allInRange) {
    const had = new Map(lines.map(l => [l.e, l]));
    return G.enemies.filter(inRange).map(e => had.get(e) || { e, held: 0, tick: 0 });
  }
  // a line whose enemy left range lives on for st.residue seconds (Residue)
  lines = lines.filter(l => {
    if (inRange(l.e)) { l.left = st.residue || 0; return true; }
    return (l.left ?? 0) > 0;
  });
  let live = lines.filter(l => inRange(l.e)).length;
  for (const e of pickTargets(t, st, st.targets + lines.length)) {
    if (live >= st.targets) break;
    if (!lines.some(l => l.e === e)) { lines.push({ e, held: t.spare || 0, tick: 0, left: st.residue || 0 }); t.spare = 0; live++; }
  }
  return lines;
}
// Rain's chain: from the burning enemy, hop to the nearest enemy not yet in it
// within RAIN_HOP, never past the tower's reach, up to st.rainChain hops
const RAIN_HOP = 120;
function rainChain(t, st, from) {
  const out = [], seen = new Set([from]), r2 = st.range ** 2;
  let at = from;
  while (out.length < st.rainChain) {
    let nxt = null, nd = RAIN_HOP * RAIN_HOP;
    for (const o of G.enemies) {
      if (o.dead || seen.has(o) || (o.x - t.x) ** 2 + (o.y - t.y) ** 2 > r2) continue;
      const d = (o.x - at.x) ** 2 + (o.y - at.y) ** 2;
      if (d < nd) { nd = d; nxt = o; }
    }
    if (!nxt) break;
    seen.add(nxt); out.push(nxt); at = nxt;
  }
  return out;
}
function acdTick(t, st, l, every) {
  const d = st.dmg * (st.sprayMul || 1) * acdMulOf(l.held, st) * every; // Spray's fitted per-line damage (aspira-skills.js)
  const burn = o => {
    const dd = shotDamage(t, st, o, d);
    damage(o, dd, t); onHit(o, t, st, dd); o.burnT = 0.4; // burning: no longer Fresh
    if (st.burnSlow && !o.dead) applySlow(o, st.burnSlow, 0.5, t.id); // Residue: the burn slows
    if (st.corrode && !o.dead) { o.armor = (o.armor || 0) - st.corrode; o.corrodeT = 0.4; } // Corrosion: past zero, on purpose; corrodeT: dotted ring
  };
  const R = st.plagueR ? plagueRadius(l, st) : 0, center = l.e;
  burn(center);
  if (st.rainChain) l.chain = rainChain(t, st, center).filter(o => { burn(o); return true; });
  if (R) for (const o of G.enemies) if (o !== center && !o.dead && Math.hypot(o.x - center.x, o.y - center.y) <= R) burn(o);
}
function stepAcd(t, dt) {
  const st = towerStats(t), every = 1 / st.rate, r2 = st.range ** 2;
  t.lines = acdLines(t, st);
  for (const l of t.lines) {
    if ((l.e.x - t.x) ** 2 + (l.e.y - t.y) ** 2 > r2) l.left -= dt; // Residue's countdown
    l.held += dt; l.tick += dt;
    // every tick spits (owner: Hydralisk sound); aspira-sfx.js caps it at 3
    // at once, each quieter than the last
    while (l.tick >= every && !l.e.dead) { l.tick -= every; acdTick(t, st, l, every); sfx("acd"); }
  }
  if (st.contagion) stepPuddles(t, st, dt); // the chart ACD's puddles (aspira-skills.js)
}
