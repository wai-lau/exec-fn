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
const ACD_BASE_DOUBLE = 1, ACD_BASE_MAX = 32; // (halved to 16 and restored, 2026-10-08: the boss gap was SOL's, not the cap's - bossvs.mjs)
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

// ---------- ACD's chart (moved from aspira-skills.js at its 500-line cap, 2026-10-07): Catalyst ramp, Pour lines, Seep puddles ----------
// FITTED 2026-10-06 to +25 / +50 / +100% (Spray to +30 / +60 / +120%, since
// its lines can never share an enemy): Corrosion's ramp time, Spray's per-line
// damage, Contagion's puddle heat (tier III's is below II's - its puddles are bigger)
// REFIT 2026-10-06 (overnight phase 2: standard team, waves 20-40, HP scaled so it is pressed - the earlier thin-field fits ran 3-12x over target)
// CORROSION REWORKED 2026-10-07 (owner): a dud axis (111% at 0, 96% at III) - the
// ramp's SPEED never mattered, enemies die or leave before it tops out. Now tier I
// keeps full heat on a new target (it was III's), II / III burn HOTTER at every
// heat (ACD_CORROSION_DMG x the dps, so the top heat rises with it - raising only
// the cap did nothing, the ramp rarely reaches it); the ramp stays ACD_DOUBLE[0]
const ACD_CORROSION_DMG = [1, 1.213, 1.823, 2.674, 3.631, 4.253];
const ACD_DOUBLE = [0.5, 0.39, 0.3, 0.12, 0.12, 0.12], ACD_LINES = [2, 3, 4, 6, 7, 8], /* early-game balance 2026-10-06: two lines from the start (was 1/2/3/5); Spray to be re-fitted */ ACD_SPRAY_MUL = [1, 0.614, 0.458, 0.4, 0.4, 0.4];
// puddles by Seep tier (index 0 = the DEFAULT drip, owner): one every `every`
// s per line, lasting `life` s, radius r; each burns at ACD_PUDDLE_HEAT of its
// line's heat when it fell, by Seep tier
// index 0 = NO puddles (owner, 2026-10-07: "ACD shouldn't have puddles at level 0"; was a default drip { every: 1.4, life: 1.5, r: 20 })
const ACD_CONTAGION = [null, { every: 1.2, life: 2.4, r: 28 }, { every: 1, life: 3.1, r: 33 }, { every: 0.9, life: 4.2, r: 42 }, { every: 0.8, life: 5, r: 50 }, { every: 0.7, life: 6.5, r: 65 }]; // pools bigger (x1.25) and longer (x1.3) at every tier (owner, 2026-10-08); V the capstone
// a puddle ramps to the OLD x32 ceiling (owner, 2026-10-08: "increase the puddle damage to compensate" for the jets' cap halved to x16)
const ACD_PUDDLE_CAP = 32;
const ACD_PUDDLE_HEAT = [0.5, 0.173, 0.149, 0.147, 0.155, 0.173];
// Contagion III (Pandemic) puddles SLOW what stands in them (owner, 2026-10-06,
// the no-FRZ niche search: 3 SOL + 6 ACD reached 98, was 74; FRZ teams unchanged)
const ACD_CONTAGION_SLOW = [0, 0.05, 0.1, 0.15, 0.2, 0.25]; // slows from I, ramping slowly to III's old 25% at V (owner, 2026-10-08) // was 0.3 (2026-10-06 reach rework: with the roaming bonus 0.3 made Pandemic ~5x; phase 4 found 0.2-0.3 all open the niche)
function acdSkillStats(t, s, b) {
  const c = skillOf(t, "corrosion");
  s.dmg = b.dmg * ACD_CORROSION_DMG[c]; s.range = b.range * RANGE_BONUS; s.double = ACD_DOUBLE[0]; s.cap = ACD_BASE_MAX; s.plagueR = 0;
  // every ACD hands 40% of a dead line's ramp on (early-game balance 2026-10-06;
  // fast waves reset it); from Corrosion I, Etch, ALL of it
  s.carry = c >= 1 ? 1 : 0.4; s.targets = ACD_LINES[skillOf(t, "spray")]; s.contagion = ACD_CONTAGION[skillOf(t, "contagion")];
  s.contagionHeat = ACD_PUDDLE_HEAT[skillOf(t, "contagion")]; s.contagionSlow = ACD_CONTAGION_SLOW[skillOf(t, "contagion")]; s.sprayMul = ACD_SPRAY_MUL[skillOf(t, "spray")]; s.skill = true;
}
// every step (stepAcd): each line drips a puddle every seep.every s; each
// puddle ticks its burn on whatever stands in it, st.rate times a second
function stepPuddles(t, st, dt) {
  const sp = st.contagion;
  for (const l of t.lines) {
    if (l.e.dead) continue;
    l.drip = (l.drip ?? sp.every) - dt;
    if (l.drip > 0) continue;
    l.drip += sp.every;
    (t.puddles ||= []).push({ x: l.e.x, y: l.e.y, r: sp.r, life: sp.life, age: 0, tick: 0, dps: st.dmg * Math.min(ACD_PUDDLE_CAP, 2 ** (l.held / st.double)) * st.contagionHeat });
  }
  if (!t.puddles) return;
  const every = 1 / st.rate;
  for (const p of t.puddles) {
    p.age += dt; p.tick += dt;
    while (p.tick >= every) {
      p.tick -= every;
      for (const e of G.enemies) {
        if (e.dead || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > p.r * p.r) continue;
        damage(e, p.dps * every, t); e.burnT = 0.4; // a real hit: it pops shields too
        if (st.contagionSlow && !e.dead) applySlow(e, st.contagionSlow, 0.5, t.id + ":pud");
      }
    }
  }
  t.puddles = t.puddles.filter(p => p.age < p.life);
}
// UI (drawAcd): a puddle is a cluster of BUBBLES (owner): PUDDLE_BUBBLES at
// once, each at a jittered spot within it, growing to its own jittered max
// size over BUBBLE_T real seconds, then POPPING (a brief widening ring) and
// starting again elsewhere; the whole cluster fades as the puddle dries
const PUDDLE_BUBBLES = 5, BUBBLE_T = 0.6, BUBBLE_POP = 0.15;
// a puddle's bubbles are as INTENSE as its damage (owner, 2026-10-07): brighter and
// bolder the more it burns, 0.6x for a faint puddle up to 1.8x for a deadly one
const puddleGlow = p => Math.max(0.6, Math.min(1.8, 0.6 + 0.3 * Math.log2(1 + (p.dps || 0) / 60)));
function drawPuddles(t) {
  const now = performance.now() / 1000;
  ctx.strokeStyle = ctx.fillStyle = COL.chatsubo; ctx.lineWidth = 1.2;
  if (lowQ) { for (const p of t.puddles || []) { ctx.globalAlpha = 0.5 * (1 - p.age / p.life); ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.6, 0, 6.283); ctx.stroke(); } ctx.globalAlpha = 1; return; } // low quality: one ring, no bubbles
  for (const p of t.puddles || []) {
    const I = puddleGlow(p), fade = Math.min(1, (1 - p.age / p.life) * I), seed = p.seed ||= 1 + Math.floor(Math.random() * 1e6);
    ctx.lineWidth = 1.2 * I;
    for (let i = 0; i < PUDDLE_BUBBLES; i++) {
      const ph = now / BUBBLE_T + i / PUDDLE_BUBBLES + (seed % 97) / 97, cyc = Math.floor(ph), f = ph - cyc;
      const h = k => fixedRand(cyc * 13 + i * 3 + k, seed); // this bubble's own jitter, fixed for its life
      const a = h(0) * 6.283, d = Math.sqrt(h(1)) * p.r * 0.8, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      const max = p.r * (0.2 + 0.25 * h(2));
      ctx.beginPath();
      if (f < 1 - BUBBLE_POP) {
        ctx.arc(x, y, max * f / (1 - BUBBLE_POP), 0, 6.283);
        ctx.globalAlpha = Math.min(1, 0.3 * fade); ctx.fill();
        ctx.globalAlpha = Math.min(1, 0.9 * fade); ctx.stroke();
      } else {
        const q = (f - 1 + BUBBLE_POP) / BUBBLE_POP; // the pop: a ring widening and gone
        ctx.arc(x, y, max * (1 + 0.5 * q), 0, 6.283);
        ctx.globalAlpha = 0.6 * (1 - q) * fade; ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}
