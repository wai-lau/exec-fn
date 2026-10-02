// /aspira — how each tower fires: Chain's instant fan, the Slower's pulse
// and tethers, the Reaper's locked charge and beam, and the fire() dispatcher
// the sim step calls. Shared combat rules (damage, onHit, shotDamage,
// applySlow, kill) stay in aspira-game.js; this file loads right after it.

// Chain lightning: one strike, then arcs fan out from the struck enemy ONE
// AT A TIME, CHAIN_HOP_DELAY apart (owner: the delay is back); an arc that
// kills its target fires the next one at once. Pending chains step in
// stepChains with game time, so the delay scales with game speed.
// RPR fires a bright flash that is gone almost at once (owner); its reload
// is shown by a separate charge-up line instead (stepReaper / drawAims)
const CHAIN_BEAM_LIFE = 0.2, RAY_BEAM_LIFE = 0.083, CHAIN_HOP_DELAY = 0.17;
const REAPER_HOLD = 2; // a Reaper's lock holds out to 2x the range it can start one in
function fireChain(t, st, e) {
  const col = TOWERS[t.kind].color, dmg = shotDamage(t, st, e, st.dmg);
  beam(t, e, col, CHAIN_BEAM_LIFE, 1.5, dmg); damage(e, dmg, t); onHit(e, t, st, dmg);
  if (st.arcs <= 0) return;
  // SINGLE LAYER (owner): the first enemy hit is the hub; every arc fans out
  // from it to the nearest unhit enemies in reach, rather than jumping on
  // from the last one. Each arc deals the first hit's damage x arcFall once.
  const c = { t, st, col, src: e, hit: new Set([e.id]), dmg: st.dmg * st.arcFall, left: st.arcs, killed: false };
  (G.chains ||= []).push({ c, wait: e.dead ? 0 : CHAIN_HOP_DELAY });
}
function stepChains(dt) {
  if (!G.chains || !G.chains.length) return;
  G.chains = G.chains.filter(p => {
    p.wait -= dt;
    while (p.wait <= 0) {
      if (!hopChain(p.c)) return false;
      p.wait += p.c.killed ? 0 : CHAIN_HOP_DELAY;
    }
    return true;
  });
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
  c.killed = nxt.dead;
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
    if (!applySlow(e, st.slow, SLOW_TIME)) continue;
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
// A Reaper CHARGES at one locked target (t.aim) for its whole reload
// (t.period), drawn as a fading-in line by drawAims, then fires at it.
// Owner's rules: if the target dies mid-charge the charge starts over on a
// new one; if it only leaves range the Reaper re-targets but keeps its charge;
// with no target at all it sits uncharged, so every shot is telegraphed.
function stepReaper(t, dt) {
  const st = towerStats(t);
  t.period = 1 / st.rate;
  // two ranges (owner): a lock can only START inside st.range (pickTargets),
  // but once charging it HOLDS out to REAPER_HOLD x that range
  if (t.aim && (t.aim.dead || Math.hypot(t.aim.x - t.x, t.aim.y - t.y) > st.range * REAPER_HOLD)) {
    if (t.aim.dead) t.cd = t.period; // the charge starts over
    t.aim = null;
  }
  if (!t.aim) {
    t.aim = pickTargets(t, st, 1)[0] || null;
    // a fresh lock with no charge built (e.g. a just-placed tower) charges in full
    if (t.aim && t.cd <= 0) t.cd = t.period;
  }
  if (!t.aim) { t.cd = t.period; return; }
  t.cd -= dt;
  if (t.cd > 0) return;
  t.shots = (t.shots || 0) + 1;
  fireRay(t, st, t.aim); sfx(t.kind);
  t.cd = t.period;
}


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

// Rapid fires a SHOTGUN VOLLEY (owner): all RAPID_BURST shots leave at once,
// sprayed WIDE of the target across VOLLEY_SPREAD (~+-70 deg), then curve in on
// it (turn rate starts low and grows with age, so the fan shows and none orbit). Each is a short HOMING LINE that deals its
// damage on arrival; the tower then reloads for RAPID_BURST shots' worth of
// time (same dps). Overkill is the cost: once the target dies, every shot
// still in flight MISSES - it stops homing and flies straight off into the
// distance, fading slowly over MISS_LIFE, so the waste shows. A missed shot
// still COLLIDES (owner): the first live enemy it flies through takes its hit.
const RAPID_BURST = 10, VOLLEY_SPREAD = 2.4, MISSILE_SPEED = 520, MISSILE_LEN = 12;
const MISSILE_LIFE = 2, MISS_LIFE = 3;
function launchMissile(t, st, e, a) {
  (G.missiles ||= []).push({ x: t.x, y: t.y, e, t, st, age: 0, a, miss: 0 });
}
function steer(m, want, dt) {
  let d = want - m.a;
  d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way round
  const turn = (2 + m.age * 60) * dt;
  m.a += Math.max(-turn, Math.min(turn, d));
}
function stepMissiles(dt) {
  if (!G.missiles || !G.missiles.length) return;
  G.missiles = G.missiles.filter(m => {
    m.age += dt;
    const e = m.e;
    if (!m.miss && (e.dead || e.gone)) m.miss = MISS_LIFE; // target gone: this shot is wasted
    if (m.miss) {
      m.miss -= dt;
      if (m.miss <= 0) return false; // flew straight off along its last heading
      const o = missileCollide(m, dt);
      if (o) { const d = shotDamage(m.t, m.st, o, m.st.dmg); damage(o, d, m.t); onHit(o, m.t, m.st, d); return false; }
    } else {
      const dx = e.x - m.x, dy = e.y - m.y, dist = Math.hypot(dx, dy);
      if (m.age > MISSILE_LIFE) return false;
      if (dist <= 6 + MISSILE_SPEED * dt) {
        const d = shotDamage(m.t, m.st, e, m.st.dmg); damage(e, d, m.t); onHit(e, m.t, m.st, d);
        return false;
      }
      steer(m, Math.atan2(dy, dx), dt);
    }
    m.x += Math.cos(m.a) * MISSILE_SPEED * dt; m.y += Math.sin(m.a) * MISSILE_SPEED * dt;
    return true;
  });
}
// the first live enemy within reach of a stray shot's next step
function missileCollide(m, dt) {
  const r = 8 + MISSILE_SPEED * dt, r2 = r * r;
  for (const o of G.enemies) {
    if (o.dead) continue;
    const dx = o.x - m.x, dy = o.y - m.y;
    if (dx * dx + dy * dy <= r2) return o;
  }
  return null;
}
function fireVolley(t, st) {
  const targets = pickTargets(t, st, st.targets);
  if (!targets.length) return false;
  t.shots = (t.shots || 0) + 1;
  for (const e of targets) {
    const aim = Math.atan2(e.y - t.y, e.x - t.x);
    for (let i = 0; i < RAPID_BURST; i++) launchMissile(t, st, e, aim + (i / (RAPID_BURST - 1) - 0.5) * VOLLEY_SPREAD);
  }
  return true;
}

function fire(t, st) {
  if (t.kind === "slower") { const hit = fireSlower(t, st); if (!hit) t.links = []; return hit; }
  if (t.kind === "rapid") return fireVolley(t, st);
  const targets = pickTargets(t, st, st.targets);
  if (!targets.length) return false;
  t.shots = (t.shots || 0) + 1;
  if (t.kind === "chain") { fireChain(t, st, targets[0]); return true; }
  if (t.kind === "reaper") { fireRay(t, st, targets[0]); return true; }
  const col = TOWERS[t.kind].color;
  for (const e of targets) {
    const d = shotDamage(t, st, e, st.dmg);
    beam(t, e, col, 0.02, 1.5, d, false, false); damage(e, d, t); onHit(e, t, st, d);
  }
  return true;
}

function usePower(code) {
  if (G.charge < POWER_FULL || G.over) return;
  G.charge = 0;
  if (code === "FRZ") {
    for (const e of G.enemies) e.stunT = Math.max(e.stunT, 4 / 3);
    banner("freeze");
  } else if (code === "BOM") {
    for (const e of G.enemies) { burst(e.x, e.y, "orange", 6); damage(e, e.max * 0.45, null); }
    ring(CX, CY, 480, "orange", 0.6); banner("blast");
  } else {
    G.power[code] = POWER_TIME;
    banner(POWERS.find(p => p[0] === code)[1].toLowerCase());
  }
}
