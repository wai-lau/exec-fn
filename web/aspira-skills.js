// /aspira - SKILL CHARTS (owner, 2026-10-05). A tower type with a chart (only
// ARC so far) levels up to 1 + SKILL_POINTS; each upgrade raises ONE of its
// three axes a tier (max SKILL_TIERS), like a JoJo Stand chart, and every tier
// is a named step. The other towers keep the path / form tree
// (aspira-upgrades.js). Loaded after aspira-towers.js (the simulator too):
// this file also holds ARC's skill-chart FIRING, kept out of towers.js (cap).
const SKILL_POINTS = 6, SKILL_TIERS = 3;
// cost of each of the six small upgrades, x the build cost (about the old
// three-step total, spread over six; balance later). DEARER (owner, 2026-10-06:
// "make the levels more expensive and more powerful"): was 2 / 3.5 / 5.5 / 8 / 10.5 / 13,
// a full chart 42.5 builds; now 62.5 (the first points stay near their old price, the last ones cost nearly double) - and every tier hits harder to match (below)
const SKILL_STEP_COST = [2.5, 4, 7, 11, 16, 22];
const SKILL_TREES = {
  // ARC (owner): Conductivity = ALL the branching (owner, 2026-10-05) - how
  // many times the chain jumps AND how many ways each jump forks; Voltage =
  // raw power, damage and range; Static = an EXPLOSION on every hit that marks
  // what it catches. Base: one jump forking two ways, three enemies.
  arc: [
    { id: "conductivity", name: "Conductivity", tiers: [
      { name: "Transfer", desc: "Jumps once more. More range." },
      { name: "Conduit", desc: "Wider forks. More range." },
      { name: "Superconductor", desc: "Fires two bolts at once. More range." },
    ] },
    { id: "voltage", name: "Voltage", tiers: [
      { name: "Spark", desc: "More damage and range." },
      { name: "Fry", desc: "More damage and range." },
      { name: "Vaporize", desc: "Most damage and range." },
    ] },
    { id: "capacitance", name: "Capacitance", tiers: [
      { name: "Static", desc: "Hits charge enemies; their next hit or death bursts. Slides further." },
      { name: "Charge", desc: "Bigger bursts. Slides further." },
      { name: "Overload", desc: "Biggest bursts; they briefly slow what they hit. Slides further." },
    ] },
  ],
};
// FRZ (owner, 2026-10-05): an AURA - everything inside is slowed (and loses it
// the moment it leaves) and ticks a little damage. Frost = a wider, colder
// aura; Rime = a ring PULSE out to the aura's edge leaving a STACKING
// PERMANENT slow on all it passes; Moons = 1 / 2 / 3 orbiting copies of the
// tower at half of everything.
SKILL_TREES.frz = [
  { id: "temp", name: "Temp", tiers: [
    { name: "Chill", desc: "Stronger aura slow (only while inside). Wider aura." },
    { name: "Freeze", desc: "Stronger aura slow. Wider aura." },
    { name: "Absolute Zero", desc: "Strongest aura slow. Widest aura." },
  ] },
  { id: "rime", name: "Rime", tiers: [
    { name: "Frost", desc: "Pulses add a permanent slow that stacks. Slides further." },
    { name: "Glacier", desc: "Stronger, faster pulses. Slides further." },
    { name: "Cryosphere", desc: "Strongest, fastest pulses. Slides furthest." },
  ] },
  { id: "moons", name: "Moons", tiers: [
    { name: "Moon", desc: "One orbiting moon: a weaker copy of the tower." },
    { name: "Twin Moons", desc: "Two stronger moons." },
    { name: "Desolation", desc: "Three full-strength moons." },
  ] },
];
// SOL (owner, 2026-10-05): Focus = more beams (the old Quad look: side by
// side at the tower, CONVERGING on the target - not parallel, owner), each its
// own full hit, 2 / 3 / 4; Refract = the beam bends on to 2 / 5 / 9 more
// enemies, each within SOL_CONE degrees of the first shot's direction (a light
// cone shows it); Scorch (was Impale; owner: light-themed) = 1 / 2 / 4 BREACH
// stacks per hit (the old bleed: armor down and crit up for every tower, for
// good). Focus x Scorch multiply:
// 4 beams x 6 = 24 Breaches a volley on one target.
SKILL_TREES.sol = [
  { id: "focus", name: "Focus", tiers: [
    { name: "Convergence", desc: "2 beams per shot. More range." },
    { name: "Crux", desc: "3 beams per shot. More range." },
    { name: "Disintegration", desc: "4 beams per shot. More range." },
  ] },
  { id: "refraction", name: "Refraction", tiers: [
    { name: "Lens", desc: "Shots bounce to 2 more enemies ahead. More range." },
    { name: "Prism", desc: "Bounce to 5 more. More range." },
    { name: "Spectrum", desc: "Bounce to 9 more. More range." },
  ] },
  { id: "breach", name: "Breach", tiers: [
    { name: "Scorch", desc: "Hits strip armor and add crit chance for all towers, for good. Slides further." },
    { name: "Sear", desc: "More per hit; harder crits. Slides further." },
    { name: "Flare", desc: "Most per hit; hardest crits. Slides further." },
  ] },
];
// ACD (owner, 2026-10-05): its lines DRIP burning PUDDLES onto the lane by
// default, each burning at a share of its line's current heat. Catalyst = the
// burn ramps faster (tier III: a line whose enemy dies hands half its ramp to
// the next); Pour = 2 / 3 / 5 lines at once; Seep = more, longer, bigger puddles.
SKILL_TREES.acd = [
  { id: "corrosion", name: "Corrosion", tiers: [
    { name: "Etch", desc: "Burn ramps up faster." },
    { name: "Corrode", desc: "Ramps faster still." },
    { name: "Dissolve", desc: "Fastest ramp; keeps full heat on a new target." },
  ] },
  { id: "spray", name: "Spray", tiers: [
    { name: "Mist", desc: "One more burn line, each on a different enemy. More range." },
    { name: "Downpour", desc: "Another line. More range." },
    { name: "Torrent", desc: "Two more lines. More range." },
  ] },
  { id: "contagion", name: "Contagion", tiers: [
    { name: "Blister", desc: "Hotter, more frequent puddles. Roams further and faster." },
    { name: "Plague", desc: "Bigger, longer puddles. Roams further and faster." },
    { name: "Pandemic", desc: "Biggest puddles; they slow enemies standing in them. Roams further and faster." },
  ] },
];
const hasSkills = t => !!SKILL_TREES[t.kind];
const maxLvl = t => (hasSkills(t) ? 1 + SKILL_POINTS : MAX_LVL);
const skillOf = (t, id) => (t.skills && t.skills[id]) || 0;
// the level the TOWER'S LOOK shows (its rings, max-level spokes): a chart
// tower's 7 levels fold onto the 4 drawn ones
const shownLvl = t => (!hasSkills(t) ? t.lvl : t.lvl >= maxLvl(t) ? MAX_LVL : 1 + Math.floor((t.lvl - 1) / 2));

// REACH BY TIER (owner, 2026-10-06: ranges and movement were HALVED, and "no upgrade
// causes any stat to go down - balance by playing around with ranges and movement
// instead"; then: each tower through what is distinctive about IT, not generic
// multipliers). A tier multiplies the tower's range / slide extent (SLIDE_MAX 2 = the
// old extent) / slide speed by [range, slide, speed]; each tower buys them differently:
//   ARC  (a long-range ANCHOR, owner) Conductivity and Voltage = RANGE; Capacitance =
//        SLIDE extent (owner: "static should increase movement range")
//   FRZ  Temp = a wider aura (its range IS the aura); FRZ roams by kind (aspira-towers.js)
//   SOL  (a long-range ANCHOR) Focus and Refraction = RANGE; Breach = SLIDE extent (owner)
//   ACD  Spray = range (more lines need more targets in reach); Contagion = a roaming
//        plague (the puddles follow the lane): slide and speed
const NO_MOVE = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
const SKILL_MOVE = {
  arc:    { conductivity: [[1, 1, 1], [1.15, 1, 1], [1.3, 1, 1], [1.5, 1, 1]], voltage: [[1, 1, 1], [1.3, 1, 1], [1.6, 1, 1], [2, 1, 1]], capacitance: [[1, 1, 1], [1, 1.3, 1], [1, 1.6, 1], [1, 2, 1]] },
  frz: { temp: [[1, 1, 1], [1.25, 1, 1], [1.5, 1, 1], [1.8, 1, 1]], rime: [[1, 1, 1], [1, 4 / 3, 1], [1, 5 / 3, 1], [1, 2, 1]], moons: NO_MOVE }, // Rime buys back FRZ's halved slide (owner)
  sol: { focus: [[1, 1, 1], [1.2, 1, 1], [1.4, 1, 1], [1.7, 1, 1]], refraction: [[1, 1, 1], [1.1, 1, 1], [1.2, 1, 1], [1.35, 1, 1]], breach: [[1, 1, 1], [1, 1.3, 1], [1, 1.6, 1], [1, 2, 1]] },
  acd:    { spray: [[1, 1, 1], [1.2, 1, 1], [1.5, 1, 1], [1.9, 1, 1]], contagion: [[1, 1, 1], [1, 1.15, 1.15], [1, 1.3, 1.3], [1, 1.5, 1.5]], corrosion: NO_MOVE },
};
function skillMove(t, s) {
  for (const [ax, tiers] of Object.entries(SKILL_MOVE[t.kind])) {
    const m = tiers[skillOf(t, ax)];
    s.range *= m[0]; s.slide *= m[1]; s.speed *= m[2];
  }
}

// ARC's numbers by tier (index 0 = untaken). Balance later (owner: ideas first).
// Voltage's damage FITTED to +25% / +50% / +100% dealt (owner; arcfit.mjs, waves 6-20)
// Voltage refit 2026-10-06 (drifted 4-6% low after the Static / slow / FRZ changes)
// REFIT 2026-10-06 (overnight phase 2: standard team, waves 20-40, HP scaled so it is pressed - the earlier thin-field fits ran 3-12x over target)
const ARC_VOLTAGE_DMG = [1, 1.4, 1.8, 2.6]; // its RANGE is in SKILL_MOVE
// Conductivity's shape by tier (owner): strikes (separate first targets),
// jumps, and forks per jump - 3, 7, 13, then two separate 13-hit attacks -
// and r, how much further each JUMP reaches (owner; Voltage owns the tower's range)
// d: a damage multiplier, FITTED so each tier deals +25% / +50% / +100% over
// the base (owner), like Voltage's (scripts/aspira-sim: arcfit)
let ARC_CONDUCTIVITY = [{ s: 1, j: 1, f: 2, r: 1, d: 1 }, { s: 1, j: 2, f: 2, r: 1.2, d: 1 }, { s: 1, j: 2, f: 3, r: 1.4, d: 1 }, { s: 2, j: 2, f: 3, r: 1.6, d: 1 }]; // owner 2026-10-06: a tier never lowers the hit (d was 1 / .775 / .613 / .394); the tree and the jump reach pay for it
// Static by tier: the blast's radius and its damage, x the hit that set it off
// FITTED 2026-10-06 to +25 / +50 / +100% ARC-own dealt (tier III saturates -
// a discharge can only take the HP in reach - so it needs a big charge)
const ARC_CAPACITANCE = [null, { r: 18, frac: 0.22 }, { r: 37.6, frac: 0.255 }, { r: 55, frac: 0.32 }]; // owner 2026-10-06: every tier a gain (III's charge was below II's); III refitted to +200% with its radius held at 55
// each jump hits ARC_FALL as hard and reaches ARC_SHRINK as far as the one before (owner)
const ARC_FALL = 0.5, ARC_SHRINK = 0.7;
// a jump's reach, before Conductivity lengthens it (owner: longer by default). It
// was 1.5 x the tower's range; the range was HALVED (owner, 2026-10-06: "not their
// effects nor reach"), so the jump keeps its old absolute size: 1.5 x the old 156
// range, and Voltage still lengthens it by the old x1.15 / 1.3 / 1.45
const ARC_JUMP_BASE = 234, ARC_VOLTAGE_JUMP = [1, 1.15, 1.3, 1.45];
function arcSkillStats(t, s, b) {
  const c = skillOf(t, "conductivity"), v = skillOf(t, "voltage"), z = skillOf(t, "capacitance");
  s.dmg = b.dmg * ARC_VOLTAGE_DMG[v] * ARC_CONDUCTIVITY[c].d; s.range = b.range * RANGE_BONUS;
  const sh = ARC_CONDUCTIVITY[c]; // Conductivity: strikes, jumps AND forks
  s.arcRange = ARC_JUMP_BASE * ARC_VOLTAGE_JUMP[v] * sh.r; s.targets = sh.s; s.layers = sh.j; s.branch = sh.f;
  s.arcFall = ARC_FALL; s.arcShrink = ARC_SHRINK; s.blast = ARC_CAPACITANCE[z]; s.statSlow = ARC_STAT_SLOW[z]; s.skill = true;
}
// what the upgrade cards offer: the next tier of each axis not yet full
function skillOptions(t) {
  return SKILL_TREES[t.kind].filter(ax => skillOf(t, ax.id) < SKILL_TIERS).map(ax => {
    const n = skillOf(t, ax.id), tier = ax.tiers[n];
    return { choice: ax.id, name: ax.name + " " + roman(n + 1) + " · " + tier.name, desc: tier.desc };
  });
}
const withSkill = (t, id) => ({ ...t.skills, [id]: skillOf(t, id) + 1 });

// ---------- ARC's chart firing ----------
// A bolt is a TREE grown a generation per hop: the strike, then every hit
// forks st.branch ways, st.layers jumps deep. A bolt NEVER hits the same
// enemy twice (owner) - so it can never strike more enemies than are in
// reach - and each jump hits ARC_FALL as hard and reaches ARC_SHRINK as far.
// Static (owner, reworked 2026-10-05): an ARC hit does NO blast - it leaves a
// CHARGE on the enemy it struck, worth st.blast.frac of the hit. Charges STACK.
// The next hit on that enemy from ANY tower - the ARC that charged it too
// (owner: it procs itself) - discharges them all at once as ONE blast around
// it before the new charge lands, and they are gone; so
// does its DEATH (owner). A discharge never sets off other charges, and an
// enemy a blast kills does not explode (no chain reaction - staticQuiet).
function fireSkillChain(t, st, e, seen) {
  if (seen && seen.has(e.id)) return; // a second strike never re-hits what the first took
  const col = TOWERS[t.kind].color, d = shotDamage(t, st, e, st.dmg);
  beam(t, e, col, CHAIN_BEAM_LIFE, 1.5, d);
  const root = { e, fx: fx[fx.length - 1], up: null, kids: new Set() };
  // Voltage SHOWS (owner): a white-hot core in every arc, and at tier III the
  // strike point throws sparks
  const v = skillOf(t, "voltage");
  if (v) root.fx.pierce = true;
  if (v >= SKILL_TIERS) burst(e.x, e.y, "white", 6);
  const c = { t, st, col, skill: true, seen: seen || new Set() }; // shared by the attack's strikes
  c.seen.add(e.id);
  skillHit(c, e, d);
  branchFrom(c, root, 1);
}
function skillHit(c, e, d) {
  damage(e, d, c.t, false, false, c.st); onHit(e, c.t, c.st, d); // (discharges e's own charges, if any)
  const b = c.st.blast;
  if (!b || e.dead) return;
  const ch = e.charge || (e.charge = { dmg: 0, n: 0, r: 0, t: c.t });
  ch.dmg += d * b.frac; ch.n++; ch.r = Math.max(ch.r, b.r); ch.t = c.t; ch.slow = Math.max(ch.slow || 0, c.st.statSlow || 0);
}
let staticQuiet = false;
// Capacitance III (Overload) rings SLOW what they hit (owner, 2026-10-06, the
// no-FRZ niche search): 30% for STAT_SLOW_T s - a late team without FRZ can
// answer the fast waves (ARC + SOL + a little ACD reached ~98, was ~83)
const ARC_STAT_SLOW = [0, 0, 0, 0.3], STAT_SLOW_T = 0.6;
// a DISCHARGE (owner): a RAPIDLY EXPANDING orange ring from the enemy, out to
// its radius over STATIC_RING_T, damaging each enemy once as its edge reaches
// it. Quiet: it sets off no other charges.
const STATIC_RING_T = 0.25;
function dischargeStatic(e) {
  const ch = e.charge;
  e.charge = null;
  (G.staticRings ||= []).push({ x: e.x, y: e.y, R: ch.r, dmg: ch.dmg, t: ch.t, slow: ch.slow || 0, age: 0, hit: new Set() });
}
// every step (stepChains): grow the rings and land their damage
function stepStaticRings(dt) {
  if (!G.staticRings || !G.staticRings.length) return;
  staticQuiet = true;
  try {
    for (const g of G.staticRings) {
      g.age += dt;
      const r = g.R * Math.min(1, g.age / STATIC_RING_T);
      for (const o of G.enemies) {
        if (o.dead || g.hit.has(o.id) || (o.x - g.x) ** 2 + (o.y - g.y) ** 2 > r * r) continue;
        g.hit.add(o.id); damage(o, g.dmg, g.t, false, false, null);
        if (g.slow && !o.dead) applySlow(o, g.slow, STAT_SLOW_T, g.t.id + ":stat");
      }
    }
  } finally { staticQuiet = false; }
  G.staticRings = G.staticRings.filter(g => g.age < STATIC_RING_T * 1.6); // a short fade past full size
}
// UI (drawScene): each ring, bright while it grows, fading once it is full
function drawStaticRings() {
  ctx.strokeStyle = COL[TOWERS.arc.color]; ctx.lineWidth = 3;
  for (const g of G.staticRings || []) {
    const p = g.age / STATIC_RING_T;
    ctx.globalAlpha = p < 1 ? 0.9 : Math.max(0, 0.9 * (1.6 - p) / 0.6);
    ctx.beginPath(); ctx.arc(g.x, g.y, g.R * Math.min(1, p), 0, 6.283); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// the nearest enemy this bolt has not hit yet, within this jump's (shrunk) reach
function skillHop(c, node, depth) {
  const from = node.e, r = c.st.arcRange * c.st.arcShrink ** (depth - 1);
  let nxt = null, nd = r * r;
  for (const o of G.enemies) {
    if (o.dead || c.seen.has(o.id)) continue;
    const d = (o.x - from.x) ** 2 + (o.y - from.y) ** 2;
    if (d < nd) { nd = d; nxt = o; }
  }
  return nxt;
}
function skillHopTo(c, node, nxt, depth) {
  const raw = c.st.dmg * c.st.arcFall ** depth, d = shotDamage(c.t, c.st, nxt, raw);
  node.kids.add(nxt.id); c.seen.add(nxt.id);
  beam(node.e, nxt, c.col, CHAIN_BEAM_LIFE, 1.5, d);
  fx[fx.length - 1].alpha = Math.min(1, raw / c.st.dmg); // as opaque as the share of the strike it carries
  if (skillOf(c.t, "voltage")) fx[fx.length - 1].pierce = true; // Voltage's white-hot core
  const child = { e: nxt, fx: fx[fx.length - 1], up: node, kids: new Set() };
  keepLit(node, CHAIN_BEAM_LIFE);
  skillHit(c, nxt, d);
  return child;
}

// ---------- FRZ's chart: the aura, the Rime pulses, the moons ----------
// numbers by tier (index 0 = untaken); balance later (owner: ideas first)
// FITTED 2026-10-06 to +25 / +50 / +100% DELAY (enemy-seconds of slow bought
// for the other towers; FRZ + L1 ARC + L1 SOL, waves 20-30) - the first
// guesses were 2-4x too strong; range moves little so "colder" reads as colder
// early-game balance 2026-10-06: +0.03 on every tier (FRZ stays a pure SUPPORT tower - owner)
const FRZ_TEMP_SLOW = [0.4, 0.43, 0.46, 0.5]; // the aura's range is in SKILL_MOVE
const FRZ_RIME = [0, 0.02, 0.035, 0.06]; // 2026-10-06: tier I was a dead point (was 1% / 1.9% / 3.7%) // each pulse's permanent stacking slow
// FRZ's own levers (owner: no generic multipliers): Rime pulses MORE OFTEN each tier, the moons are STRONGER copies each tier
const FRZ_RIME_PERIOD = [2, 2, 1.7, 1.4], FRZ_MOON_BY = [0.78, 0.9, 0.95, 1];
const FRZ_TICK = 0.5, FRZ_RIME_GROW = 2.4; // a Rime ring takes FRZ_RIME_GROW game s to reach the edge (owner: much slower; was 0.6)
const FRZ_AURA_HOLD = 0.06, FRZ_RIM_W = 16; // the frosted rim's width per unit of slow (owner: thicker the colder) // an aura slow outlasts one step only: it is gone the moment the enemy leaves
const FRZ_TICK_HIT = { armorPierce: 1 }; // a tick's hit on a shield: no armor bite
function frzSkillStats(t, s, b) {
  const f = skillOf(t, "temp");
  s.range = b.range * RANGE_BONUS;
  s.aura = FRZ_TEMP_SLOW[f]; s.dmg = b.dmg * b.rate * FRZ_TICK; s.rate = 1 / FRZ_TICK; // dmg / rate: a TICK
  s.rime = FRZ_RIME[skillOf(t, "rime")]; s.rimeEvery = FRZ_RIME_PERIOD[skillOf(t, "rime")]; s.moonN = skillOf(t, "moons"); s.moonK = FRZ_MOON_BY[s.moonN]; s.skill = true;
}
// the aura's sources: the tower, then each moon at FRZ_MOON_SCALE of everything
function frzSources(t, st) {
  const out = [{ x: t.x, y: t.y, k: 1, id: t.id }];
  if (st.moonN) moonSpots(t, { moons: st.moonN }).forEach((m, i) => out.push({ x: m.x, y: m.y, k: st.moonK, id: t.id + ":moon" + i }));
  return out;
}
// every step (aspira-game.js): slow what is inside each aura, tick its damage,
// and grow the Rime pulses
function frzStep(t, dt) {
  const st = towerStats(t), srcs = frzSources(t, st);
  t.auraT = (t.auraT || 0) - dt;
  const tick = t.auraT <= 0;
  if (tick) t.auraT += FRZ_TICK;
  let ticked = false;
  for (const s of srcs) {
    const r2 = (st.range * s.k) ** 2;
    for (const e of G.enemies) {
      if (e.dead || (e.x - s.x) ** 2 + (e.y - s.y) ** 2 > r2) continue;
      applySlow(e, st.aura * s.k, FRZ_AURA_HOLD, s.id);
      if (!tick) continue;
      ticked = true;
      // a tick POPS a shield (owner, 2026-10-06) and is never blunted by armor;
      // otherwise it is quiet (no flash) but shows its NUMBER, sized by what it took
      if (e.shield > 0) { damage(e, st.dmg * s.k, t, false, false, FRZ_TICK_HIT); continue; }
      const hp = e.hp;
      damage(e, st.dmg * s.k, t, true);
      if (hp - e.hp > 0) dmgNumber(e, String(Math.round(hp - e.hp)), hp - e.hp, "white");
    }
  }
  if (ticked) sfx("frz"); // a tick that touched anything is HEARD (owner, 2026-10-07; was silent)
  if (st.rime) {
    t.rimeT = (t.rimeT || 0) - dt;
    if (t.rimeT <= 0) {
      t.rimeT += st.rimeEvery;
      for (const s of srcs) (t.pulses ||= []).push({ x: s.x, y: s.y, R: st.range * s.k, v: st.rime * s.k, id: s.id + ":rime", age: 0, hit: new Set() });
    }
  }
  if (t.pulses) {
    for (const p of t.pulses) {
      p.age += dt;
      const r = p.R * Math.min(1, p.age / FRZ_RIME_GROW);
      for (const e of G.enemies) {
        if (e.dead || p.hit.has(e.id) || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > r * r) continue;
        p.hit.add(e.id); applySlow(e, p.v, Infinity, p.id, "stack");
      }
    }
    t.pulses = t.pulses.filter(p => p.age < FRZ_RIME_GROW);
  }
}
// UI: the aura discs, the moons and the Rime rings (aspira-effects.js drawTethers)
const MOON_TRI = 11; // a moon's triangle, corner to centre
function drawFrzSkill(t, st) {
  const col = COL[TOWERS.frz.color];
  frzSources(t, st).forEach((s, i) => {
    gradDisc(s.x, s.y, st.range * s.k, col, 0.8);
    // Frost (owner): a FROSTED RIM, thicker the colder the aura (its slow)
    ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = FRZ_RIM_W * st.aura * s.k;
    ctx.beginPath(); ctx.arc(s.x, s.y, st.range * s.k, 0, 6.283); ctx.stroke();
    // a MOON (every source after the tower; Moons III's are full strength, so
    // not "k < 1" - owner: they went missing) is a TRIANGLE pointing at the tower
    if (i) { ctx.fillStyle = col; ctx.globalAlpha = 0.95; poly(s.x, s.y, MOON_TRI, 3, Math.atan2(t.y - s.y, t.x - s.x), false); ctx.fill(); }
  });
  // Rime (owner): a THIN expanding ring with a GLOW
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.shadowColor = col; ctx.shadowBlur = 12 * cam.k;
  for (const p of t.pulses || []) {
    const f = Math.min(1, p.age / FRZ_RIME_GROW);
    ctx.globalAlpha = 0.9 * (1 - f * 0.6); ctx.beginPath(); ctx.arc(p.x, p.y, p.R * f, 0, 6.283); ctx.stroke();
  }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}

// ---------- SOL's chart: Focus beams, Refract cone, Scorch Breaches ----------
const SOL_BEAMS = [1, 2, 3, 4], SOL_REFRACTION = [0, 2, 5, 9], SOL_BREACH = [0, 1, 2, 6];
// a refraction lands within SOL_CONE degrees of the first shot's direction (at
// any distance); one Breach = BREACH_ARMOR armor off and BREACH_CRIT crit
// chance for every tower
const SOL_CONE = 8, /* greatly narrowed (owner, 2026-10-07; was 25) */ BREACH_ARMOR = 1.5, BREACH_CRIT = 0.01;
// SOL's own lever (owner: more crit): Breach also raises the crit MULTIPLIER, x3 at base
const SOL_CRITMUL = [3, 4, 5, 7];
// FITTED 2026-10-06 to +25 / +50 / +100% (on an HP-scaled field, so nothing
// saturates): each Focus beam's share of the shot by tier, and each Refract
// hop's damage by tier (a hop is far weaker than the first hit)
// (owner 2026-10-06: every Focus beam is a FULL hit - 1 / 2 / 3 / 4 beams, no share - so no stat falls; SOL's base damage pays for it)
const SOL_HOP = [1, 0.29, 0.3, 0.455];
function solSkillStats(t, s, b) {
  s.dmg = b.dmg; s.range = b.range * RANGE_BONUS; s.crit = LVL_SOL_CRIT[0]; s.rate = b.rate;
  s.beams = SOL_BEAMS[skillOf(t, "focus")]; s.refraction = SOL_REFRACTION[skillOf(t, "refraction")];
  s.breach = SOL_BREACH[skillOf(t, "breach")]; s.critMul = SOL_CRITMUL[skillOf(t, "breach")]; s.bleedArmor = s.breach ? BREACH_ARMOR : 0; s.bleedCrit = BREACH_CRIT; s.skill = true;
}
// from fireRay: bend on from the first enemy hit to st.refraction more, each the
// nearest not yet hit to the last one, ANYWHERE inside ONE light cone from the
// TOWER (owner), SOL_CONE degrees either side of the first shot - no reach
// limit between hops, nor the tower's range: the cone is the only bound
function solRefraction(t, st, e) {
  const dir = Math.atan2(e.y - t.y, e.x - t.x), half = SOL_CONE * Math.PI / 180, hit = new Set([e]);
  const inCone = o => Math.abs(((Math.atan2(o.y - t.y, o.x - t.x) - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) <= half;
  let prev = e, far = Math.hypot(e.x - t.x, e.y - t.y);
  for (let k = 0; k < st.refraction; k++) {
    let nxt = null, nd = Infinity;
    for (const o of G.enemies) {
      if (o.dead || hit.has(o)) continue;
      const d = (o.x - prev.x) ** 2 + (o.y - prev.y) ** 2;
      if (d < nd && inCone(o)) { nd = d; nxt = o; }
    }
    if (!nxt) break;
    rayHit(t, st, nxt, st.dmg * SOL_HOP[SOL_REFRACTION.indexOf(st.refraction)], prev); hit.add(nxt); prev = nxt;
    far = Math.max(far, Math.hypot(nxt.x - t.x, nxt.y - t.y));
  }
  // the cone, from the tower to just past the furthest enemy it bent to
  fx.push({ k: "cone", x: t.x, y: t.y, a: dir, half, len: far + 30, color: TOWERS[t.kind].color, t: 0, life: SOL_CONE_LIFE });
}
const SOL_CONE_LIFE = 0.6; // game seconds (1x runs 2 game s a real s): long enough to see the cubic fade
// UI (drawFx): the Refract light cone, a faint wedge that fades FAST (owner):
// its opacity falls with the cube of the time left, and with DISTANCE from the
// tower - full at the source, gone by SOL_CONE_FADE of its length (owner)
const SOL_CONE_FADE = 0.8;
function drawCone(f, k) {
  const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.len * SOL_CONE_FADE);
  g.addColorStop(0, COL[f.color]); g.addColorStop(1, "transparent");
  ctx.fillStyle = g; ctx.globalAlpha = 0.5 * k * k * k;
  ctx.beginPath(); ctx.moveTo(f.x, f.y);
  ctx.arc(f.x, f.y, f.len, f.a - f.half, f.a + f.half); ctx.closePath(); ctx.fill();
}

// ---------- ACD's chart: Catalyst ramp, Pour lines, Seep puddles ----------
// FITTED 2026-10-06 to +25 / +50 / +100% (Spray to +30 / +60 / +120%, since
// its lines can never share an enemy): Corrosion's ramp time, Spray's per-line
// damage, Contagion's puddle heat (tier III's is below II's - its puddles are bigger)
// REFIT 2026-10-06 (overnight phase 2: standard team, waves 20-40, HP scaled so it is pressed - the earlier thin-field fits ran 3-12x over target)
const ACD_DOUBLE = [0.5, 0.39, 0.3, 0.12], ACD_LINES = [2, 3, 4, 6], /* early-game balance 2026-10-06: two lines from the start (was 1/2/3/5); Spray to be re-fitted */ ACD_SPRAY_MUL = [1, 1, 1.1, 1.2];
// puddles by Seep tier (index 0 = the DEFAULT drip, owner): one every `every`
// s per line, lasting `life` s, radius r; each burns at ACD_PUDDLE_HEAT of its
// line's heat when it fell, by Seep tier
const ACD_CONTAGION = [{ every: 1.4, life: 1.5, r: 20 }, { every: 1.2, life: 1.8, r: 22 }, { every: 1, life: 2.4, r: 26 }, { every: 0.9, life: 2.7, r: 28 }]; // refit 2026-10-06
const ACD_PUDDLE_HEAT = [0.5, 1, 1.05, 1.1];
// Contagion III (Pandemic) puddles SLOW what stands in them (owner, 2026-10-06,
// the no-FRZ niche search: 3 SOL + 6 ACD reached 98, was 74; FRZ teams unchanged)
const ACD_CONTAGION_SLOW = [0, 0, 0, 0.25]; // was 0.3 (2026-10-06 reach rework: with the roaming bonus 0.3 made Pandemic ~5x; phase 4 found 0.2-0.3 all open the niche)
function acdSkillStats(t, s, b) {
  const c = skillOf(t, "corrosion");
  s.dmg = b.dmg; s.range = b.range * RANGE_BONUS; s.double = ACD_DOUBLE[c]; s.cap = ACD_BASE_MAX; s.plagueR = 0;
  // every ACD hands 40% of a dead line's ramp on (early-game balance 2026-10-06;
  // fast waves reset it); Corrosion III, Dissolve, hands on ALL of it (owner)
  s.carry = c >= 3 ? 1 : 0.4; s.targets = ACD_LINES[skillOf(t, "spray")]; s.contagion = ACD_CONTAGION[skillOf(t, "contagion")];
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
    (t.puddles ||= []).push({ x: l.e.x, y: l.e.y, r: sp.r, life: sp.life, age: 0, tick: 0, dps: st.dmg * acdMulOf(l.held, st) * st.contagionHeat });
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
function drawPuddles(t) {
  const now = performance.now() / 1000;
  ctx.strokeStyle = ctx.fillStyle = COL.chatsubo; ctx.lineWidth = 1.2;
  for (const p of t.puddles || []) {
    const fade = 1 - p.age / p.life, seed = p.seed ||= 1 + Math.floor(Math.random() * 1e6);
    for (let i = 0; i < PUDDLE_BUBBLES; i++) {
      const ph = now / BUBBLE_T + i / PUDDLE_BUBBLES + (seed % 97) / 97, cyc = Math.floor(ph), f = ph - cyc;
      const h = k => fixedRand(cyc * 13 + i * 3 + k, seed); // this bubble's own jitter, fixed for its life
      const a = h(0) * 6.283, d = Math.sqrt(h(1)) * p.r * 0.8, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      const max = p.r * (0.2 + 0.25 * h(2));
      ctx.beginPath();
      if (f < 1 - BUBBLE_POP) {
        ctx.arc(x, y, max * f / (1 - BUBBLE_POP), 0, 6.283);
        ctx.globalAlpha = 0.2 * fade; ctx.fill();
        ctx.globalAlpha = 0.75 * fade; ctx.stroke();
      } else {
        const q = (f - 1 + BUBBLE_POP) / BUBBLE_POP; // the pop: a ring widening and gone
        ctx.arc(x, y, max * (1 + 0.5 * q), 0, 6.283);
        ctx.globalAlpha = 0.6 * (1 - q) * fade; ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}
