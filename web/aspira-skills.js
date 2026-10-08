// /aspira - SKILL CHARTS (owner, 2026-10-05). A tower type with a chart (only
// ARC so far) levels up to 1 + SKILL_POINTS; each upgrade raises ONE of its
// three axes a tier (max SKILL_TIERS), like a JoJo Stand chart, and every tier
// is a named step. The other towers keep the path / form tree
// (aspira-upgrades.js). Loaded after aspira-towers.js (the simulator too):
// this file also holds ARC's skill-chart FIRING, kept out of towers.js (cap).
// NINE points (owner, 2026-10-07; was 6): every axis can be maxed. Points are bought
// by DRAGGING the axes of the chart on the tower card (aspira-sliders.js), any
// number at once; each still costs its own step of the ladder below
// FIVE tiers an axis (owner, 2026-10-07: "add another 2 tiers to each upgrade"; was 3), fifteen points a tower
const SKILL_POINTS = 15, SKILL_TIERS = 5;
// cost of each of the six small upgrades, x the build cost (about the old
// three-step total, spread over six; balance later). DEARER (owner, 2026-10-06:
// "make the levels more expensive and more powerful"): was 2 / 3.5 / 5.5 / 8 / 10.5 / 13,
// a full chart 42.5 builds; now 62.5 (the first points stay near their old price, the last ones cost nearly double) - and every tier hits harder to match (below)
// ...and on, for the three points past the sixth (owner, 2026-10-07: "keep increasing
// the prices"): the step grows by one more each time, a full chart 174.5 builds (6,980c)
// (the six points past the ninth, 2026-10-07: each step grows by one more again - a full chart 695.5 builds, 27,820c)
const SKILL_STEP_COST = [2.5, 4, 7, 11, 16, 22, 29, 37, 46, 56, 67, 79, 92, 106, 121];
// Every axis is ONE EVOLVING SENTENCE (owner, 2026-10-07): `base` says what the
// tower does with no point on the axis, and each tier's `desc` is that sentence
// with as few words changed as will carry the gain, so the card's track changes
// (aspira-sliders.js) read as a single edit - "Arcs fork on hit." -> "Arcs *chain
// once* and fork on hit." -> "... fork *into three* on hit."; no bare stat talk
// ("slides further", "more range") unless that IS the upgrade - the reach each
// tier buys is in SKILL_MOVE below. The tier `name`s are not shown on the card.
// An axis whose tier 0 does NOTHING has an EMPTY base (owner): its line on the
// card stays blank until a point is pulled, and the first tier reads as one insertion
const SKILL_TREES = {
  // ARC (owner): Conductivity = ALL the branching (owner, 2026-10-05) - how
  // many times the chain jumps AND how many ways each jump forks; Voltage =
  // raw power, damage and range; Static = an EXPLOSION on every hit that marks
  // what it catches. Base: one jump forking two ways, three enemies.
  arc: [
    { id: "conductivity", name: "Conductivity", base: "Arcs fork on hit.", tiers: [
      { name: "Transfer", desc: "Arcs chain once and fork on hit." },
      { name: "Conduit", desc: "Arcs chain once and fork into three on hit." },
      { name: "Superconductor", desc: "Two arcs chain once and fork into three on hit." },
      { name: "Lattice", desc: "Two arcs chain twice and fork into three on hit." },
      { name: "Storm", desc: "Three arcs chain twice and fork into three on hit." },
    ] },
    { id: "voltage", name: "Voltage", base: "Each jump carries half the hit.", tiers: [
      { name: "Spark", desc: "Harder hits; each jump carries most of the hit." },
      { name: "Fry", desc: "Harder hits; each jump carries nearly all of the hit." },
      { name: "Vaporize", desc: "Hardest hits; each jump carries all of the hit." },
      { name: "Arc Flash", desc: "Each jump carries more than the hit." },
      { name: "Plasma", desc: "Each jump carries far more than the hit." },
    ] },
    { id: "capacitance", name: "Capacitance", base: "", tiers: [
      { name: "Static", desc: "Hits charge the target, charged targets arc once when hit by anything." },
      { name: "Charge", desc: "Hits charge the target, charged targets arc twice when hit by anything." },
      { name: "Overload", desc: "Hits charge the target, charged targets arc three times when hit by anything, slowing what they hit." },
      { name: "Discharge", desc: "Hits charge the target, charged targets arc four times when hit by anything, slowing what they hit." },
      { name: "Tempest", desc: "Hits charge the target, charged targets arc five times when hit by anything, slowing what they hit." },
    ] },
  ],
};
// FRZ (owner, 2026-10-05): an AURA - everything inside is slowed (and loses it
// the moment it leaves) and ticks a little damage. Frost = a wider, colder
// aura; Rime = a ring PULSE out to the aura's edge leaving a STACKING
// PERMANENT slow on all it passes; Moons = 1 / 2 / 3 orbiting copies of the
// tower at half of everything.
SKILL_TREES.frz = [
  { id: "temp", name: "Temp", base: "The aura slows what it holds.", tiers: [
    { name: "Chill", desc: "A colder, wider aura slows what it holds." },
    { name: "Freeze", desc: "A far colder, wider aura slows what it holds." },
    { name: "Absolute Zero", desc: "The coldest, widest aura slows what it holds, and every tower hits it harder." },
    { name: "Permafrost", desc: "A chill slows all it holds, and turns it brittle." },
    { name: "Heat Death", desc: "A chill slows all it holds, and turns it brittle." },
  ] },
  { id: "rime", name: "Rime", base: "", tiers: [
    { name: "Frost", desc: "Pulses leave a slow that lingers past the aura and stacks." },
    { name: "Glacier", desc: "Faster pulses leave a deeper slow that lingers past the aura and stacks." },
    { name: "Cryosphere", desc: "The fastest pulses leave the deepest slow that lingers past the aura and stacks." },
    { name: "Ice Sheet", desc: "Rings of rime roll out, leaving behind a rime that layers and never thaws." },
    { name: "Glaciation", desc: "Rings of rime roll out, leaving behind a rime that layers and never thaws." },
  ] },
  { id: "moons", name: "Moons", base: "", tiers: [
    { name: "Moon", desc: "One moon orbits the tower, a weaker copy of it." },
    { name: "Twin Moons", desc: "Two moons orbit the tower, near copies of it." },
    { name: "Desolation", desc: "Three moons orbit the tower, full copies of it." },
    { name: "Quad Moons", desc: "Four moons orbit it, copies of the tower." },
    { name: "Eclipse", desc: "Five moons orbit it, copies of the tower." },
  ] },
];
// SOL (owner, 2026-10-05): Focus = more beams (the old Quad look: side by
// side at the tower, CONVERGING on the target - not parallel, owner), each its
// own full hit, 2 / 3 / 4; Refract = the beam bends on to 2 / 5 / 9 more
// enemies, each within SOL_CONE degrees of the first shot's direction (a light
// cone shows it); Pierce (was Impale; owner: light-themed) = 1 / 2 / 4 BREACH
// stacks per hit (the old bleed: armor down and crit up for every tower, for
// good). Focus x Pierce multiply:
// 4 beams x 6 = 24 Breaches a volley on one target.
SKILL_TREES.sol = [
  { id: "focus", name: "Focus", base: "One beam per shot.", tiers: [
    { name: "Convergence", desc: "Two beams per shot, each a full hit." },
    { name: "Crux", desc: "Three beams per shot, each a full hit." },
    { name: "Disintegration", desc: "Four beams per shot, each a full hit." },
    { name: "Lance", desc: "Five rays of light, each a full strike." },
    { name: "Supernova", desc: "Six rays of light, each a full strike." },
  ] },
  { id: "refraction", name: "Refraction", base: "", tiers: [
    { name: "Lens", desc: "Shots bounce on to two more enemies ahead." },
    { name: "Prism", desc: "Shots bounce harder on to five more enemies ahead." },
    { name: "Spectrum", desc: "Shots bounce hardest on to nine more enemies ahead." },
    { name: "Halo", desc: "Refracting on to twelve more ahead." },
    { name: "Aurora", desc: "Refracting on to fifteen more ahead." },
  ] },
  { id: "breach", name: "Breach", base: "", tiers: [
    { name: "Pierce", desc: "Hits breach once: armor off and crits up for every tower, for good." },
    { name: "Sear", desc: "Hits breach twice: armor off and crits up for every tower, for good." },
    { name: "Flare", desc: "Hits breach six times: armor off and crits up for every tower, for good." },
    { name: "Brand", desc: "Each beam weakens its target's armor for good, and pierces it so every tower crits it more." },
    { name: "Sunfire", desc: "Each beam weakens its target's armor for good, and pierces it so every tower crits it more." },
  ] },
];
// ACD (owner, 2026-10-05): its lines DRIP burning PUDDLES onto the lane by
// default, each burning at a share of its line's current heat. Catalyst = the
// burn ramps faster (tier III: a line whose enemy dies hands half its ramp to
// the next); Pour = 2 / 3 / 5 lines at once; Seep = more, longer, bigger puddles.
SKILL_TREES.acd = [
  { id: "corrosion", name: "Corrosion", base: "A jet keeps little of its concentration when it moves to a new target.", tiers: [
    { name: "Etch", desc: "A jet keeps all of its concentration when it moves to a new target." },
    { name: "Corrode", desc: "A stronger jet keeps all of its concentration when it moves to a new target." },
    { name: "Dissolve", desc: "The strongest jet keeps all of its concentration when it moves to a new target." },
    { name: "Erode", desc: "Acid flow holds when switching targets." },
    { name: "Annihilate", desc: "Acid flow holds when switching targets." },
  ] },
  { id: "spray", name: "Spray", base: "Two jets of acid at once, each on its own enemy.", tiers: [
    { name: "Mist", desc: "Three jets of acid at once, each on its own enemy." },
    { name: "Downpour", desc: "Four jets of acid at once, each on its own enemy." },
    { name: "Torrent", desc: "Six jets of acid at once, each on its own enemy." },
    { name: "Deluge", desc: "Seven jets of acid, each corroding the enemy." },
    { name: "Cascade", desc: "Eight jets of acid, each corroding the enemy." },
  ] },
  { id: "contagion", name: "Contagion", base: "Jets drip puddles.", tiers: [
    { name: "Blister", desc: "Jets drip blistering puddles, more often." },
    { name: "Plague", desc: "Jets drip bigger blistering puddles, more often." },
    { name: "Pandemic", desc: "Jets drip bigger blistering puddles, more often, that slow all who wade through them." },
    { name: "Epidemic", desc: "Pools of acid that slow all who wade through them." },
    { name: "Blight", desc: "Pools of acid that slow all who wade through them." },
  ] },
];
const hasSkills = t => !!SKILL_TREES[t.kind];
const maxLvl = t => (hasSkills(t) ? 1 + SKILL_POINTS : MAX_LVL);
const skillOf = (t, id) => (t.skills && t.skills[id]) || 0;
// the level the TOWER'S LOOK shows (its rings, max-level spokes): a chart
// tower's 7 levels fold onto the 4 drawn ones
const shownLvl = t => (!hasSkills(t) ? t.lvl : t.lvl >= maxLvl(t) ? MAX_LVL : 1 + Math.floor((t.lvl - 1) / 5)); // fifteen points, five a look

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
const NO_MOVE = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
const SKILL_MOVE = {
  arc:    { conductivity: [[1, 1, 1], [1.15, 1, 1], [1.3, 1, 1], [1.5, 1, 1], [1.65, 1, 1], [1.8, 1, 1]], voltage: [[1, 1, 1], [1.3, 1, 1], [1.6, 1, 1], [2, 1, 1], [2.2, 1, 1], [2.4, 1, 1]], capacitance: [[1, 1, 1], [1, 1.3, 1], [1, 1.6, 1], [1, 2, 1], [1, 2.2, 1], [1, 2.4, 1]] },
  frz: { temp: [[1, 1, 1], [1.15, 1, 1], [1.3, 1, 1], [1.5, 1, 1], [1.6, 1, 1], [1.7, 1, 1]] /* a narrower aura per tier (owner, 2026-10-08; was 1.25 .. 2.2) */, rime: [[1, 1, 1], [1, 4 / 3, 1], [1, 5 / 3, 1], [1, 2, 1], [1, 2.2, 1], [1, 2.4, 1]], moons: NO_MOVE }, // Rime buys back FRZ's halved slide (owner)
  sol: { focus: [[1, 1, 1], [1.2, 1, 1], [1.4, 1, 1], [1.7, 1, 1], [1.85, 1, 1], [2, 1, 1]], refraction: [[1, 1, 1], [1.1, 1, 1], [1.2, 1, 1], [1.35, 1, 1], [1.45, 1, 1], [1.55, 1, 1]], breach: [[1, 1, 1], [1, 1.3, 1], [1, 1.6, 1], [1, 2, 1], [1, 2.2, 1], [1, 2.4, 1]] },
  acd:    { spray: [[1, 1, 1], [1.2, 1, 1], [1.5, 1, 1], [1.9, 1, 1], [2.1, 1, 1], [2.3, 1, 1]], contagion: [[1, 1, 1], [1, 1.15, 1.15], [1, 1.3, 1.3], [1, 1.5, 1.5], [1, 1.65, 1.65], [1, 1.8, 1.8]], corrosion: NO_MOVE },
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
// REWORKED 2026-10-07 (owner): a dud axis - team damage 142% with it at 0, 105% at
// III; raw damage on the strike was worth less than the other axes' points. Now it
// is what each JUMP keeps of the hit before it (ARC_FALL 0.5 at 0; III = every jump
// at full damage), on top of its damage step; the `pierce` flag it sets is only
// the white core drawn in its arcs (aspira-draw.js), never a rule
const ARC_VOLTAGE_DMG = [1, 1.4, 1.9, 2.8, 3.6, 4.6], ARC_VOLTAGE_FALL = [0.5, 0.65, 0.8, 1, 1.1, 1.25]; // IV / V (2026-10-07): a jump carries MORE than the hit before it // its RANGE is in SKILL_MOVE
// Conductivity's shape by tier (owner): strikes (separate first targets),
// jumps, and forks per jump - 3, 7, 13, then two separate 13-hit attacks -
// and r, how much further each JUMP reaches (owner; Voltage owns the tower's range)
// d: a damage multiplier, FITTED so each tier deals +25% / +50% / +100% over
// the base (owner), like Voltage's (scripts/aspira-sim: arcfit)
let ARC_CONDUCTIVITY = [{ s: 1, j: 1, f: 2, r: 1, d: 1 }, { s: 1, j: 2, f: 2, r: 1.2, d: 1 }, { s: 1, j: 2, f: 3, r: 1.4, d: 1 }, { s: 2, j: 2, f: 3, r: 1.6, d: 1 }, { s: 2, j: 3, f: 3, r: 1.8, d: 1 }, { s: 3, j: 3, f: 3, r: 2, d: 1 }]; // IV chains twice, V three arcs (2026-10-07) // owner 2026-10-06: a tier never lowers the hit (d was 1 / .775 / .613 / .394); the tree and the jump reach pay for it
// Capacitance by tier (owner, 2026-10-07): the charge, x the hit that left it, and
// how many times the charged enemy ARCS when next hit (dischargeStatic). The
// charge shares are the old ring's fits (2026-10-06: +25 / +50 / +100%); refit later
// owner, 2026-10-08 (isolation: the weakest ARC axis, 136% team at V): more charge and more arcs (were 1..5 arcs at .22 .. .45)
const ARC_CAPACITANCE = [null, { arcs: 2, frac: 0.3 }, { arcs: 3, frac: 0.36 }, { arcs: 4, frac: 0.44 }, { arcs: 6, frac: 0.52 }, { arcs: 8, frac: 0.6 }];
// each jump hits ARC_FALL as hard and reaches ARC_SHRINK as far as the one before (owner)
const ARC_FALL = 0.5, ARC_SHRINK = 0.7;
// a jump's reach, before Conductivity lengthens it (owner: longer by default). It
// was 1.5 x the tower's range; the range was HALVED (owner, 2026-10-06: "not their
// effects nor reach"), so the jump keeps its old absolute size: 1.5 x the old 156
// range, and Voltage still lengthens it by the old x1.15 / 1.3 / 1.45
const ARC_JUMP_BASE = 234, ARC_VOLTAGE_JUMP = [1, 1.15, 1.3, 1.45, 1.6, 1.75];
function arcSkillStats(t, s, b) {
  const c = skillOf(t, "conductivity"), v = skillOf(t, "voltage"), z = skillOf(t, "capacitance");
  s.dmg = b.dmg * ARC_VOLTAGE_DMG[v] * ARC_CONDUCTIVITY[c].d; s.range = b.range * RANGE_BONUS;
  const sh = ARC_CONDUCTIVITY[c]; // Conductivity: strikes, jumps AND forks
  s.arcRange = ARC_JUMP_BASE * ARC_VOLTAGE_JUMP[v] * sh.r; s.targets = sh.s; s.layers = sh.j; s.branch = sh.f;
  s.arcFall = ARC_VOLTAGE_FALL[v]; s.arcShrink = ARC_SHRINK; s.charge = ARC_CAPACITANCE[z]; s.statSlow = ARC_STAT_SLOW[z]; s.skill = true;
}
// what the upgrade cards offer: the next tier of each axis not yet full
function skillOptions(t) {
  return SKILL_TREES[t.kind].filter(ax => skillOf(t, ax.id) < SKILL_TIERS).map(ax => {
    const n = skillOf(t, ax.id), tier = ax.tiers[n];
    return { choice: ax.id, name: ax.name + " " + roman(n + 1) + " · " + tier.name, desc: tier.desc };
  });
}
const withSkill = (t, id) => ({ ...t.skills, [id]: skillOf(t, id) + 1 });
// the sliders' BASKET (aspira-sliders.js): the price of the tower's NEXT n points, each
// at its own step of the ladder, and its chart with `add` (axis -> points) pulled on
const skillPointsCost = (t, n) => { let c = 0; for (let i = 0; i < n; i++) c += Math.round(TOWERS[t.kind].cost * SKILL_STEP_COST[t.lvl - 1 + i]); return c; };
const withSkills = (t, add) => { const s = { ...t.skills }; for (const [id, n] of Object.entries(add)) if (n) s[id] = (s[id] || 0) + n; return s; };

// ---------- ARC's chart firing ----------
// A bolt is a TREE grown a generation per hop: the strike, then every hit
// forks st.branch ways, st.layers jumps deep. A bolt NEVER hits the same
// enemy twice (owner) - so it can never strike more enemies than are in
// reach - and each jump hits ARC_FALL as hard and reaches ARC_SHRINK as far.
// Capacitance (owner, 2026-10-07: "Hits charge the target, charged targets arc
// once when hit by anything"): an ARC hit leaves a CHARGE on the enemy it struck,
// worth st.charge.frac of the hit; charges STACK. The next hit on that enemy from
// ANY tower - the ARC that charged it too (owner: it procs itself) - makes it ARC
// (dischargeStatic: st.charge.arcs leaps, each worth the whole charge) before the
// new charge lands, and the charge is gone; so does its DEATH (owner).
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
  const b = c.st.charge;
  if (!b || e.dead) return;
  const ch = e.charge || (e.charge = { dmg: 0, arcs: 0, t: c.t });
  ch.dmg += d * b.frac; ch.arcs = Math.max(ch.arcs, b.arcs); ch.t = c.t; ch.slow = Math.max(ch.slow || 0, c.st.statSlow || 0);
}
let staticQuiet = false;
// Overload's leaps SLOW what they hit (owner, 2026-10-06, the no-FRZ niche search):
// 30% for STAT_SLOW_T s - a late team without FRZ can answer the fast waves
const ARC_STAT_SLOW = [0, 0, 0, 0.3, 0.35, 0.4], STAT_SLOW_T = 0.6;
// a DISCHARGE (owner, 2026-10-07: "charged targets arc once when hit by anything"):
// the charged enemy ARCS - a bolt leaps from it to the nearest enemy not yet hit,
// ch.arcs times in a chain, each leap worth the whole charge, drawn as ARC's beams.
// Quiet: a leap neither charges nor sets off charges, so there is no chain reaction
// (staticQuiet). (Was an expanding ring around the enemy.)
const STATIC_ARC_REACH = 320; // longer than an ARC jump (owner, 2026-10-08: "increase arc reach"; was ARC_JUMP_BASE 234)
function dischargeStatic(e) {
  const ch = e.charge;
  e.charge = null;
  staticQuiet = true;
  try {
    let from = e;
    const hit = new Set([e.id]);
    for (let k = 0; k < ch.arcs; k++) {
      const nxt = chainPick(ch.t, from, STATIC_ARC_REACH * STATIC_ARC_REACH, o => hit.has(o.id)); // by the charging ARC's targeting
      if (!nxt) break;
      hit.add(nxt.id);
      beam(from, nxt, TOWERS.arc.color, CHAIN_BEAM_LIFE, 1.5, ch.dmg);
      damage(nxt, ch.dmg, ch.t, false, false, null);
      if (ch.slow && !nxt.dead) applySlow(nxt, ch.slow, STAT_SLOW_T, ch.t.id + ":stat");
      from = nxt;
    }
  } finally { staticQuiet = false; }
}
// the nearest enemy this bolt has not hit yet, within this jump's (shrunk) reach
// CHAINS TARGET LIKE THEIR TOWER (owner, 2026-10-07: "chains should use the same targeting
// algorithm as the parent"): of the enemies a jump can reach, the one the tower's own mode
// ranks first (MODE_KEY: Near = closest to the core, Biggest = most HP, Fresh = undebuffed
// first); ties go to the nearest. Used by ARC's jumps, Capacitance's leaps and SOL's refraction
function chainPick(t, from, r2, skip) {
  const key = MODE_KEY[t.mode] || MODE_KEY.close;
  let best = null, bk = Infinity, bd = Infinity;
  for (const o of G.enemies) {
    if (o.dead || skip(o)) continue;
    const d = (o.x - from.x) ** 2 + (o.y - from.y) ** 2;
    if (d > r2) continue;
    const k = key({ e: o, d });
    if (k < bk || (k === bk && d < bd)) { bk = k; bd = d; best = o; }
  }
  return best;
}
function skillHop(c, node, depth) {
  const r = c.st.arcRange * c.st.arcShrink ** (depth - 1);
  return chainPick(c.t, node.e, r * r, o => c.seen.has(o.id));
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
const FRZ_TEMP_SLOW = [0.4, 0.42, 0.44, 0.46, 0.48, 0.5]; // weakened (owner, 2026-10-08; isolation: Temp V 438% team, leaks 660 -> 56); was .43 .46 .5 .54 .58 // the aura's range is in SKILL_MOVE
// Temp III's TEAM hook (owner, 2026-10-07: FRZ's chart was flat, 97-103%): an enemy
// its aura touches turns BRITTLE - while slowed it takes x FRZ_BRITTLE from every
// tower (damage(), which already reads e.brittle; drawStatus shows the crack)
const FRZ_BRITTLE = [1, 1, 1, 1.15, 1.2, 1.25];
const FRZ_RIME = [0, 0.02, 0.035, 0.06, 0.08, 0.1]; // 2026-10-06: tier I was a dead point (was 1% / 1.9% / 3.7%) // each pulse's permanent stacking slow
// FRZ's own levers (owner: no generic multipliers): Rime pulses MORE OFTEN each tier, the moons are STRONGER copies each tier
const FRZ_RIME_PERIOD = [2, 2, 1.7, 1.4, 1.2, 1], FRZ_MOON_BY = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85]; // weakened (owner, 2026-10-08; isolation: Moons V 499% team); was .78 .9 .95 1 1 1 // Moons IV / V: four and five full moons
const FRZ_TICK = 0.5, FRZ_RIME_GROW = 2.4; // a Rime ring takes FRZ_RIME_GROW game s to reach the edge (owner: much slower; was 0.6)
const FRZ_AURA_HOLD = 0.06, FRZ_RIM_W = 16; // the frosted rim's width per unit of slow (owner: thicker the colder) // an aura slow outlasts one step only: it is gone the moment the enemy leaves
const FRZ_TICK_HIT = { armorPierce: 1 }; // a tick's hit on a shield: no armor bite
function frzSkillStats(t, s, b) {
  const f = skillOf(t, "temp");
  s.range = b.range * RANGE_BONUS;
  s.aura = FRZ_TEMP_SLOW[f]; s.brittle = FRZ_BRITTLE[f]; s.dmg = b.dmg * b.rate * FRZ_TICK; s.rate = 1 / FRZ_TICK; // dmg / rate: a TICK
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
      if (st.brittle > 1) e.brittle = Math.max(e.brittle || 1, st.brittle);
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
const FRZ_AURA_A = 0.4, FRZ_RIM_A = 0.25; // the aura's disc and rim, toned down (owner, 2026-10-07; were 0.8 / 0.45)
function drawFrzSkill(t, st) {
  const col = COL[TOWERS.frz.color];
  frzSources(t, st).forEach((s, i) => {
    gradDisc(s.x, s.y, st.range * s.k, col, FRZ_AURA_A); // fainter (owner, 2026-10-07; was 0.8)
    // Frost (owner): a FROSTED RIM, thicker the colder the aura (its slow)
    ctx.strokeStyle = col; ctx.globalAlpha = FRZ_RIM_A; ctx.lineWidth = FRZ_RIM_W * st.aura * s.k;
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

// ---------- SOL's chart: Focus beams, Refract cone, Pierce Breaches ----------
// Breach stacks per hit (owner: "each beam permanently weakens the target's armor" - Breach is what strips it; the base SOL strips nothing)
const SOL_BEAMS = [1, 2, 3, 4, 5, 6], SOL_REFRACTION = [0, 2, 5, 9, 12, 15];
// BREACH IS SOL'S OWN, from the start (owner, 2026-10-08): every hit strips SOL_BREACH_ARMOR armor for good
// (below zero too: a flat bonus on every later hit from every tower); the Breach axis massively
// increases the strip and adds crit chance for every tower, SOL_BREACH_CRIT a hit (none at base)
const SOL_BREACH_ARMOR = [2, 5, 9, 14, 20, 28], SOL_BREACH_CRIT = [0, 0.01, 0.02, 0.03, 0.04, 0.05];
// a refraction lands within SOL_CONE degrees of the first shot's direction (at
// any distance); one Breach = BREACH_ARMOR armor off and BREACH_CRIT crit
// chance for every tower
// the cone's half-angle by Refraction tier (owner, 2026-10-08: it WIDENS with the tier and starts wider, since every hop
// must now travel forward - see solRefraction; was a flat 8, before that 25)
const SOL_CONE_BY = [12, 12, 15, 18, 22, 26], SOL_CONE = SOL_CONE_BY[0], BREACH_CRIT = 0.01; // (the pre-chart path's per-stack crit; the chart SOL uses SOL_BREACH_CRIT)
// SOL's own lever (owner: more crit): Breach also raises the crit MULTIPLIER, x3 at base
const SOL_CRITMUL = [3, 4, 5, 7, 8, 9];
// FITTED 2026-10-06 to +25 / +50 / +100% (on an HP-scaled field, so nothing
// saturates): each Focus beam's share of the shot by tier, and each Refract
// hop's damage by tier (a hop is far weaker than the first hit)
// (owner 2026-10-06: every Focus beam is a FULL hit - 1 / 2 / 3 / 4 beams, no share - so no stat falls; SOL's base damage pays for it)
const SOL_HOP = [1, 0.29, 0.45, 0.7, 0.8, 0.9]; // II / III raised 2026-10-07 (were 0.3 / 0.455) with the cone narrowed to 8 degrees: fewer hops land, so each counts more
// Refraction peaked at I (107%) and fell by III (93%): range alone spread its fire
// thin, so II / III also hit harder (owner, 2026-10-07)
const SOL_REFRACTION_DMG = [1, 1, 1.3, 1.6, 1.8, 2];
// each Focus tier's beam STRENGTH (2026-10-08, the tier fit's lever for Focus: more beams alone measured 168% at V)
const SOL_FOCUS_DMG = [1, 1, 1, 1, 1, 1];
function solSkillStats(t, s, b) {
  s.dmg = b.dmg * SOL_REFRACTION_DMG[skillOf(t, "refraction")] * SOL_FOCUS_DMG[skillOf(t, "focus")]; s.range = b.range * RANGE_BONUS; s.crit = LVL_SOL_CRIT[0]; s.rate = b.rate;
  s.beams = SOL_BEAMS[skillOf(t, "focus")]; s.refraction = SOL_REFRACTION[skillOf(t, "refraction")]; s.cone = SOL_CONE_BY[skillOf(t, "refraction")];
  const bk = skillOf(t, "breach");
  s.breach = 1; s.critMul = SOL_CRITMUL[bk]; s.bleedArmor = SOL_BREACH_ARMOR[bk]; s.bleedCrit = SOL_BREACH_CRIT[bk]; s.skill = true;
}
// from fireRay: bend on from the first enemy hit to st.refraction more, each the
// nearest not yet hit to the last one, ANYWHERE inside ONE light cone from the
// TOWER (owner), SOL_CONE degrees either side of the first shot - no reach
// limit between hops, nor the tower's range: the cone is the only bound
function solRefraction(t, st, e) {
  const dir = Math.atan2(e.y - t.y, e.x - t.x), half = (st.cone || SOL_CONE) * Math.PI / 180, hit = new Set([e]);
  const off = a => Math.abs(((a - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); // an angle's distance from the shot's line
  const inCone = o => off(Math.atan2(o.y - t.y, o.x - t.x)) <= half;
  let prev = e, far = Math.hypot(e.x - t.x, e.y - t.y);
  // every hop travels FORWARD (owner, 2026-10-08: "shots shouldn't go backwards"): further from the tower than the
  // last hit, and the hop's own direction within the cone's half-angle of the shot - no beam bends back on itself
  const forward = (from, o) => Math.hypot(o.x - t.x, o.y - t.y) > Math.hypot(from.x - t.x, from.y - t.y) && off(Math.atan2(o.y - from.y, o.x - from.x)) <= half;
  for (let k = 0; k < st.refraction; k++) {
    const from = prev, nxt = chainPick(t, prev, Infinity, o => hit.has(o) || !inCone(o) || !forward(from, o)); // within the cone, forward, by SOL's targeting
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
  if (lowQ) return; // low quality: no light cones (aspira-quality.js)
  const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.len * SOL_CONE_FADE);
  g.addColorStop(0, COL[f.color]); g.addColorStop(1, "transparent");
  ctx.fillStyle = g; ctx.globalAlpha = 0.5 * k * k * k;
  ctx.beginPath(); ctx.moveTo(f.x, f.y);
  ctx.arc(f.x, f.y, f.len, f.a - f.half, f.a + f.half); ctx.closePath(); ctx.fill();
}
// ACD's chart numbers, stats and puddles live in aspira-acid.js
