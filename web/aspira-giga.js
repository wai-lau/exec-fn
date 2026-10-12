// /spire - the GIGA CAPSTONES (owner, 2026-10-11: "add a 6th level to each of the axes for each tower that is a giga
// version of the capstone", "you can only get 1/3 of the giga capstones"): every axis gains tier VI, a big leap
// over its capstone V, and a tower may take ONE axis to VI - the other two stop at V (axisCap). Sixteen points
// (5 + 5 + 6, SKILL_POINTS). Every per-tier table is extended here, in one place, so no index-6 lookup is ever
// undefined. Loaded after aspira-skills.js, aspira-acid.js, aspira-frz.js and aspira-desc.js (the simulator too).
const GIGA_TIER = SKILL_TIERS; // 6
// the most axis `id` of tower t may reach, with `add` (axis -> points) pulled on: V while another axis is at VI
function gigaHolder(t, id, add = {}) {
  return SKILL_TREES[t.kind].find(ax => ax.id !== id && skillOf(t, ax.id) + (add[ax.id] || 0) >= GIGA_TIER) || null;
}
const axisCap = (t, id, add = {}) => (gigaHolder(t, id, add) ? GIGA_TIER - 1 : GIGA_TIER);

// ---------- the numbers: index 6 of every tier table (a leap, not a step) ----------
const GIGA_NUM = [
  // ARC: Conductivity six arcs chaining twice; Voltage each jump carries twice the hit; Capacitance eight charges
  [ARC_VOLTAGE_DMG, 43.7], [ARC_VOLTAGE_FALL, 1.6], [ARC_VOLTAGE_JUMP, 2], [ARC_VOLTAGE_PIERCE, 0.9], [ARC_STAT_SLOW, 0.55],
  [ARC_CONDUCTIVITY, { s: 4 /* was 6 - the ARC nerf, 2026-10-11 */, j: 3, f: 3, r: 2.4, d: 1, v: 4 }], [ARC_CAPACITANCE, { n: 8, frac: 0.2 /* was 0.15, kept above V when V went to 0.14 (2026-10-12) */ }],
  // FRZ: Temp a far deeper chill; Rime the fastest, deepest rings; Moons FOUR moons, each with four small moons
  [FRZ_TEMP_SLOW, 0.55], [FRZ_TEMP_TICK, 0.2], [FRZ_BRITTLE, 2], [FRZ_RIME, 0.3], [FRZ_RIME_PERIOD, 0.7], [FRZ_RIME_CRACK, 0.32], [FRZ_MOON_CRACK, 0.12],
  [FRZ_MOON_COUNT, 4], [FRZ_MOON_BY, 1], [FRZ_SUBMOON_N, 4],
  // SOL: Focus eight rays; Refraction a wider cone, harder hops; Breach armor stripped for good, far bigger crits
  [SOL_BEAMS, 8], [SOL_FOCUS_DMG, 1.3], [SOL_SHIELD_POP, 5], [SOL_REFRACTION, Infinity], [SOL_REFRACTION_DMG, 4], [SOL_REFRACT_SWIFT, 7],
  [SOL_CONE_BY, 100], [SOL_HOP, 1], [SOL_CRITMUL, 12], [SOL_BREACH_ARMOR, 300], [SOL_BREACH_CRIT, 0.08],
  // ACD: Corrosion the strongest acid; Flow eleven jets landing far hotter, slowing hard; Contagion MASSIVE, long pools
  [ACD_CORROSION_DMG, 1], [ACD_CORRODE, 0.9], [ACD_CORRODE_FLOOR, 2], [ACD_LINES, 11], [ACD_FLOW_CARRY, 1.5], [ACD_FLOW_SLOW, 0.2], [ACD_SPRAY_MUL, 1],
  [ACD_CONTAGION, { every: 1, life: 40, r: 150 }], [ACD_PUDDLE_HEAT, 0.2],
];
for (const [table, v] of GIGA_NUM) if (table.length === GIGA_TIER) table.push(v);
// the reach a giga tier buys ([range, slide, speed], SKILL_MOVE): ARC stays near today's cut (owner, 2026-10-11)
const GIGA_MOVE = {
  arc: { conductivity: [1.15, 1, 1], voltage: [1.15, 1, 1], capacitance: [1, 3, 1] },
  frz: { temp: [1.7, 1, 1], rime: [1, 3, 1], moons: [1, 1, 1] },
  sol: { focus: [2.3, 1, 1], refraction: [1.7, 1, 1], breach: [1, 3, 1] },
  acd: { corrosion: [1, 1, 1], spray: [1.25, 1, 1], contagion: [1, 2.1, 2.1] },
};
for (const [kind, axes] of Object.entries(GIGA_MOVE)) {
  for (const [id, m] of Object.entries(axes)) {
    const tiers = SKILL_MOVE[kind][id];
    SKILL_MOVE[kind][id] = tiers.length === GIGA_TIER ? [...tiers, m] : tiers; // a copy: NO_MOVE is shared between axes
  }
}

// ---------- the words: each axis's tier VI, and the composers' (aspira-desc.js) index 6 ----------
const GIGA_TIERS = {
  conductivity: { name: "Hyperstorm", desc: "Six arcs chain twice and fork into three on hit." },
  voltage: { name: "Gigavolt", desc: "Each jump carries twice the hit. Arcs pierce armor." },
  capacitance: { name: "Superstorm", desc: "Hits leave eight charges, which burst around the target when it is hit by anything, slowing what they hit." },
  temp: { name: "Zero Point", desc: "A deep chill slows all it holds, and shatters the light ones brittle." },
  rime: { name: "Ice Age", desc: "Rings of rime roll out fast, shattering shields and leaving behind a rime that layers and never thaws; full rime spreads to the nearest enemy." },
  moons: { name: "Constellation", desc: "Four moons orbit it, each with four small moons of its own. Its chill cracks armor for good." },
  focus: { name: "Solar Flare", desc: "Eight rays of light, each a full strike." },
  refraction: { name: "Corona", desc: "Refracting on through every enemy ahead in a wide cone, and out of sight. Light outruns the fast: far harder on them." },
  breach: { name: "Starfire", desc: "Each beam strips its target's armor for good, and pierces it so every tower crits it far more." },
  corrosion: { name: "Oblivion", desc: "Acid dissolves armor far below nothing." },
  spray: { name: "Monsoon", desc: "Eleven slowing jets; a jet lands far hotter on its next enemy." },
  contagion: { name: "Extinction", desc: "Massive pools of acid that linger very long." },
};
for (const axes of Object.values(SKILL_TREES)) for (const ax of axes) if (ax.tiers.length === GIGA_TIER - 1 && GIGA_TIERS[ax.id]) ax.tiers.push(GIGA_TIERS[ax.id]);
ARC_KEEP.push("twice"); ARC_RETURN.push("four times");
ARC_CHARGES.push("six charges", "seven charges", "eight charges"); // indexed by the charge COUNT (ARC_CAPACITANCE[z].n)
FRZ_RIME_TEXT.push(FRZ_RIME_TEXT[5]);
FRZ_MOONS.push(" Four moons orbit it, copies of the tower, each with four small moons of its own.");
SOL_RAYS.push("Eight rays");
SOL_REFRACT.push("refracting from the first enemy struck on through every enemy ahead in a wide cone, and on out of sight");
ACD_JETS.push("Eleven");
