// /aspira — the TEN BOSSES (owner, 2026-10-02): every 10th wave is a boss from
// the Major Arcana (the Fool and the Tower left out). Each keeps the boss
// rules - it comes alone, holds the wave timer, ends the game if it gets
// through - and adds its own trick:
//   10 Star        none: the plain boss that teaches the rules
//   20 Empress     sheds EMPRESS_BROOD swarmers each time it loses a fifth of its HP
//   30 Strength    no slow or freeze touches it
//   40 Chariot     every CHARIOT_EVERY s it sprints at CHARIOT_SPD x for CHARIOT_T s
//   50 Lovers      a PAIR; when one dies the other heals to full and runs LOVERS_SPD x faster
//   60 Temperance  regenerates TEMPERANCE_REGEN of its HP a second
//   70 Devil       comes as SIX (DEVIL_COPIES), each a full boss on its own copy of the
//                  lane - any one that gets through ends the game (owner; replaced the Moon)
//   80 Justice     no single hit takes more than JUSTICE_CAP of its HP
//   90 Judgement   rises once at JUDGEMENT_REVIVE of its HP
//  100 Death       a smaller dose of the others (DEATH_*), and comes with a Lovers twin
// Boss HP is ENEMIES.bonus.hp (halved, owner). Loaded after aspira-waves.js
// (the simulator loads it too).
const ARCANA = [
  { id: "star", name: "The Star" }, { id: "empress", name: "The Empress" }, { id: "strength", name: "Strength" },
  { id: "chariot", name: "The Chariot" }, { id: "lovers", name: "The Lovers" }, { id: "temperance", name: "Temperance" },
  { id: "devil", name: "The Devil" }, { id: "justice", name: "Justice" }, { id: "judgement", name: "Judgement" },
  { id: "death", name: "Death" },
];
const EMPRESS_BROOD = 4, CHARIOT_EVERY = 4, CHARIOT_T = 1, CHARIOT_SPD = 3, LOVERS_SPD = 1.5;
const TEMPERANCE_REGEN = 0.02, DEVIL_COPIES = 5, JUSTICE_CAP = 0.02, JUDGEMENT_REVIVE = 0.5;
// Death's doses of each
const DEATH = { brood: 2, slowMul: 0.5, sprint: 2, regen: 0.01, cap: 0.05, revive: 0.25 };

const arcanaOf = n => ARCANA[Math.min(ARCANA.length, Math.max(1, Math.round(n / STAR_EVERY))) - 1];
// how many bosses ride a boss wave: the Lovers, and Death with its twin, come
// as two; the Devil as six, one on each of six lane copies
const bossCount = n => (arcanaOf(n).id === "devil" ? 1 + DEVIL_COPIES : ["lovers", "death"].includes(arcanaOf(n).id) ? 2 : 1);
const bossSplit = n => (arcanaOf(n).id === "devil" ? 1 + DEVIL_COPIES : 1);
const isA = (e, id) => e.arcana === id;

// from spawnEnemy: name the boss for its wave, and pair up the two of a pair
function bossSpawn(e, n) {
  e.arcana = arcanaOf(n).id;
  e.baseSpd = e.spd || 1; e.broodAt = 0.8; e.sprintT = CHARIOT_EVERY;
  // the Devil (each of six) and Death (and its twin) at HALF the boss HP (owner)
  if (["devil", "death"].includes(e.arcana)) { e.max *= 0.5; e.hp = e.max; }
  const mate = bossCount(n) === 2 && G.enemies.find(o => o !== e && !o.dead && o.arcana === e.arcana && o.n === n && !o.mate);
  if (mate) { mate.mate = e; e.mate = mate; }
}
// each step, for a live boss: Empress's brood, the sprint, regeneration
function bossStep(e, dt) {
  const death = isA(e, "death");
  if ((isA(e, "empress") || death) && e.hp / e.max <= e.broodAt) {
    e.broodAt -= 0.2;
    for (let i = 0; i < (death ? DEATH.brood : EMPRESS_BROOD); i++) {
      spawnEnemy("swarm", e.n, e.pi, e.ang || 0);
      const m = G.enemies[G.enemies.length - 1]; m.s = Math.max(0, e.s - 8 * i);
    }
  }
  if (isA(e, "chariot") || death) {
    e.sprintT -= dt;
    if (e.sprintT <= -CHARIOT_T) e.sprintT += CHARIOT_EVERY;
    e.spd = e.baseSpd * (e.sprintT <= 0 ? (death ? DEATH.sprint : CHARIOT_SPD) : 1) * (e.enraged ? LOVERS_SPD : 1);
  }
  if (isA(e, "temperance") || death) e.hp = Math.min(e.max, e.hp + e.max * (death ? DEATH.regen : TEMPERANCE_REGEN) * dt);

}
// from applySlow: Strength shrugs slows off; Death takes half
const bossSlowMul = e => (isA(e, "strength") ? 0 : isA(e, "death") ? DEATH.slowMul : 1);
// from damage(): Justice caps any one hit
function bossHitCap(e, amt) {
  if (isA(e, "justice")) return Math.min(amt, e.max * JUSTICE_CAP);
  if (isA(e, "death")) return Math.min(amt, e.max * DEATH.cap);
  return amt;
}
// from kill(): Judgement (and Death) rise once; returns true when it does
function bossRise(e) {
  if (e.risen || !(isA(e, "judgement") || isA(e, "death"))) return false;
  e.risen = true; e.dead = false;
  e.hp = e.max * (isA(e, "death") ? DEATH.revive : JUDGEMENT_REVIVE);
  ring(e.x, e.y, 60, "orange", 0.5);
  return true;
}
// from kill(): a Lover (or Death's twin) left alone heals to full and runs faster
function bossKilled(e) {
  const m = e.mate;
  if (!m || m.dead) return;
  m.hp = m.max; m.enraged = true; m.spd = (m.baseSpd || 1) * LOVERS_SPD;
  ring(m.x, m.y, 60, "pink", 0.5);
}
// the boss reward drops ONCE a wave: a Devil only pays when it is the last one standing
const bossPays = e => !(isA(e, "devil") && G.enemies.some(o => o !== e && !o.dead && isA(o, "devil")));

// ---------- the inverted sky (UI only; aspira-draw.js calls it last) ----------
// owner: when a boss appears, colour INVERSION spreads as a soft-edged circle
// from where it spawned, filling the screen over BOSS_INV_T s; when the last
// boss dies, it collapses over the same time onto where that boss fell. The
// canvas is inverted by painting the circle in "difference" mode; the HTML
// over it (header, build bar, card) flips by CSS once the circle covers the
// screen (bossInv.full -> #asp.asp-boss).
const BOSS_INV_T = 3;
const bossInv = { phase: "off", t0: 0, x: 0, y: 0, last: null, full: false };
function drawBossInvert() {
  const now = performance.now() / 1000, alive = G.enemies.filter(e => e.arcana && !e.dead);
  if (alive.length) bossInv.last = { x: alive[0].x, y: alive[0].y };
  if (alive.length && (bossInv.phase === "off" || bossInv.phase === "out")) {
    Object.assign(bossInv, { phase: "in", t0: now, x: alive[0].x, y: alive[0].y });
  } else if (!alive.length && bossInv.phase === "in") {
    const at = bossInv.last || { x: bossInv.x, y: bossInv.y };
    Object.assign(bossInv, { phase: "out", t0: now, x: at.x, y: at.y });
  }
  if (bossInv.phase === "off") { bossInv.full = false; return; }
  // the circle must reach the canvas corner furthest from its centre
  const corners = [[0, 0], [cv.width, 0], [0, cv.height], [cv.width, cv.height]].map(([px, py]) => ({ x: (px - cam.ox) / cam.k, y: (py - cam.oy) / cam.k }));
  const R = Math.max(...corners.map(c => Math.hypot(c.x - bossInv.x, c.y - bossInv.y))) * 1.3; // the soft edge clears the corners
  const p = Math.min(1, (now - bossInv.t0) / BOSS_INV_T), ease = p * p * (3 - 2 * p);
  const r = bossInv.phase === "in" ? R * ease : R * (1 - ease);
  bossInv.full = bossInv.phase === "in" && p >= 1;
  if (bossInv.phase === "out" && p >= 1) { bossInv.phase = "off"; return; }
  if (r < 1) return;
  const g = ctx.createRadialGradient(bossInv.x, bossInv.y, r * 0.85, bossInv.x, bossInv.y, r);
  g.addColorStop(0, COL.white); g.addColorStop(1, "transparent");
  ctx.save(); ctx.globalCompositeOperation = "difference"; ctx.globalAlpha = 1; ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(bossInv.x, bossInv.y, r, 0, 6.283); ctx.fill(); ctx.restore();
}
