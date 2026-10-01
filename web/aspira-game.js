// /aspira — game state and simulation: waves, economy, targeting, combat, fx.

let fx = [];
let best = { score: 0, wave: 0 };
try { best = JSON.parse(localStorage.getItem("aspira.best")) || best; } catch (_e) {}

function newGame() {
  return {
    money: 100, lives: 20, score: 0, wave: 0, interest: 0.03,
    towers: [], enemies: [], spawns: [], nextIn: 0, started: false, over: false,
    power: { SCR: 0, RNG: 0, MNY: 0, DAM: 0 }, charge: 0,
    nextLifeAt: 50000, id: 1,
  };
}

let G = newGame();

// ---------- waves ----------
function makeWave(n) {
  const count = Math.min(10 + Math.floor(n * 0.5), 28), m = n % 4, list = [];
  for (let i = 0; i < count; i++) {
    let type = m === 1 ? "norm" : m === 2 ? "fast" : m === 3 ? "hard" : ["norm", "fast", "hard"][i % 3];
    if (n < 3 && type === "hard") type = "norm";
    list.push(type);
  }
  if (n >= 3) list[Math.floor(Math.random() * count)] = "bonus";
  if (n % 8 === 0) list.push("boss");
  return list;
}

// Interest is paid on what you hold at the moment a wave is sent, so saving
// beats spending early. Sending before the countdown ends pays the seconds left.
function sendWave() {
  if (G.over) return;
  if (G.wave > 0 && G.nextIn > 0) {
    const early = Math.ceil(G.nextIn);
    G.money += early; addScore(early * 10);
    float(CX, CY - 80, "+" + early + " early", "orange");
  }
  const gain = Math.floor(G.money * G.interest);
  if (gain > 0) { G.money += gain; float(CX, CY + 80, "+" + gain + " interest", "green"); }
  G.wave++;
  if (G.wave > 1 && (G.wave - 1) % 8 === 0) blockBonus();
  G.spawns.push({ n: G.wave, list: makeWave(G.wave), lanes: laneMap(G.wave), idx: 0, timer: 0 });
  G.nextIn = 22;
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

// Lanes in use right now (live enemies or spawns still queued), with the
// colour of the type using them; feeds the lane highlight in aspira-draw.js.
function activeLanes() {
  const out = new Map();
  for (const e of G.enemies) if (!out.has(e.pi)) out.set(e.pi, ENEMIES[e.type].color);
  for (const w of G.spawns) {
    for (let i = w.idx; i < w.list.length; i++) {
      const pi = w.lanes[w.list[i]];
      if (!out.has(pi)) out.set(pi, ENEMIES[w.list[i]].color);
    }
  }
  return out;
}

function spawnEnemy(type, n, pi) {
  const d = ENEMIES[type], p0 = PATHS[pi].pts[0];
  const hp = (18 * Math.pow(1.15, n - 1) + n * 4) * d.hp;
  G.enemies.push({
    id: G.id++, type, hp, max: hp, pi, s: 0, x: p0.x, y: p0.y, rot: Math.random() * 6,
    bounty: Math.ceil((2 + n * 0.35) * d.bounty), slowF: 0, slowT: 0, stunT: 0, markT: 0, markMul: 1,
  });
}

// ---------- combat ----------
const effSpeed = e => ENEMIES[e.type].speed * PATHS[e.pi].pace * (e.stunT > 0 ? 0 : 1 - (e.slowT > 0 ? e.slowF : 0));

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

function damage(e, amt, t) {
  if (e.dead) return;
  e.hp -= amt;
  if (e.hp <= 0) kill(e, t);
}

function kill(e, t) {
  e.dead = true;
  const mul = (e.markT > 0 ? e.markMul : 1) * (G.power.MNY > 0 ? 2 : 1);
  const b = Math.round(e.bounty * mul);
  G.money += b;
  addScore(b * 10);
  G.charge = Math.min(POWER_FULL, G.charge + (e.type === "boss" ? 6 : 1));
  burst(e.x, e.y, ENEMIES[e.type].color, e.type === "boss" ? 40 : 14);
  if (t && t.kind === "reaper" && Math.random() < towerStats(t).life) {
    G.lives++; float(e.x, e.y - 18, "+1 life", "glow");
  }
  if (e.type === "bonus") bonusDrop(e);
}

function bonusDrop(e) {
  const r = Math.floor(Math.random() * 4);
  if (r === 0) { addScore(2000); float(e.x, e.y - 18, "+2000", "cyan"); }
  else if (r === 1) { G.lives++; float(e.x, e.y - 18, "+1 life", "cyan"); }
  else if (r === 2) { G.charge = POWER_FULL; float(e.x, e.y - 18, "power full", "cyan"); }
  else { G.interest += 0.005; float(e.x, e.y - 18, "+0.5% interest", "cyan"); }
}

function addScore(n) {
  G.score += n * (G.power.SCR > 0 ? 2 : 1);
  while (G.score >= G.nextLifeAt) {
    G.lives++; banner("extra life");
    G.nextLifeAt = G.nextLifeAt < 100000 ? 100000 : G.nextLifeAt + 100000;
  }
}

function fireChain(t, st, e) {
  const hit = new Set([e.id]), col = TOWERS[t.kind].color;
  let cur = e, dmg = st.dmg;
  beam(t, e, col, 0.15); damage(e, dmg, t);
  for (let i = 0; i < st.chains; i++) {
    let nxt = null, nd = 90 * 90;
    for (const o of G.enemies) {
      if (o.dead || hit.has(o.id)) continue;
      const d = (o.x - cur.x) ** 2 + (o.y - cur.y) ** 2;
      if (d < nd) { nd = d; nxt = o; }
    }
    if (!nxt) break;
    dmg *= 0.75; hit.add(nxt.id); beam(cur, nxt, col, 0.15); damage(nxt, dmg, t); cur = nxt;
  }
}

function fireSlower(t, st) {
  // unslowed enemies first, so three towers do not all chill the same three
  const cands = pickTargets(t, st, 99).sort((a, b) => (a.slowT > 0) - (b.slowT > 0)).slice(0, st.targets);
  for (const e of cands) {
    e.slowF = Math.max(e.slowT > 0 ? e.slowF : 0, st.slow); e.slowT = 2.5;
    beam(t, e, TOWERS[t.kind].color, 0.2);
  }
  return cands.length > 0;
}

function fire(t, st) {
  if (t.kind === "slower") return fireSlower(t, st);
  const [e] = pickTargets(t, st, 1);
  if (!e) return false;
  const col = TOWERS[t.kind].color, boss = e.type === "boss";
  switch (t.kind) {
    case "chain": fireChain(t, st, e); break;
    case "nuke": {
      const crit = Math.random() < st.crit;
      beam(t, e, col, 0.25, crit ? 5 : 3);
      ring(e.x, e.y, crit ? 40 : 24, col);
      if (crit) float(e.x, e.y - 20, "CRIT", col);
      damage(e, st.dmg * (crit ? 3 : 1), t);
      break;
    }
    case "pusher":
      beam(t, e, col, 0.2, 3);
      e.s = Math.max(0, e.s - st.push * PATHS[e.pi].pace * (boss ? 0.4 : 1));
      damage(e, st.dmg, t);
      break;
    case "stopper":
      beam(t, e, col, 0.2);
      e.stunT = Math.max(e.stunT, st.stun * (boss ? 0.4 : 1));
      damage(e, st.dmg, t);
      break;
    case "gold":
      beam(t, e, col, 0.15);
      e.markT = 5; e.markMul = Math.max(e.markMul, st.mark);
      damage(e, st.dmg, t);
      break;
    default:
      beam(t, e, col, t.kind === "rapid" ? 0.06 : 0.15, t.kind === "reaper" ? 3 : 1.5);
      damage(e, st.dmg, t);
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
    for (const e of G.enemies) { burst(e.x, e.y, "orange", 6); damage(e, e.max * (e.type === "boss" ? 0.15 : 0.45), null); }
    ring(CX, CY, 480, "orange", 0.6); banner("blast");
  } else {
    G.power[code] = POWER_TIME;
    banner(POWERS.find(p => p[0] === code)[1].toLowerCase());
  }
}

// ---------- fx ----------
function beam(a, b, color, life, w = 1.5) { fx.push({ k: "beam", x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, t: 0, life, w }); }
function ring(x, y, r, color, life = 0.35) { fx.push({ k: "ring", x, y, r, color, t: 0, life }); }
function float(x, y, text, color) { fx.push({ k: "text", x, y, text, color, t: 0, life: 1.1 }); }
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
      w.timer += type === "fast" ? 0.35 : type === "boss" ? 1.2 : 0.55;
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
    e.s += effSpeed(e) * dt;
    e.rot += dt * (e.stunT > 0 ? 0 : 1.5);
    const p = pathAt(e.pi, e.s); e.x = p.x; e.y = p.y;
    if (e.s >= PATHS[e.pi].len) {
      e.dead = true;
      G.lives -= e.type === "boss" ? 5 : 1;
      ring(e.x, e.y, 40, "pink", 0.5);
      if (G.lives <= 0) { G.lives = 0; gameOver(); return; }
    }
  }
  G.enemies = G.enemies.filter(e => !e.dead);
}

function step(dt) {
  if (G.over || !G.started) return;
  for (const k in G.power) if (G.power[k] > 0) G.power[k] = Math.max(0, G.power[k] - dt);
  G.nextIn -= dt;
  if (G.nextIn <= 0) sendWave();
  stepSpawns(dt);
  stepEnemies(dt);
  if (G.over) return;
  for (const t of G.towers) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    const st = towerStats(t);
    t.cd = fire(t, st) ? 1 / st.rate : 0.05;
  }
  G.enemies = G.enemies.filter(e => !e.dead);
}

function stepFx(dt) {
  for (const f of fx) {
    f.t += dt;
    if (f.k === "spark") { f.x += f.vx * dt; f.y += f.vy * dt; }
    if (f.k === "text") f.y -= 30 * dt;
  }
  fx = fx.filter(f => f.t < f.life);
  if (bannerT > 0) bannerT -= dt;
}

function gameOver() {
  G.over = true;
  if (G.score > best.score) best.score = G.score;
  if (G.wave > best.wave) best.wave = G.wave;
  try { localStorage.setItem("aspira.best", JSON.stringify(best)); } catch (_e) {}
  showOverlay("core breached", "Reached wave " + G.wave + " with " + G.score.toLocaleString() + " points.", "Play again");
}
