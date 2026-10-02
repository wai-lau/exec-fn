// /aspira — game state and simulation: waves, economy, targeting, combat, fx.

let fx = [];
let best = { score: 0, wave: 0 };
try { best = JSON.parse(localStorage.getItem("aspira.best")) || best; } catch (_e) {}

// TESTING: the owner asked to start rich while designing; the real start is 100
const START_MONEY = 10000;

function newGame() {
  return {
    money: START_MONEY, lives: 20, score: 0, wave: 0, interest: 0.03,
    towers: [], enemies: [], spawns: [], nextIn: 0, started: false, over: false,
    power: { SCR: 0, RNG: 0, MNY: 0, DAM: 0 }, charge: 0,
    nextLifeAt: 50000, id: 1,
  };
}

let G = newGame();

// ---------- waves ----------
const WAVE_GAP = 15;
const waveClear = () => G.enemies.length === 0 && G.spawns.length === 0;
// Waves rotate through themes so each counter tower gets its moment; waves
// 1-6 introduce them in order. Swarm waves are three times as many enemies.
const WAVE_THEMES = ["norm", "swarm", "fast", "shield", "armor", "mixed"];
const MIXED = ["norm", "swarm", "swarm", "fast", "shield", "armor"];
function makeWave(n) {
  const theme = WAVE_THEMES[(n - 1) % WAVE_THEMES.length], list = [];
  let count = Math.min(10 + Math.floor(n * 0.5), 28);
  if (theme === "swarm") count = Math.min(count * 3, 70);
  for (let i = 0; i < count; i++) list.push(theme === "mixed" ? MIXED[i % MIXED.length] : theme);
  if (n >= 3) list[Math.floor(Math.random() * count)] = "bonus";
  return list;
}

// Interest is paid on what you hold at the moment a wave is sent, so saving
// beats spending early. Sending before the countdown ends pays the seconds left.
function sendWave() {
  if (G.over) return;
  if (G.wave > 0 && G.nextIn > 0) {
    const early = Math.ceil(G.nextIn);
    G.money += early; addScore(early * 10);
    float(CX, CY - 80, "+" + early + " early", "orange", 28, 11, 1, 3);
  }
  const gain = Math.floor(G.money * G.interest);
  if (gain > 0) { G.money += gain; float(CX, CY + 80, "+" + gain + " interest", "green", 28, 11, 1, 3); }
  G.wave++;
  if (G.wave > 1 && (G.wave - 1) % 8 === 0) blockBonus();
  sfx("wave");
  G.spawns.push({ n: G.wave, list: makeWave(G.wave), lanes: laneMap(G.wave), idx: 0, timer: 0 });
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

// Lanes in use right now (live enemies or spawns still queued): lane ->
// { color, n } with the riding type's colour and its wave number; feeds the
// lane highlight and the wave:track labels in aspira-draw.js.
function activeLanes() {
  const out = new Map();
  for (const e of G.enemies) if (!out.has(e.pi)) out.set(e.pi, { color: ENEMIES[e.type].color, n: e.n });
  for (const w of G.spawns) {
    for (let i = w.idx; i < w.list.length; i++) {
      const pi = w.lanes[w.list[i]];
      if (!out.has(pi)) out.set(pi, { color: ENEMIES[w.list[i]].color, n: w.n });
    }
  }
  return out;
}

// Enemies appear where their lane enters the visible area (plus a margin),
// not at the far end of the lead-in, so none spend ages travelling unseen.
function entryS(pi) {
  const m = 60, x0 = -cam.ox / cam.k - m, y0 = -cam.oy / cam.k - m;
  const x1 = (cv.width - cam.ox) / cam.k + m, y1 = (cv.height - cam.oy) / cam.k + m;
  const p = PATHS[pi].pts.find(q => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1);
  return p ? p.s : 0;
}

function spawnEnemy(type, n, pi) {
  const d = ENEMIES[type], s0 = entryS(pi), p0 = pathAt(pi, s0);
  const hp = (18 * Math.pow(1.15, n - 1) + n * 4) * d.hp;
  const shield = d.shield ? d.shield + Math.floor(n / 3) : 0;
  G.enemies.push({
    armor: d.armor ? d.armor * (1 + 0.12 * (n - 1)) : 0, shield, shieldMax: shield,
    // swarm members wander off the lane line on their own small loop
    jit: type === "swarm" ? 6 + Math.random() * 14 : 0, ph: Math.random() * 6.283,
    id: G.id++, type, n, hp, max: hp, pi, s: s0, x: p0.x, y: p0.y, rot: Math.random() * 6,
    bounty: Math.ceil((2 + n * 0.35) * d.bounty), slowF: 0, slowT: 0, stunT: 0, markT: 0, markMul: 1,
  });
}

// ---------- combat ----------
// Global enemy pace (owner: everything at half speed). Spawn gaps are divided
// by it too, so enemies stay the same DISTANCE apart on the lane — that
// spacing is a balance lever for chain reach.
const ENEMY_SPEED = 0.5;
const effSpeed = e => ENEMIES[e.type].speed * ENEMY_SPEED * PATHS[e.pi].pace * (e.stunT > 0 ? 0 : 1 - (e.slowT > 0 ? e.slowF : 0));

const MODE_KEY = {
  close: a => a.d,
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
function damage(e, amt, t, quiet = false) {
  if (e.dead) return;
  // a shield eats one whole HIT, whatever its size (poison/splash just bounce)
  if (e.shield > 0) {
    if (quiet) return;
    e.shield--;
    fx.push({ k: "hit", x: e.x, y: e.y, r: 18, m: 1, color: "cyan", t: 0, life: 0.2 });
    float(e.x + (Math.random() - 0.5) * 24, e.y - 14, "0", "grid", 22, 1.2, 1, 30, true); // all of it soaked: dim grey, like armor
    return;
  }
  if (e.shredT > 0) amt *= e.shredMul;
  if (e.slowT > 0 && e.brittle) amt *= e.brittle;
  // armor takes a flat bite out of every hit (never below 10% of it)
  const raw = amt;
  if (e.armor && !quiet) amt = Math.max(amt * 0.1, amt - e.armor);
  const blunted = amt < raw;
  e.hp -= amt;
  if (!quiet) {
    // impact flash sized and lit by the damage; big hits also throw sparks
    const m = dmgMag(amt), col = t ? TOWERS[t.kind].color : "orange";
    fx.push({ k: "hit", x: e.x, y: e.y, r: 5 + 8 * m, m, color: col, t: 0, life: 0.15 + 0.08 * m });
    if (m > 1.2) burst(e.x, e.y, col, Math.round(m * 3));
    // damage number, jittered so rapid hits don't stack
    // armor-blunted hits read dim grey (the graticule's Silver), the rest white
    float(e.x + (Math.random() - 0.5) * 24, e.y - 14, String(Math.round(amt)), blunted ? "grid" : "white", 22, 1.2, 1, 30, true);
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
    ring(e.x, e.y, st.splash.r, TOWERS[t.kind].color, 0.3);
    for (const o of G.enemies) {
      if (o === e || o.dead) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) <= st.splash.r) damage(o, amt * st.splash.frac, t, true);
    }
  }
}

// Slow resistances (owner's balance grid): armored enemies are immune, a
// standing shield halves the slow. Returns whether any slow landed.
function applySlow(e, f, dur) {
  if (e.armor) return false;
  if (e.shield > 0) f *= 0.5;
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
  const mul = (e.markT > 0 ? e.markMul : 1) * (G.power.MNY > 0 ? 2 : 1) * (e.slowT > 0 && e.siphon ? e.siphon : 1);
  const b = Math.round(e.bounty * mul);
  G.money += b;
  sfx("kill");
  float(e.x, e.y - 30, "+" + b, "orange", 30, 2.0);
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

// Chain lightning: one strike, then arcs fan out from the struck enemy all
// at once (owner: no delay).
const CHAIN_BEAM_LIFE = 0.6, RAY_BEAM_LIFE = 3; // RPR: 3s (owner: a third of 9s)
function fireChain(t, st, e) {
  const col = TOWERS[t.kind].color, dmg = shotDamage(t, st, e, st.dmg);
  beam(t, e, col, CHAIN_BEAM_LIFE, 1.5, dmg); damage(e, dmg, t); onHit(e, t, st, dmg);
  if (st.arcs <= 0) return;
  // SINGLE LAYER (owner): the first enemy hit is the hub; every arc fans out
  // from it to the nearest unhit enemies in reach, rather than jumping on
  // from the last one. Each arc deals the first hit's damage x arcFall once.
  const c = { t, st, col, src: e, hit: new Set([e.id]), dmg: st.dmg * st.arcFall, left: st.arcs };
  while (hopChain(c));
}

// c.src is the hub: every arc's reach is measured from it
function hopChain(c) {
  const { t, st, col } = c;
  let nxt = null, nd = st.arcRange * st.arcRange;
  for (const o of G.enemies) {
    if (o.dead || c.hit.has(o.id)) continue;
    const d = (o.x - c.src.x) ** 2 + (o.y - c.src.y) ** 2;
    if (d < nd) { nd = d; nxt = o; }
  }
  if (!nxt) return false;
  const d = shotDamage(t, st, nxt, c.dmg);
  c.hit.add(nxt.id); beam(c.src, nxt, col, CHAIN_BEAM_LIFE, 1.5, d);
  damage(nxt, d, t); onHit(nxt, t, st, d);
  return --c.left > 0;
}

function fireSlower(t, st) {
  // unslowed enemies first, so three towers do not all chill the same three
  const cands = pickTargets(t, st, 9999).sort((a, b) => (a.slowT > 0) - (b.slowT > 0)).slice(0, st.all ? 9999 : st.targets);
  // SLW draws CONTINUOUS tethers to the enemies it last pulsed (drawTethers),
  // not per-pulse beams; the slow and nick still land once per pulse
  t.links = cands;
  for (const e of cands) {
    const fresh = !(e.slowT > 0);
    if (!applySlow(e, st.slow, 2.5)) continue;
    if (st.chillStop && fresh) e.stunT = Math.max(e.stunT, st.chillStop);
    if (st.brittle) e.brittle = Math.max(e.brittle || 1, st.brittle);
    if (st.siphon) e.siphon = Math.max(e.siphon || 1, st.siphon);
    // each pulse also nicks: st.dmg (+ Sap's % max HP); it is a real hit, so
    // it pops one shield charge per enemy touched (owner)
    const nick = st.dmg + (st.sap ? e.max * st.sap : 0);
    if (nick > 0) damage(e, nick, t);
  }
  return cands.length > 0;
}

// Ray: one roll for crit per shot; Assassin always crits low-HP targets.
// Lance forms pierce every enemy within `wide` of the beam, losing `fall`
// of the damage per enemy passed through.
function fireRay(t, st, e) {
  const col = TOWERS[t.kind].color, crit = Math.random() < st.crit;
  const mulFor = o => (crit || (st.critBelow && o.hp / o.max < st.critBelow) ? st.critMul : 1);
  if (!st.pierce) {
    const m = mulFor(e), d = shotDamage(t, st, e, st.dmg) * m;
    beam(t, e, col, RAY_BEAM_LIFE, m > 1 ? 5 : 3, d, true);
    if (m > 1) float(e.x, e.y - 20, "CRIT", col, 16);
    damage(e, d, t); onHit(e, t, st, d);
    return;
  }
  const dx = e.x - t.x, dy = e.y - t.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const end = { x: t.x + ux * st.range, y: t.y + uy * st.range };
  const inLine = G.enemies.filter(o => {
    if (o.dead) return false;
    const px = o.x - t.x, py = o.y - t.y, along = px * ux + py * uy;
    return along >= 0 && along <= st.range && Math.abs(px * uy - py * ux) <= st.pierce.wide;
  }).sort((a, b) => ((a.x - t.x) * ux + (a.y - t.y) * uy) - ((b.x - t.x) * ux + (b.y - t.y) * uy));
  // drawn to (and tracking) the primary target; the pierce damage used `end`
  beam(t, e, col, RAY_BEAM_LIFE, st.pierce.wide > 20 ? 7 : 3, st.dmg, true);
  let base = st.dmg;
  for (const o of inLine) {
    const m = mulFor(o), d = shotDamage(t, st, o, base) * m;
    if (m > 1) float(o.x, o.y - 20, "CRIT", col, 16);
    damage(o, d, t); onHit(o, t, st, d);
    base *= st.pierce.fall;
  }
}

function fire(t, st) {
  if (t.kind === "slower") { const hit = fireSlower(t, st); if (!hit) t.links = []; return hit; }
  const targets = pickTargets(t, st, st.targets);
  if (!targets.length) return false;
  t.shots = (t.shots || 0) + 1;
  if (t.kind === "chain") { fireChain(t, st, targets[0]); return true; }
  if (t.kind === "reaper") { fireRay(t, st, targets[0]); return true; }
  const col = TOWERS[t.kind].color;
  for (const e of targets) {
    const d = shotDamage(t, st, e, st.dmg);
    beam(t, e, col, 0.06, 1.5, d, false, false); damage(e, d, t); onHit(e, t, st, d);
  }
  return true;
}

function usePower(code) {
  if (G.charge < POWER_FULL || G.over) return;
  G.charge = 0;
  if (code === "FRZ") {
    for (const e of G.enemies) e.stunT = Math.max(e.stunT, 4);
    banner("freeze");
  } else if (code === "BOM") {
    for (const e of G.enemies) { burst(e.x, e.y, "orange", 6); damage(e, e.max * 0.45, null); }
    ring(CX, CY, 480, "orange", 0.6); banner("blast");
  } else {
    G.power[code] = POWER_TIME;
    banner(POWERS.find(p => p[0] === code)[1].toLowerCase());
  }
}

// ---------- fx ----------
// Effect magnitude from damage: ~0.9 for a 4-damage tick, ~2.3 for an 80
// hit, capped at 3 (a big crit). 0 for no damage (the Slower's beam).
const dmgMag = d => (d > 0 ? Math.min(3, 0.5 + Math.sqrt(d) / 5) : 0);
// slim: RPR's beam - half the width, brighter glow (owner).
// follow: the beam keeps hold of its two endpoint objects (tower, enemy) and
// is redrawn between them every frame while it lasts, so it tracks a moving
// target; RPD's quick tracers do not (owner).
function beam(a, b, color, life, w = 1.5, dmg = 0, slim = false, follow = true) {
  fx.push({ k: "beam", x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, t: 0, life, w, m: dmgMag(dmg), slim,
    a: follow ? a : null, b: follow ? b : null });
}
function ring(x, y, r, color, life = 0.35) { fx.push({ k: "ring", x, y, r, color, t: 0, life }); }
// vy: upward drift (units/s); long-lived floats drift slowly so they stay on screen
function float(x, y, text, color, size = 28, life = 1.1, alpha = 1, vy = 30, outline = false) {
  fx.push({ k: "text", x, y, text, color, t: 0, life, size, alpha, vy, outline });
}
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = 40 + Math.random() * 120;
    fx.push({ k: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, t: 0, life: 0.4 + Math.random() * 0.3 });
  }
}
let bannerText = "", bannerT = 0;
function banner(t) { bannerText = t; bannerT = 2; }

// ---------- update ----------
function stepSpawns(dt) {
  for (const w of G.spawns) {
    w.timer -= dt;
    while (w.timer <= 0 && w.idx < w.list.length) {
      const type = w.list[w.idx++];
      spawnEnemy(type, w.n, w.lanes[type]);
      // spacing is a balance lever: swarms pack ~11 apart (inside CHN's 70 hop
      // reach), trains spread ~60+ apart (just at or beyond it)
      w.timer += (type === "swarm" ? 0.12 : type === "fast" ? 0.5 : 0.8) / ENEMY_SPEED;
    }
  }
  G.spawns = G.spawns.filter(w => w.idx < w.list.length);
}

function stepEnemies(dt) {
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (e.stunT > 0) e.stunT -= dt;
    if (e.slowT > 0) e.slowT -= dt;
    if (e.markT > 0) e.markT -= dt; else e.markMul = 1;
    if (e.shredT > 0) e.shredT -= dt;
    if (e.dotT > 0) { e.dotT -= dt; damage(e, e.dotDps * dt, e.dotSrc, true); if (e.dead) continue; }
    e.s += effSpeed(e) * dt;
    const p = pathAt(e.pi, e.s); e.x = p.x; e.y = p.y;
    // no free spin: one corner points along the lane, nose first
    const ahead = pathAt(e.pi, e.s + 3);
    if (ahead.x !== p.x || ahead.y !== p.y) e.rot = Math.atan2(ahead.y - p.y, ahead.x - p.x);
    if (e.jit) { e.ph += dt * 2.2; e.x += Math.cos(e.ph) * e.jit; e.y += Math.sin(e.ph * 1.3) * e.jit; }
    if (e.s >= PATHS[e.pi].len) {
      e.dead = true;
      G.lives -= 1;
      sfx("leak");
      ring(e.x, e.y, 40, "pink", 0.5);
      if (G.lives <= 0) { G.lives = 0; gameOver(); return; }
    }
  }
  G.enemies = G.enemies.filter(e => !e.dead);
}

function step(dt) {
  if (G.over || !G.started) return;
  for (const k in G.power) if (G.power[k] > 0) G.power[k] = Math.max(0, G.power[k] - dt);
  // the countdown to the next wave only runs once the field is clear:
  // nothing alive, nothing still queued to spawn
  if (waveClear()) {
    if (ui.auto) { sendWave(); return; }
    G.nextIn -= dt;
    if (G.nextIn <= 0) sendWave();
  }
  stepSpawns(dt);
  stepEnemies(dt);
  if (G.over) return;
  for (const t of G.towers) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    const st = towerStats(t);
    const fired = fire(t, st);
    if (fired) sfx(t.kind);
    t.cd = fired ? 1 / st.rate : 0.05;
  }
  G.enemies = G.enemies.filter(e => !e.dead);
}

function stepFx(dt) {
  for (const f of fx) {
    f.t += dt;
    if (f.k === "spark") { f.x += f.vx * dt; f.y += f.vy * dt; }
    if (f.k === "text") f.y -= f.vy * dt;
  }
  // a beam ends the moment the enemy it points at dies (owner)
  fx = fx.filter(f => f.t < f.life && !(f.k === "beam" && f.b && f.b.dead));
  if (bannerT > 0) bannerT -= dt;
}

function gameOver() {
  G.over = true;
  sfx("over");
  if (G.score > best.score) best.score = G.score;
  if (G.wave > best.wave) best.wave = G.wave;
  try { localStorage.setItem("aspira.best", JSON.stringify(best)); } catch (_e) {}
  showOverlay("core breached", "Reached wave " + G.wave + " with " + G.score.toLocaleString() + " points.", "Play again");
}
