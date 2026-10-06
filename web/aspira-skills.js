// /aspira - SKILL CHARTS (owner, 2026-10-05). A tower type with a chart (only
// ARC so far) levels up to 1 + SKILL_POINTS; each upgrade raises ONE of its
// three axes a tier (max SKILL_TIERS), like a JoJo Stand chart, and every tier
// is a named step. The other towers keep the path / form tree
// (aspira-upgrades.js). Loaded after aspira-towers.js (the simulator too):
// this file also holds ARC's skill-chart FIRING, kept out of towers.js (cap).
const SKILL_POINTS = 6, SKILL_TIERS = 3;
// cost of each of the six small upgrades, x the build cost (about the old
// three-step total, spread over six; balance later)
const SKILL_STEP_COST = [2, 3.5, 5.5, 8, 10.5, 13];
const SKILL_TREES = {
  // ARC (owner): Conductivity = ALL the branching (owner, 2026-10-05) - how
  // many times the chain jumps AND how many ways each jump forks; Voltage =
  // raw power, damage and range; Static = an EXPLOSION on every hit that marks
  // what it catches. Base: one jump forking two ways, three enemies.
  chain: [
    { id: "cond", name: "Conductivity", tiers: [
      { name: "Conduit", desc: "The chain jumps twice, forking two ways each time." },
      { name: "Live Wire", desc: "Two jumps, forking three ways each time." },
      { name: "Superconductor", desc: "Two strikes at once, each a three-way, two-jump tree." },
    ] },
    { id: "volt", name: "Voltage", tiers: [
      { name: "Spark", desc: "Harder bolts that reach further." },
      { name: "Arc Flash", desc: "Harder still, and further." },
      { name: "High Voltage", desc: "The hardest bolts, the longest reach." },
    ] },
    { id: "static", name: "Static", tiers: [
      { name: "Static", desc: "Every hit sparks a blast; what it catches takes more damage for a while." },
      { name: "Static Field", desc: "Bigger blasts, a stronger mark." },
      { name: "Thunderclap", desc: "The biggest blasts, the strongest mark." },
    ] },
  ],
};
const hasSkills = t => !!SKILL_TREES[t.kind];
const maxLvl = t => (hasSkills(t) ? 1 + SKILL_POINTS : MAX_LVL);
const skillOf = (t, id) => (t.skills && t.skills[id]) || 0;
// the level the TOWER'S LOOK shows (its rings, max-level spokes): a chart
// tower's 7 levels fold onto the 4 drawn ones
const shownLvl = t => (!hasSkills(t) ? t.lvl : t.lvl >= maxLvl(t) ? MAX_LVL : 1 + Math.floor((t.lvl - 1) / 2));

// ARC's numbers by tier (index 0 = untaken). Balance later (owner: ideas first).
const ARC_VOLT_DMG = [1, 1.5, 2.2, 3.2], ARC_VOLT_RANGE = [1, 1.15, 1.3, 1.45];
// Conductivity's shape by tier (owner): strikes (separate first targets),
// jumps, and forks per jump - 3, 7, 13, then 26 enemies at most
const ARC_COND = [{ s: 1, j: 1, f: 2 }, { s: 1, j: 2, f: 2 }, { s: 1, j: 2, f: 3 }, { s: 2, j: 2, f: 3 }];
const ARC_STATIC = [null, { r: 40, frac: 0.5, mul: 1.15 }, { r: 60, frac: 0.5, mul: 1.3 }, { r: 85, frac: 0.5, mul: 1.5 }];
// each jump hits ARC_FALL as hard and reaches ARC_SHRINK as far as the one before (owner)
const ARC_FALL = 0.6, ARC_SHRINK = 0.7, STATIC_MARK_T = 3;
function arcSkillStats(t, s, b) {
  const c = skillOf(t, "cond"), v = skillOf(t, "volt"), z = skillOf(t, "static");
  s.dmg = b.dmg * ARC_VOLT_DMG[v]; s.range = b.range * RANGE_BONUS * ARC_VOLT_RANGE[v];
  const sh = ARC_COND[c]; // Conductivity: strikes, jumps AND forks
  s.arcRange = s.range; s.targets = sh.s; s.layers = sh.j; s.branch = sh.f;
  s.arcFall = ARC_FALL; s.arcShrink = ARC_SHRINK; s.blast = ARC_STATIC[z]; s.skill = true;
}
// what the upgrade cards offer: the next tier of each axis not yet full
function skillOptions(t) {
  return SKILL_TREES[t.kind].filter(ax => skillOf(t, ax.id) < SKILL_TIERS).map(ax => {
    const n = skillOf(t, ax.id), tier = ax.tiers[n];
    return { choice: ax.id, name: ax.name + " " + roman(n + 1) + " · " + tier.name, desc: tier.desc };
  });
}
const withSkill = (t, id) => ({ ...t.skills, [id]: skillOf(t, id) + 1 });

// ---------- ARC's chart firing ----------
// A bolt is a TREE grown a generation per hop: the strike, then every hit
// forks st.branch ways, st.layers jumps deep. A bolt NEVER hits the same
// enemy twice (owner) - so it can never strike more enemies than are in
// reach - and each jump hits ARC_FALL as hard and reaches ARC_SHRINK as far.
// Static: every hit also BLASTS (st.blast) - damage around it and a mark
// (shred: x mul damage taken from every tower for STATIC_MARK_T s).
function fireSkillChain(t, st, e, seen) {
  if (seen && seen.has(e.id)) return; // a second strike never re-hits what the first took
  const col = TOWERS[t.kind].color, d = shotDamage(t, st, e, st.dmg);
  beam(t, e, col, CHAIN_BEAM_LIFE, 1.5, d);
  const root = { e, fx: fx[fx.length - 1], up: null, kids: new Set() };
  const c = { t, st, col, skill: true, seen: seen || new Set() }; // shared by the attack's strikes
  c.seen.add(e.id);
  skillHit(c, e, d);
  branchFrom(c, root, 1);
}
function skillHit(c, e, d) {
  damage(e, d, c.t, false, false, c.st); onHit(e, c.t, c.st, d);
  const b = c.st.blast;
  if (!b) return;
  ring(e.x, e.y, b.r, c.col, 0.35);
  for (const o of G.enemies) {
    if (o.dead || (o.x - e.x) ** 2 + (o.y - e.y) ** 2 > b.r * b.r) continue;
    if (o !== e) damage(o, d * b.frac, c.t, false, false, c.st);
    o.shredMul = Math.max(o.shredT > 0 ? o.shredMul : 1, b.mul); o.shredT = STATIC_MARK_T;
  }
}
// the nearest enemy this bolt has not hit yet, within this jump's (shrunk) reach
function skillHop(c, node, depth) {
  const from = node.e, r = c.st.arcRange * c.st.arcShrink ** (depth - 1);
  let nxt = null, nd = r * r;
  for (const o of G.enemies) {
    if (o.dead || c.seen.has(o.id)) continue;
    const d = (o.x - from.x) ** 2 + (o.y - from.y) ** 2;
    if (d < nd) { nd = d; nxt = o; }
  }
  return nxt;
}
function skillHopTo(c, node, nxt, depth) {
  const raw = c.st.dmg * c.st.arcFall ** depth, d = shotDamage(c.t, c.st, nxt, raw);
  node.kids.add(nxt.id); c.seen.add(nxt.id);
  beam(node.e, nxt, c.col, CHAIN_BEAM_LIFE, 1.5, d);
  fx[fx.length - 1].alpha = Math.min(1, raw / c.st.dmg); // as opaque as the share of the strike it carries
  const child = { e: nxt, fx: fx[fx.length - 1], up: node, kids: new Set() };
  keepLit(node, CHAIN_BEAM_LIFE);
  skillHit(c, nxt, d);
  return child;
}

// ---------- the chart (UI only; the upgrade cards draw it) ----------
// a triangle radar, an axis per corner, a ring per tier; the filled shape is
// what the tower has, the dashed one what this pick would make (owner: JoJo)
function skillChart(t, next) {
  const axes = SKILL_TREES[t.kind], R = 46, C = 60, pt = (i, k) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / axes.length, r = 8 + (R - 8) * k / SKILL_TIERS;
    return (C + Math.cos(a) * r).toFixed(1) + "," + (C + Math.sin(a) * r).toFixed(1);
  };
  const shape = sk => axes.map((ax, i) => pt(i, (sk && sk[ax.id]) || 0)).join(" ");
  let svg = '<svg class="asp-chart" viewBox="0 0 120 120">';
  for (let k = 1; k <= SKILL_TIERS; k++) svg += '<polygon class="grid" points="' + axes.map((_, i) => pt(i, k)).join(" ") + '"/>';
  axes.forEach((ax, i) => {
    svg += '<line class="grid" x1="' + C + '" y1="' + C + '" x2="' + pt(i, SKILL_TIERS).replace(",", '" y2="') + '"/>';
  });
  if (next) svg += '<polygon class="next" points="' + shape(next) + '"/>';
  svg += '<polygon class="now" points="' + shape(t.skills) + '"/>';
  axes.forEach((ax, i) => {
    const [x, y] = pt(i, SKILL_TIERS + 0.9).split(",");
    svg += '<text x="' + x + '" y="' + y + '">' + ax.name.slice(0, 4).toUpperCase() + " " + skillOf(t, ax.id) + "</text>";
  });
  return svg + "</svg>";
}
