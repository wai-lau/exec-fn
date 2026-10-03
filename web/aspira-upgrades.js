// /aspira — the upgrade tree. Every tower has four levels: the upgrade to L2
// picks one of three PATHS, the one to L3 one of that path's two FINAL FORMS
// (3 paths x 2 forms = 6 finals per tower), and L4 is the SUPER form. Levels in between
// grow the base stats (towerStats in aspira-defs.js).
//
// mods are applied by applyMods(): dmg/rate/range/arcRange multiply,
// crit/arcs/targets/slow add, everything else is a behaviour flag read by
// the shot code in aspira-game.js. A final form's mods stack on its path's.

const BRANCH_LVL = 2, FINAL_LVL = 3; // the levels that bring the path / final form

// Every `desc` is its card's TAGLINE (owner): a reader-friendly one-line
// descriptor of the upgrade, with no numbers - the card's stat rows show those.
const UPGRADES = {
  chain: [
    // ARC (owner, 2026-10-02): L2 is 2 PATHS, L3 is 3 FORMS each. branch /
    // layers reshape the arc tree. Ion's damage is matched to Storm's full
    // tree per shot: Storm = strike x (1 + 12 x 0.8) = 10.6, Ion 4 hits = 3.4
    // -> x3.1.
    { name: "Storm", desc: "Lightning branches out, hitting more enemies with every arc.", mods: { branch: 3, layers: 2 }, finals: [
      { name: "Tempest", desc: "An even bushier tree of lightning.", mods: { branch: 4 },
        super: { name: "Maelstrom", desc: "The widest lightning tree of all.", mods: { branch: 5 } } },
      { name: "Overcharge", desc: "Every arc hits as hard as the first strike.", mods: { arcFall: 1 },
        super: { name: "Surge", desc: "Arcs hit harder than the strike that started them.", mods: { arcFall: 1.5 } } },
      // static: 1 = charge from the tower's own shots, 2 = Static shots charge too
      { name: "Static", desc: "Marks enemies; a marked enemy that dies fires a free shot.", mods: { static: 1, dmg: 1.5 },
        super: { name: "Thunderhead", desc: "Free shots mark what they hit, so kills can chain.", mods: { static: 2 } } },
    ] },
    // Ion and Array nerfed x0.8 (owner, 2026-10-02): the build search's winners
    // took Ion in 29 of the top 30 and Array in 29 of 30
    { name: "Ion", desc: "A piercing line that cuts through shields and armor.", mods: { dmg: 2.5, branch: 1, layers: 3, ignoreShield: true, armorPierce: 0.5, noRevisit: true }, finals: [
      { name: "Rail", desc: "The line reaches further down the spiral.", mods: { layers: 6 },
        super: { name: "Railgun", desc: "The longest line there is.", mods: { layers: 10 } } },
      // Fork (owner): two lines on two different enemies. Two full lines are 2 x 3.4 =
      // 6.8 strikes a shot, so x0.85 damage levels it with Rail (5.8); Trident ~ Railgun
      { name: "Fork", desc: "Two lines at once, never from the same enemy.", mods: { targets: 1, dmg: 0.85 },
        super: { name: "Trident", desc: "Three lines at once.", mods: { targets: 1 } } },
      { name: "Crescendo", desc: "Each hop down the line hits harder than the last.", mods: { hopGain: 1.4 },
        super: { name: "Fortissimo", desc: "The line builds to a bigger finish.", mods: { hopGain: 1.6 } } },
    ] },
  ],
  // ACD (owner, 2026-10-02): L2 Catalyst or Plague, three L3 forms each, and
  // each form's own on-theme L4 super. Bloom hits harder than Contagion
  // (x1.5 vs x0.7) to make up for its smaller area (owner).
  acid: [
    // ACD buffed (owner, 2026-10-02: "ACD upgrades feel weak"; Rain and Residue
    // tested below the baseline): Catalyst +20% burn, Rain x2.5, Residue 3s and
    // x2.2 (Scar 8s), Corrosion 1.5 a tick (Dissolve 3), Contagion x1 (was x0.7)
    { name: "Catalyst", desc: "The burn ramps up twice as fast.", mods: { double: 0.5, dmg: 1.2 }, finals: [
      // Rain tested weak whatever its burn (x1.25..x6: one line is one line);
      // it now CHAINS like ARC (owner): each tick also burns up to 5 more
      // enemies, hopping to the nearest within RAIN_HOP of the last
      { name: "Rain", desc: "The burn spreads from enemy to enemy, like lightning.", mods: { range: 2, rainChain: 5 },
        super: { name: "Deluge", desc: "Rain that reaches across the board.", mods: { range: 1.5 } } },
      { name: "Pour", desc: "Several burning lines, each ramping on its own.", mods: { targets: 2 },
        super: { name: "Torrent", desc: "Even more burning lines.", mods: { targets: 2 } } },
      // Residue also SLOWS what it burns, and switches the tower to target Fast
      // enemies - the ones that run out of range and keep burning (owner)
      { name: "Residue", desc: "Burns slow enemies and cling on after they escape; hunts Fast ones.", mods: { residue: 3, dmg: 3, burnSlow: 0.3 }, mode: "fast",
        super: { name: "Scar", desc: "The burn clings on much longer.", mods: { residue: 8 } } },
    ] },
    // circle tripled 45 -> 135 (owner, 2026-10-02: "45 range is nothing")
    { name: "Plague", desc: "Every tick also burns everything near the target.", mods: { plagueR: 135 }, finals: [
      // Bloom, Permafrost and Moons trimmed (owner, 2026-10-02: they topped the
      // late-game test at 84-90 vs an 80 baseline)
      { name: "Bloom", desc: "The burning circle grows as the burn ramps.", mods: { bloom: 1.6, dmg: 1.15 },
        super: { name: "Overgrowth", desc: "The circle blooms even wider.", mods: { bloom: 2.2 } } },
      { name: "Corrosion", desc: "Eats armor away, so every tower hits harder.", mods: { corrode: 1.5 },
        super: { name: "Dissolve", desc: "Eats armor faster.", mods: { corrode: 3 } } },
      // range cut (owner, 2026-10-02): every burn in range keeps ramping, never
      // down, so a wide Contagion was too strong. 0.6 / 0.75 of the tower's range
      { name: "Contagion", desc: "Everything in range burns, each on its own ramp.", mods: { allInRange: true, plagueR: 0, range: 0.6 },
        super: { name: "Pandemic", desc: "The contagion reaches further.", mods: { range: 1.25 } } },
    ] },
  ],
  // FRZ (owner, 2026-10-02): L2 Shatter or Stasis, three forms each, each with
  // its own on-theme L4 super.
  slower: [
    // Shatter scales off the FRZ's OWN hit, never the enemy's max HP (owner,
    // 2026-10-02: max-HP effects made towers too obviously late-game picks)
    { name: "Shatter", desc: "Slowed enemies explode when they die.", mods: { shatter: { mul: 4, r: 60 } }, finals: [
      { name: "Frostbite", desc: "Bigger explosions that slow whatever they hit.", mods: { frostbite: 4, shatter: { mul: 4, r: 84 } },
        super: { name: "Hoarfrost", desc: "The frostbite slow lingers much longer.", mods: { frostbite: 12 } } },
      { name: "Shrapnel", desc: "Much harder-hitting explosions.", mods: { shatter: { mul: 7, r: 60 } },
        super: { name: "Splinter", desc: "Explosions hit harder still.", mods: { shatter: { mul: 14, r: 60 } } } },
      { name: "Brittle", desc: "Slowed enemies take extra damage from every tower.", mods: { brittle: 1.3 },
        super: { name: "Fracture", desc: "Slowed enemies take even more.", mods: { brittle: 1.6 } } },
    ] },
    { name: "Stasis", desc: "A much stronger slow.", mods: { slow: 0.15 }, finals: [
      { name: "Deep Freeze", desc: "Freshly slowed enemies are frozen for a moment.", mods: { chillStop: 0.25 },
        super: { name: "Absolute Zero", desc: "The freeze holds longer.", mods: { chillStop: 0.5 } } },
      // (owner, 2026-10-02: were Whiteout / Blizzard, whole-range chills)
      { name: "Moons", desc: "Two orbiting moons, each a freezing tower of its own.", mods: { moons: 2 },
        super: { name: "Desolation", desc: "A third moon, and a deeper chill.", mods: { moons: 3, slow: 0.05 } } },
      { name: "Permafrost", desc: "A slow that never wears off.", mods: { permafrost: true, slow: -0.15 },
        super: { name: "Ice Age", desc: "The endless slow bites harder.", mods: { slow: 0.05 } } },
    ] },
  ],
  // SOL (owner, 2026-10-03): L2 Impale or Charge, three forms each, each with
  // its own on-theme L4 super.
  //   Impale  every hit BLEEDS the enemy (st.bleedArmor / st.bleedCrit per hit,
  //           stacking, permanent): its armor falls and EVERY tower crits it more
  //   Charge  heavier, slower twin beams (st.beams 2, each half a shot)
  reaper: [
    { name: "Impale", desc: "Every hit makes the enemy bleed: its armor falls and every tower crits it more, for good.",
      mods: { bleedArmor: 3, bleedCrit: 0.03 }, finals: [
        { name: "Pinpoint", desc: "Crits come far more often, and hit harder.", mods: { critScale: 1.5, critMul: 4 },
          super: { name: "Splicer", desc: "Crits come more often still, and hit harder still.", mods: { critScale: 2, critMul: 5 } } },
        { name: "Stake", desc: "Every hit bleeds deeper.", mods: { bleedArmor: 6, bleedCrit: 0.06 },
          super: { name: "Gore", desc: "The deepest bleeding.", mods: { bleedArmor: 9, bleedCrit: 0.09 } } },
        { name: "Ricochet", desc: "Each shot chains at full damage from enemy to enemy.", mods: { ricochet: 3 },
          super: { name: "Shredder", desc: "The chain runs much further.", mods: { ricochet: 6 } } },
      ] },
    { name: "Charge", desc: "Slower, heavier twin beams.", mods: { dmg: 2, rate: 0.7, beams: 2 }, finals: [
      { name: "Grid", desc: "More locks, each firing its own twin beams.", mods: { targets: 2 },
        super: { name: "Lattice", desc: "Even more locks.", mods: { targets: 2 } } },
      { name: "Quad", desc: "Four parallel beams at once.", mods: { beams: 4 },
        super: { name: "Horizon", desc: "Seven parallel beams.", mods: { beams: 7 } } },
      { name: "Nova", desc: "A kill bursts, hitting everything around it.", mods: { smash: { r: 160, frac: 1 } },
        super: { name: "Supernova", desc: "A far bigger, harder burst.", mods: { smash: { r: 240, frac: 2 } } } },
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
