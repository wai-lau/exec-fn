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
    if ((l.left ?? 0) > 0) return true;
    if (st.carry) t.spare = Math.max(t.spare || 0, l.held * st.carry); // Flow: an escaped enemy hands its ramp on too (the fast answer)
    return false;
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
    damage(o, dd, t, false, false, st); onHit(o, t, st, dd); o.burnT = 0.4; // burning: no longer Fresh (st: its shieldPop)
    if (st.burnSlow && !o.dead) applySlow(o, st.burnSlow, 0.5, t.id); // Residue: the burn slows
    if (st.corrode && !o.dead) corrodeHit(o, dd * st.corrode, st, t); // Corrosion: st.corrode of the tick's damage, past zero on purpose; corrodeT: dotted ring
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
// Corrosion EATS ARMOR again (owner, 2026-10-10: three towers, every trio must be winnable): the chart rework had
// dropped st.corrode, so the axis no longer touched armor. Each tick strips ACD_CORRODE of its damage, past zero -
// negative armor is a flat bonus on every hit from every tower, bosses too. The weakest of 1x / 3x / 10x tried
// (scripts/aspira-sim/trios.mjs): ARC+FRZ+ACD 90 -> won (Judgement, Death), ARC+SOL+ACD 96 -> won (Capacitance first)
// the strip's FLOOR, in multiples of the wave's armored-enemy armor (2026-10-12, trio sim: unbounded, a
// pile of negative armor was ACD's whole edge - with the strip off its trios leaked 50-100%, with it 0-5%,
// while ARC+FRZ+SOL leaked 55%): Corrosion still eats below nothing, but only so far
let ACD_BOSS_FLOOR = 16; // a BOSS's floor x this: a long fight is where Corrosion's pile matters (2026-10-12: with the plain floor ARC+FRZ+ACD lost Justice at 80 in every game; x4 still 80, x8 died at 90, x16 won 6/6)
let ACD_CORRODE_FLOOR = [0, 0.25, 0.5, 0.75, 1, 1.25]; // swept x0.25 / x0.5 / x1 at HP x1.5: x0.5 brings ACD trios to 14-45% leaked at 81-89 (ARC+FRZ+SOL 45-55%)
const acdArmorRef = new Map(), armorRefOf = n => acdArmorRef.get(n) ?? acdArmorRef.set(n, ENEMIES.armor.armor * ENEMY_HP_MUL * Math.pow(hpPow(n) + n * 4 / 18, ARMOR_EXP)).get(n);
// DAMAGE CREDIT (owner, 2026-10-12: "damage caused by debuff from another tower should attribute damage source to
// the debuffing tower"): of a hit's tally (`got`), what BRITTLE added goes to the FRZ that made it brittle (e.brittleBy),
// what LOWER ARMOR added (stripped by Breach / Corrosion - e.strip, by tower id - and frost, e.frostBy) to those towers
// by their shares, and the rest to the hitter. hit(a, A): the hit `a` through armor A, as damage() takes it
function stripBy(e, t, amt) { if (t && amt > 0) (e.strip ||= {})[t.id] = (e.strip[t.id] || 0) + amt; }
function damageCredit(e, t, pre, amt, frost, pierce, got) {
  const A0 = e.armor0 || 0, hit = (a, A) => { A = Math.trunc(A); return A > 0 && pierce < 1 ? Math.max(a * 0.1, a - A * (1 - pierce)) : A < 0 ? a - A : a; };
  const base = hit(pre, A0), brit = Math.max(0, hit(amt, A0) - base), full = hit(amt, (e.armor || 0) - frost), arm = Math.max(0, full - base - brit);
  const k = full > 0 ? got / full : 0, give = (id, v) => { const o = id != null && G.towers.find(x => x.id === id); if (o && v > 0) { o.dealt = (o.dealt || 0) + v; return v; } return 0; };
  let mine = got;
  if (brit) mine -= give(e.brittleBy, brit * k);
  if (arm) {
    const parts = Object.entries(e.strip || {}).map(([id, v]) => [Number(id), v]);
    if (frost > 0) parts.push([e.frostBy, frost]);
    const sum = parts.reduce((s, p) => s + p[1], 0);
    if (sum > 0) for (const [id, v] of parts) mine -= give(id, arm * k * v / sum);
  }
  t.dealt = (t.dealt || 0) + mine;
}
function corrodeHit(e, amt, st, t) {
  const floor = -st.corrodeFloor * armorRefOf(e.wave || 1) * (e.arcana ? ACD_BOSS_FLOOR : 1), a = e.armor || 0;
  if (a > floor) { e.armor = Math.max(floor, a - amt); stripBy(e, t, a - e.armor); } // never raises armor already below (ARC's Melt)
  e.corrodeT = 0.4;
}
const ACD_CORRODE = [0, 0.1, 0.2, 0.3, 0.45, 0.6]; // x2 (2026-10-12: Corrosion is the strip alone now; was .06 .. .3) // x6 (2026-10-11, roles: Corrosion meant as ACD's ARMOR answer - still behind spread in TEAM countermx; was .01 .. .05)
// ROLES REWORK (owner, 2026-10-12: "what is acd weak to now? seems op"): a bare ACD is a tank killer, weak to the FAST
// (no carry: a jet starts cold on every new enemy) and to SHIELDS (acid and pools pop one charge a tick, like any hit).
// Flow buys the fast back: ACD_FLOW_CARRY of a jet's ramp rides on when its enemy dies OR escapes, past 1 = it lands
// hotter, and the jets slow (ACD_FLOW_SLOW, doubled on the fast like every slow - FAST_SLOW_MUL). Contagion buys the
// shields back through COVERAGE: bigger, longer pools ticking on more enemies. Corrosion: the strongest acid, eats armor.
const ACD_FLOW_CARRY = [0, 0.3, 0.5, 0.7, 0.9, 0.9] /* V and VI no hotter (owner, 2026-10-12: "flow V should not flow faster" - range instead, SKILL_MOVE; was 1.1, VI 1.5) */, ACD_FLOW_SLOW = [0, 0.05, 0.08, 0.11, 0.14, 0.17];
// CORROSION'S DAMAGE MOVED TO THE BASE (owner, 2026-10-12): a bare ACD burns ACD_BASE_DMG_MUL harder; Corrosion is
// now the armor STRIP alone - into negative armor, a flat bonus on every tower's hits, so it pays on the unarmored too
let ACD_BASE_DMG_MUL = 2; // let: the simulator sweeps it
const ACD_CORROSION_DMG = [1, 1, 1, 1, 1, 1]; // was 1 1.4 2.1 3.1 4.2 4.9 (kept as a table: the giga tier and fits index it) // x1.15 I..V (owner, 2026-10-11: ACD's strength back through Corrosion; was 1.213 1.823 2.674 3.631 4.253)
const ACD_DOUBLE = [0.5, 0.39, 0.3, 0.12, 0.12, 0.12], ACD_LINES = [2, 3, 4, 6, 7, 8], /* early-game balance 2026-10-06: two lines from the start (was 1/2/3/5); Spray to be re-fitted */ ACD_SPRAY_MUL = [1, 1, 1, 1, 1, 1]; // every jet a full strike (owner, 2026-10-08: never below 1) - Spray's reach (SKILL_MOVE) is the lever
// puddles by Seep tier (index 0 = the DEFAULT drip, owner): one every `every`
// s per line, lasting `life` s, radius r; each burns at ACD_PUDDLE_HEAT of its
// line's heat when it fell, by Seep tier
// index 0 = NO puddles (owner, 2026-10-07: "ACD shouldn't have puddles at level 0"; was a default drip { every: 1.4, life: 1.5, r: 20 })
// pools from the START, large and long (owner, 2026-10-12: "ACD should have pools ... large and last longer from the start";
// Contagion grows them, massive at VI); was null at 0, then life 4 .. 10, r 36 .. 85
// life x~1.8 (owner, 2026-10-12: "just make the pools last even longer with contagion"; was 6 7 8 10 12 14)
const ACD_CONTAGION = [{ every: 1.2, life: 6, r: 55 }, { every: 1.2, life: 9, r: 62 }, { every: 1.18, life: 12, r: 70 }, { every: 1.18, life: 16, r: 80 }, { every: 1.18, life: 20, r: 92 }, { every: 1.18, life: 25, r: 105 }]; // BIGGER (x1.3) and LONGER (x1.5) pools that burn LESS (owner, 2026-10-08; were life 2.4 3.1 4.2 5 6.5, r 28 33 42 50 65) // drip 1.24 / 1.18s (owner, 2026-10-08: Contagion under 200% - was 1.2 .. 0.7; V at 643%); size and life keep climbing; // pools bigger (x1.25) and longer (x1.3) at every tier (owner, 2026-10-08); V the capstone
// a puddle ramps to the OLD x32 ceiling (owner, 2026-10-08: "increase the puddle damage to compensate" for the jets' cap halved to x16)
const ACD_PUDDLE_CAP = 8; // (2026-10-08: x8, was x32 - a pool held the jet's whole ramp)
let ACD_SHIELD_POP = 1; // 1 (owner, 2026-10-12: ACD pops 1x, pools too - shields are a bare ACD's weakness); // 2026-10-11 (was 1, as every hit; 2 left ACD 16-34% leaked on shield waves, 3 gives 6-23%): let: the simulator sweeps it
const ACD_PUDDLE_HEAT = [0.1, 0.11, 0.12, 0.13, 0.14, 0.15]; // 2026-10-12: base pools burn low (they are free now) // 2026-10-11: x1.5 so ACD answers a swarm a little (owner: "FRZ ACD handle swarms a bit better") // 10% of the jet with the bigger, longer pools (owner, 2026-10-08; was 30%): isolation I..V 108 117 133 160 197%, the curve it had (108 123 128 146 197) // flat 30% of the jet (2026-10-08, Contagion under 200%; no tier lowers it) // restored (overnight 2026-10-08): the tier fit cut it to ~15%, and without ARC the pools are the only swarm answer - FRZ+SOL+ACD went 0/6 -> 4/6 with them back
// (the pools' slow moved to Flow's jets, owner 2026-10-12: "these rays could slow instead of contagion")
function acdSkillStats(t, s, b) {
  const c = skillOf(t, "corrosion");
  s.dmg = b.dmg * ACD_BASE_DMG_MUL * ACD_CORROSION_DMG[c]; s.range = b.range * RANGE_BONUS; s.double = ACD_DOUBLE[0]; s.cap = ACD_BASE_MAX; s.plagueR = 0;
  // every ACD hands 40% of a dead line's ramp on (early-game balance 2026-10-06;
  // fast waves reset it); from Corrosion I, Etch, ALL of it
  const f = skillOf(t, "spray"); // Flow (id kept: saves)
  s.carry = ACD_FLOW_CARRY[f]; s.burnSlow = ACD_FLOW_SLOW[f]; s.corrode = ACD_CORRODE[c]; s.corrodeFloor = ACD_CORRODE_FLOOR[c]; s.targets = ACD_LINES[f]; s.contagion = ACD_CONTAGION[skillOf(t, "contagion")];
  s.shieldPop = ACD_SHIELD_POP; // acid EATS shields: every tick pops ACD_SHIELD_POP (the shield answer, counter matrix)
  s.contagionHeat = ACD_PUDDLE_HEAT[skillOf(t, "contagion")]; s.sprayMul = ACD_SPRAY_MUL[skillOf(t, "spray")]; s.skill = true;
}
// every step (stepAcd): each line drips a puddle every seep.every s; each
// puddle ticks its burn on whatever stands in it, st.rate times a second
function stepPuddles(t, st, dt) {
  const sp = st.contagion;
  const drop = l => (t.puddles ||= []).push({ x: l.e.x, y: l.e.y, r: sp.r, life: sp.life, age: 0, tick: 0, dps: st.dmg * Math.min(ACD_PUDDLE_CAP, 2 ** (l.held / st.double)) * st.contagionHeat });
  for (const l of t.lines) {
    // a KILL under a jet drops a pool where it fell (owner, 2026-10-12); an escape drops none
    if (l.e.dead) { if (l.e.hp <= 0 && !l.dropped) { l.dropped = true; drop(l); } continue; }
    l.drip = (l.drip ?? sp.every) - dt;
    if (l.drip > 0) continue;
    l.drip += sp.every;
    drop(l);
  }
  if (!t.puddles) return;
  const every = 1 / st.rate;
  let grid = null; // built at the first tick that needs it
  const hit = t.puddles.length > POOL_LOD ? POOL_QUIET : null; // a crowd of pools: no flash or number per hit
  for (const p of t.puddles) {
    p.age += dt; p.tick += dt;
    while (p.tick >= every) {
      p.tick -= every;
      for (const e of poolNear(grid ||= enemyGrid(), p)) {
        if (e.dead || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > p.r * p.r) continue;
        const hp0 = e.hp;
        damage(e, p.dps * every, t, false, false, hit); e.burnT = 0.4;
        if (hit && hp0 > e.hp) (t.poolAcc ||= new Map()).set(e, (t.poolAcc.get(e) || 0) + hp0 - Math.max(0, e.hp)); // a real hit: it pops one shield charge
        if (st.corrode && !e.dead) corrodeHit(e, p.dps * every * st.corrode, st, t); // Corrosion strips in the pools too (owner, 2026-10-12)
      }
    }
  }
  t.puddles = t.puddles.filter(p => p.age < p.life);
  // the unseen hits SUMMED: one number an enemy every POOL_SUM_S (owner, 2026-10-12: "instead of hiding damage counts
  // entirely, just show the accumulated damage once per half second")
  t.poolSumT = (t.poolSumT ?? POOL_SUM_S) - dt;
  if (t.poolSumT > 0 || !t.poolAcc) return;
  t.poolSumT += POOL_SUM_S;
  for (const [e, d] of t.poolAcc) dmgNumber(e, String(dmgUnits(d)), d, "white", t);
  t.poolAcc.clear();
}
// LATE-GAME LAG (owner, 2026-10-12: "make late game acid pools less laggy"): a giga Contagion keeps 300+ pools, each of
// which checked EVERY enemy at every tick - now the live enemies are bucketed once a step into POOL_CELL squares and a
// pool looks only in the squares it covers (the same hits, far fewer checks)
const POOL_CELL = 128;
// ...and past POOL_LOD pools their hits land with no flash and no number EACH (hundreds a second were most of the lag) -
// their damage summed into one number an enemy every POOL_SUM_S instead
const POOL_QUIET = { noFx: true }, POOL_SUM_S = 0.5;
function enemyGrid() {
  const g = new Map();
  for (const e of G.enemies) {
    if (e.dead) continue;
    const k = Math.floor(e.x / POOL_CELL) + "," + Math.floor(e.y / POOL_CELL);
    const b = g.get(k); if (b) b.push(e); else g.set(k, [e]);
  }
  return g;
}
function poolNear(g, p) {
  const out = [], x0 = Math.floor((p.x - p.r) / POOL_CELL), x1 = Math.floor((p.x + p.r) / POOL_CELL), y0 = Math.floor((p.y - p.r) / POOL_CELL), y1 = Math.floor((p.y + p.r) / POOL_CELL);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const b = g.get(x + "," + y); if (b) out.push(...b); }
  return out;
}
// UI (drawAcd): a puddle is a cluster of BUBBLES (owner): PUDDLE_BUBBLES at
// once, each at a jittered spot within it, growing to its own jittered max
// size over BUBBLE_T real seconds, then POPPING (a brief widening ring) and
// starting again elsewhere; the whole cluster fades as the puddle dries
const PUDDLE_BUBBLES = 5, BUBBLE_T = 0.6, BUBBLE_POP = 0.15;
// a puddle's bubbles are as INTENSE as its damage (owner, 2026-10-07): brighter and
// bolder the more it burns, 0.6x for a faint puddle up to 1.8x for a deadly one
const puddleGlow = p => Math.max(0.6, Math.min(1.8, 0.6 + 0.3 * Math.log2(1 + (p.dps || 0) / 60)));
// the POOL under the bubbles (owner, 2026-10-11: "visually more appealing"): a liquid
// body whose rim wobbles, that SPLASHES out to size over PUDDLE_SPREAD s, shrinks as it
// dries, and carries a smaller, brighter sheen at its heart
const PUDDLE_SPREAD = 0.25, PUDDLE_RIM = 20;
function puddleBlob(p, now, k, seed) {
  const grow = 1 - (1 - Math.min(1, p.age / PUDDLE_SPREAD)) ** 3, dry = 0.8 + 0.2 * (1 - p.age / p.life), R = p.r * grow * dry * k;
  const pt = i => { const a = i / PUDDLE_RIM * 6.283, w = 0.9 + 0.07 * Math.sin(a * 3 + seed + now * 1.3) + 0.04 * Math.sin(a * 5 - seed - now * 0.9); return [p.x + Math.cos(a) * R * w, p.y + Math.sin(a) * R * w]; };
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // a SMOOTH rim: a curve through the midpoints, each rim point its control
  let prev = pt(0), m = mid(pt(PUDDLE_RIM - 1), prev);
  ctx.beginPath(); ctx.moveTo(m[0], m[1]);
  for (let i = 1; i <= PUDDLE_RIM; i++) { const q = pt(i); m = mid(prev, q); ctx.quadraticCurveTo(prev[0], prev[1], m[0], m[1]); prev = q; }
  ctx.closePath();
}
// ...and DRAWN within a budget: past POOL_LOD pools a pool is a plain circle (no wobbling rim, no sheen) and the bubbles
// are shared out so all of them together stay near POOL_LOD x PUDDLE_BUBBLES
const POOL_LOD = 24;
function drawPools(t, now) {
  const many = q3d() || (t.puddles || []).length > POOL_LOD; // 3D: always the plain circle - the board is drawn into a texture and warped, the rim's wobble barely shows and its fills cost (owner, 2026-10-12: pool perf in 3D)
  for (const p of t.puddles || []) {
    const fade = Math.min(1, (1 - p.age / p.life) * puddleGlow(p)), seed = p.seed ||= 1 + Math.floor(Math.random() * 1e6);
    if (many) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.9 * (0.8 + 0.2 * (1 - p.age / p.life)), 0, 6.283); ctx.globalAlpha = 0.14 * fade; ctx.fill(); ctx.globalAlpha = 0.4 * fade; ctx.stroke(); continue; }
    puddleBlob(p, now, 1, seed); ctx.globalAlpha = 0.14 * fade; ctx.fill(); ctx.globalAlpha = 0.4 * fade; ctx.stroke();
    puddleBlob(p, now, 0.5, seed * 7); ctx.globalAlpha = 0.12 * fade; ctx.fill();
  }
}
function drawPuddles(t) {
  const now = performance.now() / 1000;
  ctx.strokeStyle = ctx.fillStyle = COL.chatsubo; ctx.lineWidth = 1.2;
  drawPools(t, now);
  if (lowQ) { for (const p of t.puddles || []) { ctx.globalAlpha = 0.5 * (1 - p.age / p.life); ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.6, 0, 6.283); ctx.stroke(); } ctx.globalAlpha = 1; return; } // low quality: one ring, no bubbles
  const n = (t.puddles || []).length, per = Math.min(q3d() ? 2 : PUDDLE_BUBBLES, n > POOL_LOD ? POOL_LOD * PUDDLE_BUBBLES / n : PUDDLE_BUBBLES); // bubbles a pool, on average (3D: 2 at most)
  (t.puddles || []).forEach((p, j) => {
    const I = puddleGlow(p), fade = Math.min(1, (1 - p.age / p.life) * I), seed = p.seed ||= 1 + Math.floor(Math.random() * 1e6);
    ctx.lineWidth = 1.2 * I;
    const nb = Math.floor(per * (j + 1)) - Math.floor(per * j); // spread evenly: some pools get one, some none
    for (let i = 0; i < nb; i++) {
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
  });
  ctx.globalAlpha = 1;
}
