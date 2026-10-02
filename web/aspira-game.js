// /aspira — game state and simulation: waves, economy, targeting, combat, fx.

let fx = [];
let best = { score: 0, wave: 0 };
try { best = JSON.parse(localStorage.getItem("aspira.best")) || best; } catch (_e) {}

// TESTING: the owner asked to start rich while designing; the real start is 100
const START_MONEY = 10000;

function newGame() {
  return {
    money: START_MONEY, lives: 20, score: 0, wave: 0, interest: 0.03,
    towers: [], enemies: [], spawns: [], chains: [], nextIn: 0, started: false, over: false,
    power: { SCR: 0, RNG: 0, MNY: 0, DAM: 0 }, charge: 0,
    nextLifeAt: 50000, id: 1,
  };
}

let G = newGame();

// ---------- waves ----------
const WAVE_GAP = 5;
// clear = nothing ALIVE on the board (ghosts of the dead may still be drifting in)
const waveClear = () => !G.enemies.some(e => !e.dead) && G.spawns.length === 0;
// A wave mixes K of the unlocked enemy types (owner): K is 1-5 on a bell
// curve peaking at 2, and each chosen type brings 1/K of its usual count.
// Types unlock in order: normal w1, swarm w2, fast w3, shield w4, armor w5.
// makeWave returns one spawn list PER TYPE, so each streams on its own lane
// at the same time. From wave 3 one enemy is swapped for a bonus star.
const UNLOCK = ["norm", "swarm", "fast", "shield", "armor"];
const K_WEIGHTS = [0.2, 0.35, 0.25, 0.13, 0.07]; // P(K = 1..5)
function pickK(max) {
  const w = K_WEIGHTS.slice(0, max), total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let k = 0; k < w.length; k++) { r -= w[k]; if (r <= 0) return k + 1; }
  return max;
}
function makeWave(n) {
  const pool = UNLOCK.slice(0, Math.min(UNLOCK.length, n)), k = pickK(pool.length);
  const types = pool.slice().sort(() => Math.random() - 0.5).slice(0, k);
  const base = Math.min(10 + Math.floor(n * 0.5), 28);
  const lists = types.map(type => {
    const usual = type === "swarm" ? base * 3 : base; // swarms: 3x the bodies of a normal wave (owner)
    return Array(Math.max(1, Math.round(usual / k))).fill(type);
  });
  if (n >= 3) { const l = lists[Math.floor(Math.random() * lists.length)]; l[Math.floor(Math.random() * l.length)] = "bonus"; }
  return lists;
}

// Interest is paid on what you hold at the moment a wave is sent, so saving
// beats spending early. Sending before the countdown ends pays the seconds left.
const TYPE_STAGGER = 2; // seconds between one enemy type's start and the next
function sendWave() {
  if (G.over) return;
  const gain = Math.floor(G.money * G.interest);
  if (gain > 0) { G.money += gain; float(CX, CY + 80, "+" + gain + " interest", "green", 28, 4, 1, 3); }
  G.wave++;
  float(CX, CY - 80, "wave " + G.wave, "orange", 28, 4, 1, 3); // no early bonus: waves always go at once (owner)
  if (G.wave > 1 && (G.wave - 1) % 8 === 0) blockBonus();
  sfx("wave");
  const lanes = laneMap(G.wave);
  // each type's group is SPLIT k ways (k = 1..6, owner) and each part rides a
  // copy of the lane rotated 360/k degrees on from the last, all at once
  // and each TYPE starts TYPE_STAGGER seconds after the one before (owner)
  makeWave(G.wave).forEach((list, ti) => {
    const k = 1 + Math.floor(Math.random() * 6), per = Math.max(1, Math.ceil(list.length / k));
    for (let j = 0; j < k; j++) {
      const part = list.slice(j * per, (j + 1) * per);
      if (part.length) G.spawns.push({ n: G.wave, list: part, lanes, ang: (j / k) * Math.PI * 2, idx: 0, timer: ti * TYPE_STAGGER });
    }
  });
  G.nextIn = WAVE_GAP;
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

// Lanes in use right now (live enemies or spawns still queued), keyed by
// lane + rotation ("pi:ang"): { pi, ang, color, n } with the riding type's
// colour and its wave number; feeds the lane highlight and the wave:track
// labels in aspira-draw.js. ang 0 is the lane itself, else a rotated copy.
function activeLanes() {
  const out = new Map();
  const add = (pi, ang, type, n) => {
    const key = pi + ":" + ang.toFixed(3);
    if (!out.has(key)) out.set(key, { pi, ang, color: ENEMIES[type].color, n });
  };
  for (const e of G.enemies) if (!e.dead) add(e.pi, e.ang || 0, e.type, e.n);
  for (const w of G.spawns) for (let i = w.idx; i < w.list.length; i++) add(w.lanes[w.list[i]], w.ang || 0, w.list[i], w.n);
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

function spawnEnemy(type, n, pi, ang = 0) {
  const d = ENEMIES[type], s0 = entryS(pi), p0 = pathAt(pi, s0, ang);
  const hp = (18 * Math.pow(1.15, n - 1) + n * 4) * d.hp;
  // shields start at exactly 5 on their first wave (4) and gain 1 every 3 waves
  const shield = d.shield ? d.shield + Math.floor(Math.max(0, n - 4) / 3) : 0;
  G.enemies.push({
    armor: d.armor ? d.armor * (1 + 0.12 * (n - 1)) : 0, shield, shieldMax: shield,
    // swarm members wander widely off the lane, each at its own speed (+-20%)
    // and its own wobble rate, so a clump churns as it moves
    jit: type === "swarm" ? 6 + Math.random() * 15 : 0, ph: Math.random() * 6.283, // owner: tripled, then halved twice
    spd: type === "swarm" ? 0.8 + Math.random() * 0.4 : 1, phr: 0.6 + Math.random(),
    id: G.id++, type, n, hp, max: hp, pi, ang, s: s0, x: p0.x, y: p0.y, rot: Math.random() * 6,
    bounty: Math.ceil((2 + n * 0.35) * d.bounty), slowF: 0, slowT: 0, stunT: 0, markT: 0, markMul: 1,
  });
}

// ---------- combat ----------
// Global enemy pace (owner: everything at half speed). Spawn gaps are divided
// by it too, so enemies stay the same DISTANCE apart on the lane — that
// spacing is a balance lever for chain reach.
const ENEMY_SPEED = 1.5;
const effSpeed = e => ENEMIES[e.type].speed * ENEMY_SPEED * (e.spd || 1) * PATHS[e.pi].pace * (e.stunT > 0 ? 0 : 1 - (e.slowT > 0 ? e.slowF : 0));

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
function damage(e, amt, t, quiet = false, crit = false) {
  if (e.dead) return;
  // a shield eats one whole HIT, whatever its size (poison/splash just bounce);
  // the Reaper's shots pass straight through shields, leaving them intact (owner)
  if (e.shield > 0 && !(t && t.kind === "reaper")) {
    if (quiet) return;
    e.shield--;
    fx.push({ k: "hit", x: e.x, y: e.y, r: 18, m: 1, color: "cyan", t: 0, life: 0.07 });
    float(e.x + (Math.random() - 0.5) * 24, e.y - 14, "0", "grid", 15, 1, 1, 30, true); // all of it soaked: dim grey, like armor
    return;
  }
  if (e.shredT > 0) amt *= e.shredMul;
  if (e.slowT > 0 && e.brittle) amt *= e.brittle;
  // armor takes a flat bite out of every hit (never below 10% of it)
  const raw = amt;
  // ... except from the Reaper, whose shots ignore armor (owner)
  if (e.armor && !quiet && !(t && t.kind === "reaper")) amt = Math.max(amt * 0.1, amt - e.armor);
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
    float(e.x + (Math.random() - 0.5) * 24, e.y - 14, String(Math.round(amt)), crit ? "pink" : blunted ? "grid" : "white",
      Math.round(11 + 16 * rel), 0.8 + 1.2 * rel, 1, 30, true);
  }
  if (e.hp <= 0) kill(e, t);
}

// Side effects of a landed hit, from the tower's upgrade mods.
function onHit(e, t, st, amt) {
  if (st.shred) { e.shredMul = Math.max(e.shredT > 0 ? e.shredMul : 1, st.shred.mul); e.shredT = st.shred.t; }
  if (st.dot) { e.dotDps = Math.max(e.dotT > 0 ? e.dotDps : 0, amt * st.dot.frac / st.dot.t); e.dotT = st.dot.t; e.dotSrc = t; }
  if (st.stun && Math.random() < st.stun.p) e.stunT = Math.max(e.stunT, st.stun.t);
  if (st.hitSlow) applySlow(e, st.hitSlow.f, st.hitSlow.t);
  if (st.splash) {
    ring(e.x, e.y, st.splash.r, TOWERS[t.kind].color, 0.1);
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
function applySlow(e, f, dur) {
  e.slowF = Math.max(e.slowT > 0 ? e.slowF : 0, f); e.slowT = Math.max(e.slowT, dur);
  return true;
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
}

function bonusDrop(e) {
  const r = Math.floor(Math.random() * 4);
  if (r === 0) { addScore(2000); float(e.x, e.y - 18, "+2000", "cyan"); }
  else if (r === 1) { G.lives++; float(e.x, e.y - 18, "+1 life", "cyan"); }
  else if (r === 2) { const c = 20 + e.bounty * 5; G.money += c; float(e.x, e.y - 18, "+" + c + " credits", "cyan"); }
  else { G.interest += 0.005; float(e.x, e.y - 18, "+0.5% interest", "cyan"); }
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
function ring(x, y, r, color, life = 0.12) { fx.push({ k: "ring", x, y, r, color, t: 0, life }); }
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
let bannerText = "", bannerT = 0;
function banner(t) { bannerText = t; bannerT = 2 / 3; }

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
function stepEnemies(dt) {
  for (const e of G.enemies) {
    if (e.gone) continue;
    if (e.dead) {
      // a GHOST (owner): the dead keep drifting in at their plain pace,
      // untargetable and harmless, and are removed at the core with no life lost
      e.s += ENEMIES[e.type].speed * ENEMY_SPEED * (e.spd || 1) * PATHS[e.pi].pace * dt;
    } else {
      if (e.stunT > 0) e.stunT -= dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.markT > 0) e.markT -= dt; else e.markMul = 1;
      if (e.shredT > 0) e.shredT -= dt;
      if (e.dotT > 0) { e.dotT -= dt; damage(e, e.dotDps * dt, e.dotSrc, true); if (e.dead) continue; }
      e.s += effSpeed(e) * dt;
    }
    const p = pathAt(e.pi, e.s, e.ang); e.x = p.x; e.y = p.y;
    // no free spin: one corner points along the lane, nose first
    const ahead = pathAt(e.pi, e.s + 3, e.ang);
    if (ahead.x !== p.x || ahead.y !== p.y) e.rot = Math.atan2(ahead.y - p.y, ahead.x - p.x);
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
      G.lives -= 1;
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
  // the next wave ALWAYS goes the moment the field clears (owner): nothing
  // alive, nothing still queued to spawn
  if (waveClear()) { sendWave(); return; }
  stepSpawns(dt);
  stepEnemies(dt);
  if (G.over) return;
  stepChains(dt);
  for (const t of G.towers) {
    if (t.kind === "reaper") { stepReaper(t, dt); continue; }
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
