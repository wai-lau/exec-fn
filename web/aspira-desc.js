// /aspira - what a tower DOES, in prose (owner, 2026-10-07): one description
// per tower composed from its chart, each axis swapping a few words in one
// template, so the card's track changes (aspira-sliders.js) read as a single
// small edit from the locked tiers to the pulled ones. Loaded after
// aspira-skills.js (the simulator too, for scripts/aspira-desc-graph.mjs).
// A tower without a composer here falls back to its axes' `base` / `desc`
// sentences (aspira-skills.js) run together.
const ARC_ADJ = ["", "harder", "much harder", "the hardest"], ARC_KEEP = ["half", "most of", "nearly all of", "all of"], ARC_SHARE = ["", "a share", "a bigger share", "the biggest share"];
const DESCRIBE = {
  // "Arcs fork on hit, each jump carrying half the hit." -> Conductivity: chain once and / into
  // three / twin; Voltage: harder .. the hardest, most of .. all of; Capacitance: the charge sentence
  arc(sk) {
    const c = sk.conductivity || 0, v = sk.voltage || 0, z = sk.capacitance || 0;
    let s = [ARC_ADJ[v], c >= 3 ? "twin" : "", "arcs", c >= 1 ? "chain once and" : "", "fork", c >= 2 ? "into three" : "", "on hit, each jump carrying", ARC_KEEP[v], "the hit."].filter(Boolean).join(" ");
    if (z) s += " Hits leave " + ARC_SHARE[z] + " of themselves behind for the next hit from any tower to burst" + (z >= 3 ? ", slowing what it catches." : ".");
    return s[0].toUpperCase() + s.slice(1);
  },
};
// the description for a chart (`skills`): the composer, else the axes' sentences run together
function describeTower(kind, skills) {
  const sk = skills || {};
  if (DESCRIBE[kind]) return DESCRIBE[kind](sk);
  return SKILL_TREES[kind].map(ax => (sk[ax.id] ? ax.tiers[sk[ax.id] - 1].desc : ax.base)).filter(Boolean).join(" ");
}
