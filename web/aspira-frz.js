// /aspira - FRZ's CHART: the aura, the Rime pulses, the moons (split from aspira-skills.js
// at its 500-line cap, 2026-10-08). Loaded right after aspira-skills.js (the simulator too):
// towerStats / the game loop call frzSkillStats, frzStep and drawFrzSkill at run time.

// ---------- FRZ's chart: the aura, the Rime pulses, the moons ----------
// numbers by tier (index 0 = untaken); balance later (owner: ideas first)
// FITTED 2026-10-06 to +25 / +50 / +100% DELAY (enemy-seconds of slow bought
// for the other towers; FRZ + L1 ARC + L1 SOL, waves 20-30) - the first
// guesses were 2-4x too strong; range moves little so "colder" reads as colder
// early-game balance 2026-10-06: +0.03 on every tier (FRZ stays a pure SUPPORT tower - owner)
const FRZ_TEMP_SLOW = [0.4, 0.41, 0.42, 0.43, 0.44, 0.45]; // a small ramp (overnight fit 2026-10-08: even a flat 0.4 overshot - Temp's reach is the next lever) // weakened (owner, 2026-10-08; isolation: Temp V 438% team, leaks 660 -> 56); was .43 .46 .5 .54 .58 // the aura's range is in SKILL_MOVE
// Temp III's TEAM hook (owner, 2026-10-07: FRZ's chart was flat, 97-103%): an enemy
// its aura touches turns BRITTLE - while slowed it takes x FRZ_BRITTLE from every
// tower (damage(), which already reads e.brittle; drawStatus shows the crack)
const FRZ_BRITTLE = [1, 1, 1, 1.15, 1.2, 1.25]; // from III (owner, 2026-10-08: kept at III)
const FRZ_RIME = [0, 0.024, 0.035, 0.054, 0.064, 0.068]; // 2026-10-06: tier I was a dead point (was 1% / 1.9% / 3.7%) // each pulse's permanent stacking slow
// FRZ's own levers (owner: no generic multipliers): Rime pulses MORE OFTEN each tier, the moons are STRONGER copies each tier
const FRZ_RIME_PERIOD = [2, 2, 1.7, 1.4, 1.2, 1], FRZ_MOON_BY = [0.6, 0.85, 0.86, 0.95, 0.95, 0.95]; /* stronger moons for the 140 orbit (2026-10-08; were .485 .515 .58 .58 .58 at 70): isolation I..V ~112 125 151 172 ~225% - V overshoots at any strength >= IV's: five moons that far out cover most of the lanes */ // weakened (owner, 2026-10-08; isolation: Moons V 499% team); was .78 .9 .95 1 1 1 // Moons IV / V: four and five full moons
const FRZ_TICK = 0.5, FRZ_RIME_GROW = 2.4; // a Rime ring takes FRZ_RIME_GROW game s to reach the edge (owner: much slower; was 0.6)
const FRZ_AURA_HOLD = 0.06, FRZ_RIM_W = 16; // the frosted rim's width per unit of slow (owner: thicker the colder) // an aura slow outlasts one step only: it is gone the moment the enemy leaves
const FRZ_TICK_HIT = { armorPierce: 1 }; // a tick's hit on a shield: no armor bite
function frzSkillStats(t, s, b) {
  const f = skillOf(t, "temp");
  s.range = b.range * RANGE_BONUS;
  s.aura = FRZ_TEMP_SLOW[f]; s.brittle = FRZ_BRITTLE[f]; s.dmg = b.dmg * b.rate * FRZ_TICK; s.rate = 1 / FRZ_TICK; // dmg / rate: a TICK
  s.rime = FRZ_RIME[skillOf(t, "rime")]; s.rimeEvery = FRZ_RIME_PERIOD[skillOf(t, "rime")]; s.moonN = FRZ_MOON_COUNT[skillOf(t, "moons")]; s.moonK = FRZ_MOON_BY[skillOf(t, "moons")]; s.subN = FRZ_SUBMOON_N[skillOf(t, "moons")]; s.skill = true;
}
// moons and SMALL MOONS by tier (owner, 2026-10-08): 1 / 2 / 3 moons at I-III, then still THREE at IV and V,
// each with 1 (IV) or 3 (V) small moons of its own (was 4 and 5 moons, V's with 2 small moons each)
const FRZ_MOON_COUNT = [0, 1, 2, 3, 3, 3], FRZ_SUBMOON_N = [0, 0, 0, 0, 1, 3];
// a small moon circles its moon at r, the other way round and faster, an aura at k x its moon's
const FRZ_SUBMOON = { r: 84, k: 0.2, spin: 2 }; // r tripled (owner, 2026-10-08; was 28) // k 0.2: V at 195% (0.1 -> 194, 0.3 -> 203, 0.5 -> 216; five moons alone sit near 190)
// the aura's sources: the tower, then each moon at FRZ_MOON_SCALE of everything, then their small moons
function frzSources(t, st) {
  const out = [{ x: t.x, y: t.y, k: 1, id: t.id }];
  if (!st.moonN) return out;
  const moons = moonSpots(t, { moons: st.moonN });
  moons.forEach((m, i) => out.push({ x: m.x, y: m.y, k: st.moonK, id: t.id + ":moon" + i }));
  if (st.subN) {
    const a0 = -(t.spin || 0) * MOON_SPIN * FRZ_SUBMOON.spin, S = FRZ_SUBMOON, n = st.subN;
    moons.forEach((m, i) => { for (let j = 0; j < n; j++) { const a = a0 + j * 2 * Math.PI / n;
      out.push({ x: m.x + Math.cos(a) * S.r, y: m.y + Math.sin(a) * S.r, k: st.moonK * S.k, id: t.id + ":moon" + i + ":" + j, small: true }); } });
  }
  return out;
}
// every step (aspira-game.js): slow what is inside each aura, tick its damage,
// and grow the Rime pulses
// FROST BITES THE FAST (2026-10-08: FRZ must answer fast enemies - it leaked 73% of them): an aura tick
// hurts x (the enemy TYPE's base speed / FRZ_BITE.ref) - fast (135) and swarms (125) take far more, shields
// (37.5) and armor (30) far less: FRZ the fast answer and weak against armor, as the counter table says.
// ref 0 = off (the simulator's probes set it)
const FRZ_BITE = { ref: 40 }; // fast x3.4, swarm x3.1, shield x0.94, armor x0.75: mono FRZ waves 61-69 leaks fast 75% -> 7% (ref 75: 59%, 55: 35%); swarm / shield / armor stay 0%
const frzBite = e => (FRZ_BITE.ref ? ENEMIES[e.type].speed / FRZ_BITE.ref : 1);
function frzStep(t, dt) {
  const st = towerStats(t), srcs = frzSources(t, st);
  t.auraT = (t.auraT || 0) - dt;
  const tick = t.auraT <= 0;
  if (tick) t.auraT += FRZ_TICK;
  let ticked = false;
  for (const s of srcs) {
    const r2 = (st.range * s.k) ** 2;
    for (const e of G.enemies) {
      if (e.dead || (e.x - s.x) ** 2 + (e.y - s.y) ** 2 > r2) continue;
      applySlow(e, st.aura * s.k, FRZ_AURA_HOLD, s.id);
      if (st.brittle > 1) e.brittle = Math.max(e.brittle || 1, st.brittle);
      if (!tick) continue;
      ticked = true;
      // a tick POPS a shield (owner, 2026-10-06) and is never blunted by armor;
      // otherwise it is quiet (no flash) but shows its NUMBER, sized by what it took
      if (e.shield > 0) { damage(e, st.dmg * s.k, t, false, false, FRZ_TICK_HIT); continue; }
      const hp = e.hp;
      damage(e, st.dmg * s.k * frzBite(e), t, true);
      if (hp - e.hp > 0) dmgNumber(e, String(dmgUnits(hp - e.hp)), hp - e.hp, "white");
    }
  }
  if (ticked) sfx("frz"); // a tick that touched anything is HEARD (owner, 2026-10-07; was silent)
  if (st.rime) {
    t.rimeT = (t.rimeT || 0) - dt;
    if (t.rimeT <= 0) {
      t.rimeT += st.rimeEvery;
      for (const s of srcs) (t.pulses ||= []).push({ x: s.x, y: s.y, R: st.range * s.k, v: st.rime * s.k, id: s.id + ":rime", age: 0, hit: new Set() });
    }
  }
  if (t.pulses) {
    for (const p of t.pulses) {
      p.age += dt;
      const r = p.R * Math.min(1, p.age / FRZ_RIME_GROW);
      for (const e of G.enemies) {
        if (e.dead || p.hit.has(e.id) || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > r * r) continue;
        p.hit.add(e.id); applySlow(e, p.v, Infinity, p.id, "stack");
      }
    }
    t.pulses = t.pulses.filter(p => p.age < FRZ_RIME_GROW);
  }
}
// UI: the aura discs, the moons and the Rime rings (aspira-effects.js drawTethers)
const MOON_TRI = 11; // a moon's triangle, corner to centre
const FRZ_AURA_A = 0.4, FRZ_RIM_A = 0.25; // the aura's disc and rim, toned down (owner, 2026-10-07; were 0.8 / 0.45)
function drawFrzSkill(t, st) {
  const col = COL[TOWERS.frz.color];
  frzSources(t, st).forEach((s, i) => {
    gradDisc(s.x, s.y, st.range * s.k, col, FRZ_AURA_A); // fainter (owner, 2026-10-07; was 0.8)
    // Frost (owner): a FROSTED RIM, thicker the colder the aura (its slow)
    ctx.strokeStyle = col; ctx.globalAlpha = FRZ_RIM_A; ctx.lineWidth = FRZ_RIM_W * st.aura * s.k;
    ctx.beginPath(); ctx.arc(s.x, s.y, st.range * s.k, 0, 6.283); ctx.stroke();
    // a MOON (every source after the tower; Moons III's are full strength, so
    // not "k < 1" - owner: they went missing) is a TRIANGLE pointing at the tower
    if (i) { ctx.fillStyle = col; ctx.globalAlpha = 0.95; poly(s.x, s.y, s.small ? MOON_TRI * 0.55 : MOON_TRI, 3, Math.atan2(t.y - s.y, t.x - s.x), false); ctx.fill(); }
  });
  // Rime (owner): a THIN expanding ring with a GLOW
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.shadowColor = col; ctx.shadowBlur = 12 * cam.k;
  for (const p of t.pulses || []) {
    const f = Math.min(1, p.age / FRZ_RIME_GROW);
    ctx.globalAlpha = 0.9 * (1 - f * 0.6); ctx.beginPath(); ctx.arc(p.x, p.y, p.R * f, 0, 6.283); ctx.stroke();
  }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}
