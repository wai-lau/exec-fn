// The scripted CORE player: buys powers in a given order as the core opens and
// money allows, and USES them the way a sane player would -
//   Temporal Drive  when a boss is up or a crowd is near the core,
//   Overcharge      on the tower that has dealt the most damage lately,
//   Orbital Relay   a copy of that same tower.
// Shared by sim.mjs's play() (strategy.core / strategy.useCore), corevalue.mjs,
// late.mjs and curve.mjs so every script plays the core the same way.
export const POWERS = ["relay", "temporal", "overcharge"];
export const ALL_T3 = ["temporal", "overcharge", "relay", "temporal", "overcharge", "relay", "temporal", "overcharge", "relay"];
const CROWD_R = 320, CROWD_N = 6, BOSS_R = 420;

// buy the next power in `order` that is still below tier 3; returns true on a buy
export function buyNext(g, order, reserve = 0) {
  const lv = g.run("G.core && G.core.pw ? {...G.core.pw} : {}");
  const bought = Object.values(lv).reduce((a, b) => a + b, 0);
  const id = order[bought];
  if (!id || !g.run(`powerOpen(${JSON.stringify(id)})`)) return false; // each power has its own opening wave (Overcharge: the first)
  if (g.G.money - g.run("coreCost()") < reserve) return false;
  return g.run(`buyPower(${JSON.stringify(id)})`);
}

// the tower that dealt the most since the last call (falls back to total)
function hotTower(g, mem) {
  let bestT = null, bestD = -1;
  for (const t of g.G.towers) {
    const d = (t.dealt || 0) - (mem[t.id] || 0);
    mem[t.id] = t.dealt || 0;
    if (d > bestD) { bestD = d; bestT = t; }
  }
  return bestT;
}

const count = (mem, id) => { mem.fired = mem.fired || {}; mem.fired[id] = (mem.fired[id] || 0) + 1; };

// call every ~0.5 game-s; `mem` is a per-game object the caller keeps
// (hotTower's memory + `fired`, how many times each power went off)
export function usePowers(g, mem) {
  const G = g.G;
  if (!G.core || !G.core.pw) return;
  const pw = G.core.pw, cd = G.core.cd || {};
  if (pw.temporal && !(cd.temporal > 0)) {
    let near = 0, boss = false;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - g.CX, e.y - g.CY);
      if (d < CROWD_R) near++;
      if (d < BOSS_R && g.run(`ENEMIES[${JSON.stringify(e.type)}].star`)) boss = true;
    }
    if ((boss || near >= CROWD_N) && g.run("temporalFreeze()")) count(mem, "temporal");
  }
  const wantOver = pw.overcharge && !(cd.overcharge > 0), wantRelay = pw.relay && !(cd.relay > 0);
  if (!wantOver && !wantRelay) return;
  const t = hotTower(g, mem);
  if (!t) return;
  if (wantOver && g.run(`overcharge(G.towers.find(t => t.id === ${t.id}))`)) count(mem, "overcharge");
  if (wantRelay && g.run(`relay(G.towers.find(t => t.id === ${t.id}))`)) count(mem, "relay");
}
