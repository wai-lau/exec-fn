// /aspira — tower defence on twelve spirals. Definitions: the path, towers, enemies,
// powers. Same-global-scope files, loaded in order:
// aspira-defs -> aspira-game -> aspira-draw -> aspira-ui. ARCHITECTURE.md §22.

// World is a fixed 1000x1000 chart; the camera (aspira-draw.js) fits it into
// whatever part of the full-screen canvas the decks leave open.
const W = 1000, CX = 500, CY = 500, CORE_R = 22; // 25% smaller (owner, 2026-10-06; was 29 - itself 25% smaller than 34, then a little bigger)
const CANVAS_FONT = "'Iosevka Mayukai Monolite', monospace";

// Twelve spirals, one entering every 30 degrees around the rim. A FIXED
// layout, the same every game: lanes come in mirror pairs (2j, 2j+1) that wind
// in opposite directions with the same turn count, so each pair is symmetric
// about its own axis; each pair's turn count is its enemy TYPE's (PAIR_TURNS,
// solved for time under fire). Archimedean (even spacing) from R0 in to the core.
// R0 sits past the canvas corners (707 from centre), so every lane starts
// off-screen and enemies drift in from beyond the chart; RIM_R is the chart's
// graduated rim, where each lane's entry marker and numeral are drawn.
const N_PATHS = 12, R0 = 760, R1 = CORE_R, RIM_R = 482, GLOW_PATH_R = 330;
// Every tower stands inside the central disc. The spirals run through it to
// the core; towers and enemies never collide, so building on a lane is fine.
// Only SIX slots (owner, 2026-10-02): the ring of hexes around the core.
const CELL_S = 32, CELL_PITCH = 2;
// the corner slots: [angle (deg, screen: -90 = up), wave it opens]. Their
// INNER LIMIT is CORNER_IN from the core (owner: with every tower at max level
// slid fully in, a gap still shows between all of them): 171 leaves the same
// 13.6 gap to the innermost ring towers that ring neighbours have to each other
// (solved on the max-level hexes at TOWER_K 0.94; 145 with the smaller towers).
// They rest there, so they only slide OUT.
// they open TOP-LEFT first, then clockwise (owner, 2026-10-06; was upper right first)
// SIX towers only (owner, 2026-10-07): the three corner slots are gone - they were
// [[-150, 20], [-30, 40], [90, 60]] (angle, the wave whose boss opened it); the code
// that builds and opens them runs over an empty list, so nothing else changed
const CORNER_SLOTS = [], CORNER_IN = 171, TILE_R = CORNER_IN;
const BUILD_R = RIM_R - 6;
// the graticule spokes and the star field start out here (no longer tied to
// the build area, which now spans the whole chart)
const INNER_R = 220;

// The build disc is tessellated into pointy-top hexagons on a lattice whose
// centre hex IS the core, so the grid has the chart's six-fold symmetry.
// CELL_PITCH spreads the lattice (owner, 2026-10-02): centres sit twice as far
// apart as touching hexes would, so towers stand apart with open sky between.
// Only the core's six neighbours are built on (owner: "limit slots to only 6,
// the ring around center"); each tower fills exactly one cell. CELL_S = hex
// circumradius (= core radius).
const CELLS = (function buildCells() {
  const w = Math.sqrt(3) * CELL_S * CELL_PITCH, h = 1.5 * CELL_S * CELL_PITCH, out = [];
  const span = Math.ceil(BUILD_R / h) + 1;
  for (let r = -span; r <= span; r++) for (let q = -2 * span; q <= 2 * span; q++) {
    if (q === 0 && r === 0) continue; // the core
    const x = CX + w * (q + r / 2), y = CY + h * r;
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + k * Math.PI / 3;
      pts.push({ x: x + CELL_S * Math.cos(a), y: y + CELL_S * Math.sin(a) });
    }
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === 1) out.push({ pts, x, y });
  }
  // THREE MORE slots (owner, 2026-10-05) out of the core's CORNERS, a little way
  // past the ring, a TOP-HEAVY triangle: upper left, upper right, then straight
  // down (clockwise); each opens when the boss of its wave (20, 40, 60) falls, hidden till then
  CORNER_SLOTS.forEach(([deg, unlock]) => {
    const a = deg * Math.PI / 180, x = CX + Math.cos(a) * TILE_R, y = CY + Math.sin(a) * TILE_R, pts = [];
    for (let k = 0; k < 6; k++) { const b = Math.PI / 6 + k * Math.PI / 3; pts.push({ x: x + CELL_S * Math.cos(b), y: y + CELL_S * Math.sin(b) }); }
    out.push({ pts, x, y, unlock, minR: CORNER_IN });
  });
  return out;
})();
// a slot is OPEN once the boss of its unlock wave is down (bossKilled sets
// G.opened); the six ring slots always are
const cellOpen = ci => ci >= 0 && (!CELLS[ci].unlock || !!(typeof G !== "undefined" && G && G.opened && G.opened[ci]));
const openCells = () => CELLS.filter((c, i) => cellOpen(i)).length;

// Centre-to-centre distance between neighbouring cells: one "tile".
const TILE = Math.sqrt(3) * CELL_S * CELL_PITCH;
function occupied(ci) { return G.towers.some(t => t.cell === ci); }

// Placement snaps to the lattice: the cell under the point, else the nearest
// cell centre within one tile (a tap just outside the grid still lands).
function snapCell(x, y) {
  const ci = cellAt(x, y);
  if (cellOpen(ci)) return ci;
  let best = -1, bd = TILE;
  CELLS.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (cellOpen(i) && d < bd) { bd = d; best = i; } });
  return best;
}

function cellAt(x, y) {
  // inside a convex cell = on the same side of every edge
  return CELLS.findIndex(({ pts }) => pts.every((p, k) => {
    const q = pts[(k + 1) % pts.length];
    return (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x) >= 0;
  }));
}
// ONE SPEED, ONE SPIRAL PER TYPE (owner, 2026-10-08): every enemy moves at ENEMY_BASE_SPEED and its TYPE picks
// its spiral pair (TYPE_PAIR, aspira-waves.js) - fast takes the most direct one. Each pair's turns were SOLVED so
// the type keeps the TIME UNDER FIRE (inside FIRE_R of the core) it had at its old speed, averaged over its old
// lanes: fast 9.3 s, swarm 10, boss 27.3, shield 33.4, armor 41.7 - with at least 1.5 turns under fire on every
// lane (fast exactly 1.5; that set the speed). Pairs: 0 fast, 1 boss, 2 swarm, 3 shield, 4 armor, 5 spare (as 3).
// Was [3, 4, 5, 6, 7, 8] with each type riding a different lane every wave at its own speed.
const PAIR_TURNS = [1.9, 5.86, 2.06, 7.22, 8.78, 7.22], FIRE_R = 250;
// Winding is driven by the lane's PITCH (its angle off straight-in), not by
// angle-vs-t: theta(t) = turns * 2pi * F(t) / F(1) with F' = t^TANGENT_Q / r(t).
// The pitch then grows smoothly from 0 (tan pitch ~ t^q), so the lane leaves
// its straight lead-in with no hook, and the 1/r term packs the coils tighter
// toward the core. (An earlier angle = t^2.2 hooked ~50 deg right after the
// lead-in: at r ~ 700 even a slow angle rate is a big sideways speed.)
const TANGENT_Q = 2;
// ... softened (owner: lanes got too dense near the core): the winding rate
// uses 1 / (r + LANE_SOFT_R), so the same turns spread outward instead of
// packing into the last few dozen units around the core
const LANE_SOFT_R = 200;
// pace 1 on every lane (owner, 2026-10-08: one speed for all; was (len / shortest)^0.6, a long lane ridden faster)
const PACE_EXP = 0;
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
  const dir = i % 2 ? 1 : -1, turns = PAIR_TURNS[i >> 1], steps = Math.round(160 * turns) + 240; // (rounded: turns may be fractional)
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
  const F = [0];
  for (let k = 1; k <= steps; k++) {
    const tm = (k - 0.5) / steps, rm = R0 - (R0 - rEnd) * tm;
    F.push(F[k - 1] + Math.pow(tm, TANGENT_Q) / (rm + LANE_SOFT_R));
  }
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, r = R0 - (R0 - rEnd) * t, a = a0 + dir * turns * Math.PI * 2 * F[k] / F[steps];
    const p = ellipse(r * Math.cos(a), r * Math.sin(a), ax, stretch);
    if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
    if (k === 0) lead = acc;
    p.s = acc; pts.push(p); prev = p;
  }
  const rim = pts.find(p => Math.hypot(p.x - CX, p.y - CY) <= RIM_R);
  // the lane never changes, so its stroke path is built once (drawLanes)
  const p2d = new Path2D();
  pts.forEach((p, k) => (k ? p2d.lineTo(p.x, p.y) : p2d.moveTo(p.x, p.y)));
  // the lane's INNER part only, for the wide glow stroke: its fade is so steep
  // it is invisible past GLOW_PATH_R, and stroking the whole spiral at 32 wide
  // was the costliest draw of a late-game frame (profiled 2026-10-05)
  const glow2d = new Path2D();
  let on = false;
  for (const p of pts) {
    if (Math.hypot(p.x - CX, p.y - CY) > GLOW_PATH_R) { on = false; continue; }
    if (on) glow2d.lineTo(p.x, p.y); else { glow2d.moveTo(p.x, p.y); on = true; }
  }
  // every other point, for the LIT lane lines rebuilt during play (half the
  // stroking; the spiral is smooth enough that it does not show)
  const lit2d = new Path2D();
  pts.forEach((p, k) => { if (k === 0) lit2d.moveTo(p.x, p.y); else if (k % 2 === 0 || k === pts.length - 1) lit2d.lineTo(p.x, p.y); });
  // the DRAWN lane runs on into the core's centre, so it ends UNDER the core, not at its rim (owner, 2026-10-09: "lane
  // highlights need to end under core, not just near it") - the path the enemies walk still ends at R1
  for (const d of [p2d, glow2d, lit2d]) d.lineTo(CX, CY);
  return { pts, len: acc, lead, turns, pace: 1, rim, ellip: stretch > 0, p2d, glow2d, lit2d };
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
    const r = INNER_R + Math.sqrt(rand()) * (1100 - INNER_R);
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

// ang: the lane is a COPY rotated by `ang` radians about the core (owner:
// a split wave rides k identical copies of its lane, 360/k degrees apart)
function pathAt(pi, s, ang = 0) {
  const { pts, len } = PATHS[pi];
  let p;
  if (s <= 0) p = pts[0];
  else if (s >= len) p = pts[pts.length - 1];
  else {
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s <= s) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi], f = (s - a.s) / (b.s - a.s || 1);
    p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
  return ang ? rotAbout(p, ang) : p;
}
function rotAbout(p, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), dx = p.x - CX, dy = p.y - CY;
  return { x: CX + dx * c - dy * s, y: CY + dx * s + dy * c };
}

// Colours are palette KEYS, resolved at boot from the hidden swatches in
// aspira.html (chrome.css tokens) — the canvas never carries a raw literal.
const COL = {};
function resolveColors() {
  for (const el of document.querySelectorAll("[data-asp-sw]")) {
    COL[el.dataset.aspSw] = getComputedStyle(el).color;
  }
}

// Rates are per REAL second at 1x speed (time was rescaled so 1x = real time;
// every rate x3 and every duration /3 against the old hidden-3x values).
// FRZ and ACD x1.5 damage, x1.2 range (owner, 2026-10-02: lift the two
// towers the build search never picked): FRZ 1.5 -> 7.5 (x5: it barely hurt) / 133 -> 160, ACD 8 -> 12 / 160 -> 192,
// then ACD again (still unpicked): 12 -> 18 burn, 192 -> 230 range
// SOL nerfed by RANGE instead (owner 2026-10-02): 318 -> 239 (x0.75), damage back to 110
// ARC damage 28 -> 34 (x1.2, owner 2026-10-02: half the enemies left it fewer arc targets) -> 42
// SOL damage 110 -> 140, range 239 -> 287 (owner: ARC and SOL were the weakest late)
// RANGES HALVED (owner, 2026-10-06: "halve all tower ranges, not their effects nor reach"):
// ARC 173.4 -> 86.7, FRZ 176 -> 88, SOL 350 -> 175, ACD 230 -> 115. Effects keep their
// absolute size (ARC's jumps ARC_JUMP_BASE, Static rings, SOL's cone, ACD puddles, the
// moons' orbit); FRZ's aura IS its range, so it halves with it.
// ids = display names (owner, 2026-10-06): arc = ARC, frz = FRZ, sol = SOL (was RAY),
// acd = ACD; older comments still call them chain/slower/reaper/acid (CHN/SLW/RPR)
// each `blurb` (the build card's tagline) is FLAVOUR, short, not a spec (owner, 2026-10-09: "descriptions should be more
// flavourful and short, no need to be super accurate"; the lines are the owner's own; were plain how-it-works lines,
// 2026-10-07); the "good vs" line above it on the card stays
// ONE SCALE (owner, 2026-10-08): every damage, HP and armor number was HALVED in the game itself
// (tower dmg, the HP curve, armor, Breach), so the smallest number shown (Breach I, -1 armor) is 1
// and what the player reads is the real value, rounded DOWN. Hit flashes and beam widths are
// sized by VIS_DMG x the damage, so they look as they did before the halving.
const VIS_DMG = 2;
const dmgUnits = v => Math.floor(v);
// ONE BLINK for everything that blinks (owner, 2026-10-08): CSS --asp-blink (aspira.css) is the same 0.7s.
// blinkWave(): 1 bright .. 0 dim, in phase with the CSS (its 0% is the bright end; syncBlinks pins it to t = 0)
const BLINK_S = 0.7;
const blinkWave = () => 0.5 + 0.5 * Math.cos(2 * Math.PI * performance.now() / 1000 / BLINK_S);
const TOWERS = {
  arc:     { name: "Arc",     ab: "ARC", color: "orange",   cost: 40,  dmg: 48, rate: 1.5, /* 2026-10-08: every damage / HP / armor HALVED (owner, the display unit made real; was 96).  2026-10-06: was 42, then 48 (late), now 96 - a shot lands for half as long with the range halved (owner, 2026-10-06), so it hits twice as hard */  range: 130 /* owner 2026-10-06: 1.5x the halved 86.7, which felt too small */, blurb: "Positively shocking!", up: "extra arcs" },
  frz:     { name: "Freeze",  ab: "FRZ", color: "cyan",   cost: 40,  dmg: 15, rate: 2.4, /* 2026-10-08: halved (was 30).  early-game balance 2026-10-06: was 2.5, then 5, then 12; 30 - the aura TICK is FRZ's own damage and pops a swarm (the Empress' children) the halved aura would otherwise miss */  range: 88,  blurb: "Negative kinetic energy.", up: "slow strength" },
  sol:     { name: "Sol",      ab: "SOL", color: "pink",   cost: 40,  dmg: 110, /* 2026-10-08: halved (was 220).  2026-10-07: x1.3 (was 170) - armor now bites SOL (owner); solarmor.mjs: 170 piercing dealt 1.10M, unpierced x1.25 1.05M, x1.5 1.39M */  rate: 1, /* 2026-10-06: slower, harder shots (was 140 / 1.35) - an armor and boss specialist, not a swarm answer; 170 with every Focus beam a FULL hit (4 x 170 is about the old 7 shared beams); range 200 (was 175): the fast waves 14 / 18 outran the halved range */  range: 260 /* owner 2026-10-06: 200 still felt too small (was 350, halved) */, blurb: "Concentrated sun.", up: "crit chance" },
  // dmg = damage per SECOND at x1; rate = ticks per second (owner: a DoT line)
  acd:     { name: "Acid",    ab: "ACD", color: "chatsubo", cost: 40,  dmg: 23,  rate: 4, /* 2026-10-08: halved (was 46).  early-game balance 2026-10-06: was 18, then 26; 46 with the range halved (and a faster base ramp, ACD_DOUBLE) */    range: 115, blurb: "Definitely not basic.", up: "burn" },
};
// which enemies each tower is GOOD AGAINST (owner), on its build card
const GOOD_VS = { arc: "swarms", frz: "fast, shields", sol: "armor, bosses", acd: "shields, bosses" };
const KINDS = Object.keys(TOWERS);
const MAX_LVL = 4;
const RANGE_BONUS = 1.035; // +15% across the board (owner, 2026-10-06; was 0.9) // 75% of the old 1.2 (owner, 2026-10-04: towers move now; a halving to 0.6 was meant as 75%)
// targeting (owner, 2026-10-03): Fresh = no debuffs yet, Biggest = most HP,
// Near = nearest the core (aspira-game.js MODE_KEY; the key stays "close", the
// label is Near so it does not read as "close this card" - owner)
// (Tagged - taking extra damage right now - came and went on 2026-10-07, owner)
const MODES = [["fresh", "Fresh"], ["biggest", "Biggest"], ["close", "Near"]];

// Each special enemy had ONE counter tower: swarm -> CHN, fast -> SLW,
// armor -> RPR; shield's counter was RPD, removed (owner: three towers only).
// shield = hits absorbed (any size) before the
// enemy takes damage; armor = flat damage removed from every hit (floor 10%).
// Both scale with the wave number in spawnEnemy.
// DICE (owner, 2026-10-09: "fast -> d4, swarm -> d6, armor -> d8, shield -> d10, boss -> d20"): each enemy is its die
// seen from above - the outline here, the facet lines in dieFacets (aspira-enemies.js).
// (was) SHAPE SHOWS SPEED (owner): triangle = fastest, more sides = slower, and the
// hexagon is reserved for the towers (bosses were removed). Swarms read by size + count;
// shield shows as concentric outlines, armor as a thick outline (drawEnemy).
// speeds (owner, 2026-10-02): fast doubled to 270, then eased to 220; shield and armor halved to
// 37.5 and 30
// every type's speed (x ENEMY_SPEED 1.5 = 114 units/s): fast's lane at exactly 1.5 turns under fire for its 9.3 s
const ENEMY_BASE_SPEED = 76;
const ENEMIES = {
  fast:   { sides: 3 /* d4 */, hp: 0.87, speed: ENEMY_BASE_SPEED * 1.5, /* 2026-10-08 (owner): the one exception to ONE SPEED - fast is 1.5x, its HP x2/3 to match the 2/3 time under fire (6.2 s; was 1.3 HP at the shared speed, 135 before that) */ /* 2026-10-08 (owner): just a bit faster than swarm (125), with a bit more HP (was 1.0 / 150) - SOL's slow heavy shot catches them.  2026-10-07: 187 -> 150 with x2 bodies (TYPE_COUNT_MUL): the top late leaker; still faster than swarm (125). 2026-10-06: 220 -> 187 */ bounty: 0.8, size: 12, color: "green" }, // owner 2026-10-02: hp 0.6 -> 1.0; green (was orange)
  // swarms: twice as many again and faster (owner, 2026-10-02: 95 -> 125), the
  // bounty halved so a swarm wave pays what it did
  swarm:  { sides: 6 /* d6 (was 4) */, hp: 0.14, speed: ENEMY_BASE_SPEED, /* was 125 */ bounty: 0.18, size: 6, color: "white" },
  shield: { sides: 5, pointy: 0.78 /* d10: ten corners, five of them a little in (was a plain pentagon) */, hp: 0.6,  speed: ENEMY_BASE_SPEED, /* was 37.5 */ bounty: 1.6, size: 13, color: "cyan", shield: 8 }, // owner 2026-10-02: less HP (0.9), more shield (5)
  armor:  { sides: 4 /* d8 (was 7) */, hp: 1.0,  speed: ENEMY_BASE_SPEED, /* was 30 */ bounty: 2,   size: 15, color: "pink", armor: 12 }, // 2026-10-08: halved with all damage / HP (was 24) // owner: 6 -> 15; 2026-10-02 less HP (1.6), more armor (15)
  // the rare BOSS (owner, 2026-10-02): every 10th wave, ALONE; an octagon,
  // x5 HP, x2 size, half speed (100 -> 50), and letting it through costs 10 lives. `star` still marks
  // it as the bonus (lane, tracer, drop); `pointy` would draw a star shape.
  // cyan, so it reads RED on the inverted sky it brings (owner)
  bonus: { sides: 10 /* d20 (was 8) */, hp: 3.5, speed: ENEMY_BASE_SPEED, /* was 50 */ bounty: 3,   size: 28, color: "cyan", star: true, leak: 10 }, // owner 2026-10-02: yellow = Marigold (was cyan)
};

const POWERS = [
  ["SCR", "Score ×2"], ["RNG", "Range +30%"], ["MNY", "Bounty ×2"],
  ["DAM", "Damage +60%"], ["FRZ", "Freeze all"], ["BOM", "Blast all"],
];
const POWER_FULL = 30, POWER_TIME = 10 / 3;

// Towers have four levels (L1-L4, matching the UI). Each table holds one
// value per level; L2 brings the path choice, L3 the final form, L4 the super
// form. (These are the old 15-level curves sampled at levels 1/5/10/15, so the
// balance is unchanged by the condensing.)
const LVL_DMG = [1, 1.874, 4.108, 9.007];
const LVL_RANGE = [1, 1.12, 1.27, 1.42];
const LVL_ARC_DMG = [1, 1.4, 2, 2.8], LVL_ARC_RANGE = [1, 1.1, 1.2, 1.3];
// (the rule "two L1 SOLs must clear wave 1" was dropped, owner 2026-10-06: SOL
// is no longer a swarm answer; its rate fell to 1, its shot rose to 189)
const LVL_SOL_RATE = [1, 1, 1, 1];
const LVL_SOL_CRIT = [0.1, 0.16, 0.235, 0.31];
const LVL_SLOW = [0.4, 0.45, 0.5, 0.55], FRZ_SLOW_MUL = 0.8; // owner: starts at 40%, grows modestly; capped at 0.85 in towerStats
// cost to go from level i+1 to i+2, as a multiple of the tower's build cost;
// the first upgrade HALVED (owner, 2026-10-05; was 5.9)
const STEP_COST = [2.95, 15.25, 24];

// Base stats come from the level tables; the chosen path's mods and then the
// final form's mods (aspira-upgrades.js) stack on top. A Spotter in range
// adds its aura; noAura stops the aura lookup recursing into other towers.
function towerStats(t, noAura = false) {
  const b = TOWERS[t.kind], i = t.lvl - 1;
  // RANGE_BONUS: every tower reaches 0.9x its table value (owner: 75% of the old 1.2, 2026-10-04)
  const s = {
    dmg: b.dmg * LVL_DMG[i], rate: b.rate, range: b.range * RANGE_BONUS * LVL_RANGE[i],
    targets: 1, critMul: 3, arcRange: 50, arcFall: 0.8,
    slide: 1, speed: 1, // x the slide extent / slide speed (aspira-towers.js; a chart tier may raise them)
  };
  switch (t.kind) {
    // arc reach = the tower's own range (owner: tripled from half the old range),
    // measured from each arc's parent enemy
    // ARC levels up MODESTLY (owner, option A): the L2 path brings the big change
    // ARC runs on its SKILL CHART now (aspira-skills.js; owner 2026-10-05)
    case "arc": arcSkillStats(t, s, b); break;
    // SOL levels up MODESTLY like ARC and ACD (owner): the L2 path brings the change
    case "sol":
      if (hasSkills(t)) { solSkillStats(t, s, b); break; } // SOL's chart (aspira-skills.js)
      s.dmg = b.dmg * LVL_ARC_DMG[i]; s.range = b.range * RANGE_BONUS * LVL_ARC_RANGE[i];
      s.crit = LVL_SOL_CRIT[i]; s.rate = b.rate * LVL_SOL_RATE[i]; break;
    case "frz": if (hasSkills(t)) { frzSkillStats(t, s, b); break; } s.slow = LVL_SLOW[i]; s.targets = 3; break; // owner: 3 rays by default (2026-10-04; was 1 since 2026-10-02)
    // ACD levels up MODESTLY like ARC (owner): the L2 path brings the big change
    case "acd":
      if (hasSkills(t)) { acdSkillStats(t, s, b); break; } // ACD's chart (aspira-skills.js)
      s.dmg = b.dmg * LVL_ARC_DMG[i]; s.range = b.range * RANGE_BONUS * LVL_ARC_RANGE[i];
      s.double = ACD_BASE_DOUBLE; s.cap = ACD_BASE_MAX; s.plagueR = 0; break;
  }
  if (t.path != null) {
    const p = UPGRADES[t.kind][t.path];
    applyMods(s, p.mods);
    if (t.form != null) {
      const fm = p.finals[t.form].mods;
      const fin = p.finals[t.form];
      // L4: the form's own on-theme super on top of it, else the generic boost
      if (t.lvl >= MAX_LVL && fin.super) { applyMods(s, fm); applyMods(s, fin.super.mods); }
      else applyMods(s, t.lvl >= MAX_LVL ? superMods(fm) : fm);
    }
  }
  // every FRZ slow 20% weaker (owner, 2026-10-02) - base, Stasis, Permafrost,
  // Ice Age, Frostbite alike; Deep Freeze's 95% near-freeze is kept as is
  if (s.slow) s.slow = Math.min(0.85, s.slow * FRZ_SLOW_MUL);
  if (hasSkills(t)) skillMove(t, s); // a chart tier's range / slide / speed (aspira-skills.js)
  if (!noAura) {
    for (const u of G.towers) {
      if (u === t) continue;
      const us = towerStats(u, true);
      // the old Spotter's damage aura - NOT a chart FRZ, whose `aura` is its SLOW
      // (that clash cut every tower inside a FRZ to a third of its damage, 2026-10-06)
      if (us.aura && !us.skill && Math.hypot(u.x - t.x, u.y - t.y) <= us.range) s.dmg *= us.aura;
    }
  }
  if (typeof relayMul === "function") { const m = relayMul(t); if (m > 1) relayStats(s, t.kind, m); } // the core's Orbital Relay: the tower as three (aspira-core.js)
  if (G.power.RNG > 0) s.range *= 1.3;
  if (G.power.DAM > 0) s.dmg *= 1.6;
  return s;
}
const upCost = t => Math.round(TOWERS[t.kind].cost * (hasSkills(t) ? SKILL_STEP_COST : STEP_COST)[t.lvl - 1]); // chart towers: six small steps
// each tower's default targeting, its natural job (owner, 2026-10-03): ARC
// starts its tree on whatever is nearest the core, FRZ slows what nothing has
// touched yet (Fresh), SOL saves its big hit for the most HP, ACD holds its
// ramping burn on the longest-lived (Biggest)
const DEFAULT_MODE = { arc: "close", frz: "fresh", sol: "biggest", acd: "biggest" };
// each new tower costs 1.5x the last (owner, 2026-10-04; was 2x): 40, 60, 90, 135, 203, 304
const towerCost = k => Math.round(TOWERS[k].cost * Math.pow(1.5, G.towers.length));
const sellValue = t => Math.floor(t.spent * 0.7);
