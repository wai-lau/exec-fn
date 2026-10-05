// /aspira — the TEN BOSSES (owner, 2026-10-02): every 10th wave is a boss from
// the Major Arcana (the Fool and the Tower left out). Each keeps the boss
// rules - it comes alone, holds the wave timer, ends the game if it gets
// through - and adds its own trick:
//   10 Star        none: the plain boss that teaches the rules
//   20 Empress     sheds EMPRESS_BROOD swarmers each time it loses a fifth of its HP (owner: 10x, then x0.75 -> 30)
//   30 Strength    no slow or freeze touches it
//   40 Chariot     every CHARIOT_EVERY s it sprints at CHARIOT_SPD x for CHARIOT_T s
//   50 Lovers      a PAIR; when one dies the other heals to full and runs LOVERS_SPD x faster
//   60 Temperance  regenerates TEMPERANCE_REGEN of its HP a second (owner: tripled to 6%, and x5 HP)
//   70 Devil       comes as SIX (DEVIL_COPIES), each a full boss on its own copy of the
//                  lane - any one that gets through ends the game (owner; replaced the Moon)
//   80 Justice     no single hit takes more than JUSTICE_CAP of its HP
//   90 Judgement   rises once at JUDGEMENT_REVIVE of its HP
//  100 Death       a juiced-up Star (owner): no tricks, x3 HP
// Boss HP is ENEMIES.bonus.hp (halved, owner). Loaded after aspira-waves.js
// (the simulator loads it too).
// each with a HINT (owner): a small mythic subtitle under its name - its trick
// told sideways, never spelled out
const ARCANA = [
  { id: "star", name: "The Star", hint: "A lone light crosses the dark, and asks only to be met." },
  { id: "empress", name: "The Empress", hint: "Wound her, and her children answer." },
  { id: "strength", name: "Strength", hint: "No frost binds her; no chain slows her stride." },
  { id: "chariot", name: "The Chariot", hint: "The reins slip, and the horses run." },
  { id: "lovers", name: "The Lovers", hint: "Part them, and the one left behind will not forgive you." },
  { id: "temperance", name: "Temperance", hint: "What is poured out is poured back." },
  { id: "devil", name: "The Devil", hint: "Six faces, one hunger. Let none pass." },
  { id: "justice", name: "Justice", hint: "No single blow outweighs the scales." },
  { id: "judgement", name: "Judgement", hint: "What falls is called to rise again." },
  { id: "death", name: "Death", hint: "No riddle. Only the end." },
];
const BOSS_HP = { star: 4, empress: 2, strength: 2, chariot: 4, lovers: 2, temperance: 5, devil: 0.75, justice: 1.5, judgement: 1.5, death: 3 };
const BOSS_INTRO = 2.5; // s between a boss wave starting and its boss arriving (its warning plays)
const EMPRESS_BROOD = 30, CHARIOT_EVERY = 4, CHARIOT_T = 1, CHARIOT_SPD = 3, LOVERS_SPD = 1.5;
const TEMPERANCE_REGEN = 0.06, DEVIL_COPIES = 5, JUSTICE_CAP = 0.02, JUDGEMENT_REVIVE = 0.5;

// how far an enemy on lane pi travels, entry to core, and the average over all lanes
const laneTravel = pi => PATHS[pi].len - entryS(pi);
let meanTravelV = 0;
const meanTravel = () => meanTravelV || (meanTravelV = PATHS.reduce((a, p, i) => a + laneTravel(i), 0) / PATHS.length);
const arcanaOf = n => ARCANA[Math.min(ARCANA.length, Math.max(1, Math.round(n / STAR_EVERY))) - 1];
// how many bosses ride a boss wave: the Lovers come as two, the Devil as six,
// one on each of six lane copies
const bossCount = n => (arcanaOf(n).id === "devil" ? 1 + DEVIL_COPIES : arcanaOf(n).id === "lovers" ? 2 : 1);
const bossSplit = n => (arcanaOf(n).id === "devil" ? 1 + DEVIL_COPIES : 1);
const isA = (e, id) => e.arcana === id;

// from spawnEnemy: name the boss for its wave, and pair up the two of a pair
function bossSpawn(e, n) {
  e.arcana = arcanaOf(n).id;
  e.baseSpd = e.spd || 1; e.broodAt = 0.8; e.sprintT = CHARIOT_EVERY;
  // HP per boss (owner): Star to Lovers x2, the Chariot x4; Devil (each of six) x0.75 (halved,
  // then x1.5); Justice and Judgement x1.5; Death x3; Temperance as is
  e.max *= BOSS_HP[e.arcana] || 1;
  // ...and by the DISTANCE its lane makes it travel (owner): a long lane keeps
  // it under fire longer, so it gets proportionally more HP (x0.5 .. x1.6, the
  // average lane x1)
  e.max *= laneTravel(e.pi) / meanTravel(); e.hp = e.max;
  // each boss a size bigger than the last (owner): Star x1.1 ... Death x2
  e.sizeMul = 1 + 0.1 * (ARCANA.findIndex(a => a.id === e.arcana) + 1);
  const mate = bossCount(n) === 2 && G.enemies.find(o => o !== e && !o.dead && o.arcana === e.arcana && o.n === n && !o.mate);
  if (mate) { mate.mate = e; e.mate = mate; }
}
// each step, for a live boss: Empress's brood, the sprint, regeneration
function bossStep(e, dt) {
  if (isA(e, "empress") && e.hp / e.max <= e.broodAt) {
    e.broodAt -= 0.2;
    for (let i = 0; i < EMPRESS_BROOD; i++) {
      spawnEnemy("swarm", e.n, e.pi, e.ang || 0);
      const m = G.enemies[G.enemies.length - 1]; m.s = Math.max(0, e.s - 8 * i);
    }
  }
  if (isA(e, "chariot")) {
    e.sprintT -= dt;
    if (e.sprintT <= -CHARIOT_T) e.sprintT += CHARIOT_EVERY;
    e.spd = e.baseSpd * (e.sprintT <= 0 ? CHARIOT_SPD : 1);
  }
  if (isA(e, "temperance")) e.hp = Math.min(e.max, e.hp + e.max * TEMPERANCE_REGEN * dt);

}
// from applySlow: Strength shrugs slows off
const bossSlowMul = e => (isA(e, "strength") ? 0 : 1);
// from damage(): Justice caps any one hit
function bossHitCap(e, amt) {
  return isA(e, "justice") ? Math.min(amt, e.max * JUSTICE_CAP) : amt;
}
// from kill(): Judgement rises once; returns true when it does
function bossRise(e) {
  if (e.risen || !isA(e, "judgement")) return false;
  e.risen = true; e.dead = false;
  e.hp = e.max * JUDGEMENT_REVIVE;
  ring(e.x, e.y, 60, "orange", 0.5);
  return true;
}
// from kill(): a Lover left alone heals to full and runs faster
function bossKilled(e) {
  // Strength's fall opens the core's upgrades, announced where its name was (owner)
  // ...with an arrow down at the core (owner)
  if (isA(e, "strength")) { float(CX, CY - 80, "core upgrades unlocked", "white", 28, 4, 1, 3); float(CX, CY - 48, "↓", "white", 28, 4, 1, 3); }
  const m = e.mate;
  if (!m || m.dead) return;
  m.hp = m.max; m.enraged = true; m.spd = (m.baseSpd || 1) * LOVERS_SPD;
  ring(m.x, m.y, 60, "pink", 0.5);
}
// the boss reward drops ONCE a wave: a Devil only pays when it is the last one standing
const bossPays = e => !(isA(e, "devil") && G.enemies.some(o => o !== e && !o.dead && isA(o, "devil")));

// ---------- the inverted sky (UI only; aspira-draw.js calls it last) ----------
// owner: when a boss appears, colour INVERSION spreads as a soft-edged circle
// from the core, filling the screen over BOSS_INV_T s; when the last
// boss dies, it collapses over the same time back onto the core. The
// canvas is inverted by painting the circle in "difference" mode; the HTML
// over it (header, build bar, card) flips by CSS once the circle covers the
// screen (bossInv.full -> #asp.asp-boss).
const BOSS_INV_T = 3;
const bossInv = { phase: "off", t0: 0, x: 0, y: 0, full: false };
function drawBossInvert() {
  const now = performance.now() / 1000, alive = G.enemies.filter(e => e.arcana && !e.dead);
  if (alive.length && (bossInv.phase === "off" || bossInv.phase === "out")) {
    Object.assign(bossInv, { phase: "in", t0: now, x: CX, y: CY }); // spreads from the CORE (owner: was the boss)
  } else if (!alive.length && bossInv.phase === "in") {
    Object.assign(bossInv, { phase: "out", t0: now, x: CX, y: CY }); // collapses onto the CORE too (owner)
  }
  if (bossInv.phase === "off") { bossInv.full = false; bossInv.r = 0; return; }
  // the circle must reach the canvas corner furthest from its centre
  const corners = [[0, 0], [cv.width, 0], [0, cv.height], [cv.width, cv.height]].map(([px, py]) => ({ x: (px - cam.ox) / cam.k, y: (py - cam.oy) / cam.k }));
  const R = Math.max(...corners.map(c => Math.hypot(c.x - bossInv.x, c.y - bossInv.y))) * 1.3; // the soft edge clears the corners
  const p = Math.min(1, (now - bossInv.t0) / BOSS_INV_T), ease = p * p * (3 - 2 * p);
  const r = bossInv.phase === "in" ? R * ease : R * (1 - ease);
  bossInv.r = r; // the boss's HP line grows and shrinks with this edge (drawBossBar)
  bossInv.full = bossInv.phase === "in" && p >= 1;
  if (bossInv.phase === "out" && p >= 1) { bossInv.phase = "off"; return; }
  if (r < 1) return;
  const g = ctx.createRadialGradient(bossInv.x, bossInv.y, r * 0.85, bossInv.x, bossInv.y, r);
  g.addColorStop(0, COL.white); g.addColorStop(1, "transparent");
  ctx.save(); ctx.globalCompositeOperation = "difference"; ctx.globalAlpha = 1; ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(bossInv.x, bossInv.y, r, 0, 6.283); ctx.fill(); ctx.restore();
}

// the STARS redden ahead of a boss (owner): over the wave before it they drift
// from white to red, stay red while it is queued or alive, and drift back to
// white over STAR_FADE_T s once it is dead
const STAR_FADE_T = 3;
const starTint = { k: 0, at: 0 };
function starRed() {
  const now = performance.now() / 1000, dt = Math.min(0.1, now - (starTint.at || now));
  starTint.at = now;
  const before = G.started && G.wave % STAR_EVERY === STAR_EVERY - 1 && !G.over;
  if (G.started && !G.over && bossUp()) starTint.k = 1;
  else if (before) starTint.k = Math.max(starTint.k, 1 - Math.max(0, G.nextIn) / WAVE_TIMER);
  else starTint.k = Math.max(0, starTint.k - dt / STAR_FADE_T);
  return starTint.k;
}

// ---------- the boss's HP, on the board (UI only; aspira-draw.js calls it) ----------
// owner: a THICK line in the boss's colour under the core, stretching to both
// sides in proportion to the HP left (BOSS_BAR_R at full), never past the
// inverted sky's spreading edge (bossInv.r) - so it grows out with the circle
// and shrinks back as it collapses. The boss's NAME sits just above it, where
// the interest line is otherwise. Drawn before the inversion, so cyan reads red.
const BOSS_BAR_R = 400, BOSS_BAR_W = 21, BOSS_BAR_TRACK = 0.3; // 3x thicker (owner); the track = full HP, translucent
function drawBossBar() {
  const bosses = G.enemies.filter(e => e.arcana && !e.dead);
  if (!bosses.length) return;
  const hp = bosses.reduce((a, e) => a + Math.max(0, e.hp), 0), max = bosses.reduce((a, e) => a + e.max, 0);
  const reach = bossInv.r || 0, half = Math.min(BOSS_BAR_R * hp / max, reach), col = ENEMIES.bonus.color;
  const y = CY + CORE_R + LIFE_GAP * LIFE_RINGS + 20;
  const arc = arcanaOf(bosses[0].n);
  text(arc.name + (bosses.length > 1 ? " ×" + bosses.length : ""), CX, y, 20, col, true);
  ctx.globalAlpha = 0.8; text(arc.hint, CX, y + 20, 12, col, true); ctx.globalAlpha = 1; // its mythic subtitle (owner)
  const by = CY, track = Math.min(BOSS_BAR_R, reach); // ON the horizon through the core, under the core (owner)
  if (track <= 0) return;
  ctx.strokeStyle = COL[col]; ctx.lineWidth = BOSS_BAR_W; ctx.lineCap = "butt";
  // the ORIGINAL HP as a translucent track (owner), the HP left solid over it
  ctx.globalAlpha = BOSS_BAR_TRACK;
  ctx.beginPath(); ctx.moveTo(CX - track, by); ctx.lineTo(CX + track, by); ctx.stroke();
  ctx.globalAlpha = 1;
  if (half > 0) { ctx.beginPath(); ctx.moveTo(CX - half, by); ctx.lineTo(CX + half, by); ctx.stroke(); }
}
