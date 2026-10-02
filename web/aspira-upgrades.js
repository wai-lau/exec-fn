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
    // ARC (owner, 2026-10-02): L2 is 2 PATHS, L3 is 3 FORMS each. branch /
    // layers reshape the arc tree. Ion's damage is matched to Storm's full
    // tree per shot: Storm = strike x (1 + 12 x 0.8) = 10.6, Ion 4 hits = 3.4
    // -> x3.1.
    { name: "Storm", desc: "the tree grows: 1→3→9", mods: { branch: 3, layers: 2 }, finals: [
      { name: "Tempest", desc: "a wider tree: 1→4→16", mods: { branch: 4 },
        super: { name: "Maelstrom", desc: "wider still: 1→5→25", mods: { branch: 5 } } },
      { name: "Overcharge", desc: "arcs hit as hard as the first strike", mods: { arcFall: 1 },
        super: { name: "Surge", desc: "arcs hit HARDER than the strike: x1.5", mods: { arcFall: 1.5 } } },
      { name: "Static", desc: "every hit slows 30% for 0.5s", mods: { hitSlow: { f: 0.3, t: 0.5 } },
        super: { name: "Lockdown", desc: "hits slow 50% for 1s and may stun (20%, 0.3s)", mods: { hitSlow: { f: 0.5, t: 1 }, stun: { p: 0.2, t: 0.3 } } } },
    ] },
    { name: "Ion", desc: "ignores shields and half of armor; a line 1→1→1→1; damage x3.1", mods: { dmg: 3.1, branch: 1, layers: 3, ignoreShield: true, armorPierce: 0.5, noRevisit: true }, finals: [
      { name: "Rail", desc: "a longer line: 6 hops", mods: { layers: 6 },
        super: { name: "Railgun", desc: "the line runs 10 hops", mods: { layers: 10 } } },
      // Fork (owner): two lines on two different enemies. Two full lines are 2 x 3.4 =
      // 6.8 strikes a shot, so x0.85 damage levels it with Rail (5.8); Trident ~ Railgun
      { name: "Fork", desc: "two lines 1→1→1→1, never from the same enemy; damage x0.85", mods: { targets: 1, dmg: 0.85 },
        super: { name: "Trident", desc: "three lines", mods: { targets: 1 } } },
      { name: "Crescendo", desc: "each hop hits 25% harder than the last", mods: { hopGain: 1.25 },
        super: { name: "Fortissimo", desc: "each hop hits 60% harder than the last", mods: { hopGain: 1.6 } } },
    ] },
  ],
  // ACD (owner, 2026-10-02): L2 Catalyst or Plague, three L3 forms each, and
  // each form's own on-theme L4 super. Bloom hits harder than Contagion
  // (x1.5 vs x0.7) to make up for its smaller area (owner).
  acid: [
    { name: "Catalyst", desc: "the burn doubles every 0.6s (was 1s)", mods: { double: 0.6 }, finals: [
      { name: "Rain", desc: "double range", mods: { range: 2 },
        super: { name: "Deluge", desc: "triple range", mods: { range: 1.5 } } },
      { name: "Pour", desc: "three lines at once, each with its own ramp", mods: { targets: 2 },
        super: { name: "Torrent", desc: "five lines", mods: { targets: 2 } } },
      { name: "Residue", desc: "an enemy that leaves range keeps burning for 2s", mods: { residue: 2 },
        super: { name: "Scar", desc: "it keeps burning for 5s", mods: { residue: 5 } } },
    ] },
    { name: "Plague", desc: "every tick also burns everything within 45 of the target", mods: { plagueR: 45 }, finals: [
      { name: "Bloom", desc: "the circle grows with the burn, up to 2x; burn x1.5", mods: { bloom: 2, dmg: 1.5 },
        super: { name: "Overgrowth", desc: "the circle grows up to 3x", mods: { bloom: 3 } } },
      { name: "Corrosion", desc: "every tick strips 0.5 armor from all it burns, below zero (bonus damage from every tower)", mods: { corrode: 0.5 },
        super: { name: "Dissolve", desc: "strips 1.5 armor a tick", mods: { corrode: 1.5 } } },
      { name: "Contagion", desc: "no line: every enemy in range burns, each on its own ramp; burn x0.7", mods: { allInRange: true, plagueR: 0, dmg: 0.7 },
        super: { name: "Pandemic", desc: "range x1.5", mods: { range: 1.5 } } },
    ] },
  ],
  // FRZ (owner, 2026-10-02): L2 Shatter or Stasis, three forms each, each with
  // its own on-theme L4 super.
  slower: [
    { name: "Shatter", desc: "an enemy that dies while slowed explodes: 25% of its max HP within 60", mods: { shatter: { frac: 0.25, r: 60 } }, finals: [
      { name: "Frostbite", desc: "explosions also slow everything they hit, for 2.6s", mods: { frostbite: 2.6 },
        super: { name: "Hoarfrost", desc: "that slow lasts 7.8s", mods: { frostbite: 7.8 } } },
      { name: "Shrapnel", desc: "explosions deal 50% of max HP", mods: { shatter: { frac: 0.5, r: 60 } },
        super: { name: "Splinter", desc: "explosions deal 100% of max HP", mods: { shatter: { frac: 1, r: 60 } } } },
      { name: "Brittle", desc: "slowed enemies take +30% from every tower", mods: { brittle: 1.3 },
        super: { name: "Fracture", desc: "+60%", mods: { brittle: 1.6 } } },
    ] },
    { name: "Stasis", desc: "slow +20%", mods: { slow: 0.2 }, finals: [
      { name: "Deep Freeze", desc: "a newly slowed enemy freezes solid for 0.4s", mods: { chillStop: 0.4 },
        super: { name: "Absolute Zero", desc: "freezes for 0.8s", mods: { chillStop: 0.8 } } },
      { name: "Whiteout", desc: "slows everything in range; the range glows", mods: { all: true },
        super: { name: "Blizzard", desc: "range x1.4", mods: { range: 1.4 } } },
      { name: "Permafrost", desc: "the slow never wears off", mods: { permafrost: true },
        super: { name: "Ice Age", desc: "the permanent slow is 15% stronger", mods: { slow: 0.15 } } },
    ] },
  ],
  // EXC (owner, 2026-10-02): L2 Charge or Array, three forms each, each with
  // its own on-theme L4 super. Multi-lock (Array) was the parked idea.
  reaper: [
    { name: "Charge", desc: "damage x1.8, fire rate -30%", mods: { dmg: 1.8, rate: 0.7 }, finals: [
      { name: "Longshot", desc: "+1% damage per 10 units to the target", mods: { longshot: 0.01 },
        super: { name: "Horizon", desc: "+2% per 10 units", mods: { longshot: 0.02 } } },
      { name: "Supernova", desc: "hits explode for 50% in a radius of 90", mods: { splash: { r: 90, frac: 0.5 } },
        super: { name: "Collapse", desc: "75% in a radius of 135", mods: { splash: { r: 135, frac: 0.75 } } } },
      { name: "Execute", desc: "an enemy left under 20% HP dies", mods: { execute: 0.2 },
        super: { name: "Verdict", desc: "under 35% HP", mods: { execute: 0.35 } } },
    ] },
    { name: "Array", desc: "3 locks, each charging on its own timer", mods: { targets: 2 }, finals: [
      { name: "Grid", desc: "5 locks", mods: { targets: 2 },
        super: { name: "Lattice", desc: "7 locks", mods: { targets: 2 } } },
      { name: "Ricochet", desc: "each beam bounces once to the nearest enemy, at 60%", mods: { bounce: 0.6 },
        super: { name: "Carom", desc: "the bounce deals full damage", mods: { bounce: 1 } } },
      { name: "Refund", desc: "50% of overkill flies back and joins the next shot", mods: { refund: 0.5 },
        super: { name: "Full Refund", desc: "all of the overkill comes back", mods: { refund: 1 } } },
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

// LEVEL 4 = SUPER FORM (owner). A form may name its OWN super (`super: { name,
// desc, mods }` - on theme with that form, owner); its mods apply on top of the
// form's. A form without one falls back to the generic rule: the final form "concentrates further" —
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
  const f = p.finals[t.form];
  if (t.lvl < MAX_LVL) return f.name;
  return f.super ? f.super.name : "Super " + f.name;
}
