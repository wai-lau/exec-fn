// /aspira — the WAVES: which enemy type each wave is, how many, how it is split
// over rotated copies of its lane, the timer that sends it, and the lane
// bookkeeping the lane drawing reads. Split out of aspira-game.js (500-line
// cap); same global scope, loaded right after it (the simulator loads it too).

// ---------- waves ----------
// Waves go on a FIXED TIMER (owner, 2026-10-02), fast enough that 2+ waves are
// usually on screen, and still at once whenever the field clears.
const WAVE_TIMER = 6.4; // 20% shorter (owner, 2026-10-12: "make wave timers 20% shorter across the board"; was 8) - halved (owner, 2026-10-12: "halve all wave timers"; was 16) // owner: 10 -> 13 -> 16s to thin the field
// clear = nothing ALIVE on the board (ghosts of the dead may still be drifting in)
// the boss (the star) or ANY of its fleet is alive, riding in (G.fleetQ) or still queued to spawn - no wave warps in
// till the whole fleet is down (owner, 2026-10-12: "still want warps to stop until boss + fleet is defeated"; the fleet
// held unseen in G.fleetQ, and escorts left after their boss, used to let the timer run)
const bossUp = () => G.enemies.some(e => !e.dead && (ENEMIES[e.type].star || e.bossKin)) || G.fleetQ.length > 0 ||
  G.spawns.some(w => w.list.slice(w.idx).some(t => ENEMIES[t].star));
const waveClear = () => !G.enemies.some(e => !e.dead) && G.spawns.length === 0 && !G.fleetQ.length;
// the NEXT wave is a boss's: it waits for a clear field, no timer (aspira-game.js step, the wave list)
const bossNext = () => (G.wave + 1) % STAR_EVERY === 0;
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
const STAR_EVERY = 12; // a boss every 12 waves (owner, 2026-10-12: "add 2 waves before each boss"; was 10) - the star rides waves 10, 20, 30... (owner, 2026-10-02; was every wave from 3)
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
const TYPE_COUNT_MUL = { swarm: 0.325 /* x1.25 bodies, each /1.25 HP (owner, 2026-10-12: "a little more swarmy"; was 0.26) */ /* 2026-10-08 owner: half as many, double hp (was 0.52) */, shield: 0.99, armor: 1.07, fast: 2 /* 2026-10-07: the early fit wanted 1.99 (was 1.47) - fast put the least early pressure of any type */ }, WAVE_TYPE_FORCE = {};
for (const k in TYPE_COUNT_MUL) TYPE_COUNT_MUL[k] *= 0.9; // 2026-10-11: a tenth fewer of each, with the faster short-lane mix (aspira-defs.js)
// DOUBLE the swarms past SWARM_X2_FROM, each at its own HP (owner, 2026-10-12: "dont triple swarms, just double"; then
// not before wave 11 - SOL openers died at wave 6 to wave 1's doubled swarm, SOL being weak to it)
const SWARM_X2_FROM = 11;
// swarms are DOUBLED on waves 11-60 and x1.5 after (owner, 2026-10-06): a
// SOL-heavy build must find a swarm answer; x2 past 60 cost ARC+SOL+FRZ teams 20 waves
const SWARM_MID_MUL = 2, SWARM_MID = [11, 60], SWARM_LATE_MUL = 1.5;
const swarmMul = n => (n < SWARM_MID[0] ? 1 : n <= SWARM_MID[1] ? SWARM_MID_MUL : SWARM_LATE_MUL);
let COUNT_SLOPE = 0.5, COUNT_CAP = Infinity; // a plain wave's base count: 10 + slope x n, uncapped (owner, 2026-10-11: the R10 battery, cap 28 left the late game easy)
const WAVE_COUNT_MUL = { [UNLOCK.indexOf("shield") + 1]: 0.5 }; /* the FIRST shield wave at half (owner, 2026-10-12) */ // (wave 1 was DOUBLED from 2026-10-09; dropped 2026-10-12 - owner: "make sure that the first swarm wave is weaker than the second")
// FEWER LATE FAST (owner, 2026-10-11: "for waves that make lives go fix them"): fast cost 14 lives a wave past 80, every
// other type under 2 - x FAST_LATE_MUL past FAST_LATE_FROM. waverep x3 with HP_END 1.06: 0.8 6.8 a wave, 0.65 2.6, 0.5 1.3
const FAST_LATE_MUL = 0.65, FAST_LATE_FROM = 80;
// how many of `type` a plain wave n brings (before the split onto lane copies) - wavePlan, and a boss's fleet (aspira-bosses.js)
function waveCount(type, n0) {
  const n = eqWave(n0); // (the 10-cycle equivalent - aspira-defs.js; WAVE_COUNT_MUL keys stay real waves)
  const base = Math.min(10 + Math.floor(n * COUNT_SLOPE), COUNT_CAP); // let: the simulator sweeps both (owner, 2026-10-11: "enemy counts increase as the game progresses")
  // swarms: 3x the bodies (owner); split k ways onto rotated lane copies
  // HALF the bodies at TWICE the health (owner, 2026-10-02)
  // x WAVE_COUNT_MUL[n]: waves 1-30 tuned so each comes about as close to the
  // core against one L1 tower of each kind (owner; scripts/aspira-sim/wavebal.mjs)
  const c = (type === "swarm" ? base * 6 : base) / 2 * (WAVE_COUNT_MUL[n0] ?? 1) * (TYPE_COUNT_MUL[type] ?? 1) * (type === "swarm" ? swarmMul(n) * (n >= SWARM_X2_FROM ? 2 : 1) : 1) * (type === "fast" && n > FAST_LATE_FROM ? FAST_LATE_MUL : 1); // swarms 6x (owner: doubled from 3x)
  // SYMMETRICAL FORMATIONS (owner, 2026-10-11: "2n+1 for fast, 3n for armor"): whole Vs and full lattice rows
  const unit = FORM_UNIT[type] || 1;
  return Math.max(unit, Math.round(c / unit) * unit);
}
function wavePlan(n, prev) {
  // every STAR_EVERY-th wave is the boss, ALONE (owner, 2026-10-02)
  if (n % STAR_EVERY === 0) return { type: "bonus", count: bossCount(n), split: bossSplit(n), star: true }; // the Lovers and Death come as two, the Devil as six (aspira-bosses.js)
  const choices = UNLOCK.filter(t => t !== prev);
  const type = WAVE_TYPE_FORCE[n] || (n <= UNLOCK.length ? UNLOCK[n - 1] : choices[Math.floor(fixedRand(n, 1) * choices.length)]);
  const raw = waveCount(type, n);
  // split k ways, ROUNDED DOWN so every lane copy gets the same number (owner)
  // FORMATIONS stay whole (aspira-formations.js): shields split only into whole Vs, armor into whole rows
  const split = formSplit(type, raw, n);
  return { type, count: laneCount(type, raw, split), split, star: n % STAR_EVERY === 0 };
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
const INTEREST_PER_WAVE = 20; // the game no longer caps interest (2026-10-12); kept as the simulator's "smart" saver target (sim.mjs: hold what earns this x the wave)
// Kill bounty = bountyBase(wave) x the type's bounty: +BOUNTY_SLOPE credits a wave,
// x BOUNTY_EARLY on waves 1-BOUNTY_EARLY_TO (owner, 2026-10-06: "slight bounty
// increase waves 1-30"), growing only BOUNTY_SLOPE_LATE a wave past BOUNTY_KNEE
// ("slightly slower growth after 60": wave 80 pays 27 not 30, wave 100 31 not 37;
// money run 'phase 7' - a spender was only fully built at wave ~91 already)
const BOUNTY_BASE = 2, BOUNTY_SLOPE = 0.35, BOUNTY_KNEE = 30 /* (owner, 2026-10-12: "reduce money gain ramping from wave 30 onwards"; was 60) */, BOUNTY_SLOPE_LATE = 0.1 /* was 0.2: wave 80 pays 17.5 not 27, wave 100 19.5 not 31 */, BOUNTY_EARLY = 1.1, BOUNTY_EARLY_TO = 30;
const bountyBase = n => (BOUNTY_BASE + BOUNTY_SLOPE * Math.min(n, BOUNTY_KNEE) + BOUNTY_SLOPE_LATE * Math.max(0, n - BOUNTY_KNEE)) * (1 + (BOUNTY_EARLY - 1) * Math.min(1, Math.max(0, (BOUNTY_EARLY_TO - n) / 10))); // full to wave 20, easing off by 30 (no drop at 31)
function sendWave() {
  if (G.over) return;
  // the payout is CAPPED at INTEREST_PER_WAVE x the wave being sent (owner, 2026-10-06, "late money is way
  // too much"): the core's 9 powers cost up to 20000, so a saver's 5-8% was out-earning the whole field
  const gain = Math.floor(G.money * G.interest); // NO CAP (owner, 2026-10-12: "no interest cap pls"; INTEREST_PER_WAVE x the wave until then)
  if (gain > 0) { G.money += gain; creditsFx = { gain, pct: G.interest * 100, t0: performance.now() / 1000 }; }
  G.wave++;
  if (typeof tickPowerCooldowns === "function") tickPowerCooldowns(); // core power cooldowns count waves (aspira-core.js)
  // the boss is named in its HP BAR under the speed row (owner), not mid-screen
  // a boss is announced (owner): the advisor's double beep, then the Archon
  // (each boss has its own line, "bossvoice.<arcana>", else the shared one)
  if (G.wave % STAR_EVERY === 0) sfxSeq([bossVoice(arcanaOf(G.wave).id)]); // (no "bosswarn" double beep first - owner, 2026-10-12)
  sfx("wave");
  const lanes = laneMap(G.wave);
  // each type's group is SPLIT k ways (k = 1..6, owner) and each part rides a
  // copy of the lane rotated 360/k degrees on from the last, all at once
  makeWave(G.wave).forEach(list => {
    // the lane split comes from the wave number; even parts (wavePlan rounded the count down to fit)
    // (a boss wave takes its split from the boss: the Devil's six come from
    // six directions, one per rotated copy of the lane)
    const boss = G.wave % STAR_EVERY === 0;
    // FORMATIONS stay whole (aspira-formations.js): shields split only into whole Vs, armor into whole rows
    const want = boss ? bossSplit(G.wave) : formSplit(list[0], list.length, G.wave);
    const k = Math.min(list.length, want), per = Math.floor(list.length / k), share = list[0] === "swarm"; // swarm: the remainder SHARED out, one more on the first lanes
    for (let j = 0, at = 0; j < k; j++) {
      const len = share ? per + (j < list.length - per * k ? 1 : 0) : per, part = list.slice(at, at + len); at += len;
      if (!part.length) continue;
      const ang = (laneTurn(G.wave) + (j / k) * Math.PI * 2) % (Math.PI * 2); // the wave's turn round the rim, then the split
      // a boss arrives BOSS_INTRO s into its wave, after its warning (owner)
      G.spawns.push({ n: G.wave, list: part, lanes, ang, idx: 0, timer: boss ? BOSS_INTRO : 0 });
      // each lane copy remembers how many it was sent, for its brightness
      for (const type of part) { const key = laneKey(lanes[type], ang); (G.laneTotals ||= {})[key] = (G.laneTotals[key] || 0) + 1; }
    }
  });
  G.nextIn = WAVE_TIMER;
  G.started = true;
}


// Each enemy TYPE rides ITS OWN spiral pair (owner, 2026-10-08: one speed for all, the
// spiral sets the pace - fast takes the most direct; turns solved per type, PAIR_TURNS
// in aspira-defs.js), always the pair's CLOCKWISE twin (EVERYTHING rides clockwise,
// owner 2026-10-05: the odd lane of a pair). So the entry still moves round the rim,
// each wave turns the whole set laneTurn(n) about the core (5 slots a wave, as the
// old (n*5 + k*7) % 12 rotation did) - the parts of a split group ride copies turned on from there.
// (Was: type k of wave n took lane (n*5 + k*7) % 12, each type at its own speed.)
const TYPE_PAIR = { fast: 4, bonus: 1, swarm: 2, shield: 3, armor: 0 }; // fast and armor SWAPPED (owner, 2026-10-12: "make fast use more windy paths, make armor use more direct paths"; fast took pair 0, the most direct, armor pair 4, the windiest)
const TYPE_ORDER = Object.keys(ENEMIES);
const isCcw = pi => pi % 2 === 0;
const laneTurn = n => ((n * 5) % N_PATHS) * 2 * Math.PI / N_PATHS;
function laneMap() {
  const out = {};
  for (const type of TYPE_ORDER) out[type] = 2 * TYPE_PAIR[type] + 1;
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
    if (u) { u.alive++; if (ENEMIES[e.type].star && !u.star) Object.assign(u, { star: true, color: ENEMIES[e.type].color }); } // a boss lane whichever rider comes first
    else out.set(key, { pi: e.pi, ang: e.ang || 0, color: ENEMIES[e.type].color, n: e.n, star: !!ENEMIES[e.type].star, swarm: e.type === "swarm", alive: 1 });
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
  const on = blinkWave() > 0.5; // the one blink (2026-10-08; was 2 a second)
  cellPath(CELLS[slotFlash.ci], 0.94);
  ctx.strokeStyle = COL.white; ctx.lineWidth = 4; ctx.globalAlpha = on ? 1 : 0.35; ctx.stroke(); ctx.globalAlpha = 1;
}

// ---------- the credits over the core (UI only; aspira-draw.js calls it) ----------
// the count is drawn over the core (owner), just the number "12,345"; for
// CREDITS_FX_T s after an interest payout "+Xc (+r%)" shows just under the rings
const CREDITS_FX_T = 2.5;
let creditsFx = null;
// 1.5x larger (owner, 2026-10-11: "3x larger", then "too large, like half that size"; were 14 / 15 / 8)
const POP_PX = 21, CRED_PX = 23, CRED_SUB_PX = 12;
const popY = () => CY + CORE_R + LIFE_GAP * LIFE_RINGS + 9 + POP_PX / 2; // just under the rings (was +16 at 14px)
// a LOST LIFE puts "X lives left" in the same spot for as long (owner, 2026-10-11), over an interest pop-up older than it
let livesFx = null;
function livesLost() { livesFx = { t0: performance.now() / 1000 }; }
// part: "count" the number alone, "pop" the interest pop-up alone (3D draws the pop-up over everything, warpEntities)
function drawCredits(part) {
  const fxOn = creditsFx && performance.now() / 1000 - creditsFx.t0 < CREDITS_FX_T;
  // just the NUMBER, centred on the core (owner: the CREDITS word is gone),
  // full with separators - counts run past 10k (owner)
  const n = Math.floor(fxOn ? G.money - creditsFx.gain : G.money).toLocaleString("en-US");
  // a little "CRED" UNDER it (owner, 2026-10-06; was a "c", first after it on the same line)
  if (part !== "pop") {
    text(n, CX, CY - 5, CRED_PX, "bg", "white"); // BLACK with a white halo (owner)
    text("CRED", CX, CY + 13, CRED_SUB_PX, "bg", "white");
  }
  if (part === "count" || G.enemies.some(e => e.arcana && !e.dead)) return; // a boss's name takes this spot (drawBossBar)
  const livesOn = livesFx && performance.now() / 1000 - livesFx.t0 < CREDITS_FX_T && (!fxOn || livesFx.t0 >= creditsFx.t0);
  if (livesOn) { text(G.lives + (G.lives === 1 ? " life left" : " lives left"), CX, popY(), POP_PX, "pink", true); return; }
  if (!fxOn) return;
  const parts = [["+" + creditsFx.gain + "c", "green"], [" (+" + creditsFx.pct.toFixed(1) + "%)", "green"]];
  ctx.font = POP_PX + "px " + CANVAS_FONT; // the interest pop-up
  const ws = parts.map(p => ctx.measureText(p[0]).width);
  let x = CX - ws.reduce((a, w) => a + w, 0) / 2;
  parts.forEach((p, i) => { text(p[0], x + ws[i] / 2, popY(), POP_PX, p[1], true); x += ws[i]; });
}
