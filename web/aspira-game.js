// /aspira — game state and simulation: waves, economy, targeting, combat, fx.

let fx = [];
let best = { score: 0, wave: 0 };
try { best = JSON.parse(localStorage.getItem("aspira.best")) || best; } catch (_e) {}

// TESTING: the owner asked to start rich while designing; the real start is 100
const START_MONEY = 100; // the real economy (owner, 2026-10-02; was 10000 for testing)

function newGame() {
  // NULLIFY moved the slots out; a new game puts them home (aspira-core.js
  // loads after this file, so the very first call finds no pushCells yet)
  if (typeof pushCells === "function") pushCells(0);
  return {
    money: START_MONEY, lives: 20, score: 0, wave: 0, interest: 0.03,
    towers: [], enemies: [], spawns: [], chains: [], nextIn: 0, started: false, over: false,
    power: { SCR: 0, RNG: 0, MNY: 0, DAM: 0 }, charge: 0,
    nextLifeAt: 50000, id: 1,
  };
}

let G = newGame();

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
// order: swarm w1, fast w2, shield w3, armor w4. makeWave returns the spawn
// lists (one, kept a list so the lane split below stays generic). Every
// STAR_EVERY-th wave is the boss alone (wavePlan).
// Normal enemies were REMOVED (owner, 2026-10-02): every type now has a counter
const UNLOCK = ["swarm", "fast", "shield", "armor"];
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
function wavePlan(n, prev) {
  // every STAR_EVERY-th wave is the boss, ALONE (owner, 2026-10-02)
  if (n % STAR_EVERY === 0) return { type: "bonus", count: 1, split: 1, star: true };
  const pool = UNLOCK.slice(0, Math.min(UNLOCK.length, n));
  const choices = pool.length > 1 ? pool.filter(t => t !== prev) : pool;
  const type = choices[Math.floor(fixedRand(n, 1) * choices.length)];
  const base = Math.min(10 + Math.floor(n * 0.5), 28);
  // swarms: 3x the bodies (owner); split k ways onto rotated lane copies
  // HALF the bodies at TWICE the health (owner, 2026-10-02)
  const raw = Math.max(1, Math.round((type === "swarm" ? base * 3 : base) / 2));
  // split k ways, ROUNDED DOWN so every lane copy gets the same number (owner)
  const split = Math.min(raw, 1 + Math.floor(fixedRand(n, 3) * 6));
  return { type, count: Math.floor(raw / split) * split, split, star: n % STAR_EVERY === 0 };
}
function makeWave(n) {
  const { type, count } = wavePlan(n, G.lastType);
  if (type !== "bonus") G.lastType = type; // the boss wave does not break the alternation
  const list = Array(count).fill(type);
  return [list];
}

// Interest is paid on what you hold at the moment a wave is sent, so saving
// beats spending early. Sending before the countdown ends pays the seconds left.
function sendWave() {
  if (G.over) return;
  const gain = Math.floor(G.money * G.interest);
  if (gain > 0) { G.money += gain; float(CX, CY + 80, "+" + gain + " interest", "green", 28, 4, 1, 3); }
  G.wave++;
  float(CX, CY - 80, "wave " + G.wave, "orange", 28, 4, 1, 3); // no early bonus: waves always go at once (owner)
  if (G.wave > 1 && (G.wave - 1) % 8 === 0) blockBonus();
  // (owner) white like the core, and held 3s so it registers; click the core: aspira-core.js
  if (G.wave === CORE_UNLOCK) banner("core upgrades unlocked", "white", 3);
  sfx("wave");
  const lanes = laneMap(G.wave);
  // each type's group is SPLIT k ways (k = 1..6, owner) and each part rides a
  // copy of the lane rotated 360/k degrees on from the last, all at once
  makeWave(G.wave).forEach(list => {
    // the lane split comes from the wave number; even parts (wavePlan rounded the count down to fit)
    const k = Math.min(list.length, 1 + Math.floor(fixedRand(G.wave, 3) * 6)), per = Math.floor(list.length / k);
    for (let j = 0; j < k; j++) {
      const part = list.slice(j * per, (j + 1) * per);
      if (!part.length) continue;
      const ang = (j / k) * Math.PI * 2;
      G.spawns.push({ n: G.wave, list: part, lanes, ang, idx: 0, timer: 0 });
      // each lane copy remembers how many it was sent, for its brightness
      for (const type of part) { const key = laneKey(lanes[type], ang); (G.laneTotals ||= {})[key] = (G.laneTotals[key] || 0) + 1; }
    }
  });
  G.nextIn = WAVE_TIMER;
  G.started = true;
}

function blockBonus() {
  const k = ((G.wave - 1) / 8) % 3;
  if (k === 1) { const c = 100 + G.wave * 10; G.money += c; addScore(c * 10); banner("bonus +" + c + " credits"); }
  else if (k === 2) { G.interest += 0.01; banner("bonus interest +1%"); }
  else { G.lives += 3; banner("bonus +3 lives"); }
}

// Each enemy TYPE in a wave owns one lane for that wave. Type k of wave n
// takes lane (n*5 + k*7) % 12: 7 is coprime with 12, so the (up to five)
// types of one wave always land on five different lanes, and 5n rotates the
// whole set round the rim from wave to wave.
const TYPE_ORDER = Object.keys(ENEMIES);
function laneMap(n) {
  const out = {};
  TYPE_ORDER.forEach((type, k) => { out[type] = (n * 5 + k * 7) % N_PATHS; });
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

// Enemies appear where their lane first crosses SPAWN_R from the core (owner:
// every spawn the same distance from the centre, whatever the screen shape or
// lane rotation - a rotated copy crosses the circle at the same s).
const SPAWN_R = 600;
function entryS(pi) {
  const p = PATHS[pi].pts.find(q => Math.hypot(q.x - CX, q.y - CY) <= SPAWN_R);
  return p ? p.s : 0;
}

// gentler late ramp (owner, 2026-10-02): HP x1.10 a wave (was 1.15, which
// quadrupled every 10 waves and walled every build by ~70), armor with the
// curve's 0.4 power (was 0.5); shields keep the old 1.15 curve (owner)
const HP_GROWTH = 1.10, ARMOR_EXP = 0.4;
function spawnEnemy(type, n, pi, ang = 0) {
  const d = ENEMIES[type], s0 = entryS(pi), p0 = pathAt(pi, s0, ang);
  const hp = (18 * Math.pow(HP_GROWTH, n - 1) + n * 4) * d.hp * 2; // x2: half as many enemies (owner)
  // DEFENCES KEEP PACE WITH HP (overnight simulator, 2026-10-02): with flat
  // armor/shields, late waves were pure dps and ARC spam won. Armor grows with
  // the curve to ARMOR_EXP (0.4; was the square root), shields with its 0.4 power - normalised so
  // shields still start at exactly their base (8) on their first wave (3).
  const grow = Math.pow(HP_GROWTH, n - 1) + n * 4 / 18, grow3 = Math.pow(HP_GROWTH, 2) + 3 * 4 / 18;
  // shields keep the OLD steeper curve (owner: "shields can stay the same")
  const sGrow = Math.pow(1.15, n - 1) + n * 4 / 18, sGrow3 = Math.pow(1.15, 2) + 3 * 4 / 18;
  const shield = d.shield ? Math.max(d.shield, Math.round(d.shield * Math.pow(sGrow / sGrow3, 0.4))) : 0;
  G.enemies.push({
    armor: d.armor ? d.armor * Math.pow(grow, ARMOR_EXP) : 0, shield, shieldMax: shield,
    // swarm members wander widely off the lane, each at its own speed (+-20%)
    // and its own wobble rate, so a clump churns as it moves
    jit: type === "swarm" ? 6 + Math.random() * 15 : 0, ph: Math.random() * 6.283, // owner: tripled, then halved twice
    spd: type === "swarm" ? 0.8 + Math.random() * 0.4 : 1, phr: 0.6 + Math.random(),
    id: G.id++, type, n, hp, max: hp, pi, ang, s: s0, x: p0.x, y: p0.y, rot: Math.random() * 6,
    bounty: Math.ceil((2 + n * 0.35) * d.bounty), slowF: 0, slowT: 0, stunT: 0, markT: 0, markMul: 1,
  });
  if (coreHas("quench")) quench(G.enemies[G.enemies.length - 1]); // the core's Quench (aspira-core.js)
}

// ---------- combat ----------
// Global enemy pace (owner: everything at half speed). Spawn gaps are divided
// by it too, so enemies stay the same DISTANCE apart on the lane — that
// spacing is a balance lever for chain reach.
const ENEMY_SPEED = 1.5;
const effSpeed = e => ENEMIES[e.type].speed * ENEMY_SPEED * (e.spd || 1) * PATHS[e.pi].pace * (e.stunT > 0 ? 0 : 1 - (e.slowT > 0 ? e.slowF : 0)) *
  (coreHas("vacuum") ? VACUUM_SPD : 1); // the core's Vacuum (aspira-core.js)

const MODE_KEY = {
  // close = closest to the CORE (owner), not to the tower: the most urgent enemy
  close: a => (a.e.x - CX) ** 2 + (a.e.y - CY) ** 2,
  hard: a => -a.e.hp,
  weak: a => a.e.hp,
  fast: a => -effSpeed(a.e),
};

function pickTargets(t, st, count) {
  const r2 = st.range * st.range, c = [];
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = (e.x - t.x) ** 2 + (e.y - t.y) ** 2;
    if (d <= r2) c.push({ e, d });
  }
  const key = MODE_KEY[t.mode];
  // ties go to whoever is furthest along the spiral
  c.sort((a, b) => key(a) - key(b) || b.e.s - a.e.s);
  return c.slice(0, count).map(a => a.e);
}

// quiet: no flash or number (poison ticks, splash), so they do not spam
// crit: draw this hit's number PINK instead of a separate CRIT label (owner)
// st (optional): the hitting tower's stats, for pierce - st.ignoreShield and
// st.armorPierce (the share of armor ignored; ARC's Ion path, owner)
function damage(e, amt, t, quiet = false, crit = false, st = null) {
  if (e.dead) return;
  // a shield eats one whole HIT, whatever its size (poison/splash just bounce) -
  // SOL's included (owner: stripping shields is ACD's job, its ticks pop them)
  if (e.shield > 0 && !(st && st.ignoreShield)) {
    if (quiet) return;
    e.shield--;
    fx.push({ k: "hit", x: e.x, y: e.y, r: 18, m: 1, color: "cyan", t: 0, life: 0.07 });
    float(e.x + (Math.random() - 0.5) * 24, e.y - 14, "0", "grid", 15, 1, 1, 30, true); // all of it soaked: dim grey, like armor
    return;
  }
  if (e.shredT > 0) amt *= e.shredMul;
  if (e.slowT > 0 && e.brittle) amt *= e.brittle;
  amt *= echoMul(e); // the core's Echo (aspira-core.js)
  // armor takes a flat bite out of every hit (never below 10% of it)
  const raw = amt;
  // ... except from the Reaper, whose shots ignore armor (owner)
  const pierce = t && t.kind === "reaper" ? 1 : (st && st.armorPierce) || 0;
  if (e.armor > 0 && !quiet && pierce < 1) amt = Math.max(amt * 0.1, amt - e.armor * (1 - pierce));
  // NEGATIVE armor (ACD's Corrosion, owner) is a flat bonus on every hit
  else if (e.armor < 0 && !quiet) amt -= e.armor;
  const blunted = amt < raw;
  // per-tower tally: damage counts only up to the HP the enemy had left
  if (t) t.dealt = (t.dealt || 0) + Math.min(amt, Math.max(0, e.hp));
  e.hp -= amt;
  if (!quiet) {
    // impact flash sized and lit by the damage; big hits also throw sparks
    const m = dmgMag(amt), col = t ? TOWERS[t.kind].color : "orange";
    fx.push({ k: "hit", x: e.x, y: e.y, r: 5 + 8 * m, m, color: col, t: 0, life: 0.05 + 0.027 * m });
    if (m > 1.2) burst(e.x, e.y, col, Math.round(m * 3));
    // damage number, jittered so rapid hits don't stack
    // armor-blunted hits read dim grey (the graticule's Silver), the rest white
    // sized RELATIVE to the biggest hit seen this game (owner): the largest so
    // far is 27px / 2s, a tiny one 11px / 0.8s (owner: smaller), spaced by sqrt(amt / maxHit)
    G.maxHit = Math.max(G.maxHit || 1, amt);
    const rel = Math.sqrt(amt / G.maxHit);
    float(e.x + (Math.random() - 0.5) * 24, e.y - 14, String(Math.round(amt)), crit ? "orange" : blunted ? "grid" : "white",
      Math.round(11 + 16 * rel), 0.8 + 1.2 * rel, 1, 30, true);
  }
  if (e.hp <= 0) kill(e, t);
}

// Side effects of a landed hit, from the tower's upgrade mods.
function onHit(e, t, st, amt) {
  if (st.shred) { e.shredMul = Math.max(e.shredT > 0 ? e.shredMul : 1, st.shred.mul); e.shredT = st.shred.t; }
  if (st.dot) { e.dotDps = Math.max(e.dotT > 0 ? e.dotDps : 0, amt * st.dot.frac / st.dot.t); e.dotT = st.dot.t; e.dotSrc = t; }
  if (st.stun && Math.random() < st.stun.p) e.stunT = Math.max(e.stunT, st.stun.t);
  if (st.hitSlow) applySlow(e, st.hitSlow.f, st.hitSlow.t, t ? t.id : "x");
  // Melt (ARC): every hit strips armor for good, so later hits land harder
  if (st.armorShred && e.armor) e.armor = Math.max(0, e.armor - st.armorShred);
  if (st.splash) {
    // a FILLED blast that lingers 0.3s, so the splash actually reads (owner)
    fx.push({ k: "blast", x: e.x, y: e.y, r: st.splash.r, color: TOWERS[t.kind].color, t: 0, life: 0.3 });
    for (const o of G.enemies) {
      if (o === e || o.dead) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) <= st.splash.r) damage(o, amt * st.splash.frac, t, true);
    }
  }
}

// how long a Slower's slow lasts (owner: 5x the old 2.5s)
const SLOW_TIME = 125 / 48; // ~2.6 real seconds (owner: 10x the old ~4.2s, then 1/4, then 1/4)

// Slow affects every enemy at full strength (owner; the earlier armor-immune
// and shield-halves rules are gone). Returns whether any slow landed.
// Slows STACK across sources, LOGARITHMICALLY (owner, 2026-10-02; was one
// slow at a time). Each source (a tower id, or "id:chill" for Deep Freeze)
// keeps ONE slow on the enemy: its stronger slow replaces its weaker, an equal
// one refreshes the time, a weaker one is ignored while the stronger runs.
// Across n live sources the strongest, f1, grows by 1 + STACK_K * ln(n):
// 0.4 alone, 0.54 from two towers, 0.62 from three, 0.68 from four - never past
// STACK_CAP by stacking (a single stronger slow, Deep Freeze's 95%, still holds).
// FRZ hits Fast enemies twice as hard (owner, 2026-10-02): double the slow,
// up to 90% - never past a stronger slow already asked for (Deep Freeze 95%)
const FAST_SLOW_MUL = 2, FAST_SLOW_CAP = 0.9, STACK_K = 0.5, STACK_CAP = 0.9;
function applySlow(e, f, dur, src = "x") {
  if (e.type === "fast") f = Math.max(f, Math.min(FAST_SLOW_CAP, f * FAST_SLOW_MUL));
  const slows = e.slows || (e.slows = {}), s = slows[src];
  if (s && s.t > 0 && f < s.f) return true;
  slows[src] = { f, t: !s || !(s.t > 0) || f > s.f ? dur : Math.max(s.t, dur) };
  sumSlows(e);
  return true;
}
// age every source's slow by dt, drop the spent ones, and fold the rest into
// e.slowF / e.slowT (what effSpeed, Brittle, Shatter and the drawing read)
function sumSlows(e, dt = 0) {
  let f1 = 0, n = 0, t = 0;
  for (const k in e.slows) {
    const s = e.slows[k];
    s.t -= dt;
    if (!(s.t > 0)) { delete e.slows[k]; continue; }
    f1 = Math.max(f1, s.f); n++; t = Math.max(t, s.t);
  }
  e.slowF = n > 1 ? Math.max(f1, Math.min(STACK_CAP, f1 * (1 + STACK_K * Math.log(n)))) : f1;
  e.slowT = t;
}

// damage for one shot at one enemy: EMP's armored bonus and the every-Nth-shot charge
function shotDamage(t, st, e, base) {
  let d = base;
  if (st.armorMul && e.armor) d *= st.armorMul;
  if (st.everyN && t.shots % st.everyN.n === 0) d *= st.everyN.mul;
  return d;
}

function kill(e, t) {
  e.dead = true;
  if (t) t.kills = (t.kills || 0) + 1;
  const mul = (e.markT > 0 ? e.markMul : 1) * (G.power.MNY > 0 ? 2 : 1) * (e.slowT > 0 && e.siphon ? e.siphon : 1);
  const b = Math.round(e.bounty * mul);
  G.money += b;
  sfx("kill");
  float(e.x, e.y - 30, "+" + b, "orange", 18, 2.0); // small (owner)
  addScore(b * 10);
  G.charge = Math.min(POWER_FULL, G.charge + 1);
  burst(e.x, e.y, ENEMIES[e.type].color, 14);
  if (e.type === "bonus") bonusDrop(e);
  if (e.shatter && e.slowT > 0 && !shattering) shatterAt(e); // FRZ's Shatter
  if (e.charged) staticDischarge(e); // ARC's Static
}

// the star drops +10 LIVES or +5% INTEREST, half and half (owner, 2026-10-02:
// never score, no credits; x10 since it now comes every 10th wave); fixed
// per wave, like the waves
function bonusDrop(e) {
  if (fixedRand(e.n, 4) < 0.5) { G.lives += 10; float(e.x, e.y - 18, "+10 lives", "cyan"); }
  else { G.interest += 0.05; float(e.x, e.y - 18, "+5% interest", "cyan"); }
}

function addScore(n) {
  G.score += n * (G.power.SCR > 0 ? 2 : 1);
  while (G.score >= G.nextLifeAt) {
    G.lives++; sfx("life"); banner("extra life");
    G.nextLifeAt = G.nextLifeAt < 100000 ? 100000 : G.nextLifeAt + 100000;
  }
}

// ---------- fx ----------
// Effect magnitude from damage: ~0.9 for a 4-damage tick, ~2.3 for an 80
// hit, capped at 3 (a big crit). 0 for no damage (the Slower's beam).
const dmgMag = d => (d > 0 ? Math.min(3, 0.5 + Math.sqrt(d) / 5) : 0);
// slim: RPR's beam - half the width, brighter glow (owner).
// follow: the beam keeps hold of its two endpoint objects (tower, enemy) and
// is redrawn between them every frame while it lasts, so it tracks a moving
// target; follow = false draws a fixed line between the start points.
function beam(a, b, color, life, w = 1.5, dmg = 0, slim = false, follow = true) {
  fx.push({ k: "beam", x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, t: 0, life, w, m: dmgMag(dmg), slim,
    a: follow ? a : null, b: follow ? b : null });
}
function ring(x, y, r, color, life = 0.12, grad = false) { fx.push({ k: "ring", x, y, r, color, t: 0, life, grad }); }
// vy: upward drift (units/s); long-lived floats drift slowly so they stay on screen
// every pop-up has the black outline + dark glow (owner); `under` marks the
// damage numbers, which draw beneath everything but the background
function float(x, y, text, color, size = 28, life = 1.1, alpha = 1, vy = 30, under = false) {
  fx.push({ k: "text", x, y, text, color, t: 0, life, size, alpha, vy, outline: true, under });
}
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = 40 + Math.random() * 120;
    fx.push({ k: "spark", x, y, vx: Math.cos(a) * v * 3, vy: Math.sin(a) * v * 3, color, t: 0, life: (0.4 + Math.random() * 0.3) / 3 });
  }
}
let bannerText = "", bannerT = 0, bannerCol = "orange";
// a banner across the top; `life` in seconds, `col` a palette key
function banner(t, col = "orange", life = 2 / 3) { bannerText = t; bannerT = life; bannerCol = col; }

// ---------- update ----------
function stepSpawns(dt) {
  for (const w of G.spawns) {
    w.timer -= dt;
    while (w.timer <= 0 && w.idx < w.list.length) {
      const type = w.list[w.idx++];
      spawnEnemy(type, w.n, w.lanes[type], w.ang || 0);
      // spacing is a balance lever: swarms stream evenly and very densely
      // (5x the bodies in the same time as before), trains spread ~60+ apart
      w.timer += (type === "swarm" ? 0.024 : type === "fast" ? 0.5 : 0.8) / ENEMY_SPEED;
    }
  }
  G.spawns = G.spawns.filter(w => w.idx < w.list.length);
}

const JIT_FADE_R = 400; // swarm wander is full beyond this radius, 0 at the core
// enemies turn nose-first along their lane - drawing only, so the headless
// balance simulator switches it off (scripts/aspira-sim)
let FACING = true;
function stepEnemies(dt) {
  for (const e of G.enemies) {
    if (e.gone) continue;
    if (e.dead) {
      // a GHOST (owner): the dead keep drifting in at their plain pace,
      // untargetable and harmless, and are removed at the core with no life lost
      e.s += ENEMIES[e.type].speed * ENEMY_SPEED * (e.spd || 1) * PATHS[e.pi].pace * dt;
    } else {
      if (e.stunT > 0) e.stunT -= dt;
      if (e.slows) sumSlows(e, dt);
      if (e.markT > 0) e.markT -= dt; else e.markMul = 1;
      if (e.biteT > 0) e.biteT -= dt; // Frostbite tint
      if (e.corrodeT > 0) e.corrodeT -= dt; // Corrosion ring
      if (e.shredT > 0) e.shredT -= dt;
      if (e.dotT > 0) { e.dotT -= dt; damage(e, e.dotDps * dt, e.dotSrc, true); if (e.dead) continue; }
      e.s += effSpeed(e) * dt;
    }
    const p = pathAt(e.pi, e.s, e.ang); e.x = p.x; e.y = p.y;
    // no free spin: one corner points along the lane, nose first
    if (FACING) {
      const ahead = pathAt(e.pi, e.s + 3, e.ang);
      if (ahead.x !== p.x || ahead.y !== p.y) e.rot = Math.atan2(ahead.y - p.y, ahead.x - p.x);
    }
    // wobble rate cut to 1/3 (owner) when the wander tripled, so it drifts, not buzzes
    if (e.jit) {
      e.ph += dt * 2.2 * (e.phr || 1);
      // the wander fades to nothing approaching the core (owner), so the swarm
      // funnels into a clean line instead of piling over the centre
      const j = e.jit * Math.min(1, Math.hypot(e.x - CX, e.y - CY) / JIT_FADE_R) ** 2; // squared: gone well before the core
      e.x += Math.cos(e.ph) * j; e.y += Math.sin(e.ph * 1.3) * j;
    }
    if (e.s >= PATHS[e.pi].len) {
      e.gone = true;
      if (e.dead) continue; // a ghost just fades out at the core
      e.dead = true;
      G.lives -= ENEMIES[e.type].leak || 1; // the boss costs 10 (owner)
      sfx("leak"); shakeScreen();
      ring(e.x, e.y, 40, "pink", 0.17);
      if (G.lives <= 0) { G.lives = 0; gameOver(); return; }
    }
  }
  G.enemies = G.enemies.filter(e => !e.gone);
}

function step(dt) {
  if (G.over || !G.started) return;
  for (const k in G.power) if (G.power[k] > 0) G.power[k] = Math.max(0, G.power[k] - dt);
  stepCore(dt); // the core's ZEN pulse (aspira-core.js)
  // the next wave goes when its timer runs out, or the moment the field
  // clears (owner): nothing alive, nothing still queued to spawn
  // ...except the BOSS holds the timer (owner): nothing new comes until it
  // is dead (or through), then the field is clear and the next wave goes
  if (!bossUp()) G.nextIn -= dt;
  if (G.nextIn <= 0 || waveClear()) { sendWave(); return; }
  stepSpawns(dt);
  stepEnemies(dt);
  if (G.over) return;
  stepChains(dt);
  for (const t of G.towers) {
    if (t.kind === "reaper") { stepReaper(t, dt); continue; }
    if (t.kind === "acid") { stepAcid(t, dt); continue; }
    t.cd -= dt;
    if (t.cd > 0) continue;
    const st = towerStats(t);
    const fired = fire(t, st);
    if (fired) sfx(t.kind);
    t.cd = fired ? 1 / st.rate : 0.05;
  }
  G.enemies = G.enemies.filter(e => !e.gone);
}

// Beams, rings and sparks age in GAME time (they follow the 1/2/3x speed);
// floating text ages in REAL time (stepFloats) so a 1s damage number is 1s
// on screen at any speed (owner).
function stepFx(dt) {
  for (const f of fx) {
    if (f.k === "text") continue;
    f.t += dt;
    if (f.k === "spark") { f.x += f.vx * dt; f.y += f.vy * dt; }
  }
  // beams run their full life and keep following their target, ghost or not
  fx = fx.filter(f => f.t < f.life);
  if (bannerT > 0) bannerT -= dt;
}

function stepFloats(dt) {
  for (const f of fx) if (f.k === "text") { f.t += dt; f.y -= f.vy * dt; }
  fx = fx.filter(f => f.k !== "text" || f.t < f.life);
}

function gameOver() {
  G.over = true;
  sfx("over");
  if (G.score > best.score) best.score = G.score;
  if (G.wave > best.wave) best.wave = G.wave;
  try { localStorage.setItem("aspira.best", JSON.stringify(best)); } catch (_e) {}
  showOverlay("core breached", "Reached wave " + G.wave + " with " + G.score.toLocaleString() + " points.", "Play again");
}
