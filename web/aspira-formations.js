// /spire - enemy FORMATIONS (owner, 2026-10-11: "swarm has the jitter, fast uses these bird-like triangle patterns,
// armor ... a tight square lattice, shields continue to come in a line"). A formation is a SIDEWAYS offset across the
// lane (e.lat, world units, + = the lane's left) and a HEAD START along it; stepEnemies lays e.lat across the lane at
// its current heading (formOffset), shrinking it to nothing inside FORM_FADE_R of the core so a formation funnels in.
// Swarms keep their wander (e.jit) and shields their single file: neither has an entry here.
const FORM_FADE_R = 160;
// FAST: Vs of FAST_V birds - a leader, then pairs fanned back and out
const FAST_V = 5, FAST_V_LAT = 22, FAST_V_BACK = 26;
// ARMOR: one tight SQUARE lattice per lane copy, ARMOR_W abreast, rows ARMOR_PITCH apart - the same as the columns
const ARMOR_W = 3, ARMOR_PITCH = 36;
// THE ROLL (owner: "side axes should rotate about the center axis - speed rotates less, armor does not rotate"): a
// formation turns about its lane's centre line, one radian every FORM_ROLL[type] world units it travels - its side
// members sweep across the lane in 2D and over and under it in 3D (e.z, aspira-solids.js); no entry = it never rolls
const FORM_ROLL = { fast: 160 };
// the slots for a group of m: [lat, ahead] each
const FORMS = {
  fast: { group: () => FAST_V, slots: m => Array.from({ length: m }, (_, i) => {
    const d = Math.ceil(i / 2), side = i % 2 ? 1 : -1; // 0 the leader; 1, 2 the first pair; 3, 4 the next
    return [side * d * FAST_V_LAT, (Math.ceil((m - 1) / 2) - d) * FAST_V_BACK];
  }) },
  armor: { group: m => m, slots: m => {
    const rows = Math.ceil(m / ARMOR_W);
    return Array.from({ length: m }, (_, i) => {
      const r = Math.floor(i / ARMOR_W), inRow = Math.min(ARMOR_W, m - r * ARMOR_W), c = i % ARMOR_W; // a short last row stays centred
      return [(c - (inRow - 1) / 2) * ARMOR_PITCH, (rows - 1 - r) * ARMOR_PITCH];
    });
  } },
};
// a wave's count is a whole number of these (waveCount): every V full (FAST_V, odd: 2n+1), every lattice row full
const FORM_UNIT = { fast: FAST_V, armor: ARMOR_W };
// how many lane copies a wave of `count` splits onto, at most `want`: fast only into whole Vs, armor into whole
// lattice rows (the largest k <= want that divides its number of groups); everything else as asked
// (2026-10-11: one armor block on one lane made armor free - all 36 sim games won, armor 0 lives - so armor splits
// again, in WHOLE ROWS; ARMOR_ONE_BLOCK true brings the single block back. let: the simulator sweeps it)
let ARMOR_ONE_BLOCK = false;
function formSplit(type, count, want) {
  const unit = FORM_UNIT[type];
  if (!unit) return Math.min(count, want);
  if (type === "armor" && ARMOR_ONE_BLOCK) return 1;
  const groups = Math.max(1, Math.floor(count / unit));
  let k = Math.min(want, groups);
  while (k > 1 && groups % k) k--;
  return k;
}
// from stepSpawns: spawn the next formation of `type` from wave part w at once; returns how many it took (0: none)
function formSpawn(w, type) {
  const f = FORMS[type];
  if (!f) return 0;
  let m = 0;
  const left = w.list.length - w.idx + 1, cap = f.group(left);
  while (m < cap && w.idx - 1 + m < w.list.length && w.list[w.idx - 1 + m] === type) m++;
  const slots = f.slots(m);
  for (let i = 0; i < m; i++) {
    spawnEnemy(type, w.n, w.lanes[type], w.ang || 0);
    const e = G.enemies[G.enemies.length - 1];
    e.lat = slots[i][0]; e.ahead = slots[i][1]; e.s += e.ahead; // e.ahead: so the group rolls as ONE (formOffset)
  }
  w.idx += m - 1;
  return m;
}
// from stepEnemies: point p on the lane moved e.lat across it (toward the lane's left), faded in near the core
// s: where along the lane (the enemy itself by default; its tracer asks for points behind it - drawStarTrail)
function formOffset(e, p, s = e.s) {
  const q = pathAt(e.pi, s + 3, e.ang), tx = q.x - p.x, ty = q.y - p.y, L = Math.hypot(tx, ty);
  if (!L) return;
  const roll = FORM_ROLL[e.type], phi = roll ? (s - (e.ahead || 0)) / roll : 0; // the group's own travel: one phase for all
  const fade = Math.min(1, Math.hypot(p.x - CX, p.y - CY) / FORM_FADE_R), k = e.lat * Math.cos(phi) * fade / L;
  p.x += -ty * k; p.y += tx * k;
  if (s === e.s) e.z = roll ? e.lat * Math.sin(phi) * fade : 0; // the height of its roll (3D only)
}
