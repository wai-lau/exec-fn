// /aspira - SKILL CHARTS (owner, 2026-10-05). A tower type with a chart (only
// ARC so far) levels up to 1 + SKILL_POINTS; each upgrade raises ONE of its
// three axes a tier (max SKILL_TIERS), like a JoJo Stand chart, and every tier
// is a named step. The other towers keep the path / form tree
// (aspira-upgrades.js). Loaded after aspira-towers.js (the simulator too):
// this file also holds ARC's skill-chart FIRING, kept out of towers.js (cap).
const SKILL_POINTS = 6, SKILL_TIERS = 3;
// cost of each of the six small upgrades, x the build cost (about the old
// three-step total, spread over six; balance later)
const SKILL_STEP_COST = [2, 3.5, 5.5, 8, 10.5, 13];
const SKILL_TREES = {
  // ARC (owner): Conductivity = ALL the branching (owner, 2026-10-05) - how
  // many times the chain jumps AND how many ways each jump forks; Voltage =
  // raw power, damage and range; Static = an EXPLOSION on every hit that marks
  // what it catches. Base: one jump forking two ways, three enemies.
  chain: [
    { id: "cond", name: "Conductivity", tiers: [
      { name: "Transfer", desc: "The bolt jumps once more, forking as it goes, and jumps further." },
      { name: "Conduit", desc: "Wider forks at every jump." },
      { name: "Superconductor", desc: "Two separate bolts at once, each a full forking tree." },
    ] },
    { id: "volt", name: "Voltage", tiers: [
      { name: "Spark", desc: "Harder bolts with a white-hot core, reaching further." },
      { name: "Fry", desc: "Harder and further still." },
      { name: "Vaporize", desc: "The hardest bolts; every strike throws sparks." },
    ] },
    { id: "static", name: "Capacitance", tiers: [
      { name: "Static", desc: "Hits leave charges; the next hit on that enemy, or its death, sets them off in a ring." },
      { name: "Charge", desc: "Heavier charges, a wider ring." },
      { name: "Overload", desc: "The heaviest charges, the widest ring." },
    ] },
  ],
};
// FRZ (owner, 2026-10-05): an AURA - everything inside is slowed (and loses it
// the moment it leaves) and ticks a little damage. Frost = a wider, colder
// aura; Rime = a ring PULSE out to the aura's edge leaving a STACKING
// PERMANENT slow on all it passes; Moons = 1 / 2 / 3 orbiting copies of the
// tower at half of everything.
SKILL_TREES.slower = [
  { id: "frost", name: "Temp", tiers: [
    { name: "Chill", desc: "A wider, colder aura." },
    { name: "Freeze", desc: "Wider and colder still." },
    { name: "Absolute Zero", desc: "The widest, coldest aura." },
  ] },
  { id: "rime", name: "Rime", tiers: [
    { name: "Frost", desc: "Rings pulse out and leave a chill that never wears off; it stacks." },
    { name: "Glacier", desc: "Each ring's lasting chill bites deeper." },
    { name: "Cryosphere", desc: "The deepest lasting chill per ring." },
  ] },
  { id: "moons", name: "Moons", tiers: [
    { name: "Moon", desc: "A moon orbits the tower: a smaller copy of it." },
    { name: "Twin Moons", desc: "Two moons." },
    { name: "Desolation", desc: "Three moons." },
  ] },
];
// SOL (owner, 2026-10-05): Focus = more beams (the old Quad look: side by
// side at the tower, CONVERGING on the target - not parallel, owner), each its
// own hit, 2 / 4 / 7; Refract = the beam bends on to 2 / 5 / 9 more
// enemies, each within SOL_CONE degrees of the first shot's direction (a light
// cone shows it); Scorch (was Impale; owner: light-themed) = 1 / 2 / 4 BREACH
// stacks per hit (the old bleed: armor down and crit up for every tower, for
// good). Focus x Scorch multiply:
// 7 beams x 4 = 28 Breaches a volley on one target.
SKILL_TREES.reaper = [
  { id: "focus", name: "Focus", tiers: [
    { name: "Convergence", desc: "More beams converge on the target, each its own hit." },
    { name: "Crux", desc: "Even more converging beams." },
    { name: "Disintegration", desc: "A full volley of converging beams." },
  ] },
  { id: "refract", name: "Refraction", tiers: [
    { name: "Lens", desc: "The beam bends on to more enemies inside its light cone." },
    { name: "Prism", desc: "Bends on to many more." },
    { name: "Spectrum", desc: "Bends through nearly everything in the cone." },
  ] },
  { id: "scorch", name: "Breach", tiers: [
    { name: "Scorch", desc: "Each hit burns a Breach into the enemy: armor down and crits up for every tower, for good." },
    { name: "Sear", desc: "More Breaches per hit." },
    { name: "Flare", desc: "The most Breaches per hit." },
  ] },
];
// ACD (owner, 2026-10-05): its lines DRIP burning PUDDLES onto the lane by
// default, each burning at a share of its line's current heat. Catalyst = the
// burn ramps faster (tier III: a line whose enemy dies hands half its ramp to
// the next); Pour = 2 / 3 / 5 lines at once; Seep = more, longer, bigger puddles.
SKILL_TREES.acid = [
  { id: "catalyst", name: "Corrosion", tiers: [
    { name: "Etch", desc: "The burn ramps up faster." },
    { name: "Corrode", desc: "Faster still." },
    { name: "Dissolve", desc: "The burn never cools: a line whose enemy dies starts on the next at full heat." },
  ] },
  { id: "pour", name: "Spray", tiers: [
    { name: "Mist", desc: "More burning lines, never two on one enemy." },
    { name: "Downpour", desc: "More lines still." },
    { name: "Torrent", desc: "The most lines." },
  ] },
  { id: "seep", name: "Contagion", tiers: [
    { name: "Blister", desc: "Puddles drip more often and bubble longer." },
    { name: "Plague", desc: "More, longer, wider puddles." },
    { name: "Pandemic", desc: "The most, longest, widest puddles." },
  ] },
];
const hasSkills = t => !!SKILL_TREES[t.kind];
const maxLvl = t => (hasSkills(t) ? 1 + SKILL_POINTS : MAX_LVL);
const skillOf = (t, id) => (t.skills && t.skills[id]) || 0;
// the level the TOWER'S LOOK shows (its rings, max-level spokes): a chart
// tower's 7 levels fold onto the 4 drawn ones
const shownLvl = t => (!hasSkills(t) ? t.lvl : t.lvl >= maxLvl(t) ? MAX_LVL : 1 + Math.floor((t.lvl - 1) / 2));

// ARC's numbers by tier (index 0 = untaken). Balance later (owner: ideas first).
// Voltage's damage FITTED to +25% / +50% / +100% dealt (owner; arcfit.mjs, waves 6-20)
// Voltage refit 2026-10-06 (drifted 4-6% low after the Static / slow / FRZ changes)
const ARC_VOLT_DMG = [1, 1.31, 1.49, 3.27], ARC_VOLT_RANGE = [1, 1.15, 1.3, 1.45];
// Conductivity's shape by tier (owner): strikes (separate first targets),
// jumps, and forks per jump - 3, 7, 13, then two separate 13-hit attacks -
// and r, how much further each JUMP reaches (owner; Voltage owns the tower's range)
// d: a damage multiplier, FITTED so each tier deals +25% / +50% / +100% over
// the base (owner), like Voltage's (scripts/aspira-sim: arcfit)
let ARC_COND = [{ s: 1, j: 1, f: 2, r: 1, d: 1 }, { s: 1, j: 2, f: 2, r: 1.2, d: 1.24 }, { s: 1, j: 2, f: 3, r: 1.4, d: 1.53 }, { s: 2, j: 2, f: 3, r: 1.6, d: 2.8 }];
// Static by tier: the blast's radius and its damage, x the hit that set it off
// FITTED 2026-10-06 to +25 / +50 / +100% ARC-own dealt (tier III saturates -
// a discharge can only take the HP in reach - so it needs a big charge)
const ARC_STATIC = [null, { r: 40, frac: 0.83 }, { r: 60, frac: 1.49 }, { r: 85, frac: 5.3 }];
// each jump hits ARC_FALL as hard and reaches ARC_SHRINK as far as the one before (owner)
const ARC_FALL = 0.6, ARC_SHRINK = 0.7;
// a jump's reach, x the tower's range, before Conductivity lengthens it (owner: longer by default)
let ARC_JUMP_REACH = 1.5;
function arcSkillStats(t, s, b) {
  const c = skillOf(t, "cond"), v = skillOf(t, "volt"), z = skillOf(t, "static");
  s.dmg = b.dmg * ARC_VOLT_DMG[v] * ARC_COND[c].d; s.range = b.range * RANGE_BONUS * ARC_VOLT_RANGE[v];
  const sh = ARC_COND[c]; // Conductivity: strikes, jumps AND forks
  s.arcRange = s.range * ARC_JUMP_REACH * sh.r; s.targets = sh.s; s.layers = sh.j; s.branch = sh.f;
  s.arcFall = ARC_FALL; s.arcShrink = ARC_SHRINK; s.blast = ARC_STATIC[z]; s.skill = true;
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
  const v = skillOf(t, "volt");
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
  ch.dmg += d * b.frac; ch.n++; ch.r = Math.max(ch.r, b.r); ch.t = c.t;
}
let staticQuiet = false;
// a DISCHARGE (owner): a RAPIDLY EXPANDING orange ring from the enemy, out to
// its radius over STATIC_RING_T, damaging each enemy once as its edge reaches
// it. Quiet: it sets off no other charges.
const STATIC_RING_T = 0.25;
function dischargeStatic(e) {
  const ch = e.charge;
  e.charge = null;
  (G.staticRings ||= []).push({ x: e.x, y: e.y, R: ch.r, dmg: ch.dmg, t: ch.t, age: 0, hit: new Set() });
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
      }
    }
  } finally { staticQuiet = false; }
  G.staticRings = G.staticRings.filter(g => g.age < STATIC_RING_T * 1.6); // a short fade past full size
}
// UI (drawScene): each ring, bright while it grows, fading once it is full
function drawStaticRings() {
  ctx.strokeStyle = COL[TOWERS.chain.color]; ctx.lineWidth = 3;
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
  if (skillOf(c.t, "volt")) fx[fx.length - 1].pierce = true; // Voltage's white-hot core
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
const FRZ_FROST_SLOW = [0.33, 0.363, 0.394, 0.439], FRZ_FROST_RANGE = [1, 1.05, 1.1, 1.15];
const FRZ_RIME = [0, 0.01, 0.019, 0.037]; // each pulse's permanent stacking slow
const FRZ_TICK = 0.5, FRZ_RIME_EVERY = 2, FRZ_RIME_GROW = 2.4, FRZ_MOON_SCALE = 0.78; // a Rime ring takes FRZ_RIME_GROW game s to reach the edge (owner: much slower; was 0.6)
const FRZ_AURA_HOLD = 0.06, FRZ_RIM_W = 16; // the frosted rim's width per unit of slow (owner: thicker the colder) // an aura slow outlasts one step only: it is gone the moment the enemy leaves
function frzSkillStats(t, s, b) {
  const f = skillOf(t, "frost");
  s.range = b.range * RANGE_BONUS * FRZ_FROST_RANGE[f];
  s.aura = FRZ_FROST_SLOW[f]; s.dmg = b.dmg * b.rate * FRZ_TICK; s.rate = 1 / FRZ_TICK; // dmg / rate: a TICK
  s.rime = FRZ_RIME[skillOf(t, "rime")]; s.moonN = skillOf(t, "moons"); s.skill = true;
}
// the aura's sources: the tower, then each moon at FRZ_MOON_SCALE of everything
function frzSources(t, st) {
  const out = [{ x: t.x, y: t.y, k: 1, id: t.id }];
  if (st.moonN) moonSpots(t, { moons: st.moonN }).forEach((m, i) => out.push({ x: m.x, y: m.y, k: FRZ_MOON_SCALE, id: t.id + ":moon" + i }));
  return out;
}
// every step (aspira-game.js): slow what is inside each aura, tick its damage,
// and grow the Rime pulses
function frzStep(t, dt) {
  const st = towerStats(t), srcs = frzSources(t, st);
  t.auraT = (t.auraT || 0) - dt;
  const tick = t.auraT <= 0;
  if (tick) t.auraT += FRZ_TICK;
  for (const s of srcs) {
    const r2 = (st.range * s.k) ** 2;
    for (const e of G.enemies) {
      if (e.dead || (e.x - s.x) ** 2 + (e.y - s.y) ** 2 > r2) continue;
      applySlow(e, st.aura * s.k, FRZ_AURA_HOLD, s.id);
      if (tick) damage(e, st.dmg * s.k, t, true); // quiet: an aura does not strip shields
    }
  }
  if (st.rime) {
    t.rimeT = (t.rimeT || 0) - dt;
    if (t.rimeT <= 0) {
      t.rimeT += FRZ_RIME_EVERY;
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
function drawFrzSkill(t, st) {
  const col = COL[TOWERS.slower.color];
  for (const s of frzSources(t, st)) {
    gradDisc(s.x, s.y, st.range * s.k, col, 0.8);
    // Frost (owner): a FROSTED RIM, thicker the colder the aura (its slow)
    ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = FRZ_RIM_W * st.aura * s.k;
    ctx.beginPath(); ctx.arc(s.x, s.y, st.range * s.k, 0, 6.283); ctx.stroke();
    if (s.k < 1) { ctx.fillStyle = col; ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, 6.283); ctx.fill(); }
  }
  // Rime (owner): a THIN expanding ring with a GLOW
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.shadowColor = col; ctx.shadowBlur = 12 * cam.k;
  for (const p of t.pulses || []) {
    const f = Math.min(1, p.age / FRZ_RIME_GROW);
    ctx.globalAlpha = 0.9 * (1 - f * 0.6); ctx.beginPath(); ctx.arc(p.x, p.y, p.R * f, 0, 6.283); ctx.stroke();
  }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}

// ---------- SOL's chart: Focus beams, Refract cone, Scorch Breaches ----------
const SOL_BEAMS = [1, 2, 4, 7], SOL_REFRACT = [0, 2, 5, 9], SOL_BREACH = [0, 1, 2, 6];
// a refraction lands within SOL_CONE degrees of the first shot's direction (at
// any distance); one Breach = BREACH_ARMOR armor off and BREACH_CRIT crit
// chance for every tower
const SOL_CONE = 25, BREACH_ARMOR = 1.5, BREACH_CRIT = 0.01;
// FITTED 2026-10-06 to +25 / +50 / +100% (on an HP-scaled field, so nothing
// saturates): each Focus beam's share of the shot by tier, and each Refract
// hop's damage by tier (a hop is far weaker than the first hit)
const SOL_SHARE = [1, 0.604, 0.355, 0.276], SOL_HOP = [1, 0.169, 0.207, 0.386];
function solSkillStats(t, s, b) {
  s.dmg = b.dmg; s.range = b.range * RANGE_BONUS; s.crit = LVL_REAPER_CRIT[0]; s.rate = b.rate;
  s.beams = SOL_BEAMS[skillOf(t, "focus")]; s.refract = SOL_REFRACT[skillOf(t, "refract")];
  s.breach = SOL_BREACH[skillOf(t, "scorch")]; s.bleedArmor = s.breach ? BREACH_ARMOR : 0; s.bleedCrit = BREACH_CRIT; s.skill = true;
}
// from fireRay: bend on from the first enemy hit to st.refract more, each the
// nearest not yet hit to the last one, ANYWHERE inside ONE light cone from the
// TOWER (owner), SOL_CONE degrees either side of the first shot - no reach
// limit between hops, nor the tower's range: the cone is the only bound
function solRefract(t, st, e) {
  const dir = Math.atan2(e.y - t.y, e.x - t.x), half = SOL_CONE * Math.PI / 180, hit = new Set([e]);
  const inCone = o => Math.abs(((Math.atan2(o.y - t.y, o.x - t.x) - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) <= half;
  let prev = e, far = Math.hypot(e.x - t.x, e.y - t.y);
  for (let k = 0; k < st.refract; k++) {
    let nxt = null, nd = Infinity;
    for (const o of G.enemies) {
      if (o.dead || hit.has(o)) continue;
      const d = (o.x - prev.x) ** 2 + (o.y - prev.y) ** 2;
      if (d < nd && inCone(o)) { nd = d; nxt = o; }
    }
    if (!nxt) break;
    rayHit(t, st, nxt, st.dmg * SOL_HOP[SOL_REFRACT.indexOf(st.refract)], prev); hit.add(nxt); prev = nxt;
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
const ACD_DOUBLE = [1, 0.7, 0.6, 0.6], ACD_LINES = [2, 3, 4, 6], /* early-game balance 2026-10-06: two lines from the start (was 1/2/3/5); Spray to be re-fitted */ ACD_POUR_MUL = [1, 1.03, 1.39, 2.4];
// puddles by Seep tier (index 0 = the DEFAULT drip, owner): one every `every`
// s per line, lasting `life` s, radius r; each burns at ACD_PUDDLE_HEAT of its
// line's heat when it fell, by Seep tier
const ACD_SEEP = [{ every: 1.4, life: 1.5, r: 20 }, { every: 1, life: 2, r: 25 }, { every: 0.7, life: 3, r: 32 }, { every: 0.5, life: 4.5, r: 40 }];
const ACD_PUDDLE_HEAT = [0.5, 2.8, 2.3, 3.75];
function acidSkillStats(t, s, b) {
  const c = skillOf(t, "catalyst");
  s.dmg = b.dmg; s.range = b.range * RANGE_BONUS; s.double = ACD_DOUBLE[c]; s.cap = ACID_MAX; s.plagueR = 0;
  // every ACD hands 40% of a dead line's ramp on (early-game balance 2026-10-06;
  // fast waves reset it); Corrosion III, Dissolve, hands on ALL of it (owner)
  s.carry = c >= 3 ? 1 : 0.4; s.targets = ACD_LINES[skillOf(t, "pour")]; s.seep = ACD_SEEP[skillOf(t, "seep")];
  s.seepHeat = ACD_PUDDLE_HEAT[skillOf(t, "seep")]; s.pourMul = ACD_POUR_MUL[skillOf(t, "pour")]; s.skill = true;
}
// every step (stepAcid): each line drips a puddle every seep.every s; each
// puddle ticks its burn on whatever stands in it, st.rate times a second
function stepPuddles(t, st, dt) {
  const sp = st.seep;
  for (const l of t.lines) {
    if (l.e.dead) continue;
    l.drip = (l.drip ?? sp.every) - dt;
    if (l.drip > 0) continue;
    l.drip += sp.every;
    (t.puddles ||= []).push({ x: l.e.x, y: l.e.y, r: sp.r, life: sp.life, age: 0, tick: 0, dps: st.dmg * acidMulOf(l.held, st) * st.seepHeat });
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
      }
    }
  }
  t.puddles = t.puddles.filter(p => p.age < p.life);
}
// UI (drawAcid): a puddle is a cluster of BUBBLES (owner): PUDDLE_BUBBLES at
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

// ---------- the chart (UI only; the upgrade cards draw it) ----------
// a triangle radar, an axis per corner, a ring per tier; the filled shape is
// what the tower has, the dashed one what this pick would make (owner: JoJo)
function skillChart(t, next) {
  const axes = SKILL_TREES[t.kind], R = 46, C = 60, pt = (i, k) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / axes.length, r = 8 + (R - 8) * k / SKILL_TIERS;
    return (C + Math.cos(a) * r).toFixed(1) + "," + (C + Math.sin(a) * r).toFixed(1);
  };
  const shape = sk => axes.map((ax, i) => pt(i, (sk && sk[ax.id]) || 0)).join(" ");
  let svg = '<svg class="asp-chart" viewBox="0 0 120 120">';
  for (let k = 1; k <= SKILL_TIERS; k++) svg += '<polygon class="grid" points="' + axes.map((_, i) => pt(i, k)).join(" ") + '"/>';
  axes.forEach((ax, i) => {
    svg += '<line class="grid" x1="' + C + '" y1="' + C + '" x2="' + pt(i, SKILL_TIERS).replace(",", '" y2="') + '"/>';
  });
  if (next) svg += '<polygon class="next" points="' + shape(next) + '"/>';
  svg += '<polygon class="now" points="' + shape(t.skills) + '"/>';
  axes.forEach((ax, i) => {
    const [x, y] = pt(i, SKILL_TIERS + 0.9).split(",");
    svg += '<text x="' + x + '" y="' + y + '">' + ax.name.slice(0, 4).toUpperCase() + " " + skillOf(t, ax.id) + "</text>";
  });
  return svg + "</svg>";
}
