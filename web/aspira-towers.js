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
// arcs only land on enemies within the REACH, measured from the TOWER (owner;
// drawn as a dashed outer ring): CHAIN_LEASH x range for the base 1-layer
// tree, and a longer chain reaches further (owner, 2026-10-02) - +0.5 x range
// per layer: Storm (2) 2x, Ion (3) 2.5x, Rail (6) 4x, Railgun (10) 6x
const CHAIN_LEASH = 1.5, LEASH_PER_LAYER = 0.5;
const chainReach = st => st.range * (CHAIN_LEASH + LEASH_PER_LAYER * (st.layers - 1));
const REAPER_HOLD = 2; // a Reaper's lock holds out to 2x the range it can start one in

// The tree is built of NODES (an enemy can appear in several once arcs
// bounce back): node = { e, fx: the beam that reached it, up: parent node,
// kids: Set of enemy ids its arcs already took }.
// from: where the strike comes from - the tower, or (Static) the spot where a
// charged enemy died; relay: this shot was fired by Static (its hits charge
// enemies only at L4, Thunderhead, so kills cannot chain-react below that)
function fireChain(t, st, e, from = t, relay = false) {
  const col = TOWERS[t.kind].color, dmg = shotDamage(t, st, e, st.dmg);
  beam(from, e, col, CHAIN_BEAM_LIFE, 1.5, dmg); const root = { e, fx: fx[fx.length - 1], up: null, kids: new Set() };
  if (st.ignoreShield) root.fx.pierce = true; // Ion: a white core - it pierces (owner)
  const c = { t, st, col, dmg: st.dmg * st.arcFall, seen: new Set([e.id]), relay };
  chainHit(c, e, dmg);
  branchFrom(c, root, 1);
}
// one ARC hit; Static charges the enemy (Marigold border) so its death fires a shot
function chainHit(c, e, d) {
  damage(e, d, c.t, false, false, c.st); onHit(e, c.t, c.st, d);
  if (c.st.static && !e.dead && (!c.relay || c.st.static > 1)) e.charged = c.t;
}
// Static: a charged enemy that dies fires a full ARC shot from where it died,
// at the nearest live enemy within the tower's range of that spot
function staticDischarge(e) {
  const t = e.charged;
  if (!G.towers.includes(t)) return;
  const st = towerStats(t);
  let nxt = null, nd = st.range * st.range;
  for (const o of G.enemies) {
    if (o.dead || o === e) continue;
    const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
    if (d < nd) { nd = d; nxt = o; }
  }
  if (nxt) fireChain(t, st, nxt, { x: e.x, y: e.y }, true);
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
  const from = node.e, leash = chainReach(c.st) ** 2;
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
  if (c.st.ignoreShield) fx[fx.length - 1].pierce = true;
  const child = { e: nxt, fx: fx[fx.length - 1], up: node, kids: new Set() };
  keepLit(node, CHAIN_BEAM_LIFE); // the parent's beam outlasts this one
  chainHit(c, nxt, d);
  return child;
}

// Moon / Desolation (st.all; were Whiteout / Blizzard) no longer chill the
// whole range (owner: it read like ACD's Contagion): st.moons MOONS orbit the
// tower fast, evenly spaced (Moon 1, Desolation 2), and a pulse lands on
// whatever is inside a moon's sector out to MOON_REACH x range.
const MOON_SPIN = 4, MOON_ARC = 1.1, MOON_REACH = 1.15; // rad/s; sector half-width, rad
const moonAngles = (t, st) => {
  const a = (t.spin || 0) * MOON_SPIN, n = st.moons || 1;
  return Array.from({ length: n }, (_, i) => a + i * 2 * Math.PI / n);
};
function inMoonSweep(t, st, e) {
  const dx = e.x - t.x, dy = e.y - t.y;
  if (dx * dx + dy * dy > (st.range * MOON_REACH) ** 2) return false;
  const a = Math.atan2(dy, dx);
  return moonAngles(t, st).some(m => Math.abs(Math.atan2(Math.sin(a - m), Math.cos(a - m))) <= MOON_ARC);
}
function fireSlower(t, st) {
  // unslowed enemies first, so three towers do not all chill the same three
  const cands = st.all ? G.enemies.filter(e => !e.dead && inMoonSweep(t, st, e))
    : pickTargets(t, st, 9999).sort((a, b) => (a.slowT > 0) - (b.slowT > 0)).slice(0, st.targets);
  // SLW draws CONTINUOUS tethers to the enemies it last pulsed (drawTethers),
  // not per-pulse beams; the slow and nick still land once per pulse
  t.links = cands;
  for (const e of cands) {
    const fresh = !(e.slowT > 0);
    if (!applySlow(e, st.slow, st.permafrost ? Infinity : SLOW_TIME, t.id)) continue; // Permafrost: forever
    if (st.shatter) e.shatter = { t, st };
    // Deep Freeze: a near-freeze (95% slow), never a stun - no stunlocking (owner)
    if (st.chillStop && fresh) applySlow(e, 0.95, st.chillStop, t.id + ":chill");
    if (st.brittle) e.brittle = Math.max(e.brittle || 1, st.brittle);
    if (st.siphon) e.siphon = Math.max(e.siphon || 1, st.siphon);
    // each pulse also nicks: st.dmg (+ Sap's % max HP); it is a real hit, so
    // it pops one shield charge per enemy touched (owner)
    const nick = st.dmg + (st.sap ? e.max * st.sap : 0);
    if (nick > 0) damage(e, nick, t);
  }
  return cands.length > 0;
}

// Shatter (FRZ): an enemy that dies while slowed, after a Shatter FRZ chilled
// it, explodes for st.shatter.mul x that tower's hit on everyone within r;
// Frostbite slows what the blast hits. Blast kills never shatter in turn
// (no chain reactions; owner).
let shattering = false;
function shatterAt(e) {
  const { t, st } = e.shatter, r = st.shatter.r, d = st.dmg * st.shatter.mul;
  ring(e.x, e.y, r, "cyan", 0.25, true); // gradient-filled (owner)
  shattering = true;
  for (const o of G.enemies) {
    if (o === e || o.dead || Math.hypot(o.x - e.x, o.y - e.y) > r) continue;
    damage(o, d, t);
    if (st.frostbite && !o.dead) { applySlow(o, st.slow, st.frostbite, t.id); o.biteT = st.frostbite; } // biteT: frost tint
  }
  shattering = false;
}

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
    if (st.corrode && !o.dead) { o.armor = (o.armor || 0) - st.corrode; o.corrodeT = 0.4; } // Corrosion: past zero, on purpose; corrodeT: dotted ring
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
    // every tick spits (owner: Hydralisk sound); aspira-sfx.js caps it at 3
    // at once, each quieter than the last
    while (l.tick >= every && !l.e.dead) { l.tick -= every; acidTick(t, st, l, every); sfx("acid"); }
  }
}

// SOL's shot: one crit roll per shot. Its forms (owner, 2026-10-02):
//   st.longshot  +x damage per 10 units from the tower (Longshot)
//   st.splash    the hit explodes (Supernova; onHit)
//   st.execute   an enemy left with less HP than this share of the shot dies outright (Execute)
//   st.bounce    the beam bounces once to the nearest enemy at this share (Ricochet)
//   st.refund    this share of any OVERKILL flies back to the tower as a
//                reflected beam and is banked into its next shot (Refund)
const BOUNCE_R = 160;
function rayHit(t, st, e, base, from, crit) {
  const m = crit || (st.critBelow && e.hp / e.max < st.critBelow) ? st.critMul : 1;
  const far = st.longshot ? 1 + st.longshot * Math.hypot(e.x - t.x, e.y - t.y) / 10 : 1;
  const d = shotDamage(t, st, e, base) * m * far, before = e.hp;
  beam(from, e, TOWERS[t.kind].color, RAY_BEAM_LIFE, m > 1 ? 5 : 3, d, true);
  if (st.twin) fx[fx.length - 1].twin = true; // Charge: drawn as two parallel beams (owner)
  damage(e, d, t, false, m > 1); onHit(e, t, st, d); // a crit shows as a PINK number (owner)
  if (st.execute && !e.dead && e.hp < d * st.execute) {
    // Execute / Verdict: the enemy flashes WHITE as it goes, with extra sparks (owner)
    fx.push({ k: "flash", x: e.x, y: e.y, r: ENEMIES[e.type].size * 1.6, t: 0, life: 0.3 });
    burst(e.x, e.y, "white", 22);
    damage(e, e.hp + 1, t, false, true);
  }
  return e.dead ? Math.max(0, d - before) : 0;
}
function fireRay(t, st, e) {
  const crit = Math.random() < st.crit, bank = t.bank || 0;
  t.bank = 0;
  let over = rayHit(t, st, e, st.dmg + bank, t, crit);
  if (st.bounce) {
    let nxt = null, nd = BOUNCE_R * BOUNCE_R;
    for (const o of G.enemies) {
      if (o.dead || o === e) continue;
      const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
      if (d < nd) { nd = d; nxt = o; }
    }
    if (nxt) over += rayHit(t, st, nxt, st.dmg * st.bounce, e, false);
  }
  if (st.refund && over > 0) {
    t.bank = over * st.refund;
    beam(e, t, TOWERS[t.kind].color, RAY_BEAM_LIFE * 3, 2, t.bank, true, false); // the reflected beam home
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
