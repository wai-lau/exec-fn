// /aspira - what a tower DOES, in prose (owner, 2026-10-07): one description
// per tower composed from its chart, each axis swapping a few words in one
// template, so the card's track changes (aspira-sliders.js) read as a single
// small edit from the locked tiers to the pulled ones. Loaded after
// aspira-skills.js (the simulator too, for scripts/aspira-desc-graph.mjs).
// (A tower without a composer here would fall back to its axes' `base` / `desc`
// sentences, aspira-skills.js, run together.)
const cap = s => s[0].toUpperCase() + s.slice(1);
const ARC_ADJ = ["", "harder", "much harder", "the hardest"], ARC_KEEP = ["half", "most of", "nearly all of", "all of"], ARC_ARCS = ["", "once", "twice", "three times"];
// thematic words where they fit (owner): chill, rime, brittle, moons; rays, refract, scorch; jets, etch, blister
const FRZ_CHILL = ["A", "A deeper, wider", "A far deeper, wider", "The deepest, widest"];
const FRZ_RIME_TEXT = ["", " Rings of rime roll out, leaving a frost that never thaws and stacks.", " Rings of rime roll out faster, leaving a deeper frost that never thaws and stacks.", " Rings of rime roll out fastest, leaving the deepest frost that never thaws and stacks."];
const FRZ_MOONS = ["", " One pale moon orbits it, a copy of the tower.", " Two brighter moons orbit it, copies of the tower.", " Three full moons orbit it, copies of the tower."];
const SOL_RAYS = ["A ray", "Two rays", "Three rays", "Four rays"];
const SOL_REFRACT = ["stopping at the first enemy struck", "refracting from the first enemy struck on to two more ahead", "refracting harder from the first enemy struck on to five more ahead", "refracting hardest from the first enemy struck on to nine more ahead"];
const SOL_OVER = ["", "", " twice over", " six times over"];
const ACD_JETS = ["Two", "Three", "Four", "Six"], ACD_ACID = ["", "", "stronger ", "the strongest "]; // acidic terms, never heat (owner)
const ACD_PUDDLES = ["puddles", "blistering puddles, more often", "bigger blistering puddles, more often", "bigger blistering puddles, more often, that slow all who wade through them"];
const DESCRIBE = {
  // "Arcs fork on hit, each jump carrying half the hit." -> Conductivity: chain once and / into
  // three / twin; Voltage: harder .. the hardest, most of .. all of; Capacitance: the charge sentence (owner's words)
  arc(sk) {
    const c = sk.conductivity || 0, v = sk.voltage || 0, z = sk.capacitance || 0;
    let s = [ARC_ADJ[v], c >= 3 ? "twin" : "", "arcs", c >= 1 ? "chain once and" : "", "fork", c >= 2 ? "into three" : "", "on hit, each jump carrying", ARC_KEEP[v], "the hit."].filter(Boolean).join(" ");
    if (z) s += " Hits charge the target, charged targets arc " + ARC_ARCS[z] + " when hit by anything" + (z >= 3 ? ", slowing what they hit." : ".");
    return cap(s);
  },
  // "A chill slows all it holds." -> Temp: deeper, wider .. the deepest, widest (III: and turns
  // it brittle); Rime: the rings of rime; Moons: the moons
  frz(sk) {
    const f = sk.temp || 0;
    return FRZ_CHILL[f] + " chill slows all it holds" + (f >= 3 ? ", and turns it brittle." : ".") + FRZ_RIME_TEXT[sk.rime || 0] + FRZ_MOONS[sk.moons || 0];
  },
  // "A ray of light, stopping at the first enemy struck." -> Focus: two .. four rays, each a full
  // strike; Refraction: refracting (harder / hardest) on to two / five / nine more; Breach (owner's
  // words): each beam weakens its target's armor (twice over / six times over) for good, and
  // scorches it so every tower crits it more
  sol(sk) {
    const f = sk.focus || 0, r = sk.refraction || 0, b = sk.breach || 0;
    return SOL_RAYS[f] + " of light" + (f ? ", each a full strike" : "") + ", " + SOL_REFRACT[r] + (b ? "; each beam weakens its target's armor" + SOL_OVER[b] + " for good, and scorches it so every tower crits it more." : ".");
  },
  // "Two jets of acid, each etching its own enemy, dripping puddles; a fresh jet starts with little
  // of a spent one's concentration." (owner: jets of acid, acidic terms) -> Spray: three .. six jets;
  // Corrosion: all of the concentration, then stronger / the strongest acid; Contagion: blistering puddles
  acd(sk) {
    const c = sk.corrosion || 0;
    return ACD_JETS[sk.spray || 0] + " jets of " + ACD_ACID[c] + "acid, each etching its own enemy, dripping " + ACD_PUDDLES[sk.contagion || 0] + "; a fresh jet starts with " + (c ? "all" : "little") + " of a spent one's concentration.";
  },
};
// the description for a chart (`skills`): the composer, else the axes' sentences run together
function describeTower(kind, skills) {
  const sk = skills || {};
  if (DESCRIBE[kind]) return DESCRIBE[kind](sk);
  return SKILL_TREES[kind].map(ax => (sk[ax.id] ? ax.tiers[sk[ax.id] - 1].desc : ax.base)).filter(Boolean).join(" ");
}
