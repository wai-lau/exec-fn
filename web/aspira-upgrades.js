// /aspira — the upgrade tree. Every tower has four levels: the upgrade to L2
// picks one of three PATHS, the one to L3 one of that path's two FINAL FORMS
// (3 paths x 2 forms = 6 finals per tower), and L4 is the SUPER form. Levels in between
// grow the base stats (towerStats in aspira-defs.js).
//
// mods are applied by applyMods(): dmg/rate/range/arcRange multiply,
// crit/arcs/targets/slow add, everything else is a behaviour flag read by
// the shot code in aspira-game.js. A final form's mods stack on its path's.

const BRANCH_LVL = 2, FINAL_LVL = 3; // the levels that bring the path / final form

const UPGRADES = {
  chain: [
    // base hop reach (50) only spans packed swarms; Conductor buys the reach to
    // chain through ordinary trains (spaced ~48-67), turning CHN into an all-rounder
    { name: "Conductor", desc: "+2 arcs, arcs reach 50% further (chain through trains)", mods: { arcs: 2, arcRange: 1.5 }, finals: [
      { name: "Storm", desc: "+3 arcs, arcs hit almost as hard as the first strike", mods: { arcs: 3, arcFall: 0.9 } },
      { name: "Tesla", desc: "arcs jump 70% further", mods: { arcRange: 1.7 } },
    ] },
    { name: "Overload", desc: "+50% damage", mods: { dmg: 1.5 }, finals: [
      { name: "Capacitor", desc: "every 4th shot deals x4", mods: { everyN: { n: 4, mul: 4 } } },
      // was "x2.5 to bosses"; bosses were removed, so EMP now targets armor (placeholder)
      { name: "EMP", desc: "x2.5 damage to armored enemies", mods: { armorMul: 2.5 } },
    ] },
    { name: "Shock", desc: "15% chance to stun 0.1s", mods: { stun: { p: 0.15, t: 0.1 } }, finals: [
      { name: "Paralyze", desc: "35% chance to stun 0.2s", mods: { stun: { p: 0.35, t: 0.2 } } },
      { name: "Static", desc: "every hit slows 30% for 0.5s", mods: { hitSlow: { f: 0.3, t: 0.5 } } },
    ] },
  ],
  // ACD's tree is a PLACEHOLDER (owner to design): plain stat paths for now
  acid: [
    { name: "Corrosive", desc: "+50% burn", mods: { dmg: 1.5 }, finals: [
      { name: "Melt", desc: "burn x2", mods: { dmg: 2 } },
      { name: "Reach", desc: "+40% range", mods: { range: 1.4 } },
    ] },
    { name: "Long Line", desc: "+30% range", mods: { range: 1.3 }, finals: [
      { name: "Lance", desc: "+30% range, +30% burn", mods: { range: 1.3, dmg: 1.3 } },
      { name: "Searing", desc: "burn x1.8", mods: { dmg: 1.8 } },
    ] },
    { name: "Catalyst", desc: "+30% burn", mods: { dmg: 1.3 }, finals: [
      { name: "Volatile", desc: "burn x1.6", mods: { dmg: 1.6 } },
      { name: "Wide", desc: "+50% range", mods: { range: 1.5 } },
    ] },
  ],
  slower: [
    { name: "Frost", desc: "+15% slow", mods: { slow: 0.15 }, finals: [
      { name: "Deep Freeze", desc: "newly slowed enemies freeze 0.17s", mods: { chillStop: 0.17 } },
      { name: "Brittle", desc: "slowed enemies take +30% damage", mods: { brittle: 1.3 } },
    ] },
    { name: "Spread", desc: "+3 targets", mods: { targets: 3 }, finals: [
      { name: "Blizzard", desc: "slows everything in range", mods: { all: true } },
      { name: "Glacier", desc: "+40% range", mods: { range: 1.4 } },
    ] },
    { name: "Sap", desc: "each pulse deals 2% max HP", mods: { sap: 0.02 }, finals: [
      { name: "Wither", desc: "each pulse deals 5% max HP", mods: { sap: 0.05 } },
      { name: "Siphon", desc: "slowed enemies pay +50% bounty", mods: { siphon: 1.5 } },
    ] },
  ],
  reaper: [
    // PARKED (owner): extra locks - each with its own charge timer - as an
    // upgrade, via a `targets` mod (stepReaper already holds st.targets locks)
    { name: "Focus", desc: "+15% crit chance", mods: { crit: 0.15 }, finals: [
      { name: "Executioner", desc: "crits deal x6 instead of x3", mods: { critMul: 6 } },
      { name: "Assassin", desc: "always crits enemies under 30% HP", mods: { critBelow: 0.3 } },
    ] },
    { name: "Lance", desc: "pierces every enemy in line, -30% each", mods: { pierce: { fall: 0.7, wide: 14 } }, finals: [
      { name: "Piercer", desc: "piercing loses no damage", mods: { pierce: { fall: 1, wide: 14 } } },
      { name: "Wide Beam", desc: "beam three times wider", mods: { pierce: { fall: 0.8, wide: 42 } } },
    ] },
    { name: "Charge", desc: "damage x1.8, -30% fire rate", mods: { dmg: 1.8, rate: 0.7 }, finals: [
      { name: "Supernova", desc: "hits explode for 50% in a wide radius", mods: { splash: { r: 90, frac: 0.5 } } },
      { name: "Annihilator", desc: "damage x2 again", mods: { dmg: 2, rate: 0.85 } },
    ] },
  ],
};

const MUL_MODS = ["dmg", "rate", "range", "arcRange"], ADD_MODS = ["crit", "arcs", "targets", "slow"];
function applyMods(s, mods) {
  for (const [k, v] of Object.entries(mods)) {
    if (MUL_MODS.includes(k)) s[k] = (s[k] ?? 1) * v;
    else if (ADD_MODS.includes(k)) s[k] = (s[k] ?? 0) + v;
    else s[k] = v;
  }
}

// LEVEL 4 = SUPER FORM (owner): the final form "concentrates further" —
// its own mods are intensified, so the tower becomes a super version of what
// it already is. Multipliers compound (v^1.6: Sniper's half fire rate goes
// slower still, its x3 damage far higher); additive bonuses double; each
// behaviour value is pushed by its own rule below. Booleans stay as they are.
const SUPER_POW = 1.6;
const boost = v => 1 + (v - 1) * 2; // for "x1.5 bonus" style multipliers
const SUPER_KEYS = {
  critMul: v => v * 1.5, critBelow: v => Math.min(0.6, v * 1.5), sap: v => v * 2, chillStop: v => v * 2,
  siphon: boost, brittle: boost, aura: boost, armorMul: v => v * 1.5,
};
const SUPER_FIELDS = {
  p: v => Math.min(0.9, v * 1.6), t: v => v * 1.5, frac: v => v * 1.5, r: v => v * 1.3,
  mul: boost, n: v => Math.max(2, v - 1), f: v => Math.min(0.8, v * 1.5),
  fall: v => Math.min(1, v + (1 - v) * 0.5), wide: v => v * 1.5,
};
function superMods(mods) {
  const out = {};
  for (const [k, v] of Object.entries(mods)) {
    if (MUL_MODS.includes(k)) out[k] = Math.pow(v, SUPER_POW);
    else if (ADD_MODS.includes(k)) out[k] = v * 2;
    else if (SUPER_KEYS[k]) out[k] = SUPER_KEYS[k](v);
    else if (v && typeof v === "object") {
      out[k] = {};
      for (const [f, x] of Object.entries(v)) out[k][f] = SUPER_FIELDS[f] ? SUPER_FIELDS[f](x) : x;
    } else out[k] = v;
  }
  return out;
}

// the choice the NEXT upgrade requires, if any: the step onto L2 picks the
// path, the step onto L3 the final form (owner)
function pendingChoice(t) {
  if (t.lvl === BRANCH_LVL - 1 && t.path == null) return "path";
  if (t.lvl === FINAL_LVL - 1 && t.form == null) return "form";
  return null;
}

function towerTitle(t) {
  const b = TOWERS[t.kind];
  if (t.path == null) return b.name;
  const p = UPGRADES[t.kind][t.path];
  if (t.form == null) return b.name + " · " + p.name;
  return (t.lvl >= MAX_LVL ? "Super " : "") + p.finals[t.form].name;
}
