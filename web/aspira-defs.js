// /aspira — tower defence on twelve spirals. Definitions: the path, towers, enemies,
// powers. Same-global-scope files, loaded in order:
// aspira-defs -> aspira-game -> aspira-draw -> aspira-ui. ARCHITECTURE.md §22.

// World is a fixed 1000x1000 chart; the camera (aspira-draw.js) fits it into
// whatever part of the full-screen canvas the decks leave open.
const W = 1000, CX = 500, CY = 500, CORE_R = 34;
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
// Towers build on BUILD_RINGS hex rings around the core; BUILD_R is the
// outer edge of the last ring (its farthest corner), which the stars and the
// graticule keep clear of.
const CELL_S = 32, BUILD_RINGS = 4;
const BUILD_R = Math.ceil(BUILD_RINGS * Math.sqrt(3) * CELL_S + CELL_S);

// The build disc is tessellated into pointy-top hexagons on a lattice whose
// centre hex IS the core, so the grid has the chart's six-fold symmetry.
// BUILD_RINGS rings around it (6 + 12 + 18 + 24 = 60 cells at 4); each
// tower fills exactly one cell. CELL_S = hex circumradius (= core radius).
const CELLS = (function buildCells() {
  const w = Math.sqrt(3) * CELL_S, out = [];
  for (let r = -4; r <= 4; r++) for (let q = -4; q <= 4; q++) {
    if (q === 0 && r === 0) continue; // the core
    const x = CX + w * (q + r / 2), y = CY + 1.5 * CELL_S * r;
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + k * Math.PI / 3;
      pts.push({ x: x + CELL_S * Math.cos(a), y: y + CELL_S * Math.sin(a) });
    }
    // axial hex distance from the core = which ring the cell is on
    if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 <= BUILD_RINGS) out.push({ pts, x, y });
  }
  return out;
})();

// Centre-to-centre distance between neighbouring cells: one "tile".
const TILE = Math.sqrt(3) * CELL_S;

// Placement snaps to the lattice: the cell under the point, else the nearest
// cell centre within one tile (a tap just outside the grid still lands).
function snapCell(x, y) {
  const ci = cellAt(x, y);
  if (ci >= 0) return ci;
  let best = -1, bd = TILE;
  CELLS.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = i; } });
  return best;
}

function cellAt(x, y) {
  // inside a convex cell = on the same side of every edge
  return CELLS.findIndex(({ pts }) => pts.every((p, k) => {
    const q = pts[(k + 1) % pts.length];
    return (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x) >= 0;
  }));
}
const PAIR_TURNS = [3, 4, 5, 6, 7, 8];
// Winding density rises toward the core: angle = turns * 2pi * t^SPIRAL_P.
const SPIRAL_P = 2.2;
// An 8-turn lane is ~2.5x longer than a 3-turn one. Enemies on it move
// faster (pace = (len / shortest)^0.6) so it takes ~1.4x as long, not 2.5x.
const PACE_EXP = 0.6;
// Straight radial lead-in from LEAD_R to R0 ahead of every spiral, so on a
// wide screen a lane never visibly BEGINS in open space. The spiral leaves R0
// pointing straight outward (angle ~ t^2.2), so the join has no kink.
const LEAD_R = 2400;
const PATHS = [];

// Stretch a point along axis `ax` by a CONSTANT 1 + stretch, so an elliptical
// lane keeps its shape all the way in (owner: it must not round off). To still
// end on the core, an elliptical lane spirals in to R1 / (1 + stretch): even
// its stretched end point lands inside the core.
const ELLIPSE = 0.7;
function ellipse(x, y, ax, stretch) {
  const c = Math.cos(ax), sn = Math.sin(ax);
  const u = (x * c + y * sn) * (1 + stretch), v = -x * sn + y * c;
  return { x: CX + u * c - v * sn, y: CY + u * sn + v * c, s: 0 };
}

function buildSpiral(i) {
  const a0 = ((i + 0.5) / N_PATHS) * Math.PI * 2 - Math.PI / 2;
  const dir = i % 2 ? 1 : -1, turns = PAIR_TURNS[i >> 1], steps = 160 * turns + 240;
  // odd pairs are elliptical: stretched along the pair's own mirror axis, so
  // the pair stays symmetric; ax = that axis, stretch = 0 for round pairs
  const ax = (((i >> 1) * 2 + 1) / N_PATHS) * Math.PI * 2 - Math.PI / 2;
  const stretch = (i >> 1) % 2 ? ELLIPSE : 0, rEnd = R1 / (1 + stretch);
  const pts = [];
  let prev = null, acc = 0;
  for (let k = 0; k < 40; k++) {
    const r = LEAD_R - (LEAD_R - R0) * k / 40;
    const p = ellipse(r * Math.cos(a0), r * Math.sin(a0), ax, stretch);
    if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
    p.s = acc; pts.push(p); prev = p;
  }
  let lead = 0;
  for (let k = 0; k <= steps; k++) {
    // angle grows as t^SPIRAL_P: almost straight in from far out, winding
    // tighter toward the core, but a finite total (no orbiting forever)
    const t = k / steps, r = R0 - (R0 - rEnd) * t, a = a0 + dir * turns * Math.PI * 2 * Math.pow(t, SPIRAL_P);
    const p = ellipse(r * Math.cos(a), r * Math.sin(a), ax, stretch);
    if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
    if (k === 0) lead = acc;
    p.s = acc; pts.push(p); prev = p;
  }
  const rim = pts.find(p => Math.hypot(p.x - CX, p.y - CY) <= RIM_R);
  // the lane never changes, so its stroke path is built once (drawLanes)
  const p2d = new Path2D();
  pts.forEach((p, k) => (k ? p2d.lineTo(p.x, p.y) : p2d.moveTo(p.x, p.y)));
  return { pts, len: acc, lead, turns, pace: 1, rim, ellip: stretch > 0, p2d };
}

for (let i = 0; i < N_PATHS; i++) PATHS.push(buildSpiral(i));
{
  // pace from the spiral alone: the lead-in is the same length for every lane
  const spiralLen = p => p.len - p.lead, shortest = Math.min(...PATHS.map(spiralLen));
  for (const p of PATHS) p.pace = Math.pow(spiralLen(p) / shortest, PACE_EXP);
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
const RANGE_BONUS = 1.2;
const MODES = [["close", "Close"], ["hard", "Hard"], ["weak", "Weak"], ["fast", "Fast"]];

const ENEMIES = {
  norm:  { sides: 4, hp: 1,   speed: 80,  bounty: 1,   size: 13, color: "green" },
  fast:  { sides: 3, hp: 0.6, speed: 135, bounty: 0.8, size: 12, color: "orange" },
  hard:  { sides: 7, hp: 2.6, speed: 55,  bounty: 2,   size: 15, color: "pink" },
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
  // RANGE_BONUS: every tower reaches 20% further than its table value (owner)
  const s = { dmg: b.dmg * Math.pow(1.4, L), rate: b.rate, range: b.range * RANGE_BONUS * (1 + 0.06 * L) };
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
