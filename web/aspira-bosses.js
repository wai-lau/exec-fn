// /aspira — the TEN BOSSES (owner, 2026-10-02): every 10th wave is a boss from
// the Major Arcana (the Fool and the Tower left out). Each keeps the boss
// rules - it comes alone, holds the wave timer, ends the game if it gets
// through - and adds its own trick:
//   10 Star        none: the plain boss that teaches the rules
//   20 Empress     sheds EMPRESS_BROOD swarmers each time it loses a fifth of its HP (owner: 10x, then x0.75 -> 30; fitted -> 12)
//   30 Strength    no slow or freeze touches it
//   40 Chariot     every CHARIOT_EVERY s it sprints at CHARIOT_SPD x for CHARIOT_T s
//   50 Lovers      a PAIR; when one dies the other heals to full and runs LOVERS_SPD x faster
//   60 Temperance  regenerates TEMPERANCE_REGEN of its HP a second (owner: tripled to 6%, and x5 HP)
//   70 Devil       comes as SIX (DEVIL_COPIES), each a full boss on its own copy of the
//                  lane - any one that gets through ends the game (owner; replaced the Moon)
//   80 Justice     no single hit takes more than JUSTICE_CAP of its HP
//   90 Judgement   rises once at JUDGEMENT_REVIVE of its HP
//  100 Death       a juiced-up Star (owner): no tricks, the most HP but the Chariot
// Boss HP is ENEMIES.bonus.hp (halved, owner). Loaded after aspira-waves.js
// (the simulator loads it too).
// each with a HINT (owner): a mythic subtitle under its name - its trick told
// sideways, never spelled out - as a HAIKU (owner, 2026-10-05): three lines,
// 5-7-5 syllables, drawn one under another
const ARCANA = [
  { id: "star", name: "The Star", hint: ["One light in the dark", "crossing the long silent sky", "asks only to meet."] },
  { id: "empress", name: "The Empress", hint: ["Strike the mother once", "and the field fills with her young:", "her children answer."] },
  { id: "strength", name: "Strength", hint: ["No frost can bind her,", "no chain will shorten her stride.", "She walks through the cold."] },
  { id: "chariot", name: "The Chariot", hint: ["The reins slip loose now", "and the horses break and run,", "faster than your aim."] },
  { id: "lovers", name: "The Lovers", hint: ["Two walk as one heart.", "Part them, and the one who stays", "will never forgive."] },
  { id: "temperance", name: "Temperance", hint: ["What is poured away", "returns to the cup again;", "the wound fills, and heals."] },
  { id: "devil", name: "The Devil", hint: ["Six faces, one want,", "six roads leading to your door.", "Let not one get through."] },
  { id: "justice", name: "Justice", hint: ["The scales hold steady.", "No blow, however heavy,", "outweighs the balance."] },
  { id: "judgement", name: "Judgement", hint: ["The trumpet sounds once;", "what has fallen hears its name", "and rises again."] },
  { id: "death", name: "Death", hint: ["No riddle, no trick,", "only the long road to dark,", "only, now, the end."] },
];
// fitted 2026-10-05 (scripts/aspira-sim/bossbal.mjs): each boss comes 0.9x as
// near the core as the four waves around it (owner: "just a little closer"),
// on closest approach, against every open slot filled. Was star 4, strength 2,
// lovers 2, temperance 5, justice 1.5, judgement 1.5, death 3. Death's fit
// (1.8) sits on the edge of leaking - a boss leak ends the game - so 1.6.
const BOSS_HP = { star: 3.4, empress: 2, strength: 0.9, chariot: 4, lovers: 3.1, temperance: 3, devil: 0.75, justice: 4.4, judgement: 1.7, death: 1.6 };
const BOSS_INTRO = 2.5; // s between a boss wave starting and its boss arriving (its warning plays)
let EMPRESS_BROOD = 12; // fitted 2026-10-05 (was 30): her HP was never the lever, her brood is; let: the boss balance test (scripts/aspira-sim/bossbal.mjs, BB_BROOD) tries other broods
const CHARIOT_EVERY = 4, CHARIOT_T = 1, CHARIOT_SPD = 3, LOVERS_SPD = 1.5;
const TEMPERANCE_REGEN = 0.06, DEVIL_COPIES = 5, JUSTICE_CAP = 0.02, JUDGEMENT_REVIVE = 0.5;

// how far an enemy on lane pi travels, entry to core, and the average over all lanes
const laneTravel = pi => PATHS[pi].len - entryS(pi);
let meanTravelV = 0;
const meanTravel = () => meanTravelV || (meanTravelV = PATHS.reduce((a, p, i) => a + laneTravel(i), 0) / PATHS.length);
// the game-over title when a BOSS gets through (owner: "overwhelmed by strength")
const BOSS_BREACH = {
  star: "eclipsed by the star", empress: "smothered by the empress", strength: "overwhelmed by strength",
  chariot: "overrun by the chariot", lovers: "undone by the lovers", temperance: "outlasted by temperance",
  devil: "bound by the devil", justice: "sentenced by justice", judgement: "weighed by judgement", death: "silenced by death",
};
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
  // HP per boss: BOSS_HP (fitted, see there; the Devil's is each of six)
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
      m.bossKin = true; // the boss's own: the inverted sky holds till these die too
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
  // the LAST boss of its wave down: that wave's corner slot opens (owner: unlocks
  // come AFTER the boss, never during its wave) - announced like the core's
  // upgrades, the slot flashing meanwhile (aspira-waves.js)
  if (!G.enemies.some(o => o !== e && !o.dead && o.arcana && o.n === e.n)) {
    CELLS.forEach((c, ci) => {
      if (c.unlock !== e.n || (G.opened ||= {})[ci]) return;
      G.opened[ci] = true;
      float(CX, CY - 80, "new slot unlocked", "white", 28, SLOT_TEXT_S, 1, 3);
      slotFlash = { ci, until: performance.now() + SLOT_FLASH_S * 1000 };
    });
  }
  const m = e.mate;
  if (!m || m.dead) return;
  m.hp = m.max; m.enraged = true; m.spd = (m.baseSpd || 1) * LOVERS_SPD;
  ring(m.x, m.y, 60, "pink", 0.5);
}
// the boss reward drops ONCE a wave: a Devil only pays when it is the last one standing
const bossPays = e => !(isA(e, "devil") && G.enemies.some(o => o !== e && !o.dead && isA(o, "devil")));

// ---------- the inverted sky (UI only; render() in aspira-draw.js draws it) ----------
// owner: when a boss appears, colour INVERSION spreads as a circle from the
// core, filling the screen over BOSS_INV_T s; when the last boss dies, it
// collapses over the same time back onto the core. This only keeps the STATE
// (phase, radius r, full); render() draws the inverted frame (withPalette).
// The HTML over the board flips by CSS once the circle covers the screen
// (bossInv.full -> #asp.asp-boss).
const BOSS_INV_T = 3;
const bossInv = { phase: "off", t0: 0, x: 0, y: 0, full: false, r: 0 };
function bossSkyStep() {
  // the sky stays inverted while ANY boss-related enemy lives - the boss and its
  // brood (owner) - and only then collapses
  const now = performance.now() / 1000, alive = G.enemies.some(e => (e.arcana || e.bossKin) && !e.dead);
  if (alive && (bossInv.phase === "off" || bossInv.phase === "out")) {
    Object.assign(bossInv, { phase: "in", t0: now, x: CX, y: CY }); // spreads from the CORE (owner: was the boss)
  } else if (!alive && bossInv.phase === "in") {
    Object.assign(bossInv, { phase: "out", t0: now, x: CX, y: CY }); // collapses onto the CORE too (owner)
  }
  if (bossInv.phase === "out" && now - bossInv.t0 >= BOSS_INV_T) bossInv.phase = "off";
  if (bossInv.phase === "off") { bossInv.full = false; bossInv.r = 0; return; }
  // the circle must reach the canvas corner furthest from its centre
  const corners = [[0, 0], [cv.width, 0], [0, cv.height], [cv.width, cv.height]].map(([px, py]) => ({ x: (px - cam.ox) / cam.k, y: (py - cam.oy) / cam.k }));
  const R = Math.max(...corners.map(c => Math.hypot(c.x - bossInv.x, c.y - bossInv.y))) * 1.05;
  const p = Math.min(1, (now - bossInv.t0) / BOSS_INV_T), ease = p * p * (3 - 2 * p);
  bossInv.r = bossInv.phase === "in" ? R * ease : R * (1 - ease); // the boss's HP line grows and shrinks with this edge (drawBossBar)
  bossInv.full = bossInv.phase === "in" && p >= 1;
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
// the boss's NAME and mythic subtitle under the core: drawn LAST, over the
// towers (owner) - so after the inverted sky, and in the colour the sky would
// have given it: the boss red inside the inversion's circle, its own outside
const BOSS_TITLE_PX = 46, BOSS_SUB_PX = 30;
function drawBossTitle() {
  const bosses = G.enemies.filter(e => e.arcana && !e.dead);
  if (!bosses.length) return;
  // the TITLE above the core, the haiku under it (owner)
  const off = CORE_R + LIFE_GAP * LIFE_RINGS + 20, arc = arcanaOf(bosses[0].n), col = ENEMIES.bonus.color;
  // drawn in its own colours with a dark halo: inside the inverted sky the
  // inverted palette turns that red on a white halo (render, withPalette)
  text(arc.name, CX, CY - off - BOSS_TITLE_PX * 0.5, BOSS_TITLE_PX, col, true, true); // BOLD and bigger (owner); just the name, no "x2" (owner)
  // the haiku, much bigger (owner; was 12, 15, 19), its three lines stacked
  ctx.globalAlpha = 0.85;
  arc.hint.forEach((l, i) => text(l, CX, CY + off + BOSS_SUB_PX * (0.5 + 1.15 * i), BOSS_SUB_PX, col, true));
  ctx.globalAlpha = 1;
}
function drawBossBar() {
  const bosses = G.enemies.filter(e => e.arcana && !e.dead);
  if (!bosses.length) return;
  const hp = bosses.reduce((a, e) => a + Math.max(0, e.hp), 0), max = bosses.reduce((a, e) => a + e.max, 0);
  const reach = bossInv.r || 0, half = Math.min(BOSS_BAR_R * hp / max, reach), col = ENEMIES.bonus.color;
  const by = CY, track = Math.min(BOSS_BAR_R, reach); // ON the horizon through the core, under the core (owner)
  if (track <= 0) return;
  ctx.strokeStyle = COL[col]; ctx.lineWidth = BOSS_BAR_W; ctx.lineCap = "butt";
  // the ORIGINAL HP as a translucent track (owner), the HP left solid over it
  ctx.globalAlpha = BOSS_BAR_TRACK;
  ctx.beginPath(); ctx.moveTo(CX - track, by); ctx.lineTo(CX + track, by); ctx.stroke();
  ctx.globalAlpha = 1;
  if (half > 0) { ctx.beginPath(); ctx.moveTo(CX - half, by); ctx.lineTo(CX + half, by); ctx.stroke(); }
}
