// /aspira — game state and simulation: waves, economy, targeting, combat, fx.

let fx = [];
let best = { score: 0, wave: 0 };
try { best = JSON.parse(localStorage.getItem("aspira.best")) || best; } catch (_e) {}

// TESTING: the owner asked to start rich while designing; the real start is 100
const START_MONEY = 120; // owner, 2026-10-02 (was 100; the 10000 playtest start is gone)

function newGame() {
  // NULLIFY moved the slots out; a new game puts them home (aspira-core.js
  // loads after this file, so the very first call finds no pushCells yet)
  if (typeof pushCells === "function") pushCells(0);
  return {
    money: START_MONEY, lives: 18, score: 0, wave: 0, interest: 0.03, // 18 = two full shield rings (owner)
    towers: [], enemies: [], spawns: [], chains: [], nextIn: 0, started: false, over: false,
    power: { SCR: 0, RNG: 0, MNY: 0, DAM: 0 }, charge: 0,
    nextLifeAt: 50000, id: 1,
  };
}

let G = newGame();

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
const HP_GROWTH = 1.10, ARMOR_EXP = 0.4, SHIELD_EXP = 0.335;
// one enemy's HP on wave n (before a boss's own multiplier); the wave list shows it too
// shields GROW SLOWER (owner, 2026-10-06): to the SHIELD_EXP power of the old
// steeper curve (was 0.4) - the same early (8 on wave 3, 11 on 10), about HALF
// late (244 on 80, was 503) - and a shielded enemy's HP rises by old / new, so
// it takes about as long to kill (x1.2 on 20, x2 on 80). Normalised so shields
// start at exactly their base on their first wave (3).
const sCurve = n => Math.pow(1.15, n - 1) + n * 4 / 18;
function shieldsOf(type, n) {
  const b = ENEMIES[type].shield;
  if (!b) return { shield: 0, hpMul: 1 };
  const r = sCurve(n) / sCurve(3), old = Math.max(b, b * Math.pow(r, 0.4)), shield = Math.max(b, Math.round(b * Math.pow(r, SHIELD_EXP)));
  return { shield, hpMul: old / shield };
}
const enemyHp = (type, n) => (9 * Math.pow(HP_GROWTH, n - 1) + n * 2) * ENEMIES[type].hp * 2 * shieldsOf(type, n).hpMul; // x2: half as many enemies (owner); 9 / 2 (2026-10-08: all HP halved, was 18 / 4)
function spawnEnemy(type, n, pi, ang = 0) {
  const d = ENEMIES[type], s0 = entryS(pi), p0 = pathAt(pi, s0, ang);
  const hp = enemyHp(type, n);
  // DEFENCES KEEP PACE WITH HP (overnight simulator, 2026-10-02): with flat
  // armor/shields, late waves were pure dps and ARC spam won. Armor grows with
  // the curve to ARMOR_EXP (0.4; was the square root), shields with its 0.4 power - normalised so
  // shields still start at exactly their base (8) on their first wave (3).
  const grow = Math.pow(HP_GROWTH, n - 1) + n * 4 / 18, grow3 = Math.pow(HP_GROWTH, 2) + 3 * 4 / 18;
  const { shield } = shieldsOf(type, n); // fewer late shields, more HP (shieldsOf)
  const armor = d.armor ? d.armor * Math.pow(grow, ARMOR_EXP) : 0;
  G.enemies.push({
    armor, shield, shieldMax: shield, wave: n, // the wave it CAME from (the end screen's leaks)
    // swarm members wander widely off the lane, each at its own speed (+-20%)
    // and its own wobble rate, so a clump churns as it moves
    jit: type === "swarm" ? 12 + Math.random() * 30 : 0, ph: Math.random() * 6.283, // owner: tripled, halved twice, doubled 2026-10-08
    spd: type === "swarm" ? 0.8 + Math.random() * 0.4 : 1, phr: 0.6 + Math.random(),
    id: G.id++, type, n, hp, max: hp, pi, ang, s: s0, x: p0.x, y: p0.y, rot: Math.random() * 6,
    // fractional, so a cheap swarmer really pays its share (owner: halved
    // swarm bounty must hold; money is shown rounded down)
    bounty: bountyBase(n) * d.bounty, // (aspira-waves.js) slowF: 0, slowT: 0, stunT: 0, markT: 0, markMul: 1,
  });
  if (type === "bonus") bossSpawn(G.enemies[G.enemies.length - 1], n); // which boss (aspira-bosses.js)
}

// ---------- combat ----------
// Global enemy pace (owner: everything at half speed). Spawn gaps are divided
// by it too, so enemies stay the same DISTANCE apart on the lane — that
// spacing is a balance lever for chain reach.
const ENEMY_SPEED = 1.5;
const effSpeed = e => ENEMIES[e.type].speed * ENEMY_SPEED * (e.spd || 1) * PATHS[e.pi].pace * (e.stunT > 0 ? 0 : 1 - (e.slowT > 0 ? e.slowF : 0));

// FRESH (owner): an enemy carrying NO debuff - slowed, stunned, bleeding,
// burning, corroded, frostbitten, shredded, poisoned or charged
const debuffed = e => e.slowT > 0 || e.stunT > 0 || e.bleedCrit > 0 || e.burnT > 0 || e.corrodeT > 0 ||
  e.biteT > 0 || e.shredT > 0 || e.dotT > 0 || !!e.charged || !!e.charge;
const coreD2 = e => (e.x - CX) ** 2 + (e.y - CY) ** 2;
const MODE_KEY = {
  // close = closest to the CORE (owner), not to the tower: the most urgent enemy
  close: a => coreD2(a.e),
  // fresh: undebuffed first (nearest the core among them), then the rest
  fresh: a => (debuffed(a.e) ? 1e9 : 0) + coreD2(a.e),
  biggest: a => -a.e.hp, // the most HP left (owner)
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
// a floating damage number, sized RELATIVE to the biggest hit seen this game
// (owner): the largest so far is 27px / 2s, a tiny one 11px / 0.8s, spaced by
// sqrt(size / maxHit) - size being the hit before armor or shield
// At most DMG_MAX on screen, a HARD cap (owner, 2026-10-06): every hit gets a
// number, small ones too, and past the cap the SMALLEST number on screen is
// culled to make room - unless the new hit is smaller still, which then goes
// unshown. (They age in REAL time while the game runs up to 20x, so late
// waves at speed piled thousands up - drawing them was most of the frame;
// profiled 2026-10-05, waves 80-85, 9 max towers.)
const DMG_MAX = 120;
let dmgLive = []; // the live damage-number floats, each carrying its hit size `v`
// a number's size follows its hit against the biggest hit yet - steeper and wider than it was (owner, 2026-10-08:
// "big numbers bigger!!"; was sqrt, 11..27px)
const DMG_SIZE_EXP = 0.7, DMG_PX_MIN = 10, DMG_PX_SPAN = 28;
function dmgNumber(e, label, size, color) {
  G.maxHit = Math.max(G.maxHit || 1, size);
  const rel = (size / G.maxHit) ** DMG_SIZE_EXP;
  if (dmgLive.length >= DMG_MAX) {
    dmgLive = dmgLive.filter(f => f.t < f.life);
    if (dmgLive.length >= DMG_MAX) {
      let lo = 0;
      for (let i = 1; i < dmgLive.length; i++) if (dmgLive[i].v < dmgLive[lo].v) lo = i;
      if (dmgLive[lo].v >= size) return; // this hit is the smallest: no number
      dmgLive[lo].t = dmgLive[lo].life; // cull the smallest on screen
      dmgLive.splice(lo, 1);
    }
  }
  float(e.x + (Math.random() - 0.5) * 24, e.y - 14, label, color, Math.round(DMG_PX_MIN + DMG_PX_SPAN * rel), 0.8 + 1.2 * rel, 1, 30, true);
  const f = fx[fx.length - 1];
  f.v = size; dmgLive.push(f);
}
const BLEED_CRIT_MUL = 2;
function damage(e, amt, t, quiet = false, crit = false, st = null) {
  if (e.dead) return;
  if (e.charge && !staticQuiet && t) dischargeStatic(e); // ARC Static: ANY tower's hit sets the charges off, the charging ARC's too (aspira-skills.js)
  // a shield eats one whole HIT, whatever its size (poison/splash just bounce) -
  // SOL's included (owner: stripping shields is ACD's job, its ticks pop them)
  if (e.shield > 0 && !(st && st.ignoreShield)) {
    if (quiet) return;
    e.shield--;
    fx.push({ k: "hit", x: e.x, y: e.y, r: 18, m: 1, color: "cyan", t: 0, life: 0.07 });
    // all of it soaked: a "0" in SHIELD blue, as BIG as the hit it swallowed (owner)
    dmgNumber(e, "0", amt, "cyan");
    return;
  }
  // BLEED (SOL's Impale): every OTHER tower may crit a bleeding enemy too, for
  // x BLEED_CRIT_MUL (SOL rolls the bleed into its own crit, rayHit)
  if (!quiet && !crit && e.bleedCrit > 0 && !(t && t.kind === "sol") && Math.random() < e.bleedCrit) { crit = true; amt *= BLEED_CRIT_MUL; }
  if (e.shredT > 0) amt *= e.shredMul;
  if (e.slowT > 0 && e.brittle) amt *= e.brittle;
  // armor takes a flat bite out of every hit (never below 10% of it)
  const raw = amt;
  // (SOL ignored armor until 2026-10-07; owner: "SOL should no longer ignore armor" - its damage rose x1.3 to match, solarmor.mjs)
  const pierce = (st && st.armorPierce) || 0;
  if (e.armor > 0 && !quiet && pierce < 1) amt = Math.max(amt * 0.1, amt - e.armor * (1 - pierce));
  // NEGATIVE armor (ACD's Corrosion, owner) is a flat bonus on every hit
  else if (e.armor < 0 && !quiet) amt -= e.armor;
  const blunted = amt < raw;
  // per-tower tally: damage counts only up to the HP the enemy had left
  if (t) t.dealt = (t.dealt || 0) + Math.min(amt, Math.max(0, e.hp));
  amt = bossHitCap(e, amt); // Justice / Death cap a single hit (aspira-bosses.js)
  e.hp -= amt;
  if (!quiet) {
    // impact flash sized and lit by the damage; big hits also throw sparks
    const m = dmgMag(amt), col = t ? TOWERS[t.kind].color : "orange";
    fx.push({ k: "hit", x: e.x, y: e.y, r: 5 + 8 * m, m, color: col, t: 0, life: 0.05 + 0.027 * m });
    if (m > 1.2) burst(e.x, e.y, col, Math.round(m * 3));
    // damage number, jittered so rapid hits don't stack
    // armor-blunted hits read dim grey (the graticule's Silver), the rest white
    // sized by the hit BEFORE armor (owner): a big hit blunted to little still reads big, in grey
    dmgNumber(e, String(dmgUnits(amt)), raw, crit ? "orange" : blunted ? "grid" : "white");
  }
  if (e.hp <= 0) kill(e, t);
}

// Side effects of a landed hit, from the tower's upgrade mods.
function onHit(e, t, st, amt) {
  if (st.shred) applyMark(e, st.shred.mul, st.shred.t, t ? t.id : "x");
  if (st.dot) { e.dotDps = Math.max(e.dotT > 0 ? e.dotDps : 0, amt * st.dot.frac / st.dot.t); e.dotT = st.dot.t; e.dotSrc = t; }
  if (st.stun && Math.random() < st.stun.p) e.stunT = Math.max(e.stunT, st.stun.t);
  if (st.hitSlow) applySlow(e, st.hitSlow.f, st.hitSlow.t, t ? t.id : "x");
  // Melt (ARC): every hit strips armor for good, past zero (owner: every armor
  // reduction is permanent and may go negative), so later hits land harder
  if (st.armorShred) e.armor = (e.armor || 0) - st.armorShred;
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

// DEBUFF SHAPES (owner, 2026-10-05). Every slow and every damage mark is held
// PER SOURCE (a tower's id, a blast, ...) and has a SHAPE that decides what a
// re-hit from the SAME source does:
//   "refresh"  one per source, TIMES OUT; a re-hit resets its timer (the default)
//   "once"     one per source, PERMANENT; a re-hit does nothing (Permafrost)
//   "stack"    every hit adds a PERMANENT stack of its own
// Different sources always stack, MULTIPLICATIVELY (owner): speed x (1 - s1) x
// (1 - s2)..., so two 30% slows leave 49%; damage taken x m1 x m2 ... A slow
// never passes SLOW_CAP by stacking (a single stronger one - Deep Freeze's 95%
// - still holds). FRZ hits Fast enemies twice as hard (owner): double the
// slow, up to FAST_SLOW_CAP.
const FAST_SLOW_MUL = 2, FAST_SLOW_CAP = 0.96, SLOW_CAP = 0.9;
let debuffSeq = 0;
function addDebuff(map, src, v, dur, shape) {
  if (shape === "stack") { map[src + "#" + ++debuffSeq] = { v, t: Infinity }; return; }
  const d = map[src];
  if (shape === "once") { if (!d) map[src] = { v, t: Infinity }; return; }
  map[src] = { v: d && d.t > 0 ? Math.max(d.v, v) : v, t: d && d.t === Infinity ? Infinity : dur };
}
function applySlow(e, f, dur, src = "x", shape = "refresh") {
  if (e.arcana) { f *= bossSlowMul(e); if (f <= 0) return true; } // Strength / Death (aspira-bosses.js)
  if (e.type === "fast") f = Math.max(f, Math.min(FAST_SLOW_CAP, f * FAST_SLOW_MUL));
  addDebuff(e.slows ||= {}, src, f, dur, shape);
  sumSlows(e);
  return true;
}
// age every slow by dt, drop the spent ones, and fold the rest into e.slowF /
// e.slowT (what effSpeed, Brittle, Shatter and the drawing read)
function sumSlows(e, dt = 0) {
  let keep = 1, top = 0, t = 0;
  for (const k in e.slows) {
    const s = e.slows[k];
    s.t -= dt;
    if (!(s.t > 0)) { delete e.slows[k]; continue; }
    keep *= 1 - s.v; top = Math.max(top, s.v); t = Math.max(t, s.t);
  }
  e.slowF = Math.min(Math.max(SLOW_CAP, top), 1 - keep);
  e.slowT = t;
}
// a damage-taken MARK (SOL's shred, ARC's Static): the same shapes, x mul each
function applyMark(e, mul, dur, src = "x", shape = "refresh") {
  addDebuff(e.marks ||= {}, src, mul, dur, shape);
  sumMarks(e);
}
function sumMarks(e, dt = 0) {
  let m = 1, t = 0;
  for (const k in e.marks) {
    const d = e.marks[k];
    d.t -= dt;
    if (!(d.t > 0)) { delete e.marks[k]; continue; }
    m *= d.v; t = Math.max(t, d.t);
  }
  e.shredMul = m; e.shredT = t; // what damage() and debuffed() read
}

// damage for one shot at one enemy: EMP's armored bonus and the every-Nth-shot charge
function shotDamage(t, st, e, base) {
  let d = base;
  if (st.armorMul && e.armor) d *= st.armorMul;
  if (st.everyN && t.shots % st.everyN.n === 0) d *= st.everyN.mul;
  return d;
}

function kill(e, t) {
  if (bossRise(e)) return; // Judgement / Death rise once (aspira-bosses.js)
  e.dead = true;
  if (t) t.kills = (t.kills || 0) + 1;
  const mul = (e.markT > 0 ? e.markMul : 1) * (G.power.MNY > 0 ? 2 : 1) * (e.slowT > 0 && e.siphon ? e.siphon : 1);
  const b = e.bounty * mul;
  G.money += b;
  sfx("kill");
  float(e.x, e.y - 30, "+" + (b < 10 ? +b.toFixed(1) : Math.round(b)) + "c", "orange", 18, 2.0); // small (owner); credits read "Nc", all gold here
  fx[fx.length - 1].shrink = true; // it holds, then shrinks + fades like a damage number (owner)
  addScore(Math.round(b * 10));
  G.charge = Math.min(POWER_FULL, G.charge + 1);
  burst(e.x, e.y, ENEMIES[e.type].color, 14);
  if (e.type === "bonus") { if (bossPays(e)) bonusDrop(e); bossKilled(e); } // the last Devil pays; a Lover's mate enrages (aspira-bosses.js)
  if (e.shatter && e.slowT > 0 && !shattering) shatterAt(e); // FRZ's Shatter
  if (e.charged) staticDischarge(e); // ARC's Static (the old path)
  // the chart ARC's Static: a charged enemy that DIES lets its charges go too
  // (owner) - unless a Static blast killed it (no chain reaction)
  if (e.charge && !staticQuiet) dischargeStatic(e);
}

// LIVES come in multiples of LIFE_STEP 6 - a ring's first side count (owner, 2026-10-04)
const LIFE_STEP = 6;
// the star drops +12 LIVES (was +10) or +1% INTEREST (was +5%), half and half (owner, 2026-10-02:
// never score, no credits; x10 since it now comes every 10th wave); fixed
// per wave, like the waves
function bonusDrop(e) {
  if (fixedRand(e.n, 4) < 0.5) { G.lives += 2 * LIFE_STEP; float(e.x, e.y - 18, "+" + 2 * LIFE_STEP + " lives", "cyan"); }
  else { G.interest += 0.01; float(e.x, e.y - 18, "+1% interest", "cyan"); } // owner: was +5%, too much compounding
}

function addScore(n) {
  G.score += n * (G.power.SCR > 0 ? 2 : 1);
  while (G.score >= G.nextLifeAt) {
    G.lives += LIFE_STEP; sfx("life"); banner("+" + LIFE_STEP + " lives");
    G.nextLifeAt = G.nextLifeAt < 100000 ? 100000 : G.nextLifeAt + 100000;
  }
}

// ---------- fx ----------
// Effect magnitude from damage: ~0.9 for a 4-damage tick, ~2.3 for an 80
// hit, capped at 3 (a big crit). 0 for no damage (the Slower's beam).
const dmgMag = d => (d > 0 ? Math.min(3, 0.5 + Math.sqrt(d * VIS_DMG) / 5) : 0); // VIS_DMG: sized as before the halving
// slim: RPR's beam - half the width, brighter glow (owner).
// follow: the beam keeps hold of its two endpoint objects (tower, enemy) and
// is redrawn between them every frame while it lasts, so it tracks a moving
// target; follow = false draws a fixed line between the start points.
// EVERY beam's thickness follows the damage of its hit (owner): beamWidth()
// scales with sqrt(hit / biggest hit seen), the curve damage numbers size on
// beam thickness is ABSOLUTE (owner, 2026-10-05): it depends on the hit's own
// damage alone, never on the biggest hit so far (that is the damage numbers'
// rule). Damage runs from ~5 to 100k+ over a game, so it is LOGARITHMIC:
// 10 -> 2.0, 100 -> 3.6, 1k -> 5.2, 10k -> 6.8, 100k -> 8.4, capped at BEAM_MAX
const BEAM_MIN = 0.4, BEAM_PER_DECADE = 1.6, BEAM_MAX = 10;
const beamWidth = d => Math.min(BEAM_MAX, BEAM_MIN + BEAM_PER_DECADE * Math.log10(1 + Math.max(0, d * VIS_DMG)));
// every beam lasts BEAM_LIFE_MUL x its asked life and draws BEAM_BRIGHT x as
// bright (owner, 2026-10-06: "twice as long and twice as bright"; drawFx)
const BEAM_LIFE_MUL = 2, BEAM_BRIGHT = 2;
function beam(a, b, color, life, w = 1.5, dmg = 0, slim = false, follow = true) {
  fx.push({ k: "beam", x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, t: 0, life: life * BEAM_LIFE_MUL, w, d: dmg, m: dmgMag(dmg), slim,
    a: follow ? a : null, b: follow ? b : null });
}
function ring(x, y, r, color, life = 0.12, grad = false, outline = true) { fx.push({ k: "ring", x, y, r, color, t: 0, life, grad, outline }); }
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
      if (e.arcana) bossStep(e, dt); // the bosses' tricks (aspira-bosses.js)
      if (e.biteT > 0) e.biteT -= dt; // Frostbite tint
      if (e.corrodeT > 0) e.corrodeT -= dt; // Corrosion ring
      if (e.burnT > 0) e.burnT -= dt; // under an ACD burn (Fresh targeting)
      if (e.marks) sumMarks(e, dt);
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
      const before = G.lives;
      G.lives -= ENEMIES[e.type].leak || 1;
      sfx("leak"); shakeScreen();
      ring(e.x, e.y, 40, "pink", 0.17);
      // a BOSS that gets through ends the game outright (owner, 2026-10-02)
      if (ENEMIES[e.type].star) { G.lives = 0; G.breachBy = e.arcana; } // the end title names the boss (BOSS_BREACH)
      const lw = e.wave || G.wave; // lives lost per wave it CAME from (owner), for the end screen
      (G.leaks ||= {})[lw] = (G.leaks[lw] || 0) + before - Math.max(0, G.lives);
      if (G.lives <= 0) { G.lives = 0; gameOver(); return; }
    }
  }
  G.enemies = G.enemies.filter(e => !e.gone);
}

function step(dt) {
  if (G.over || !G.started) return;
  G.clock = (G.clock || 0) + dt; // game time (aspira-positioning.js paces its predictions on it)
  for (const k in G.power) if (G.power[k] > 0) G.power[k] = Math.max(0, G.power[k] - dt);
  stepCore(dt); // the core's powers: cooldowns, Temporal's ring, Fortifications' copy firing (aspira-core.js)
  // the next wave goes when its timer runs out, or the moment the field
  // clears (owner): nothing alive, nothing still queued to spawn
  // ...except the BOSS holds the timer (owner): nothing new comes until it
  // is dead (or through), then the field is clear and the next wave goes
  if (!bossUp()) G.nextIn -= dt;
  // the game is WON when the 10th boss (wave WIN_WAVE) falls (owner)
  // (no wave after it: the field plays out, then the clear wins)
  if (G.wave >= WIN_WAVE) { if (waveClear()) { winGame(); return; } }
  else if (G.nextIn <= 0 || waveClear()) { sendWave(); return; }
  stepSpawns(dt);
  stepEnemies(dt);
  if (G.over) return;
  stepChains(dt);
  for (const t of G.towers) {
    t.spin = (t.spin || 0) + dt; // game-time clock for anything that orbits (FRZ's moons)
    moveTower(t, dt); // slides along its spoke after its target (aspira-towers.js)
    if (t.kind === "frz" && hasSkills(t)) { frzStep(t, dt); continue; } // the chart FRZ: an aura, every step (aspira-skills.js)
    if (t.kind === "sol") { stepSol(t, dt); continue; }
    if (t.kind === "acd") { stepAcd(t, dt); continue; }
    t.cd -= dt;
    if (t.cd > 0) continue;
    const st = towerStats(t);
    let fired = false;
    for (let i = 0, n = t.kind === "arc" ? relayMul(t) : 1; i < n; i++) fired = fire(t, st) || fired; // the Orbital Relay: an ARC attacks three times (aspira-core.js)
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
  dmgLive = dmgLive.filter(f => f.t < f.life);
}

const WIN_WAVE = 100; // the 10th boss
function winGame() {
  G.over = true; G.won = true;
  best.ascended = true; // the title reads ASCENDANT from now on (owner; aspira-ui.js)
  addScore(G.lives * 1000);
  if (G.score > best.score) best.score = G.score;
  if (G.wave > best.wave) best.wave = G.wave;
  try { localStorage.setItem("aspira.best", JSON.stringify(best)); } catch (_e) {}
  if (typeof renderEndStats === "function") renderEndStats();
  showOverlay("ascendant", // the win title (owner, 2026-10-06; was "the core holds")
    "All ten bosses down with " + G.lives + " lives left.", "Play again");
}
function gameOver() {
  G.over = true;
  sfx("over");
  if (G.score > best.score) best.score = G.score;
  if (G.wave > best.wave) best.wave = G.wave;
  try { localStorage.setItem("aspira.best", JSON.stringify(best)); } catch (_e) {}
  if (typeof renderEndStats === "function") renderEndStats(); // the end screen's tower + leak stats (aspira-endstats.js)
  showOverlay((G.breachBy && BOSS_BREACH[G.breachBy]) || "core breached", "Reached wave " + G.wave + (G.wave >= (best.wave || 0) ? ", your best." : " (best: " + best.wave + ")."), "Play again");
}
