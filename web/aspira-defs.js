// /aspira — tower defence on twelve spirals. Definitions: the path, towers, enemies,
// powers. Same-global-scope files, loaded in order:
// aspira-defs -> aspira-game -> aspira-draw -> aspira-ui. ARCHITECTURE.md §22.

// World is a fixed 1000x1000 chart; the camera (aspira-draw.js) fits it into
// whatever part of the full-screen canvas the decks leave open.
const W = 1000, CX = 500, CY = 500, CORE_R = 46;
const CANVAS_FONT = "'Iosevka Mayukai Monolite', monospace";

// Twelve spirals, one entering every 30 degrees around the rim. A FIXED
// layout, the same every game: lanes come in mirror pairs (2j, 2j+1) that wind
// in opposite directions with the same turn count, so each pair is symmetric
// about its own axis, and the six pairs climb from 3 full turns to 8 round the
// clock (PAIR_TURNS). Archimedean (even spacing) from R0 in to the core.
// R0 sits past the canvas corners (707 from centre), so every lane starts
// off-screen and enemies drift in from beyond the chart; RIM_R is the chart's
// graduated rim, where each lane's entry marker and numeral are drawn.
const N_PATHS = 12, R0 = 760, R1 = CORE_R, RIM_R = 482;
// Every tower stands inside the central disc. The spirals run through it to
// the core; towers and enemies never collide, so building on a lane is fine.
const BUILD_R = 190;
const PAIR_TURNS = [3, 4, 5, 6, 7, 8];
// An 8-turn lane is ~2.5x longer than a 3-turn one. Enemies on it move
// faster (pace = (len / shortest)^0.6) so it takes ~1.4x as long, not 2.5x.
const PACE_EXP = 0.6;
const PATHS = [];

// Stretch a point along axis `ax` by 1 + stretch * (r - R1) / (R0 - R1): full
// ellipse at the off-screen start, a circle at the core, so an elliptical lane
// still enters from beyond every edge and still ends on the core.
const ELLIPSE = 0.45;
function ellipse(x, y, r, ax, stretch) {
  const c = Math.cos(ax), sn = Math.sin(ax);
  const u = (x * c + y * sn) * (1 + stretch * (r - R1) / (R0 - R1)), v = -x * sn + y * c;
  return { x: CX + u * c - v * sn, y: CY + u * sn + v * c, s: 0 };
}

function buildSpiral(i) {
  const a0 = ((i + 0.5) / N_PATHS) * Math.PI * 2 - Math.PI / 2;
  const dir = i % 2 ? 1 : -1, turns = PAIR_TURNS[i >> 1], steps = 160 * turns + 240;
  // odd pairs are elliptical: stretched along the pair's own mirror axis, so
  // the pair stays symmetric; ax = that axis, stretch = 0 for round pairs
  const ax = (((i >> 1) * 2 + 1) / N_PATHS) * Math.PI * 2 - Math.PI / 2;
  const stretch = (i >> 1) % 2 ? ELLIPSE : 0;
  const pts = [];
  let prev = null, acc = 0;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, r = R0 - (R0 - R1) * t, a = a0 + dir * turns * Math.PI * 2 * t;
    const p = ellipse(r * Math.cos(a), r * Math.sin(a), r, ax, stretch);
    if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
    p.s = acc; pts.push(p); prev = p;
  }
  const rim = pts.find(p => Math.hypot(p.x - CX, p.y - CY) <= RIM_R);
  return { pts, len: acc, turns, pace: 1, rim, ellip: stretch > 0 };
}

for (let i = 0; i < N_PATHS; i++) PATHS.push(buildSpiral(i));
{
  const shortest = Math.min(...PATHS.map(p => p.len));
  for (const p of PATHS) p.pace = Math.pow(p.len / shortest, PACE_EXP);
}

// Background stars for the chart, symmetric like the lanes: one 60-degree
// wedge between two mirror axes is seeded (identical every load), then
// reflected and rotated by 120 degrees into all six wedges.
const STARS = (function starField() {
  let a = 20261001;
  const rand = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const axis = -Math.PI / 3, out = [];
  for (let n = 0; n < 190; n++) {
    const r = BUILD_R + 12 + Math.sqrt(rand()) * (1100 - BUILD_R - 12);
    const th = axis + rand() * Math.PI / 3, m = Math.pow(rand(), 3) * 2.2 + 0.5;
    for (const base of [th, 2 * axis - th]) {
      for (let k = 0; k < 3; k++) {
        const ang = base + k * Math.PI * 2 / 3;
        out.push({ x: CX + r * Math.cos(ang), y: CY + r * Math.sin(ang), m });
      }
    }
  }
  return out;
})();

function pathAt(pi, s) {
  const { pts, len } = PATHS[pi];
  if (s <= 0) return pts[0];
  if (s >= len) return pts[pts.length - 1];
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = (s - a.s) / (b.s - a.s || 1);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Colours are palette KEYS, resolved at boot from the hidden swatches in
// aspira.html (chrome.css tokens) — the canvas never carries a raw literal.
const COL = {};
function resolveColors() {
  for (const el of document.querySelectorAll("[data-asp-sw]")) {
    COL[el.dataset.aspSw] = getComputedStyle(el).color;
  }
}

const TOWERS = {
  rapid:   { name: "Rapid",   ab: "RPD", color: "cyan",   cost: 15,  dmg: 4,  rate: 6,    range: 220, blurb: "Cheap, quick, long reach.", up: "fire rate" },
  chain:   { name: "Chain",   ab: "CHN", color: "pink",   cost: 40,  dmg: 14, rate: 1.2,  range: 185, blurb: "Arcs to nearby enemies.", up: "extra arcs" },
  nuke:    { name: "Nuke",    ab: "NUK", color: "glow",   cost: 80,  dmg: 80, rate: 0.35, range: 265, blurb: "Huge hits, slow reload, can crit for triple.", up: "crit chance" },
  slower:  { name: "Slower",  ab: "SLW", color: "cyan",   cost: 50,  dmg: 0,  rate: 1.2,  range: 190, blurb: "Slows three enemies at once.", up: "slow strength" },
  pusher:  { name: "Pusher",  ab: "PSH", color: "green",  cost: 60,  dmg: 4,  rate: 0.5,  range: 175, blurb: "Knocks enemies back along the spiral.", up: "push distance" },
  stopper: { name: "Stopper", ab: "STP", color: "pink",   cost: 70,  dmg: 3,  rate: 0.45, range: 185, blurb: "Freezes one enemy in place.", up: "stun time" },
  reaper:  { name: "Reaper",  ab: "RPR", color: "glow",   cost: 120, dmg: 45, rate: 0.7,  range: 200, blurb: "Its kills may grant you a life.", up: "life chance" },
  gold:    { name: "Gold",    ab: "GLD", color: "orange", cost: 45,  dmg: 2,  rate: 0.9,  range: 190, blurb: "Marks enemies for a bigger bounty.", up: "bounty mark" },
};
const KINDS = Object.keys(TOWERS);
const MAX_LVL = 5;
const MODES = [["close", "Close"], ["hard", "Hard"], ["weak", "Weak"], ["fast", "Fast"]];

const ENEMIES = {
  norm:  { sides: 4, hp: 1,   speed: 80,  bounty: 1,   size: 13, color: "green" },
  fast:  { sides: 3, hp: 0.6, speed: 135, bounty: 0.8, size: 12, color: "orange" },
  hard:  { sides: 6, hp: 2.6, speed: 55,  bounty: 2,   size: 15, color: "pink" },
  bonus: { sides: 5, hp: 1.4, speed: 100, bounty: 3,   size: 14, color: "cyan", star: true },
  boss:  { sides: 8, hp: 14,  speed: 45,  bounty: 15,  size: 24, color: "glow" },
};

const POWERS = [
  ["SCR", "Score ×2"], ["RNG", "Range +30%"], ["MNY", "Bounty ×2"],
  ["DAM", "Damage +60%"], ["FRZ", "Freeze all"], ["BOM", "Blast all"],
];
const POWER_FULL = 30, POWER_TIME = 10;

function towerStats(t) {
  const b = TOWERS[t.kind], L = t.lvl - 1;
  const s = { dmg: b.dmg * Math.pow(1.4, L), rate: b.rate, range: b.range * (1 + 0.06 * L) };
  switch (t.kind) {
    case "rapid": s.rate = b.rate * (1 + 0.2 * L); break;
    case "chain": s.chains = 2 + L; break;
    case "nuke": s.crit = 0.1 + 0.08 * L; break;
    case "slower": s.slow = Math.min(0.8, 0.35 + 0.09 * L); s.targets = 3; break;
    case "pusher": s.push = 45 + 20 * L; break;
    case "stopper": s.stun = 0.6 + 0.3 * L; break;
    case "reaper": s.life = 0.04 + 0.02 * L; break;
    case "gold": s.mark = 2 + 0.5 * L; break;
  }
  if (G.power.RNG > 0) s.range *= 1.3;
  if (G.power.DAM > 0) s.dmg *= 1.6;
  return s;
}
const upCost = t => Math.round(TOWERS[t.kind].cost * (0.7 + 0.5 * t.lvl));
const sellValue = t => Math.floor(t.spent * 0.7);
