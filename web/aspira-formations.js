// /spire - enemy FORMATIONS (owner, 2026-10-11: "swarm has the jitter, fast uses these bird-like triangle patterns,
// armor ... a tight square lattice, shields continue to come in a line"). A formation is a SIDEWAYS offset across the
// lane (e.lat, world units, + = the lane's left) and a HEAD START along it; stepEnemies lays it across the lane at its
// current heading (formOffset), the across part shrinking to nothing inside FORM_FADE_R of the core so it funnels in.
// Swarms keep their wander (e.jit): no entry here.
const FORM_FADE_R = 160;
// SHIELDS: Vs of V_N - a leader, then pairs fanned back and out (owner, 2026-10-11: "fast in lines, Vs for shields";
// fast flew the Vs for an afternoon and now come single file)
const V_N = 5, V_LAT = 24, V_BACK = 28;
// FAST: PAIRS side by side, FAST_PAIR apart, spinning about their midpoint (owner, 2026-10-11: "for fast, make them
// come in pairs and spin also"); each pair FAST_PAIR behind the one before - a square ladder (owner: "side by side
// distance equal to distance prev and next ... a little smaller"; was 30 across and ~114 between pairs)
const FAST_PAIR = 26;
// ARMOR: one tight SQUARE lattice per lane copy, ARMOR_W abreast, rows ARMOR_PITCH apart - the same as the columns
const ARMOR_W = 3, ARMOR_PITCH = 36;
// THE SPIN (owner, 2026-10-11: "rotate about the center unit's axis (spin around them)", then "don't make shields do
// the spinning, make armor do the spinning"): a formation turns FLAT on the board about its CENTRE - the lattice's
// middle, or the boss its escorts surround - one radian every FORM_SPIN[type] world units it travels; the members orbit
// it. No entry = it never spins (the shield Vs)
const FORM_SPIN = { fast: 160 }; // (armor spun for an hour: owner, "remove armor spin")
// the slots for a group of m: [lat, ahead] each
const FORMS = {
  fast: { group: () => 2, slots: m => (m === 2 ? [[-FAST_PAIR / 2, 0], [FAST_PAIR / 2, 0]] : [[0, 0]]) },
  shield: { group: () => V_N, slots: m => Array.from({ length: m }, (_, i) => {
    const d = Math.ceil(i / 2), side = i % 2 ? 1 : -1; // 0 the leader; 1, 2 the first pair; 3, 4 the next
    return [side * d * V_LAT, (Math.ceil((m - 1) / 2) - d) * V_BACK];
  }) },
  armor: { group: m => m, slots: m => {
    const rows = Math.ceil(m / ARMOR_W);
    return Array.from({ length: m }, (_, i) => {
      const r = Math.floor(i / ARMOR_W), inRow = Math.min(ARMOR_W, m - r * ARMOR_W), c = i % ARMOR_W; // a short last row stays centred
      return [(c - (inRow - 1) / 2) * ARMOR_PITCH, (rows - 1 - r) * ARMOR_PITCH];
    });
  } },
};
// a wave's count is a whole number of these (waveCount): every V full (V_N, odd: 2n+1). Armor is NOT rounded (owner,
// 2026-10-11: "having centered 1 or 2 armored in the back looks nice") - a short last row sits centred at the back
const FORM_UNIT = { shield: V_N, fast: 2 }, FORM_GROUP = { shield: V_N, armor: ARMOR_W, fast: 2 };
// how many lane copies a wave of `count` splits onto, at most `want`: shields only into whole Vs, armor into whole
// lattice rows (the largest k <= want that divides its number of groups); everything else as asked
// (2026-10-11: one armor block on one lane made armor free - all 36 sim games won, armor 0 lives - so armor splits
// again, in WHOLE ROWS; ARMOR_ONE_BLOCK true brings the single block back. let: the simulator sweeps it)
let ARMOR_ONE_BLOCK = false;
// HOW MANY LANES each type rides (owner, 2026-10-12: "swarm should always use 5-6 paths, fast 2-3, armor 1-3, shield
// 3-5"; was 1-6 for all): the wave's pick in the range, else the nearest in it that splits the groups evenly, else the
// pick with the odd groups dropped (laneCount rounds the count down to whole groups per lane)
const LANE_SPLIT = { swarm: [5, 6], fast: [2, 3], armor: [1, 3], shield: [3, 5] };
function formSplit(type, count, n) {
  if (type === "armor" && ARMOR_ONE_BLOCK) return 1;
  const [lo, hi] = LANE_SPLIT[type] || [1, 6], unit = FORM_GROUP[type] || 1, groups = Math.max(1, Math.floor(count / unit));
  const want = lo + Math.floor(fixedRand(n, 3) * (hi - lo + 1));
  for (let d = 0; d <= hi - lo; d++) for (const k of [want - d, want + d]) if (k >= lo && k <= hi && k <= groups && groups % k === 0) return k;
  return Math.min(want, groups);
}
const laneCount = (type, count, k) => { const unit = FORM_GROUP[type] || 1; return Math.floor(count / (k * unit)) * k * unit || count; };
// from stepSpawns: spawn the next formation of `type` from wave part w at once; returns how many it took (0: none)
function formSpawn(w, type) {
  const f = FORMS[type];
  if (!f) return 0;
  let m = 0;
  const left = w.list.length - w.idx + 1, cap = f.group(left);
  while (m < cap && w.idx - 1 + m < w.list.length && w.list[w.idx - 1 + m] === type) m++;
  const slots = f.slots(m), mid = slots.reduce((a, q) => a + q[1], 0) / m; // the centre it spins about: its middle row
  for (let i = 0; i < m; i++) {
    spawnEnemy(type, w.n, w.lanes[type], w.ang || 0);
    const e = G.enemies[G.enemies.length - 1];
    e.form = true; e.lat = slots[i][0]; e.ahead = slots[i][1]; e.aheadC = mid; e.s += e.ahead; // aheadC: the formation's centre
  }
  w.idx += m - 1;
  return m;
}
// from stepEnemies: p (the lane at s) moved to this member's place in its formation - its offset from the CENTRE UNIT
// (along the lane, and e.lat across it toward the lane's left) turned by the spin, the across part faded near the core.
// s: where along the lane (the enemy itself by default; its tracer asks for points behind it - drawStarTrail)
function formOffset(e, p, s = e.s) {
  const spin = FORM_SPIN[e.type], c = s - (e.ahead || 0) + (e.aheadC || 0), phi = spin ? c / spin : 0; // c: the centre unit's place - one phase for all
  const a0 = (e.ahead || 0) - (e.aheadC || 0), cs = Math.cos(phi), sn = Math.sin(phi);
  const along = a0 * cs - e.lat * sn, across = a0 * sn + e.lat * cs;
  const b = pathAt(e.pi, c + along, e.ang), q = pathAt(e.pi, c + along + 3, e.ang), tx = q.x - b.x, ty = q.y - b.y, L = Math.hypot(tx, ty) || 1;
  const k = across * Math.min(1, Math.hypot(b.x - CX, b.y - CY) / FORM_FADE_R) / L;
  p.x = b.x - ty * k; p.y = b.y + tx * k;
}
