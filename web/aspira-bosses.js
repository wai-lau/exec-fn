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
// REFIT 2026-10-07 (bossbal.mjs tune, 2 seeds, after the free core, the chart-axis
// refit and the fast refit): Chariot 40 and Temperance 60 breached the reference
// team, Lovers 50 got to 47 of the core (target 168). Was star 3.4, empress 2,
// strength 0.9, chariot 4, lovers 3.1, temperance 3, devil 0.75, justice 4.4,
// judgement 1.7. Death not refitted (the run was stopped for memory): kept 1.6.
const BOSS_HP = { star: 2.7, empress: 3.4, strength: 1.1, chariot: 1.7, lovers: 1.2, temperance: 0.61, devil: 0.38, justice: 3.2, judgement: 1.7, death: 1.6 };
// each boss's ARMOR (x the armored enemy's growth curve at its wave, like ENEMIES.armor) and SPEED
// (x the boss base) - owner, 2026-10-08: the bosses ACD is too good against get armor and speed and
// lose HP, so SOL (whose hits strip armor) and ACD (whose ramp wants a long-lived target) boss alike
const BOSS_ARMOR = { star: 0, empress: 0, strength: 0, chariot: 0, lovers: 0, temperance: 0, devil: 0, justice: 0, judgement: 0, death: 0 };
const BOSS_SPEED = { star: 1, empress: 1, strength: 1, chariot: 1, lovers: 1, temperance: 1, devil: 1, justice: 1, judgement: 1, death: 1 };
// each boss's SHIELD (hits absorbed, whatever their size) and its REFILL a second - the counter to
// SOL's few huge hits (owner, 2026-10-08): ACD's ticks, ARC's forks and FRZ's aura strip it cheaply
const BOSS_SHIELD = { star: 0, empress: 0, strength: 0, chariot: 0, lovers: 0, temperance: 0, devil: 0, justice: 0, judgement: 0, death: 0 };
const BOSS_SHIELD_REGEN = { star: 0, empress: 0, strength: 0, chariot: 0, lovers: 0, temperance: 0, devil: 0, justice: 0, judgement: 0, death: 0 };
const BOSS_INTRO = 2.5; // s between a boss wave starting and its boss arriving (its warning plays)
let EMPRESS_BROOD = 12; // fitted 2026-10-05 (was 30): her HP was never the lever, her brood is; let: the boss balance test (scripts/aspira-sim/bossbal.mjs, BB_BROOD) tries other broods
const CHARIOT_EVERY = 4, CHARIOT_T = 1, CHARIOT_SPD = 3, LOVERS_SPD = 1.5;
const TEMPERANCE_REGEN = 0.06, DEVIL_COPIES = 5, JUSTICE_CAP = 0.02, JUDGEMENT_REVIVE = 0.5;

// a boss's HP scaled with its lane's length while it rode a different lane each boss wave; it has ONE
// spiral now (owner, 2026-10-08), so the old average factor (1.107 over the boss waves) stands as a constant
const BOSS_LANE_HP = 1.107;
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
  e.arcana = arcanaOf(n).id; e.titleAt = typeof performance !== "undefined" ? performance.now() / 1000 : 0; // when its title went up (drawBossTitle)
  e.spd = (e.spd || 1) * (BOSS_SPEED[e.arcana] || 1);
  const grow = hpPow(n) + n * 4 / 18; // the armored enemy's armor curve (spawnEnemy)
  e.armor = e.armor0 = Math.floor((BOSS_ARMOR[e.arcana] || 0) * Math.pow(grow, ARMOR_EXP));
  e.baseSpd = e.spd; e.broodAt = 0.8; e.sprintT = CHARIOT_EVERY;
  e.shield = e.shieldMax = BOSS_SHIELD[e.arcana] || 0; e.shieldBuf = 0;
  // HP per boss: BOSS_HP (fitted, see there; the Devil's is each of six)
  e.max *= BOSS_HP[e.arcana] || 1;
  // ...and by the DISTANCE its lane makes it travel (owner): a long lane keeps
  // it under fire longer, so it gets proportionally more HP (x0.5 .. x1.6, the
  // average lane x1)
  e.max = Math.floor(e.max * BOSS_LANE_HP); e.hp = e.max; // whole HP
  // each boss a size bigger than the last (owner): Star x1.1 ... Death x2
  e.sizeMul = 1 + 0.1 * (ARCANA.findIndex(a => a.id === e.arcana) + 1);
  const mate = bossCount(n) === 2 && G.enemies.find(o => o !== e && !o.dead && o.arcana === e.arcana && o.n === n && !o.mate);
  if (mate) { mate.mate = e; e.mate = mate; }
  bossFleet(e, n);
}
// each boss comes with a FLEET (owner, 2026-10-09: "each boss should come with a fleet of units, thematically" - then
// "don't reduce boss hps", "don't add a huge fleet, maybe the equivalent of 1 wave"): ONE plain wave's worth of its
// escort's types below (waveCount at that wave, plain HP and bounty), split among the bodies of a pair or the Devil's
// six, ahead of and behind it on its lane, its own kin (the inverted sky holds till they die too). The Chariot's
// outriders sprint when she does (bossStep). The fleet keeps the boss's pace, spaced clear of it (FLEET_GAP)
const FLEET = {
  star: ["fast"], empress: ["shield"], strength: ["armor"], chariot: ["fast"], lovers: ["swarm"], // shooting stars, handmaidens, lions, outriders, couples
  temperance: ["shield"], devil: ["swarm"], justice: ["armor"], judgement: ["swarm"], death: ["fast", "swarm", "armor", "shield"], // the cup, imps, guards, the risen, four horsemen
};
const FLEET_GAP = 10; // clear space between bodies, world units
// x a plain wave, per boss: the fleet's SIZE, the balance lever (owner: "balance by adding to boss fleets") - fitted by
// scripts/aspira-sim/bossfleet.mjs against the regular waves before each boss, which overlap where a boss wave does not
const FLEET_MUL = { star: 1, empress: 1, strength: 1, chariot: 1, lovers: 1, temperance: 1, devil: 1, justice: 1, judgement: 1, death: 1 };
function bossFleet(e, n) {
  const kinds = FLEET[e.arcana];
  if (!kinds) return;
  e.fleet = [];
  const bodies = bossCount(n), reach = [ENEMIES.bonus.size * (e.sizeMul || 1), ENEMIES.bonus.size * (e.sizeMul || 1)]; // how far ahead / behind is taken
  let i = 0;
  for (const k of kinds) {
    const count = Math.max(1, Math.round(waveCount(k, n) * (FLEET_MUL[e.arcana] ?? 1) / kinds.length / bodies));
    for (let c = 0; c < count; c++, i++) {
      spawnEnemy(k, n, e.pi, e.ang || 0);
      // spaced so NOTHING OVERLAPS (owner, 2026-10-09: "increase spacing between all units and boss during boss waves so
      // that they don't overlap"): each clears the boss and the one before it by FLEET_GAP, ahead, behind, ahead...
      const m = G.enemies[G.enemies.length - 1], side = i % 2, r = ENEMIES[k].size;
      reach[side] += FLEET_GAP + r;
      m.s = Math.max(0, e.s + (side ? -1 : 1) * reach[side]);
      reach[side] += r;
      // in FORMATION: at the boss's own pace, so the spacing holds (a fast escort behind would run through it)
      m.spd = (e.spd || 1) * ENEMIES.bonus.speed / ENEMIES[k].speed; m.jit = 0; // (a swarmer's wander would carry it into its neighbours)
      m.bossKin = true; m.fleetSpd = m.spd; e.fleet.push(m);
    }
  }
  e.fleetSpan = reach[0] + reach[1]; G.lastBoss = e; // how much lane it takes, ahead + behind (stepSpawns spaces a second boss by it)
}
// each step, for a live boss: Empress's brood, the sprint, regeneration
function bossStep(e, dt) {
  const regen = BOSS_SHIELD_REGEN[e.arcana] || 0; // a shield that REFILLS (up to its full ring)
  if (regen && e.shield < e.shieldMax) { e.shieldBuf += regen * dt; const n = Math.floor(e.shieldBuf); if (n) { e.shieldBuf -= n; e.shield = Math.min(e.shieldMax, e.shield + n); } }
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
    for (const m of e.fleet || []) if (!m.dead) m.spd = m.fleetSpd * (e.sprintT <= 0 ? CHARIOT_SPD : 1); // the outriders keep pace
  }
  if (isA(e, "temperance")) { // regen banks fractions and heals in WHOLE points (HP stays a whole number)
    e.regenBuf = (e.regenBuf || 0) + e.max * TEMPERANCE_REGEN * dt;
    const whole = Math.floor(e.regenBuf); e.regenBuf -= whole; e.hp = Math.min(e.max, e.hp + whole);
  }

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
  e.hp = Math.floor(e.max * JUDGEMENT_REVIVE);
  ring(e.x, e.y, 60, "orange", 0.5);
  return true;
}
// from kill(): a Lover left alone heals to full and runs faster
function bossKilled(e) {
  // the LAST boss of its wave down: that wave's corner slot opens (owner: unlocks
  // come AFTER the boss, never during its wave), the slot flashing meanwhile
  // (aspira-waves.js) - or, on a CORE_PICKS wave, a core power is won (aspira-core.js),
  // announced where the boss's name was, with an arrow down at the core (owner)
  if (!G.enemies.some(o => o !== e && !o.dead && o.arcana && o.n === e.n)) {
    if (CORE_PICKS.includes(e.n)) {
      const given = grantPick();
      float(CX, CY - 80, given ? given.name + " online" : "choose a core power", "white", 28, 4, 1, 3); float(CX, CY - 48, "↓", "white", 28, 4, 1, 3);
    }
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
const BOSS_TITLE_PX = 22, BOSS_SUB_PX = 22, BOSS_TITLE_T = 10, BOSS_TITLE_FADE = 1; // the credits' size (owner, 2026-10-06; were 46 / 30)
// the live boss's haiku for the HTML above the title (updateHud), or ""
const bossHint = () => { const b = G.enemies.find(e => e.arcana && !e.dead); return b ? arcanaOf(b.n).hint.join("\n") : ""; };
function drawBossTitle() {
  const bosses = G.enemies.filter(e => e.arcana && !e.dead);
  if (!bosses.length) return;
  // the TITLE above the core, the haiku under it (owner), hugging its life rings
  // (owner, 2026-10-06: closer to the middle; was 24 further out)
  // the title FADES after BOSS_TITLE_T s on screen if the boss still lives (owner, 2026-10-09: "fade out boss title
  // after 10s if boss is not dead yet"), over BOSS_TITLE_FADE s of real time
  const age = performance.now() / 1000 - Math.min(...bosses.map(b => b.titleAt || 0)), fade = 1 - Math.max(0, Math.min(1, (age - BOSS_TITLE_T) / BOSS_TITLE_FADE));
  if (fade <= 0) return;
  const off = CORE_R + LIFE_GAP * LIFE_RINGS - 4, arc = arcanaOf(bosses[0].n), col = ENEMIES.bonus.color, a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * fade;
  // drawn in its own colours with a dark halo: inside the inverted sky the
  // inverted palette turns that red on a white halo (render, withPalette)
  text(arc.name, CX, CY - off - BOSS_TITLE_PX * 0.5, BOSS_TITLE_PX, col, true, true); // BOLD and bigger (owner); just the name, no "x2" (owner)
  ctx.globalAlpha = a0;
  // (the haiku sits ABOVE THE SPIRE title now, owner - bossHint, the HUD tick)
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
