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
// SIX with the GIGA tier (owner, 2026-10-11; aspira-giga.js): ONE axis a tower may take to VI, so sixteen points (5 + 5 + 6)
const SKILL_POINTS = 16, SKILL_TIERS = 6;
// cost of each of the six small upgrades, x the build cost (about the old
// three-step total, spread over six; balance later). DEARER (owner, 2026-10-06:
// "make the levels more expensive and more powerful"): was 2 / 3.5 / 5.5 / 8 / 10.5 / 13,
// a full chart 42.5 builds; now 62.5 (the first points stay near their old price, the last ones cost nearly double) - and every tier hits harder to match (below)
// ...and on, for the three points past the sixth (owner, 2026-10-07: "keep increasing
// the prices"): the step grows by one more each time, a full chart 174.5 builds (6,980c)
// (the six points past the ninth, 2026-10-07: each step grows by one more again - a full chart 695.5 builds, 27,820c)
const SKILL_STEP_COST = [2.5, 4, 7, 11, 16, 22, 29, 37, 46, 56, 67, 79, 92, 106, 121, 137]; // the 16th: the giga point (2026-10-11)
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
      { name: "Lattice", desc: "Three arcs chain once and fork into three on hit." },
      { name: "Storm", desc: "Four arcs chain once and fork into three on hit." },
    ] },
    { id: "voltage", name: "Voltage", base: "Each jump carries half the hit.", tiers: [
      { name: "Spark", desc: "Harder hits; each jump carries most of the hit. Arcs pierce armor." },
      { name: "Fry", desc: "Harder hits; each jump carries nearly all of the hit. Arcs pierce armor." },
      { name: "Vaporize", desc: "Hardest hits; each jump carries all of the hit. Arcs pierce armor." },
      { name: "Arc Flash", desc: "Each jump carries more than the hit. Arcs pierce armor." },
      { name: "Plasma", desc: "Each jump carries far more than the hit. Arcs pierce armor." },
    ] },
    { id: "capacitance", name: "Capacitance", base: "", tiers: [
      { name: "Static", desc: "Hits leave a charge, which bursts around the target when it is hit by anything, slowing what they hit." },
      { name: "Charge", desc: "Hits leave two charges, which burst around the target when it is hit by anything, slowing what they hit." },
      { name: "Overload", desc: "Hits leave three charges, which burst around the target when it is hit by anything, slowing what they hit." },
      { name: "Discharge", desc: "Hits leave four charges, which burst around the target when it is hit by anything, slowing what they hit." },
      { name: "Tempest", desc: "Hits leave five charges, which burst around the target when it is hit by anything, slowing what they hit." },
    ] },
  ],
};
// FRZ (owner, 2026-10-05): an AURA - everything inside is slowed (and loses it
// the moment it leaves) and ticks a little damage. Frost = a wider, colder
// aura; Rime = a ring PULSE out to the aura's edge leaving a STACKING
// PERMANENT slow on all it passes; Moons = 1 / 2 / 3 orbiting copies of the
// tower at half of everything.
SKILL_TREES.frz = [
  { id: "temp", name: "Sublimation" /* (owner, 2026-10-12; was Temp) */, base: "The aura slows what it holds.", tiers: [
    { name: "Chill", desc: "A colder, wider aura slows what it holds, and turns the light ones brittle." },
    { name: "Freeze", desc: "A far colder, wider aura slows what it holds, and turns the light ones brittle." },
    { name: "Absolute Zero", desc: "A chill slows all it holds, and turns the light ones brittle." },
    { name: "Permafrost", desc: "A chill slows all it holds, and turns the light ones brittle." },
    { name: "Heat Death", desc: "A chill slows all it holds, and turns the light ones brittle." },
  ] },
  { id: "rime", name: "Permafrost" /* (owner, 2026-10-12; was Rime) */, base: "", tiers: [
    { name: "Frost", desc: "Pulses leave a slow that lingers past the aura and stacks; full frost spreads to the nearest enemy." },
    { name: "Glacier", desc: "Faster pulses leave a deeper slow that lingers past the aura and stacks; full frost spreads to the nearest enemy." },
    { name: "Cryosphere", desc: "The fastest pulses leave the deepest slow that lingers past the aura and stacks; full frost spreads to the nearest enemy." },
    { name: "Ice Sheet", desc: "Rings of frost roll out, leaving behind a frost that layers and never thaws; full frost spreads to the nearest enemy." },
    { name: "Glaciation", desc: "Rings of frost roll out, leaving behind a frost that layers and never thaws; full frost spreads to the nearest enemy." },
  ] },
  { id: "moons", name: "Moons", base: "", tiers: [
    { name: "Moon", desc: "One moon orbits the tower, a weaker copy of it. Its chill cracks armor for good." },
    { name: "Twin Moons", desc: "Two moons orbit the tower, near copies of it. Its chill cracks armor for good." },
    { name: "Desolation", desc: "Three moons orbit the tower, full copies of it. Its chill cracks armor for good." },
    { name: "Satellites", desc: "Three moons orbit it, each with a small moon of its own. Its chill cracks armor for good." },
    { name: "Eclipse", desc: "Three moons orbit it, each with three small moons of its own. Its chill cracks armor for good." },
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
    { name: "Lens", desc: "Shots bounce on to three more enemies ahead. Light outruns the fast: far harder on them." },
    { name: "Prism", desc: "Shots bounce harder on to six more enemies ahead. Light outruns the fast: far harder on them." },
    { name: "Spectrum", desc: "Shots bounce hardest on to ten more enemies ahead. Light outruns the fast: far harder on them." },
    { name: "Halo", desc: "Refracting on to thirteen more ahead. Light outruns the fast: far harder on them." },
    { name: "Aurora", desc: "Refracting on through every enemy ahead, and out of sight. Light outruns the fast: far harder on them." },
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
  { id: "corrosion", name: "Corrosion", base: "Acid that builds while a jet holds its enemy.", tiers: [
    { name: "Etch", desc: "Acid eats armor, even below nothing: every tower hits the eaten harder." },
    { name: "Corrode", desc: "Acid eats armor faster, even below nothing." },
    { name: "Dissolve", desc: "Acid eats armor faster still, even below nothing." },
    { name: "Erode", desc: "Acid devours armor, far below nothing." },
    { name: "Annihilate", desc: "Acid devours armor, far below nothing." },
  ] },
  { id: "spray", name: "Flow", base: "Two jets, each starting cold on a new enemy.", tiers: [
    { name: "Mist", desc: "Three slowing jets; a jet keeps some of its acid on its next enemy." },
    { name: "Downpour", desc: "Four slowing jets; a jet keeps half its acid on its next enemy." },
    { name: "Torrent", desc: "Six slowing jets; a jet keeps most of its acid on its next enemy." },
    { name: "Deluge", desc: "Seven slowing jets; a jet keeps nearly all its acid on its next enemy." },
    { name: "Cascade", desc: "Eight slowing jets; a jet lands hotter on its next enemy." },
  ] },
  { id: "contagion", name: "Contagion", base: "Jets drip large pools of acid; each kill leaves one more.", tiers: [
    { name: "Blister", desc: "Jets drip larger pools that linger longer." },
    { name: "Plague", desc: "Jets drip larger pools that linger longer." },
    { name: "Pandemic", desc: "Jets drip wide pools that linger long." },
    { name: "Epidemic", desc: "Jets drip wide pools that linger long." },
    { name: "Blight", desc: "Jets drip vast pools that linger long." },
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
  // ARC's range tiers CUT (owner, 2026-10-11: "ranges way too high, late game players don't need to move towers"):
  // maxed it reached x4.3 - all of the plain lanes from a corner; now x1.25. SOL keeps its reach (owner, same day)
  arc:    { conductivity: [[1, 1, 1], [1.02, 1, 1], [1.04, 1, 1], [1.07, 1, 1], [1.09, 1, 1], [1.12, 1, 1]], voltage: [[1, 1, 1], [1.02, 1, 1], [1.04, 1, 1], [1.07, 1, 1], [1.09, 1, 1], [1.12, 1, 1]], capacitance: [[1, 1, 1], [1, 1.3, 1], [1, 1.6, 1], [1, 2, 1], [1, 2.2, 1], [1, 2.4, 1]] },
  frz: { temp: [[1, 1, 1], [1.1, 1, 1], [1.2, 1, 1], [1.3, 1, 1], [1.4, 1, 1], [1.5, 1, 1]] /* wider again (owner, 2026-10-11: FRZ's reach back now its leash is screen-capped; was 1.08 .. 1.2) */ /* a narrower aura per tier (owner, 2026-10-08; was 1.25 .. 2.2) */, rime: [[1, 1, 1], [1, 4 / 3, 1], [1, 5 / 3, 1], [1, 2, 1], [1, 2.2, 1], [1, 2.4, 1]], moons: NO_MOVE }, // Rime buys back FRZ's halved slide (owner)
  sol: { focus: [[1, 1, 1], [1.2, 1, 1], [1.4, 1, 1], [1.7, 1, 1], [1.85, 1, 1], [2, 1, 1]], refraction: [[1, 1, 1], [1.1, 1, 1], [1.2, 1, 1], [1.35, 1, 1], [1.45, 1, 1], [1.55, 1, 1]], breach: [[1, 1, 1], [1, 1.3, 1], [1, 1.6, 1], [1, 2, 1], [1, 2.2, 1], [1, 2.4, 1]] },
  acd:    { spray: [[1, 1, 1], [1.02, 1, 1], [1.04, 1, 1], [1.06, 1, 1], [1.12, 1, 1], [1.3, 1, 1]] /* V: RANGE instead of a hotter carry (owner, 2026-10-12; was 1.15) */ /* Spray's lever now that each jet stays a full strike (owner, 2026-10-08; was 1.2 .. 2.3) */, contagion: [[1, 1, 1], [1, 1.15, 1.15], [1, 1.3, 1.3], [1, 1.5, 1.5], [1, 1.65, 1.65], [1, 1.8, 1.8]], corrosion: NO_MOVE },
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
const ARC_VOLTAGE_DMG = [1, 3.31, 6.8, 11.96, 18.67, 27.17] /* x (1 + 0.6 tier) (2026-10-11, roles: TEAM countermx 81-89 - Voltage leaks 4% of armor, Conductivity 10, Capacitance 12; was 2.068 3.093 4.272 5.492 6.793) */, ARC_VOLTAGE_FALL = [0.5, 0.65, 0.8, 1, 1.1, 1.25]; // IV / V (2026-10-07): a jump carries MORE than the hit before it // its RANGE is in SKILL_MOVE
// Conductivity's shape by tier (owner): strikes (separate first targets),
// jumps, and forks per jump - 3, 7, 13, then two separate 13-hit attacks -
// and r, how much further each JUMP reaches (owner; Voltage owns the tower's range)
// d: a damage multiplier, FITTED so each tier deals +25% / +50% / +100% over
// the base (owner), like Voltage's (scripts/aspira-sim: arcfit)
let ARC_CONDUCTIVITY = [{ s: 1, j: 1, f: 2, r: 1, d: 1, v: 0 }, { s: 1, j: 2, f: 2, r: 1.2, d: 1, v: 0 }, { s: 1, j: 2, f: 3, r: 1.4, d: 1, v: 0 }, { s: 2, j: 2, f: 3, r: 1.6, d: 1, v: 1 }, { s: 2, j: 2, f: 3, r: 1.8, d: 1, v: 2 }, { s: 3, j: 2, f: 3, r: 2, d: 1, v: 3 }] /* IV / V strikes cut 3 / 4 -> 2 / 3 (owner, 2026-10-11: "nerf arc and boost others") */ /* IV / V: three and four arcs at III's depth and forking (owner, 2026-10-08) */; // IV chains twice, V three arcs (2026-10-07) // owner 2026-10-06: a tier never lowers the hit (d was 1 / .775 / .613 / .394); the tree and the jump reach pay for it
// v: how many times a bolt may RETURN to an enemy it already struck (owner, 2026-10-08): from III a jump may hit any
// enemy but the one it leaps from - III once more (2 hits an enemy), IV twice (3), V three times (4)
// Capacitance by tier (owner, 2026-10-07): the charge, x the hit that left it, and
// how many times the charged enemy ARCS when next hit (dischargeStatic). The
// charge shares are the old ring's fits (2026-10-06: +25 / +50 / +100%); refit later
// owner, 2026-10-08 (isolation: the weakest ARC axis, 136% team at V): more charge and more arcs (were 1..5 arcs at .22 .. .45)
// BURSTS, NOT ARCS (owner, 2026-10-08: "Capa is too much like Cond now - circle AoE instead of arcs; add multiple
// charges instead of arcing more ... hits add more and more charges as you level up"): an ARC hit leaves `n`
// charges, each worth `frac` of the hit; the next hit from anything sets them ALL off, each a BURST of radius
// ARC_BURST_R round the enemy hitting everything inside (each burst its own hit: armor bites each, each pops a shield)
const ARC_CAPACITANCE = [null, { n: 1, frac: 0.14 }, { n: 2, frac: 0.14 }, { n: 3, frac: 0.14 }, { n: 4, frac: 0.14 }, { n: 5, frac: 0.14 }]; // frac 0.1 -> 0.14 (2026-10-12, chartvalue 30-60: tier III read 96% of the 2/2/2 team and 3/0/3 92% - now 99% / 98%) // a burst hits all round it, so each charge is small: isolation I..V 110 119 150 167 184% (with the slows below)
const ARC_BURST_R = 70, ARC_BURST_A = 0.45;
// each jump hits ARC_FALL as hard and reaches ARC_SHRINK as far as the one before (owner)
const ARC_FALL = 0.5, ARC_SHRINK = 0.7;
// a jump's reach, before Conductivity lengthens it (owner: longer by default). It
// was 1.5 x the tower's range; the range was HALVED (owner, 2026-10-06: "not their
// effects nor reach"), so the jump keeps its old absolute size: 1.5 x the old 156
// range, and Voltage still lengthens it by the old x1.15 / 1.3 / 1.45
const ARC_JUMP_BASE = 234, ARC_VOLTAGE_JUMP = [1, 1.15, 1.3, 1.45, 1.6, 1.75];
// VOLTAGE PIERCES ARMOR (owner, 2026-10-11: "make upgrade choices matter" - Voltage was ARC's dead axis, worst on every
// type): its arcs ignore this share of armor - Voltage is ARC's armor answer, Conductivity the shields, Capacitance the fast
const ARC_VOLTAGE_PIERCE = [0, 0.15, 0.3, 0.45, 0.6, 0.75];
function arcSkillStats(t, s, b) {
  const c = skillOf(t, "conductivity"), v = skillOf(t, "voltage"), z = skillOf(t, "capacitance");
  s.dmg = b.dmg * ARC_VOLTAGE_DMG[v] * ARC_CONDUCTIVITY[c].d; s.range = b.range * RANGE_BONUS;
  const sh = ARC_CONDUCTIVITY[c]; // Conductivity: strikes, jumps AND forks
  s.arcRange = ARC_JUMP_BASE * ARC_VOLTAGE_JUMP[v] * sh.r; s.targets = sh.s; s.layers = sh.j; s.branch = sh.f; s.revisit = sh.v || 0;
  s.arcFall = ARC_VOLTAGE_FALL[v]; s.arcShrink = ARC_SHRINK; s.charge = ARC_CAPACITANCE[z]; s.statSlow = ARC_STAT_SLOW[z]; s.armorPierce = ARC_VOLTAGE_PIERCE[v]; s.skill = true;
}
// what the upgrade cards offer: the next tier of each axis not yet full
function skillOptions(t) {
  return SKILL_TREES[t.kind].filter(ax => skillOf(t, ax.id) < axisCap(t, ax.id)).map(ax => { // (one giga VI a tower - aspira-giga.js)
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
// (dischargeStatic: every charge bursts round it) before the
// new charge lands, and the charge is gone; so does its DEATH (owner).
function fireSkillChain(t, st, e, seen) {
  if (seen && seen.has(e.id)) return; // a second strike never re-hits what the first took
  const col = TOWERS[t.kind].color, d = shotDamage(t, st, e, st.dmg);
  beam(t, e, col, CHAIN_BEAM_LIFE, 1.5, d);
  const root = { e, fx: Object.assign(fx[fx.length - 1], { soft: true, alpha: ARC_A }), up: null, kids: new Set() };
  // Voltage SHOWS (owner): a white-hot core in every arc, and at tier III the
  // strike point throws sparks
  const v = skillOf(t, "voltage");
  if (v) root.fx.pierce = true;
  if (v >= SKILL_TIERS - 1) burst(e.x, e.y, "white", v > SKILL_TIERS - 1 ? 12 : 6); // V sparks, the giga VI twice as many
  const c = { t, st, col, skill: true, seen: seen || new Set(), hits: new Map() }; // shared by the attack's strikes
  c.seen.add(e.id); c.hits.set(e.id, 1);
  skillHit(c, e, d);
  branchFrom(c, root, 1);
}
function skillHit(c, e, d) {
  damage(e, d, c.t, false, false, c.st); onHit(e, c.t, c.st, d); // (discharges e's own charges, if any)
  const b = c.st.charge;
  if (!b || e.dead) return;
  const ch = e.charge || (e.charge = { list: [], t: c.t });
  for (let k = 0; k < b.n; k++) ch.list.push(d * b.frac); // n charges a hit (the hit itself set off any it had)
  ch.t = c.t; ch.slow = Math.max(ch.slow || 0, c.st.statSlow || 0);
}
let staticQuiet = false;
// Overload's leaps SLOW what they hit (owner, 2026-10-06, the no-FRZ niche search):
// 30% for STAT_SLOW_T s - a late team without FRZ can answer the fast waves
const ARC_STAT_SLOW = [0, 0.25, 0.3, 0.35, 0.4, 0.45] /* from tier I and deeper (2026-10-11, roles: Capacitance is ARC's FAST answer - leaks 0% of fast, Conductivity 4; was 0 0 0 .15 .17 .2) */, STAT_SLOW_T = 0.6; // from III (owner, 2026-10-08: kept at III, not moved to V)
// a DISCHARGE: every charge the enemy holds BURSTS round it (ARC_CAPACITANCE; 2026-10-08, was a chain of
// arcs - too much like Conductivity). Quiet: a burst neither charges nor sets off charges, so there is
// no chain reaction (staticQuiet).
// ARC's LOOK only (owner, 2026-10-08: "overwhelming at high levels" -> "less visible overall, the strike most of all;
// still tied to damage, but less"): the strike draws at ARC_A, a jump at ARC_A x (its share of the strike)^ARC_CORR -
// so under Voltage IV-V, where a jump carries MORE than the strike, the far jumps outshine the shot; widths follow the
// damage at ARC_W_CORR of the usual slope; Capacitance's leaps thin and faint; the glow narrower and dimmer (drawFx, f.soft)
const ARC_A = 0.3, ARC_CORR = 0.5, ARC_W_CORR = 0.5, ARC_LEAP_A = 0.6 * ARC_A, ARC_LEAP_W = 0.6, ARC_GLOW_A = 0.12, ARC_GLOW_W = 2;
function dischargeStatic(e) {
  const ch = e.charge;
  e.charge = null;
  staticQuiet = true;
  try {
    // every charge BURSTS round the enemy: everything within ARC_BURST_R (the enemy too) takes it, a ring per charge
    // ONE thin, faint ring for the whole discharge, no glow (owner, 2026-10-08: "reduce intensity, no glow"; was a glowing ring per charge)
    ring(e.x, e.y, ARC_BURST_R, TOWERS.arc.color, 0.18, false); const rf = fx[fx.length - 1]; if (rf && rf.k === "ring") Object.assign(rf, { a: ARC_BURST_A, w: 1.2 }); // (the simulator stubs ring out)
    ch.list.forEach(dmg => {
      for (const o of G.enemies) {
        if (o.dead || Math.hypot(o.x - e.x, o.y - e.y) > ARC_BURST_R) continue;
        damage(o, dmg, ch.t, false, false, null);
        if (ch.slow && !o.dead) applySlow(o, ch.slow, STAT_SLOW_T, ch.t.id + ":stat");
      }
    });
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
  // never the enemy it leaps from; an enemy already struck only while its hits are under 1 + st.revisit (Conductivity III+)
  const max = 1 + (c.st.revisit || 0);
  return chainPick(c.t, node.e, r * r, o => o.id === node.e.id || (c.hits.get(o.id) || 0) >= max);
}
function skillHopTo(c, node, nxt, depth) {
  const raw = c.st.dmg * c.st.arcFall ** depth, d = shotDamage(c.t, c.st, nxt, raw);
  node.kids.add(nxt.id); c.seen.add(nxt.id); c.hits.set(nxt.id, (c.hits.get(nxt.id) || 0) + 1);
  beam(node.e, nxt, c.col, CHAIN_BEAM_LIFE, 1.5, d);
  Object.assign(fx[fx.length - 1], { soft: true, alpha: Math.min(1, ARC_A * (raw / c.st.dmg) ** ARC_CORR) }); // brighter as its share of the strike grows (ARC_A)
  if (skillOf(c.t, "voltage")) fx[fx.length - 1].pierce = true; // Voltage's white-hot core
  const child = { e: nxt, fx: fx[fx.length - 1], up: node, kids: new Set() };
  keepLit(node, CHAIN_BEAM_LIFE);
  skillHit(c, nxt, d);
  return child;
}

// (FRZ's chart - aura, Rime, moons - lives in aspira-frz.js)

// ---------- SOL's chart: Focus beams, Refract cone, Pierce Breaches ----------
// Breach stacks per hit (owner: "each beam permanently weakens the target's armor" - Breach is what strips it; the base SOL strips nothing)
// Refraction from the start (owner, 2026-10-08): one hop in a 40-degree cone at tier 0; every tier one more hop than before
// (were 0 / 2 / 5 / 9 / 12 / 15); V has NO limit - every enemy ahead in the cone, then on out of sight (solRefraction)
const SOL_SHIELD_POP = [1, 2, 3, 4, 5, 6] /* more per Focus tier (owner, 2026-10-12: SOL's shield help; was 1 1 2 2 3 3) */, SOL_REFRACT_POP = [0, 1, 1, 2, 2, 3] /* Refraction breaks shields too (owner, 2026-10-12) */; // 2026-10-11: a concentrated beam punches through more than one shield
const SOL_BEAMS = [1, 2, 3, 4, 5, 6], SOL_REFRACTION = [1, 3, 6, 10, 13, Infinity];
// BREACH IS SOL'S OWN, from the start (owner, 2026-10-08): every hit strips SOL_BREACH_ARMOR armor for good
// (below zero too: a flat bonus on every later hit from every tower); the Breach axis massively
// increases the strip and adds crit chance for every tower, SOL_BREACH_CRIT a hit (none at base)
// BREACH STRIPS A FLAT AMOUNT, big from the start (owner, 2026-10-12: "SOL with any upgrades should be good vs armor", then
// "dont scale breach with enemy armor" - it was x the wave's armor for an hour): a bare SOL strips 80 a hit (was 3)
const SOL_BREACH_ARMOR = [80, 120, 160, 210, 270, 330] /* was 3 24 72 150 261 300 */ /* x1.5 for the crit chance it no longer gives (owner, 2026-10-12: "remove extra crit chance, just reduce armor more") */ /* doubled back (2026-10-12, trio sim: ARC+FRZ+SOL, the trio without ACD, leaked 57% of armor at 81-89 - 45% with this) */ /* halved, rounded down (2026-10-08; was 2 16 49 101 174 200) */, SOL_BREACH_CRIT = [0, 0, 0, 0, 0, 0]; // NO crit chance any more (owner, 2026-10-12; was 0 .01 .02 .03 .04 .05)
// a refraction lands within SOL_CONE degrees of the first shot's direction (at
// any distance); one Breach = BREACH_ARMOR armor off and BREACH_CRIT crit
// chance for every tower
// the cone's half-angle by Refraction tier (owner, 2026-10-08: it WIDENS with the tier and starts wider, since every hop
// must now travel forward - see solRefraction; was a flat 8, before that 25)
const SOL_CONE_BY = [15, 45, 45, 60, 60, 60] /* x0.75 once the cone started at the first enemy (owner, 2026-10-12: "reduce refraction angle now for all levels"; soldiag ARC+FRZ+SOL armor leaks 3-9% -> 11-19%, Refraction builds 4%; was 20 60 60 80 80 80) */, SOL_CONE = SOL_CONE_BY[0], BREACH_CRIT = 0.01; // (the pre-chart path's per-stack crit; the chart SOL uses SOL_BREACH_CRIT)
// SOL's own lever (owner: more crit): Breach also raises the crit MULTIPLIER, x3 at base
const SOL_CRITMUL = [3, 4, 5, 7, 8, 9];
// FITTED 2026-10-06 to +25 / +50 / +100% (on an HP-scaled field, so nothing
// saturates): each Focus beam's share of the shot by tier, and each Refract
// hop's damage by tier (a hop is far weaker than the first hit)
// (owner 2026-10-06: every Focus beam is a FULL hit - 1 / 2 / 3 / 4 beams, no share - so no stat falls; SOL's base damage pays for it)
const SOL_HOP = [1, 1, 1, 1, 1, 1]; // every refraction hop a full strike (overnight fit 2026-10-08: even 1.5x reached only 133% - Refraction needs a mechanic change, not numbers) // II / III raised 2026-10-07 (were 0.3 / 0.455) with the cone narrowed to 8 degrees: fewer hops land, so each counts more
// Refraction peaked at I (107%) and fell by III (93%): range alone spread its fire
// thin, so II / III also hit harder (owner, 2026-10-07)
// (LIGHT OUTRUNS THE FAST, Refraction x the fast, removed 2026-10-12 - owner: no extra damage by enemy type)
const SOL_REFRACTION_DMG = [1, 1, 1.3, 1.84, 2.43, 3]; // III..V x1.15 / 1.35 / 1.5 with the 160-degree cone (owner, 2026-10-08: "even a 160 deg angle?" - the cone alone tops out at 156%)
// each Focus tier's beam STRENGTH (2026-10-08, the tier fit's lever for Focus: more beams alone measured 168% at V)
const SOL_FOCUS_DMG = [1, 1, 1, 1, 1.139, 1.176]; // never below 1 (owner, 2026-10-08: no upgrade lowers a stat) - more beams carry I..III (114 / 133 / 152%)
function solSkillStats(t, s, b) {
  s.dmg = b.dmg * SOL_REFRACTION_DMG[skillOf(t, "refraction")] * SOL_FOCUS_DMG[skillOf(t, "focus")]; s.range = b.range * RANGE_BONUS; s.crit = LVL_SOL_CRIT[0]; s.rate = b.rate;
  s.shieldPop = SOL_SHIELD_POP[skillOf(t, "focus")] + SOL_REFRACT_POP[skillOf(t, "refraction")]; // FOCUS pierces shields: each beam pops this many (SOL's shield help, counter matrix)
  s.beams = SOL_BEAMS[skillOf(t, "focus")]; s.refraction = SOL_REFRACTION[skillOf(t, "refraction")]; s.cone = SOL_CONE_BY[skillOf(t, "refraction")]; s.hop = SOL_HOP[skillOf(t, "refraction")];
  const bk = skillOf(t, "breach");
  s.breach = 1; s.critMul = SOL_CRITMUL[bk]; s.bleedArmor = SOL_BREACH_ARMOR[bk]; s.bleedCrit = SOL_BREACH_CRIT[bk]; s.skill = true;
}
// from fireRay: bend on from the first enemy hit to st.refraction more, each the nearest not yet hit to the last one,
// inside ONE light cone, SOL_CONE degrees either side - no reach limit between hops, nor the tower's range.
// THE CONE STARTS AT THE FIRST ENEMY STRUCK (owner, 2026-10-12: "on first bounce of any refraction, pretend like the cone
// originated from that enemy and direct that cone towards the optimal angle to hit the most"): it points where it holds
// the most living enemies (up to the hops it has - solConeDir), and every hop runs FORWARD, further from that first enemy
// than the last hit and along the cone (it was the TOWER's cone along the shot, which a lattice coming head-on mostly
// left: 3-4 hops of 10-13, soldiag.mjs); SOL's targeting picks among what the cone holds (chainPick)
const angOff = (a, b) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
function solConeDir(t, st, e, half) {
  const others = G.enemies.filter(o => !o.dead && o !== e), ang = others.map(o => Math.atan2(o.y - e.y, o.x - e.x));
  let dir = Math.atan2(e.y - t.y, e.x - t.x), best = 0; // nothing round it: on along the shot
  for (const a of ang) { let n = 0; for (const b of ang) if (angOff(a, b) <= half) n++; n = Math.min(n, st.refraction); if (n > best) { best = n; dir = a; } }
  return dir;
}
function solRefraction(t, st, e) {
  const half = (st.cone || SOL_CONE) * Math.PI / 180, dir = solConeDir(t, st, e, half), hit = new Set([e]), ex = e.x, ey = e.y;
  const fromE = o => Math.hypot(o.x - ex, o.y - ey), inCone = o => angOff(Math.atan2(o.y - ey, o.x - ex), dir) <= half;
  const forward = (from, o) => fromE(o) > (from === e ? 0 : fromE(from)) && (from === e || angOff(Math.atan2(o.y - from.y, o.x - from.x), dir) <= half);
  let prev = e, from0 = t, far = Math.hypot(ex - t.x, ey - t.y), farE = 0;
  for (let k = 0; k < st.refraction; k++) {
    const from = prev, nxt = chainPick(t, prev, Infinity, o => hit.has(o) || !inCone(o) || !forward(from, o)); // within the cone, forward, by SOL's targeting
    if (!nxt) { solOutOfSight(t, st, from0, prev); break; } // no one left in the cone: on out of sight (owner, 2026-10-08: always, not only V)
    from0 = prev;
    rayHit(t, st, nxt, st.dmg * (st.hop || 1), prev); hit.add(nxt); prev = nxt;
    far = Math.max(far, Math.hypot(nxt.x - t.x, nxt.y - t.y)); farE = Math.max(farE, fromE(nxt));
  }
  // the cone DRAWN from the tower along the shot, as before (owner, 2026-10-12: "draw the cone from the tower still anyway"),
  // to just past the furthest enemy it bent to - the bending itself runs from the first enemy (above)
  fx.push({ k: "cone", x: t.x, y: t.y, a: Math.atan2(ey - t.y, ex - t.x), half, len: far + 30, color: TOWERS[t.kind].color, t: 0, life: SOL_CONE_LIFE });
  // ...and AGAIN from the first enemy struck, the way the hops really bend (owner, 2026-10-12: "when an enemy is hit with the
  // first refraction bounce, show the cone again")
  if (farE > 0) fx.push({ k: "cone", x: ex, y: ey, a: dir, half, len: farE + 30, color: TOWERS[t.kind].color, t: 0, life: SOL_CONE_LIFE });
}
// a shot that runs OUT OF TARGETS goes on from the last enemy struck, along its last leg, far past the screen's edge (owner, 2026-10-08)
const SOL_OUT_LEN = 3000;
// it FOLLOWS, like every other beam (owner, 2026-10-08: "should track dead enemies like arc to avoid jumps"):
// it starts on the struck enemy (dead or alive - a ghost keeps moving) and its far end is read live
// along a -> b, so the extension never detaches from the leg it continues
function solOutOfSight(t, st, a, b) {
  const far = { get x() { const dx = b.x - a.x, dy = b.y - a.y; return b.x + dx / (Math.hypot(dx, dy) || 1) * SOL_OUT_LEN; },
    get y() { const dx = b.x - a.x, dy = b.y - a.y; return b.y + dy / (Math.hypot(dx, dy) || 1) * SOL_OUT_LEN; } };
  beam(b, far, TOWERS[t.kind].color, RAY_BEAM_LIFE, 3, st.dmg, true);
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
