// The scripted CORE player: picks powers in a given order as bosses hand them
// out (free, top tier - aspira-core.js), and USES them the way a sane player would -
//   Temporal Drive  when a boss is up or a crowd is near the core,
//   Orbital Relay   on the tower that has dealt the most damage lately (it acts as three).
// Shared by sim.mjs's play() (strategy.core / strategy.useCore), corevalue.mjs,
// late.mjs and curve.mjs so every script plays the core the same way.
export const POWERS = ["relay", "temporal"];
export const ALL = ["temporal", "relay"];
const CROWD_R = 320, CROWD_N = 6, BOSS_R = 420;

// a boss handed out a pick: take the first power in `order` not yet owned
// (a power missing from `order` is never chosen); returns true on a pick
export function pickNext(g, order) {
  if (!g.run("corePicks()")) return false;
  const id = order.find(p => !g.run(`powerLvl(${JSON.stringify(p)})`));
  return id ? g.run(`pickPower(${JSON.stringify(id)})`) : false;
}
// every power at once (late.mjs: a run that starts past wave 70)
export function grantAll(g) {
  for (const id of ALL) g.run(`coreState().picks++; pickPower(${JSON.stringify(id)});`);
}

// the tower that dealt the most since the last call (falls back to total);
// `kind`: only that kind's towers count, while the player has one (players.mjs)
function hotTower(g, mem, kind) {
  let bestT = null, bestD = -1;
  const pool = kind && g.G.towers.some(t => t.kind === kind) ? g.G.towers.filter(t => t.kind === kind) : g.G.towers;
  for (const t of g.G.towers) { const d = (t.dealt || 0) - (mem[t.id] || 0); mem[t.id] = t.dealt || 0; t.__hot = d; }
  for (const t of pool) if (t.__hot > bestD) { bestD = t.__hot; bestT = t; }
  return bestT;
}

const count = (mem, id) => { mem.fired = mem.fired || {}; mem.fired[id] = (mem.fired[id] || 0) + 1; };

// call every ~0.5 game-s; `mem` is a per-game object the caller keeps
// (hotTower's memory + `fired`, how many times each power went off)
export function usePowers(g, mem, relayKind) {
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
  if (!pw.relay || cd.relay > 0) return;
  const t = hotTower(g, mem, relayKind);
  if (t && g.run(`relay(G.towers.find(t => t.id === ${t.id}))`)) count(mem, "relay");
}
