// /aspira — the WAVES: which enemy type each wave is, how many, how it is split
// over rotated copies of its lane, the timer that sends it, and the lane
// bookkeeping the lane drawing reads. Split out of aspira-game.js (500-line
// cap); same global scope, loaded right after it (the simulator loads it too).

// ---------- waves ----------
// Waves go on a FIXED TIMER (owner, 2026-10-02), fast enough that 2+ waves are
// usually on screen, and still at once whenever the field clears.
const WAVE_TIMER = 16; // owner: 10 -> 13 -> 16s to thin the field
// clear = nothing ALIVE on the board (ghosts of the dead may still be drifting in)
// the boss (the star) is alive or still queued to spawn
const bossUp = () => G.enemies.some(e => !e.dead && ENEMIES[e.type].star) ||
  G.spawns.some(w => w.list.slice(w.idx).some(t => ENEMIES[t].star));
const waveClear = () => !G.enemies.some(e => !e.dead) && G.spawns.length === 0;
// ONE enemy type per wave (owner, 2026-10-02, back from the 1-5 type mix):
// a random unlocked type, never the same as the wave before. Types unlock in
// order: swarm w1, shield w2, armor w3, fast w4 (fixed). makeWave returns the spawn
// lists (one, kept a list so the lane split below stays generic). Every
// STAR_EVERY-th wave is the boss alone (wavePlan).
// Normal enemies were REMOVED (owner, 2026-10-02): every type now has a counter
// the first four waves are FIXED (owner, 2026-10-02): swarm, shield, armor,
// fast - one of each, to meet them in turn; from wave 5 a random type, never
// the one before
const UNLOCK = ["swarm", "shield", "armor", "fast"];
const STAR_EVERY = 10; // the star rides waves 10, 20, 30... (owner, 2026-10-02; was every wave from 3)
// Waves are the SAME every game (owner, 2026-10-02): type, lane split, star
// slot and star drop all come from fixedRand(wave, salt), a hash, never
// Math.random. Only crits, swarm jitter and stun chance stay random.
function fixedRand(n, salt) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// what wave n will be, given the type of the wave before it - pure, so the
// HUD can preview the next wave (owner) without touching the game
// enemy COUNTS per TYPE (owner, 2026-10-04: the types balanced against each
// other at the same wave, the rise across waves kept; scripts/aspira-sim/wavebal.mjs
// types). WAVE_TYPE_FORCE is the simulator's way to try a type at a wave - empty in play.
// fitted 2026-10-04 (typebal.mjs, 2 seeds, waves 3-29 vs one L1 of each
// tower, on ENEMY-SECONDS - the first fit, on closest approach, piled on slow
// armor and shields); used for EVERY wave (owner: no upgrades in the test)
const TYPE_COUNT_MUL = { swarm: 0.26 /* 2026-10-08 owner: half as many, double hp (was 0.52) */, shield: 0.99, armor: 1.07, fast: 2 /* 2026-10-07: the early fit wanted 1.99 (was 1.47) - fast put the least early pressure of any type */ }, WAVE_TYPE_FORCE = {};
// swarms are DOUBLED on waves 11-60 and x1.5 after (owner, 2026-10-06): a
// SOL-heavy build must find a swarm answer; x2 past 60 cost ARC+SOL+FRZ teams 20 waves
const SWARM_MID_MUL = 2, SWARM_MID = [11, 60], SWARM_LATE_MUL = 1.5;
const swarmMul = n => (n < SWARM_MID[0] ? 1 : n <= SWARM_MID[1] ? SWARM_MID_MUL : SWARM_LATE_MUL);
const WAVE_COUNT_MUL = {};
function wavePlan(n, prev) {
  // every STAR_EVERY-th wave is the boss, ALONE (owner, 2026-10-02)
  if (n % STAR_EVERY === 0) return { type: "bonus", count: bossCount(n), split: bossSplit(n), star: true }; // the Lovers and Death come as two, the Devil as six (aspira-bosses.js)
  const choices = UNLOCK.filter(t => t !== prev);
  const type = WAVE_TYPE_FORCE[n] || (n <= UNLOCK.length ? UNLOCK[n - 1] : choices[Math.floor(fixedRand(n, 1) * choices.length)]);
  const base = Math.min(10 + Math.floor(n * 0.5), 28);
  // swarms: 3x the bodies (owner); split k ways onto rotated lane copies
  // HALF the bodies at TWICE the health (owner, 2026-10-02)
  // x WAVE_COUNT_MUL[n]: waves 1-30 tuned so each comes about as close to the
  // core against one L1 tower of each kind (owner; scripts/aspira-sim/wavebal.mjs)
  const raw = Math.max(1, Math.round((type === "swarm" ? base * 6 : base) / 2 * (WAVE_COUNT_MUL[n] ?? 1) * (TYPE_COUNT_MUL[type] ?? 1) * (type === "swarm" ? swarmMul(n) : 1))); // swarms 6x (owner: doubled from 3x)
  // split k ways, ROUNDED DOWN so every lane copy gets the same number (owner)
  const split = Math.min(raw, 1 + Math.floor(fixedRand(n, 3) * 6));
  return { type, count: Math.floor(raw / split) * split, split, star: n % STAR_EVERY === 0 };
}
function makeWave(n) {
  const { type, count } = wavePlan(n, G.lastType);
  if (type !== "bonus") G.lastType = type; // the boss wave does not break the alternation
  (G.planLog ||= {})[n] = { type, count }; // what wave n was, for the wave list once it is under way
  const list = Array(count).fill(type);
  return [list];
}

// Interest is paid on what you hold at the moment a wave is sent, so saving
// beats spending early. Sending before the countdown ends pays the seconds left.
const INTEREST_PER_WAVE = 4;
// Kill bounty = bountyBase(wave) x the type's bounty: +BOUNTY_SLOPE credits a wave,
// x BOUNTY_EARLY on waves 1-BOUNTY_EARLY_TO (owner, 2026-10-06: "slight bounty
// increase waves 1-30"), growing only BOUNTY_SLOPE_LATE a wave past BOUNTY_KNEE
// ("slightly slower growth after 60": wave 80 pays 27 not 30, wave 100 31 not 37;
// money run 'phase 7' - a spender was only fully built at wave ~91 already)
const BOUNTY_BASE = 2, BOUNTY_SLOPE = 0.35, BOUNTY_KNEE = 60, BOUNTY_SLOPE_LATE = 0.2, BOUNTY_EARLY = 1.1, BOUNTY_EARLY_TO = 30;
const bountyBase = n => (BOUNTY_BASE + BOUNTY_SLOPE * Math.min(n, BOUNTY_KNEE) + BOUNTY_SLOPE_LATE * Math.max(0, n - BOUNTY_KNEE)) * (1 + (BOUNTY_EARLY - 1) * Math.min(1, Math.max(0, (BOUNTY_EARLY_TO - n) / 10))); // full to wave 20, easing off by 30 (no drop at 31)
function sendWave() {
  if (G.over) return;
  // the payout is CAPPED at INTEREST_PER_WAVE x the wave being sent (owner, 2026-10-06, "late money is way
  // too much"): the core's 9 powers cost up to 20000, so a saver's 5-8% was out-earning the whole field
  const gain = Math.min(Math.floor(G.money * G.interest), INTEREST_PER_WAVE * (G.wave + 1));
  if (gain > 0) { G.money += gain; creditsFx = { gain, pct: G.interest * 100, t0: performance.now() / 1000 }; }
  G.wave++;
  // the boss is named in its HP BAR under the speed row (owner), not mid-screen
  // a boss is announced (owner): the advisor's double beep, then the Archon
  // (each boss has its own line, "bossvoice.<arcana>", else the shared one)
  if (G.wave % STAR_EVERY === 0) sfxSeq(["bosswarn", bossVoice(arcanaOf(G.wave).id)]);
  sfx("wave");
  const lanes = laneMap(G.wave);
  // each type's group is SPLIT k ways (k = 1..6, owner) and each part rides a
  // copy of the lane rotated 360/k degrees on from the last, all at once
  makeWave(G.wave).forEach(list => {
    // the lane split comes from the wave number; even parts (wavePlan rounded the count down to fit)
    // (a boss wave takes its split from the boss: the Devil's six come from
    // six directions, one per rotated copy of the lane)
    const boss = G.wave % STAR_EVERY === 0;
    const want = boss ? bossSplit(G.wave) : 1 + Math.floor(fixedRand(G.wave, 3) * 6);
    const k = Math.min(list.length, want), per = Math.floor(list.length / k);
    for (let j = 0; j < k; j++) {
      const part = list.slice(j * per, (j + 1) * per);
      if (!part.length) continue;
      const ang = (j / k) * Math.PI * 2;
      // a boss arrives BOSS_INTRO s into its wave, after its warning (owner)
      G.spawns.push({ n: G.wave, list: part, lanes, ang, idx: 0, timer: boss ? BOSS_INTRO : 0 });
      // each lane copy remembers how many it was sent, for its brightness
      for (const type of part) { const key = laneKey(lanes[type], ang); (G.laneTotals ||= {})[key] = (G.laneTotals[key] || 0) + 1; }
    }
  });
  G.nextIn = WAVE_TIMER;
  G.started = true;
}


// Each enemy TYPE in a wave owns one lane for that wave. Type k of wave n
// takes lane (n*5 + k*7) % 12: 7 is coprime with 12, so the (up to five)
// types of one wave always land on five different lanes, and 5n rotates the
// whole set round the rim from wave to wave.
const TYPE_ORDER = Object.keys(ENEMIES);
// a BOSS rides a lane of at least BOSS_MIN_TURNS loops round the core (owner):
// a shorter pick moves on to the next lane that long (its HP scales with the
// lane's length anyway - bossSpawn)
const BOSS_MIN_TURNS = 5;
// EVERYTHING rides CLOCKWISE (owner, 2026-10-05; bosses briefly had the
// counter-clockwise lanes to themselves): lanes come in mirror pairs, the even
// one of each winding counter-clockwise on screen (defs dir -1), the odd one
// clockwise. A type landing on an even lane takes its pair's odd twin - the
// same length, mirrored, so the balance holds - and a boss moves on to the next
// clockwise lane of BOSS_MIN_TURNS+ turns.
const isCcw = pi => pi % 2 === 0;
function laneMap(n) {
  const out = {};
  TYPE_ORDER.forEach((type, k) => {
    const pi = (n * 5 + k * 7) % N_PATHS;
    out[type] = isCcw(pi) ? pi + 1 : pi;
  });
  while (isCcw(out.bonus) || PATHS[out.bonus].turns < BOSS_MIN_TURNS) out.bonus = (out.bonus + 1) % N_PATHS;
  return out;
}

// Lanes in use right now (a live enemy on them), keyed by
// lane + rotation ("pi:ang"): { pi, ang, color, n, star, a } with the riding
// type's colour and its wave number; feeds the lane highlight and the
// wave:track labels in aspira-lanes.js. ang 0 is the lane itself, else a
// rotated copy. Brightness a = ALIVE / SENT on that lane (owner, 2026-10-02,
// replacing a timed fade): it fills in as the group spawns and drains as it
// dies, and the lane's count is forgotten once nothing is alive or queued.
const laneKey = (pi, ang) => pi + ":" + ang.toFixed(3);
function activeLanes() {
  const out = new Map(), totals = G.laneTotals || {};
  for (const e of G.enemies) {
    if (e.dead) continue;
    const key = laneKey(e.pi, e.ang || 0), u = out.get(key);
    if (u) u.alive++;
    else out.set(key, { pi: e.pi, ang: e.ang || 0, color: ENEMIES[e.type].color, n: e.n, star: !!ENEMIES[e.type].star, alive: 1 });
  }
  const queued = new Set();
  for (const w of G.spawns) for (let i = w.idx; i < w.list.length; i++) queued.add(laneKey(w.lanes[w.list[i]], w.ang || 0));
  for (const key in totals) if (!out.has(key) && !queued.has(key)) delete totals[key];
  for (const [key, u] of out) u.a = Math.min(1, u.alive / (totals[key] || u.alive));
  return out;
}

// a newly opened corner slot flashes white for SLOT_FLASH_S real seconds (owner:
// 3x as long as its notice, SLOT_TEXT_S, stays up)
const SLOT_TEXT_S = 4, SLOT_FLASH_S = 12;
let slotFlash = null;
function drawSlotFlash() {
  if (!slotFlash || performance.now() > slotFlash.until) { slotFlash = null; return; }
  const on = Math.floor(performance.now() / 250) % 2 === 0; // 2 flashes a second
  cellPath(CELLS[slotFlash.ci], 0.94);
  ctx.strokeStyle = COL.white; ctx.lineWidth = 4; ctx.globalAlpha = on ? 1 : 0.25; ctx.stroke(); ctx.globalAlpha = 1;
}

// ---------- the credits over the core (UI only; aspira-draw.js calls it) ----------
// the count is drawn over the core (owner), just the number "12,345"; for
// CREDITS_FX_T s after an interest payout "+Xc (+r%)" shows just under the rings
const CREDITS_FX_T = 2.5;
let creditsFx = null;
function drawCredits() {
  const fxOn = creditsFx && performance.now() / 1000 - creditsFx.t0 < CREDITS_FX_T;
  // just the NUMBER, centred on the core (owner: the CREDITS word is gone),
  // full with separators - counts run past 10k (owner)
  const n = Math.floor(fxOn ? G.money - creditsFx.gain : G.money).toLocaleString("en-US");
  // a little "CRED" UNDER it (owner, 2026-10-06; was a "c", first after it on the same line)
  text(n, CX, CY - 3, 15, "bg", "white"); // BLACK with a white halo (owner); smaller (owner, 2026-10-06; was 22)
  text("CRED", CX, CY + 9, 8, "bg", "white");
  if (!fxOn || G.enemies.some(e => e.arcana && !e.dead)) return; // a boss's name takes this spot (drawBossBar)
  const parts = [["+" + creditsFx.gain + "c", "green"], [" (+" + creditsFx.pct.toFixed(1) + "%)", "green"]];
  ctx.font = "14px " + CANVAS_FONT; // the interest pop-up, smaller (owner; was 20)
  const ws = parts.map(p => ctx.measureText(p[0]).width);
  let x = CX - ws.reduce((a, w) => a + w, 0) / 2;
  parts.forEach((p, i) => { text(p[0], x + ws[i] / 2, CY + CORE_R + LIFE_GAP * LIFE_RINGS + 16, 14, p[1], true); x += ws[i]; });
}
