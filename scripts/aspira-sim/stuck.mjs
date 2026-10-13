// STUCK TOWERS (owner, 2026-10-13: "make sure towers don't get stuck" - "that should be part of the battery"): each trio, every
// axis at IV, plays to wave 60 with the simulator's gliding player (autoGlide, aspira-positioning.js) and counts glide steps that
// went NOWHERE with a goal held, goals given up, the longest run of give-ups in a row, and frames a tower stood somewhere it may
// not (legalSpot null) and their longest run. Healthy: stalled 0, streak <= 1, no illegal run past ILLEGAL_RUN - else STUCK, exit 1.
// usage: node stuck.mjs [toWave=60]   (ASPIRA_PATCH / ASPIRA_WEB as everywhere)
import { makeGame } from "./sim.mjs";
import { simBanner } from "./simver.mjs";

const TO = Number(process.argv[2] || 60), ILLEGAL_RUN = 25; // frames (0.5 s) an overlap may last: two towers gliding at once can cross for a step, the next sends one home
const TRIOS = [["arc", "frz", "sol"], ["arc", "frz", "acd"], ["arc", "sol", "acd"], ["frz", "sol", "acd"]];
console.log(simBanner());
let bad = false;
TRIOS.forEach((trio, i) => {
  const g = makeGame(i + 1); g.reset(); g.G.money = 1e9;
  for (const k of trio) {
    const ci = g.run(`CELLS.findIndex((c, i) => cellOpen(i) && !G.towers.some(t => t.cell === i))`), t = g.place(k, ci);
    for (const ax of g.run(`SKILL_TREES.${k}.map(a => a.id)`)) for (let n = 0; n < 4; n++) g.upgrade(t, ax);
  }
  g.run(`globalThis.__st = { stalled: 0, gaveUp: 0, streak: 0, illegal: 0, illegalRun: 0 }; const og = autoGlide; autoGlide = function (t, dt) {
    const had = !!t.goal, x = t.x, y = t.y; og(t, dt); const moved = Math.hypot(t.x - x, t.y - y) > 0.01;
    if (had && t.goal && !moved) __st.stalled++;
    if (had && !t.goal && !moved) { __st.gaveUp++; t.__s = (t.__s || 0) + 1; __st.streak = Math.max(__st.streak, t.__s); } else if (moved) t.__s = 0;
    if (!legalSpot(t, t)) { __st.illegal++; t.__i = (t.__i || 0) + 1; __st.illegalRun = Math.max(__st.illegalRun, t.__i); } else t.__i = 0; }`);
  for (let s = 0; s < 120000 && g.G.wave < TO && !g.G.over; s++) { g.G.lives = 1e6; g.step(0.02); }
  const st = JSON.parse(g.run("JSON.stringify(__st)")), sick = st.stalled > 0 || st.streak > 1 || st.illegalRun > ILLEGAL_RUN;
  bad ||= sick;
  console.log(trio.join("+").toUpperCase().padEnd(12), "to wave", g.G.wave, " stalled", st.stalled, " gave up", st.gaveUp, " streak", st.streak, " illegal", st.illegal, "(longest", st.illegalRun + ")", sick ? " STUCK" : " ok");
});
process.exit(bad ? 1 : 0);
