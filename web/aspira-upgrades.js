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
      // static: 1 = charge from the tower's own shots, 2 = Static shots charge too
      { name: "Static", desc: "hits deal x1.5 and charge enemies (an orange border); a charged enemy that dies fires a full shot from where it fell", mods: { static: 1, dmg: 1.5 },
        super: { name: "Thunderhead", desc: "those shots charge what they hit too: kills can cascade", mods: { static: 2 } } },
    ] },
    // Ion and Array nerfed x0.8 (owner, 2026-10-02): the build search's winners
    // took Ion in 29 of the top 30 and Array in 29 of 30
    { name: "Ion", desc: "ignores shields and half of armor; a line 1→1→1→1; damage x2.5", mods: { dmg: 2.5, branch: 1, layers: 3, ignoreShield: true, armorPierce: 0.5, noRevisit: true }, finals: [
      { name: "Rail", desc: "a longer line: 6 hops", mods: { layers: 6 },
        super: { name: "Railgun", desc: "the line runs 10 hops", mods: { layers: 10 } } },
      // Fork (owner): two lines on two different enemies. Two full lines are 2 x 3.4 =
      // 6.8 strikes a shot, so x0.85 damage levels it with Rail (5.8); Trident ~ Railgun
      { name: "Fork", desc: "two lines 1→1→1→1, never from the same enemy; damage x0.85", mods: { targets: 1, dmg: 0.85 },
        super: { name: "Trident", desc: "three lines", mods: { targets: 1 } } },
      { name: "Crescendo", desc: "each hop hits 40% harder than the last", mods: { hopGain: 1.4 },
        super: { name: "Fortissimo", desc: "each hop hits 60% harder than the last", mods: { hopGain: 1.6 } } },
    ] },
  ],
  // ACD (owner, 2026-10-02): L2 Catalyst or Plague, three L3 forms each, and
  // each form's own on-theme L4 super. Bloom hits harder than Contagion
  // (x1.5 vs x0.7) to make up for its smaller area (owner).
  acid: [
    // ACD buffed (owner, 2026-10-02: "ACD upgrades feel weak"; Rain and Residue
    // tested below the baseline): Catalyst +20% burn, Rain x2.5, Residue 3s and
    // x2.2 (Scar 8s), Corrosion 1.5 a tick (Dissolve 3), Contagion x1 (was x0.7)
    { name: "Catalyst", desc: "the burn doubles every 0.5s (was 1s); burn x1.2", mods: { double: 0.5, dmg: 1.2 }, finals: [
      // Rain tested weak whatever its burn (x1.25..x6: one line is one line);
      // it now CHAINS like ARC (owner): each tick also burns up to 5 more
      // enemies, hopping to the nearest within RAIN_HOP of the last
      { name: "Rain", desc: "double range; the burn chains to 5 more enemies, hopping like ARC", mods: { range: 2, rainChain: 5 },
        super: { name: "Deluge", desc: "triple range", mods: { range: 1.5 } } },
      { name: "Pour", desc: "three lines at once, each with its own ramp", mods: { targets: 2 },
        super: { name: "Torrent", desc: "five lines", mods: { targets: 2 } } },
      // Residue also SLOWS what it burns, and switches the tower to target Fast
      // enemies - the ones that run out of range and keep burning (owner)
      { name: "Residue", desc: "burns slow by 30%; an enemy that leaves range keeps burning for 3s; burn x2.2; targets Fast enemies", mods: { residue: 3, dmg: 2.2, burnSlow: 0.3 }, mode: "fast",
        super: { name: "Scar", desc: "it keeps burning for 8s", mods: { residue: 8 } } },
    ] },
    // circle tripled 45 -> 135 (owner, 2026-10-02: "45 range is nothing")
    { name: "Plague", desc: "every tick also burns everything within 135 of the target", mods: { plagueR: 135 }, finals: [
      // Bloom, Permafrost and Moons trimmed (owner, 2026-10-02: they topped the
      // late-game test at 84-90 vs an 80 baseline)
      { name: "Bloom", desc: "the circle grows with the burn, up to 1.6x; burn x1.3", mods: { bloom: 1.6, dmg: 1.3 },
        super: { name: "Overgrowth", desc: "the circle grows up to 2.2x", mods: { bloom: 2.2 } } },
      { name: "Corrosion", desc: "every tick strips 1.5 armor from all it burns, below zero (bonus damage from every tower)", mods: { corrode: 1.5 },
        super: { name: "Dissolve", desc: "strips 3 armor a tick", mods: { corrode: 3 } } },
      // range cut (owner, 2026-10-02): every burn in range keeps ramping, never
      // down, so a wide Contagion was too strong. 0.6 / 0.75 of the tower's range
      { name: "Contagion", desc: "no line: every enemy in range burns, each on its own ramp; range x0.6", mods: { allInRange: true, plagueR: 0, range: 0.6 },
        super: { name: "Pandemic", desc: "range x1.25", mods: { range: 1.25 } } },
    ] },
  ],
  // FRZ (owner, 2026-10-02): L2 Shatter or Stasis, three forms each, each with
  // its own on-theme L4 super.
  slower: [
    // Shatter scales off the FRZ's OWN hit, never the enemy's max HP (owner,
    // 2026-10-02: max-HP effects made towers too obviously late-game picks)
    { name: "Shatter", desc: "an enemy that dies while slowed explodes for 4x this tower's hit, within 60", mods: { shatter: { mul: 4, r: 60 } }, finals: [
      { name: "Frostbite", desc: "bigger blasts (r84) that also slow everything they hit, for 4s", mods: { frostbite: 4, shatter: { mul: 4, r: 84 } },
        super: { name: "Hoarfrost", desc: "that slow lasts 12s", mods: { frostbite: 12 } } },
      { name: "Shrapnel", desc: "explosions deal 7x this tower's hit", mods: { shatter: { mul: 7, r: 60 } },
        super: { name: "Splinter", desc: "explosions deal 14x this tower's hit", mods: { shatter: { mul: 14, r: 60 } } } },
      { name: "Brittle", desc: "slowed enemies take +30% from every tower", mods: { brittle: 1.3 },
        super: { name: "Fracture", desc: "+60%", mods: { brittle: 1.6 } } },
    ] },
    { name: "Stasis", desc: "slow +15%", mods: { slow: 0.15 }, finals: [
      { name: "Deep Freeze", desc: "a newly slowed enemy nearly freezes: 95% slow for 0.25s", mods: { chillStop: 0.25 },
        super: { name: "Absolute Zero", desc: "95% slow for 0.5s", mods: { chillStop: 0.5 } } },
      // (owner, 2026-10-02: were Whiteout / Blizzard, whole-range chills)
      { name: "Moons", desc: "two moons orbit the tower, each one a Stasis FRZ of its own (same range, slow and nick)", mods: { moons: 2 },
        super: { name: "Desolation", desc: "a third moon, and the slow +5%", mods: { moons: 3, slow: 0.05 } } },
      { name: "Permafrost", desc: "the slow never wears off, but is 15% weaker", mods: { permafrost: true, slow: -0.15 },
        super: { name: "Ice Age", desc: "the permanent slow is 5% stronger", mods: { slow: 0.05 } } },
    ] },
  ],
  // SOL (owner, 2026-10-02): L2 Charge or Array, three forms each, each with
  // its own on-theme L4 super. Multi-lock (Array) was the parked idea.
  reaper: [
    { name: "Charge", desc: "damage x2, fire rate -30%; fires twin beams", mods: { dmg: 2, rate: 0.7, twin: true }, finals: [
      { name: "Longshot", desc: "+1.5% damage per 10 units to the target", mods: { longshot: 0.015 },
        super: { name: "Horizon", desc: "+3% per 10 units", mods: { longshot: 0.03 } } },
      { name: "Supernova", desc: "hits explode for 50% in a radius of 90", mods: { splash: { r: 90, frac: 0.5 } },
        super: { name: "Collapse", desc: "75% in a radius of 135", mods: { splash: { r: 135, frac: 0.75 } } } },
      // Execute measures against the SHOT, not the enemy's max HP (owner)
      { name: "Execute", desc: "an enemy left with less HP than half this shot dies", mods: { execute: 0.5 },
        super: { name: "Verdict", desc: "less HP than a whole shot", mods: { execute: 1 } } },
    ] },
    { name: "Array", desc: "3 locks, each charging on its own timer; each beam x0.48", mods: { targets: 2, dmg: 0.48 }, finals: [
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

// the 3-letter label drawn on the tower follows its newest name (owner):
// ARC -> STO (Storm) -> TEM (Tempest) -> MAE (Maelstrom). First three
// letters, except where that would clash within a tree or read badly.
const AB_OVERRIDE = {
  Railgun: "RGN", Fortissimo: "FFF", Overcharge: "OVR", Overgrowth: "OVG",
  "Deep Freeze": "DFZ", "Absolute Zero": "ABZ", "Full Refund": "FRF", Moons: "MON",
};
function towerAb(t) {
  if (t.path == null) return TOWERS[t.kind].ab;
  const p = UPGRADES[t.kind][t.path], f = t.form == null ? null : p.finals[t.form];
  const name = !f ? p.name : t.lvl < MAX_LVL || !f.super ? f.name : f.super.name;
  return AB_OVERRIDE[name] || name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}
