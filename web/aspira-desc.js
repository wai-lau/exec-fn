// /aspira - what a tower DOES, in prose (owner, 2026-10-07): one description
// per tower composed from its chart, each axis swapping a few words in one
// template, so the card's track changes (aspira-sliders.js) read as a single
// small edit from the locked tiers to the pulled ones. Loaded after
// aspira-skills.js (the simulator too, for scripts/aspira-desc-graph.mjs).
// (A tower without a composer here would fall back to its axes' `base` / `desc`
// sentences, aspira-skills.js, run together.)
const cap = s => s[0].toUpperCase() + s.slice(1);
const ARC_KEEP = ["half", "most of", "nearly all of", "all of", "more than", "far more than"], ARC_ARCS = ["", "once", "twice", "three times", "four times", "five times"];
// thematic words where they fit (owner): chill, rime, brittle, moons; rays, refract, scorch; jets, etch.
// ONLY BEHAVIOUR is told here (owner, 2026-10-07): a tier that just moves a number - harder
// hits, a colder or wider aura, faster pulses, a stronger acid, more or bigger puddles -
// changes no words; the card's stat rows show that change (now -> next)
const FRZ_RIME_TEXT = ["", ...Array(5).fill(" Rings of rime roll out, leaving behind a rime that layers and never thaws.")];
const FRZ_MOONS = ["", " One moon orbits it, a copy of the tower.", " Two moons orbit it, copies of the tower.", " Three moons orbit it, copies of the tower.", " Four moons orbit it, copies of the tower.", " Five moons orbit it, copies of the tower."];
const SOL_RAYS = ["A ray", "Two rays", "Three rays", "Four rays", "Five rays", "Six rays"];
const SOL_REFRACT = ["stopping at the first enemy struck", "refracting from the first enemy struck on to two more ahead", "refracting from the first enemy struck on to five more ahead", "refracting from the first enemy struck on to nine more ahead", "refracting from the first enemy struck on to twelve more ahead", "refracting from the first enemy struck on to fifteen more ahead"];
const ACD_JETS = ["Two", "Three", "Four", "Six", "Seven", "Eight"]; // acidic terms, never heat (owner)
const DESCRIBE = {
  // "Arcs fork on hit, each jump carrying half the hit." -> Conductivity: chain once and / into
  // three / twin; Voltage: most of .. all of (its harder hit is a stat row); Capacitance: the charge sentence (owner's words)
  arc(sk) {
    const c = sk.conductivity || 0, v = sk.voltage || 0, z = sk.capacitance || 0;
    let s = [c >= 5 ? "three" : c >= 3 ? "twin" : "", "arcs", c >= 4 ? "chain twice and" : c >= 1 ? "chain once and" : "", "fork", c >= 2 ? "into three" : "", "on hit, each jump carrying", ARC_KEEP[v], "the hit."].filter(Boolean).join(" ");
    if (z) s += " Hits charge the target, charged targets arc " + ARC_ARCS[z] + " when hit by anything" + (z >= 3 ? ", slowing what they hit." : ".");
    return cap(s);
  },
  // "A chill slows all it holds." -> Temp III: and turns it brittle (its colder, wider aura is
  // stat rows); Rime: the rings of rime; Moons: the moons
  frz(sk) {
    return "A chill slows all it holds" + ((sk.temp || 0) >= 3 ? ", and turns it brittle." : ".") + FRZ_RIME_TEXT[sk.rime || 0] + FRZ_MOONS[sk.moons || 0];
  },
  // "A ray of light, stopping at the first enemy struck." -> Focus: two .. four rays, each a full
  // strike; Refraction: refracting on to two / five / nine more; Breach (owner's words): each beam
  // weakens its target's armor for good, and scorches it so every tower crits it more
  sol(sk) {
    const f = sk.focus || 0, r = sk.refraction || 0, b = sk.breach || 0;
    return SOL_RAYS[f] + " of light" + (f ? ", each a full strike" : "") + ", " + SOL_REFRACT[r] + (b ? "; each beam weakens its target's armor for good, and scorches it so every tower crits it more." : ".");
  },
  // "Two jets of acid, each corroding the enemy. Acid flow is reduced when switching targets."
  // (owner's words) -> Spray: three .. six jets; Corrosion I: the flow HOLDS on a switch;
  // Contagion I: leaving behind pools of acid that slow all who wade through them (from I, 2026-10-08)
  acd(sk) {
    const c = sk.contagion || 0; // no pools until Contagion I (owner)
    return ACD_JETS[sk.spray || 0] + " jets of acid, each corroding the enemy" + (c ? ", leaving behind pools of acid that slow all who wade through them" : "") + ". Acid flow " + ((sk.corrosion || 0) ? "holds" : "is reduced") + " when switching targets.";
  },
};
// the description for a chart (`skills`): the composer, else the axes' sentences run together
function describeTower(kind, skills) {
  const sk = skills || {};
  if (DESCRIBE[kind]) return DESCRIBE[kind](sk);
  return SKILL_TREES[kind].map(ax => (sk[ax.id] ? ax.tiers[sk[ax.id] - 1].desc : ax.base)).filter(Boolean).join(" ");
}
