// /aspira - what a tower DOES, in prose (owner, 2026-10-07): one description
// per tower composed from its chart, each axis swapping a few words in one
// template, so the card's track changes (aspira-sliders.js) read as a single
// small edit from the locked tiers to the pulled ones. Loaded after
// aspira-skills.js (the simulator too, for scripts/aspira-desc-graph.mjs).
// (A tower without a composer here would fall back to its axes' `base` / `desc`
// sentences, aspira-skills.js, run together.)
const cap = s => s[0].toUpperCase() + s.slice(1);
const ARC_CHARGES = ["", "a charge", "two charges", "three charges", "four charges", "five charges"]; // Capacitance (2026-10-08)
const ARC_KEEP = ["half", "most of", "nearly all of", "all of", "more than", "far more than"], ARC_RETURN = ["", "", "", "once", "twice", "three times"];
// thematic words where they fit (owner): chill, rime, brittle, moons; rays, refract, pierce; jets, etch.
// ONLY BEHAVIOUR is told here (owner, 2026-10-07): a tier that just moves a number - harder
// hits, a colder or wider aura, faster pulses, a stronger acid, more or bigger puddles -
// changes no words; the card's stat rows show that change (now -> next)
const FRZ_RIME_TEXT = ["", ...Array(5).fill(" Frost rings leave lasting frost that stacks and spreads when full.") /* "rime" is FROST in every word shown (owner, 2026-10-12) */];
const FRZ_MOONS = ["", " A moon copies it.", " Two moons copy it.", " Three moons copy it.", " Three moons copy it, each with a moonlet.", " Three moons copy it, each with three moonlets."];
const SOL_RAYS = ["A ray", "Two rays", "Three rays", "Four rays", "Five rays", "Six rays"];
const SOL_REFRACT = ["refracting on to one more enemy", "refracting on to three more enemies", "refracting on to six more enemies", "refracting on to ten more enemies", "refracting on to thirteen more enemies", "refracting through every enemy ahead"];
const ACD_JETS = ["Two", "Three", "Four", "Six", "Seven", "Eight"]; // acidic terms, never heat (owner)
const DESCRIBE = {
  // "Arcs fork on hit, each jump carrying half the hit." -> Conductivity: chain once and / into
  // three / twin; Voltage: most of .. all of (its harder hit is a stat row); Capacitance: the charge sentence (owner's words)
  arc(sk) {
    const c = sk.conductivity || 0, v = sk.voltage || 0, z = sk.capacitance || 0;
    let s = [c >= 6 ? "six" : c >= 5 ? "four" : c >= 4 ? "three" : c >= 3 ? "twin" : "", "arcs", c >= 6 ? "chain twice and" : c >= 1 ? "chain once and" : "", "fork", c >= 2 ? "in three" : "", c >= 3 ? "on hit, re-striking " + ARC_RETURN[c] + "; each jump carries" : "on hit; each jump carries", ARC_KEEP[v], v ? "the hit and pierces armor." : "the hit."].filter(Boolean).join(" ");
    if (z) s += " Hits leave " + ARC_CHARGES[ARC_CAPACITANCE[z].n] + (ARC_CAPACITANCE[z].n > 1 ? " that burst" : " that bursts") + " on a later hit, slowing all near.";
    return cap(s);
  },
  // "A chill slows all it holds." -> Temp III: and turns it brittle (its colder, wider aura is
  // stat rows); Rime: the rings of rime; Moons: the moons
  frz(sk) {
    const tp = sk.temp || 0; // Temp takes ARMOR (owner, 2026-10-12): reducing, then shattering, then decimating it
    return "A chill that hurts more the colder you are" + (tp >= 6 ? ", decimating their armor." : tp >= 4 ? ", shattering their armor." : tp >= 1 ? ", reducing their armor." : ".") + FRZ_RIME_TEXT[sk.rime || 0] + FRZ_MOONS[sk.moons || 0] + "";
  },
  // "A ray of light, stopping at the first enemy struck; each beam weakens its target's armor for
  // good." (Breach is SOL's own from the start, owner 2026-10-08) -> Focus: two .. six rays, each a
  // full strike; Refraction: refracting on to more; Breach: armor *greatly*, and pierces it so every tower crits it more
  sol(sk) {
    const f = sk.focus || 0, r = sk.refraction || 0, b = sk.breach || 0;
    return SOL_RAYS[f] + " of light" + (f ? ", each a full strike" : "") + ", " + SOL_REFRACT[r] + (b >= 6 ? "; each beam evaporates armor." : "; each beam weakens armor" + (b ? " greatly" : "") + " for good.") + "";
  },
  // ACD roles rework (owner, 2026-10-12): Flow = more jets that slow and carry their acid on;
  // Corrosion = stronger acid that eats armor; Contagion = the always-on pools grow, massive at VI
  acd(sk) {
    const c = sk.contagion || 0, f = sk.spray || 0, k = sk.corrosion || 0; // pools from the start (owner, 2026-10-12)
    return ACD_JETS[f] + (f ? " slowing" : "") + " jets of " + "acid" + (k >= 6 ? " that dissolves armor" : k ? " that corrodes armor" : "") + ", dripping " + (c >= 6 ? "massive" : c >= 3 ? "huge" : c ? "larger" : "large") + " pools; each kill leaves one more. " + (f ? "A jet keeps its flow on its next enemy." : "A jet starts cold on each new enemy.");
  },
};
// the description for a chart (`skills`): the composer, else the axes' sentences run together
function describeTower(kind, skills) {
  const sk = skills || {};
  if (DESCRIBE[kind]) return DESCRIBE[kind](sk);
  return SKILL_TREES[kind].map(ax => (sk[ax.id] ? ax.tiers[sk[ax.id] - 1].desc : ax.base)).filter(Boolean).join(" ");
}
