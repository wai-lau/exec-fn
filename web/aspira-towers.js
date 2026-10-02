// /aspira — how each tower fires: Chain's lightning tree, the Slower's pulse
// and tethers, the Reaper's locked charge and beam, and the fire() dispatcher
// the sim step calls. Shared combat rules (damage, onHit, shotDamage,
// applySlow, kill) stay in aspira-game.js; this file loads right after it.

// Chain lightning is a TREE (owner): the tower strikes one hub, the hub arcs
// to st.branch enemies, each of those to as many more, st.layers deep. Base
// is 1-2 (3 hits) at every level; the L2 PATH reshapes it (owner): Storm
// 1-3-9, Ion a line 1-1-1-1. Every arc
// reaches from its own parent (arcRange) to the nearest enemy and deals the
// strike's damage x arcFall. Arcs may BOUNCE BACK to an enemy this shot
// already hit (owner) - just not to their own parent, nor to one a sibling
// arc from the same parent already took. Every arc lands hopDelay(st) after
// its parent was hit - kills included (owner): no arc ever skips the delay.
// Pending arcs step in stepChains on game time, so the delay scales with speed.
// RPR fires a bright flash that is gone almost at once (owner); its reload
// is shown by a separate charge-up line instead (stepReaper / drawAims)
// the arc delay is a QUARTER of the tower's shot interval (owner), so it
// follows fire-rate upgrades: 1.5 shots/s -> 0.17s per layer
const CHAIN_BEAM_LIFE = 0.2, RAY_BEAM_LIFE = 0.083, CHAIN_HOP_FRAC = 0.25;
const hopDelay = st => CHAIN_HOP_FRAC / st.rate;
// arcs only land on enemies within CHAIN_LEASH x the tower's range, measured
// from the TOWER (owner; drawn as a dashed outer ring)
const CHAIN_LEASH = 1.5;
const REAPER_HOLD = 2; // a Reaper's lock holds out to 2x the range it can start one in

// The tree is built of NODES (an enemy can appear in several once arcs
// bounce back): node = { e, fx: the beam that reached it, up: parent node,
// kids: Set of enemy ids its arcs already took }.
function fireChain(t, st, e) {
  const col = TOWERS[t.kind].color, dmg = shotDamage(t, st, e, st.dmg);
  beam(t, e, col, CHAIN_BEAM_LIFE, 1.5, dmg); const root = { e, fx: fx[fx.length - 1], up: null, kids: new Set() };
  damage(e, dmg, t, false, false, st); onHit(e, t, st, dmg);
  const c = { t, st, col, dmg: st.dmg * st.arcFall, seen: new Set([e.id]) };
  branchFrom(c, root, 1);
}
// keep this node's beam, and every beam above it, lit for `left` more
// seconds: a parent's beam outlives all its children's (the deepest keep
// CHAIN_BEAM_LIFE)
function keepLit(node, left) {
  for (let n = node; n; n = n.up) n.fx.life = Math.max(n.fx.life, n.fx.t + left);
}
// queue st.branch pending arcs out of `node`, one tree layer deeper
function branchFrom(c, node, depth) {
  if (depth > c.st.layers) return;
  keepLit(node, hopDelay(c.st) + 0.05); // stay lit until the children land
  for (let i = 0; i < c.st.branch; i++) (G.chains ||= []).push({ c, node, depth, wait: hopDelay(c.st) });
}
function stepChains(dt) {
  if (!G.chains || !G.chains.length) return;
  const pending = G.chains; G.chains = [];
  for (const p of pending) {
    p.wait -= dt;
    if (p.wait > 0) { G.chains.push(p); continue; }
    const nxt = nextHop(p.c, p.node);
    if (!nxt) continue; // nothing left in reach: this arc fizzles
    branchFrom(p.c, hopTo(p.c, p.node, nxt, p.depth), p.depth + 1);
  }
}

// the nearest enemy within arc reach of the node's enemy (and the tower's leash)
function nextHop(c, node) {
  const from = node.e, leash = (c.st.range * CHAIN_LEASH) ** 2;
  let nxt = null, nd = c.st.arcRange * c.st.arcRange;
  for (const o of G.enemies) {
    if (o.dead || o === from || node.kids.has(o.id)) continue;
    if (c.st.noRevisit && c.seen.has(o.id)) continue; // Ion: a line runs ON, never back
    if ((o.x - c.t.x) ** 2 + (o.y - c.t.y) ** 2 > leash) continue;
    const d = (o.x - from.x) ** 2 + (o.y - from.y) ** 2;
    if (d < nd) { nd = d; nxt = o; }
  }
  return nxt;
}
// Crescendo (st.hopGain): each layer deeper hits that much harder than the last
function hopTo(c, node, nxt, depth) {
  const { t, st, col } = c, d = shotDamage(t, st, nxt, c.dmg * (st.hopGain || 1) ** (depth - 1));
  node.kids.add(nxt.id); c.seen.add(nxt.id); beam(node.e, nxt, col, CHAIN_BEAM_LIFE, 1.5, d);
  const child = { e: nxt, fx: fx[fx.length - 1], up: node, kids: new Set() };
  keepLit(node, CHAIN_BEAM_LIFE); // the parent's beam outlasts this one
  damage(nxt, d, t, false, false, st); onHit(nxt, t, st, d);
  return child;
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
// A Reaper CHARGES at each locked target (t.locks: st.targets of them, 1 at base) for its whole reload
// (t.period), drawn as a fading-in line by drawAims, then fires at it.
// Owner's rules: if the target dies mid-charge the charge starts over on a
// new one; if it only leaves range the Reaper re-targets but keeps its charge;
// with no target at all it sits uncharged, so every shot is telegraphed.
function stepReaper(t, dt) {
  const st = towerStats(t);
  t.period = 1 / st.rate;
  // two ranges (owner): a lock can only START inside st.range (pickTargets),
  // but once charging it HOLDS out to REAPER_HOLD x that range. It holds up
  // to st.targets locks - 1 at base; more are PARKED for a Reaper upgrade
  // (owner: a `targets` mod) - EACH WITH ITS OWN CHARGE TIMER (owner):
  // a new lock charges from empty, fires its own ray when full and charges
  // again; a lock whose target dies or slips away is dropped, and the slot
  // refills with a fresh lock.
  t.locks = (t.locks || []).filter(l => !l.e.dead && Math.hypot(l.e.x - t.x, l.e.y - t.y) <= st.range * REAPER_HOLD);
  if (t.locks.length < st.targets) {
    for (const e of pickTargets(t, st, st.targets + t.locks.length)) {
      if (t.locks.length >= st.targets) break;
      if (!t.locks.some(l => l.e === e)) t.locks.push({ e, cd: t.period });
    }
  }
  let fired = false;
  for (const l of t.locks) {
    l.cd -= dt;
    if (l.cd > 0) continue;
    fireRay(t, st, l.e); l.cd = t.period; fired = true;
    t.shots = (t.shots || 0) + 1;
  }
  if (fired) sfx(t.kind);
}


// ACD (owner): continuous LINES on enemies whose burn RAMPS EXPONENTIALLY
// while held - doubling every st.double seconds (1s; Catalyst 0.6s), capped at
// st.cap (x64). It starts LOW (3 dmg/s at x1). Damage lands in st.rate ticks a
// second, each a real hit (armor cuts it, a shield eats it). Each line keeps
// its own ramp, which resets when its enemy dies or leaves range.
//   st.targets    lines at once (Pour 3)
//   st.residue    seconds a line keeps burning after its enemy leaves range
//   st.plagueR    each tick also burns everyone within this radius of the
//                 line's enemy (Plague); st.bloom grows it with the ramp
//   st.corrode    armor stripped from everything a tick burns, below zero
//   st.allInRange no lines: every enemy in range burns on its own ramp
const ACID_DOUBLE = 1, ACID_MAX = 64;
const acidMulOf = (held, st) => Math.min(st.cap, 2 ** (held / st.double));
const acidFrac = (l, st) => Math.log2(acidMulOf(l.held, st)) / Math.log2(st.cap); // 0 fresh .. 1 full burn
function plagueRadius(l, st) {
  return st.plagueR * (st.bloom ? 1 + (st.bloom - 1) * acidFrac(l, st) : 1);
}
function acidLines(t, st) {
  const r2 = st.range ** 2, inRange = e => !e.dead && (e.x - t.x) ** 2 + (e.y - t.y) ** 2 <= r2;
  let lines = (t.lines || []).filter(l => !l.e.dead);
  if (st.allInRange) {
    const had = new Map(lines.map(l => [l.e, l]));
    return G.enemies.filter(inRange).map(e => had.get(e) || { e, held: 0, tick: 0 });
  }
  // a line whose enemy left range lives on for st.residue seconds (Residue)
  lines = lines.filter(l => {
    if (inRange(l.e)) { l.left = st.residue || 0; return true; }
    return (l.left ?? 0) > 0;
  });
  let live = lines.filter(l => inRange(l.e)).length;
  for (const e of pickTargets(t, st, st.targets + lines.length)) {
    if (live >= st.targets) break;
    if (!lines.some(l => l.e === e)) { lines.push({ e, held: 0, tick: 0, left: st.residue || 0 }); live++; }
  }
  return lines;
}
function acidTick(t, st, l, every) {
  const d = st.dmg * acidMulOf(l.held, st) * every;
  const burn = o => {
    const dd = shotDamage(t, st, o, d);
    damage(o, dd, t); onHit(o, t, st, dd);
    if (st.corrode && !o.dead) o.armor = (o.armor || 0) - st.corrode; // Corrosion: past zero, on purpose
  };
  const R = st.plagueR ? plagueRadius(l, st) : 0, center = l.e;
  burn(center);
  if (R) for (const o of G.enemies) if (o !== center && !o.dead && Math.hypot(o.x - center.x, o.y - center.y) <= R) burn(o);
}
function stepAcid(t, dt) {
  const st = towerStats(t), every = 1 / st.rate, r2 = st.range ** 2;
  t.lines = acidLines(t, st);
  for (const l of t.lines) {
    if ((l.e.x - t.x) ** 2 + (l.e.y - t.y) ** 2 > r2) l.left -= dt; // Residue's countdown
    l.held += dt; l.tick += dt;
    while (l.tick >= every && !l.e.dead) { l.tick -= every; acidTick(t, st, l, every); }
  }
}

function fireRay(t, st, e) {
  const col = TOWERS[t.kind].color, crit = Math.random() < st.crit;
  const mulFor = o => (crit || (st.critBelow && o.hp / o.max < st.critBelow) ? st.critMul : 1);
  if (!st.pierce) {
    const m = mulFor(e), d = shotDamage(t, st, e, st.dmg) * m;
    beam(t, e, col, RAY_BEAM_LIFE, m > 1 ? 5 : 3, d, true);
    damage(e, d, t, false, m > 1); onHit(e, t, st, d); // a crit shows as a PINK number (owner)
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
    damage(o, d, t, false, m > 1); onHit(o, t, st, d);
    base *= st.pierce.fall;
  }
}

function fire(t, st) {
  if (t.kind === "slower") { const hit = fireSlower(t, st); if (!hit) t.links = []; return hit; }
  const targets = pickTargets(t, st, st.targets);
  if (!targets.length) return false;
  t.shots = (t.shots || 0) + 1;
  // one chain per target: st.targets > 1 (Ion's Fork) starts several lines on
  // DIFFERENT enemies (pickTargets never repeats one)
  if (t.kind === "chain") { for (const e of targets) fireChain(t, st, e); return true; }
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
