// /aspira — tower defence on a spiral. Definitions: the path, towers, enemies,
// powers. Same-global-scope files, loaded in order:
// aspira-defs -> aspira-game -> aspira-draw -> aspira-ui. ARCHITECTURE.md §22.

// World is a fixed 1000x1000 square; the canvas scales it to fit.
const W = 1000, CX = 500, CY = 500, R0 = 470, R1 = 62, TURNS = 2.6, CORE_R = 46;
const CANVAS_FONT = "'Iosevka Mayukai Monolite', monospace";

// Archimedean spiral from the rim (s = 0) to the core (s = PATHLEN), sampled
// densely enough that linear interpolation between samples is invisible.
const PATH = [];
let PATHLEN = 0;
(function buildPath() {
  const T = TURNS * Math.PI * 2;
  let prev = null, acc = 0;
  for (let t = 0; t <= T; t += 0.004) {
    const r = R0 - (R0 - R1) * t / T, a = t - Math.PI / 2;
    const p = { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a), s: 0 };
    if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
    p.s = acc; PATH.push(p); prev = p;
  }
  PATHLEN = acc;
})();

function pathAt(s) {
  if (s <= 0) return PATH[0];
  if (s >= PATHLEN) return PATH[PATH.length - 1];
  let lo = 0, hi = PATH.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PATH[m].s <= s) lo = m; else hi = m; }
  const a = PATH[lo], b = PATH[hi], f = (s - a.s) / (b.s - a.s || 1);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function distToPath(x, y) {
  let d = Infinity;
  for (let i = 0; i < PATH.length; i += 3) {
    const p = PATH[i], q = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (q < d) d = q;
  }
  return Math.sqrt(d);
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
  rapid:   { name: "Rapid",   ab: "RPD", color: "cyan",   cost: 15,  dmg: 4,  rate: 6,    range: 140, blurb: "Cheap, quick, long reach.", up: "fire rate" },
  chain:   { name: "Chain",   ab: "CHN", color: "pink",   cost: 40,  dmg: 14, rate: 1.2,  range: 115, blurb: "Arcs to nearby enemies.", up: "extra arcs" },
  nuke:    { name: "Nuke",    ab: "NUK", color: "glow",   cost: 80,  dmg: 80, rate: 0.35, range: 165, blurb: "Huge hits, slow reload, can crit for triple.", up: "crit chance" },
  slower:  { name: "Slower",  ab: "SLW", color: "cyan",   cost: 50,  dmg: 0,  rate: 1.2,  range: 120, blurb: "Slows three enemies at once.", up: "slow strength" },
  pusher:  { name: "Pusher",  ab: "PSH", color: "green",  cost: 60,  dmg: 4,  rate: 0.5,  range: 110, blurb: "Knocks enemies back along the spiral.", up: "push distance" },
  stopper: { name: "Stopper", ab: "STP", color: "pink",   cost: 70,  dmg: 3,  rate: 0.45, range: 115, blurb: "Freezes one enemy in place.", up: "stun time" },
  reaper:  { name: "Reaper",  ab: "RPR", color: "glow",   cost: 120, dmg: 45, rate: 0.7,  range: 125, blurb: "Its kills may grant you a life.", up: "life chance" },
  gold:    { name: "Gold",    ab: "GLD", color: "orange", cost: 45,  dmg: 2,  rate: 0.9,  range: 125, blurb: "Marks enemies for a bigger bounty.", up: "bounty mark" },
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
