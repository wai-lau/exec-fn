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
// is shown by a separate charge-up line instead (stepSol / drawAims)
// the arc delay is a QUARTER of the tower's shot interval (owner), so it
// follows fire-rate upgrades: 1.5 shots/s -> 0.17s per layer
// beam lives (x BEAM_LIFE_MUL; look only - owner, 2026-10-08: SOL longer, ARC slightly shorter; were 0.2 / 0.083)
const CHAIN_BEAM_LIFE = 0.16, RAY_BEAM_LIFE = 0.15, CHAIN_HOP_FRAC = 0.25;
const hopDelay = st => CHAIN_HOP_FRAC / st.rate;
// arcs only land on enemies within the REACH, measured from the TOWER (owner;
// drawn as a dashed outer ring): CHAIN_LEASH x range for the base 1-layer
// tree, and a longer chain reaches further (owner, 2026-10-02) - +0.5 x range
// per layer: Storm (2) 2x, Ion (3) 2.5x, Rail (6) 4x, Railgun (10) 6x
const CHAIN_LEASH = 1.5, LEASH_PER_LAYER = 0.5;
const chainReach = st => (st.skill ? st.range + st.arcRange * (1 - st.arcShrink ** st.layers) / (1 - st.arcShrink) // a chart ARC: its jumps, each shorter
  : st.range * (CHAIN_LEASH + LEASH_PER_LAYER * (st.layers - 1)));
const SOL_HOLD = 2; // a Reaper's lock holds out to 2x the range it can start one in

// The tree is built of NODES (an enemy can appear in several once arcs
// bounce back): node = { e, fx: the beam that reached it, up: parent node,
// kids: Set of enemy ids its arcs already took }.
// from: where the strike comes from - the tower, or (Static) the spot where a
// charged enemy died; relay: this shot was fired by Static (its hits charge
// enemies only at L4, Thunderhead, so kills cannot chain-react below that)
function fireChain(t, st, e, from = t, relay = false, seen = null) {
  if (st.skill) { fireSkillChain(t, st, e, seen); return; } // the skill-chart ARC (aspira-skills.js)
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
  for (let n = node; n; n = n.up) n.fx.life = Math.max(n.fx.life, n.fx.t + left * BEAM_LIFE_MUL); // beams last longer (owner), the tree with them
}
// queue st.branch pending arcs out of `node`, one tree layer deeper
// ARMOR GROUNDS THE ARC (2026-10-08, the counter table: ARC weak against armor): a chart ARC's arc that
// strikes an ARMORED enemy (armor still above ARC_GROUND) stops there - no jumps on from it
const ARC_GROUND = { at: 0 };
function branchFrom(c, node, depth) {
  if (depth > c.st.layers) return;
  if (c.skill && (node.e.armor || 0) > ARC_GROUND.at) return;
  keepLit(node, hopDelay(c.st) + 0.05); // stay lit until the children land
  for (let i = 0; i < c.st.branch; i++) (G.chains ||= []).push({ c, node, depth, wait: hopDelay(c.st) });
}
function stepChains(dt) {
  if (!G.chains || !G.chains.length) return;
  const pending = G.chains; G.chains = [];
  for (const p of pending) {
    p.wait -= dt;
    if (p.wait > 0) { G.chains.push(p); continue; }
    const nxt = p.c.skill ? skillHop(p.c, p.node, p.depth) : nextHop(p.c, p.node);
    if (!nxt) continue; // nothing left in reach: this arc fizzles
    branchFrom(p.c, (p.c.skill ? skillHopTo : hopTo)(p.c, p.node, nxt, p.depth), p.depth + 1);
  }
}

// the nearest enemy within arc reach of the node's enemy (and the tower's
// leash) that is NOT AN ANCESTOR of this node (owner: every ARC hop, not just
// back to its own parent) - an arc never runs back up its own branch
function nextHop(c, node) {
  const from = node.e, leash = chainReach(c.st) ** 2, anc = new Set();
  for (let n = node; n; n = n.up) anc.add(n.e.id);
  let nxt = null, nd = c.st.arcRange * c.st.arcRange;
  for (const o of G.enemies) {
    if (o.dead || anc.has(o.id) || node.kids.has(o.id)) continue;
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
  // Crescendo / Fortissimo: each hop LOOKS heavier too (owner) - a thicker
  // beam, a growing ring and more sparks the deeper it goes
  const up = st.hopGain ? depth - 1 : 0;
  node.kids.add(nxt.id); c.seen.add(nxt.id); beam(node.e, nxt, col, CHAIN_BEAM_LIFE, 1.5 * (1 + 0.6 * up), d);
  if (c.st.ignoreShield) fx[fx.length - 1].pierce = true;
  // the beam's opacity is the share of the FIRST strike's damage this hop still carries (owner)
  fx[fx.length - 1].alpha = Math.min(1, c.dmg * (st.hopGain || 1) ** (depth - 1) / st.dmg);
  if (up) { ring(nxt.x, nxt.y, 14 + 9 * up, col, 0.18 + 0.05 * up); burst(nxt.x, nxt.y, col, 3 * up); }
  const child = { e: nxt, fx: fx[fx.length - 1], up: node, kids: new Set() };
  keepLit(node, CHAIN_BEAM_LIFE); // the parent's beam outlasts this one
  chainHit(c, nxt, d);
  return child;
}

// Moons / Desolation (were Whiteout / Blizzard; owner, 2026-10-02): st.moons
// MOONS orbit the tower at MOON_ORBIT, evenly spaced, and EACH MOON IS A
// STASIS FRZ of its own - the tower's range, slow, nick and target count, all
// measured from the moon, with its own tether. Desolation: a third moon and
// +10% slow (owner).
const MOON_SPIN = 2 / 3, MOON_ORBIT = 126; // rad/s (owner: 4 -> 2 -> 2/3); orbit radius tripled (owner, 2026-10-05; was 80, then 42)
// a chart FRZ's moons orbit CLOSER, and closer with every Moons tier (owner,
// 2026-10-06: after the range halving 126 put them far outside the aura)
const MOON_ORBIT_BY_N = [MOON_ORBIT, 140, 140, 140, 140, 140]; // TWICE as far (owner, 2026-10-08: "twice as far as they are now"; was 70 at every tier, before that 70 58 46 46 46)
// a chart FRZ's moons fly ELLIPTICAL orbits (owner, 2026-10-08): Keplerian, the tower at a focus, the
// orbit's size its old radius, eccentricity MOON_ECC - the near end (periapsis) toward the core, so a moon
// swings far out over the lanes (210) and back in close (70), fastest near the tower; the moons are evenly
// spaced in TIME (mean anomaly), so they bunch on the far side like real ones
const MOON_ECC = 0; // back to CIRCLES (owner, same day; 0.5 swung 70..210) - 0 makes the orbit a circle round the tower
// the orbit itself, for drawing: centre (a x e from the focus, away from periapsis), semi-axes, tilt
function moonOrbit(t, n) {
  const a = MOON_ORBIT_BY_N[Math.min(n, MOON_ORBIT_BY_N.length - 1)], phi = Math.atan2(CY - t.y, CX - t.x);
  return { x: t.x - Math.cos(phi) * a * MOON_ECC, y: t.y - Math.sin(phi) * a * MOON_ECC, a, b: a * Math.sqrt(1 - MOON_ECC * MOON_ECC), phi };
}
function moonSpots(t, st) {
  const a = (t.spin || 0) * MOON_SPIN, n = st.moons || 1;
  const kep = hasSkills(t), phi = Math.atan2(CY - t.y, CX - t.x), cp = Math.cos(phi), sp = Math.sin(phi), b = Math.sqrt(1 - MOON_ECC * MOON_ECC);
  return Array.from({ length: n }, (_, i) => {
    const m = a + i * 2 * Math.PI / n;
    const r = kep ? MOON_ORBIT_BY_N[Math.min(n, MOON_ORBIT_BY_N.length - 1)] : MOON_ORBIT;
    if (!kep) return { x: t.x + Math.cos(m) * r, y: t.y + Math.sin(m) * r };
    let E = m; for (let k = 0; k < 5; k++) E -= (E - MOON_ECC * Math.sin(E) - m) / (1 - MOON_ECC * Math.cos(E)); // Kepler's equation
    const px = r * (Math.cos(E) - MOON_ECC), py = r * b * Math.sin(E); // from the focus, periapsis on +x
    return { x: t.x + px * cp - py * sp, y: t.y + px * sp + py * cp };
  });
}
// each moon's pick, like a Stasis FRZ standing where the moon is; t.moonLinks
// remembers which moon holds which enemy, for the tethers
function moonTargets(t, st) {
  const out = [], taken = new Set();
  t.moonLinks = [];
  moonSpots(t, st).forEach((m, i) => {
    const mine = pickTargets({ ...t, x: m.x, y: m.y }, st, 9999).filter(e => !taken.has(e))
      .sort((a, b) => (a.slowT > 0) - (b.slowT > 0)).slice(0, st.targets);
    for (const e of mine) { taken.add(e); out.push(e); t.moonLinks.push({ i, e }); }
  });
  return out;
}
function fireFrz(t, st) {
  // unslowed enemies first, so three towers do not all chill the same three
  const cands = st.moons ? moonTargets(t, st)
    : pickTargets(t, st, 9999).sort((a, b) => (a.slowT > 0) - (b.slowT > 0)).slice(0, st.targets);
  // SLW draws CONTINUOUS tethers to the enemies it last pulsed (drawTethers),
  // not per-pulse beams; the slow and nick still land once per pulse
  t.links = cands;
  for (const e of cands) {
    const fresh = !(e.slowT > 0);
    if (!applySlow(e, st.slow, st.permafrost ? Infinity : SLOW_TIME, t.id, st.permafrost ? "once" : "refresh")) continue; // Permafrost: once, forever
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
const aimAt = (t, e) => Math.atan2(e.y - t.y, e.x - t.x);
// e within SOL's cone (st.cone degrees either side) of direction a from the tower
const inSolCone = (t, st, a, e) => Math.abs(((aimAt(t, e) - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) <= (st.cone || SOL_CONE) * Math.PI / 180;
function stepSol(t, dt) {
  const st = towerStats(t);
  t.period = 1 / st.rate;
  // two ranges (owner): a lock can only START inside st.range (pickTargets),
  // but once charging it HOLDS out to SOL_HOLD x that range. It holds up
  // to st.targets locks - 1 at base; more are PARKED for a Reaper upgrade
  // (owner: a `targets` mod) - EACH WITH ITS OWN CHARGE TIMER (owner):
  // a new lock charges from empty, fires its own ray when full and charges
  // again; a lock whose target dies or slips away is dropped, and the slot
  // refills with a fresh lock.
  // CHARGE CONSERVATION (owner, 2026-10-08): a lost lock hands its charge on only to a new
  // target inside the Refraction cone (st.cone either side) of the lost one's direction from
  // the tower; anywhere else the new lock charges from empty
  const lost = [];
  t.locks = (t.locks || []).filter(l => { const ok = !l.e.dead && Math.hypot(l.e.x - t.x, l.e.y - t.y) <= st.range * SOL_HOLD; if (!ok) lost.push({ a: aimAt(t, l.e), cd: l.cd }); return ok; });
  if (t.locks.length < st.targets) {
    for (const e of pickTargets(t, st, st.targets + t.locks.length)) {
      if (t.locks.length >= st.targets) break;
      if (t.locks.some(l => l.e === e)) continue;
      const k = lost.findIndex(o => inSolCone(t, st, o.a, e));
      t.locks.push({ e, cd: k >= 0 ? lost.splice(k, 1)[0].cd : t.period });
    }
  }
  let fired = false;
  for (const l of t.locks) {
    l.cd -= dt;
    if (l.cd > 0) continue;
    // a full charge RE-AIMS by the targeting before it fires (owner: Fresh kept
    // hitting the enemy it had already bled): the best enemy in range that no
    // other lock holds - inside the Refraction cone of its target, since only
    // there does the charge carry over (owner, 2026-10-08); else it fires where it was
    const a0 = aimAt(t, l.e), pick = pickTargets(t, st, st.targets + t.locks.length).find(e => e === l.e || (!t.locks.some(o => o.e === e) && inSolCone(t, st, a0, e)));
    if (pick) l.e = pick;
    fireRay(t, st, l.e); l.cd = t.period; fired = true;
    t.shots = (t.shots || 0) + 1;
  }
  if (fired) sfx(t.kind);
}


// SOL's shot (owner, 2026-10-03). One crit roll per target, its chance the
// tower's own plus the target's BLEED, times st.critScale (Pinpoint). Forms:
//   st.bleedArmor / st.bleedCrit  each hit bleeds the enemy (Impale): armor
//                 down for good (past zero), crit chance up for every tower
//   st.ricochet   the shot chains at full damage to this many more enemies
//   st.beams      converging beams, each a FULL hit (Focus 2 / 3 / 4) - so each pops
//                 its own shield charge
//   st.smash      a kill bursts for frac x the shot within r (Nova)
const BOUNCE_R = 120, BLEED_CRIT_CAP = 1; // Ricochet hop at 75%, with every range (owner)
function bleed(e, st, t) {
  if (!st.bleedArmor || e.dead) return;
  const k = st.breach || 1; // the chart SOL: Breach stacks per hit (aspira-skills.js)
  const per = st.breachRef ? st.breachRef * armorRefOf(e.wave || 1) : st.bleedArmor; // the chart SOL: in wave armors (aspira-skills.js)
  e.armor = (e.armor || 0) - per * k; stripBy(e, t, per * k); // permanent, and on past zero (owner); its share of the damage it adds is SOL's (damageCredit)
  e.bleedCrit = Math.min(BLEED_CRIT_CAP, (e.bleedCrit || 0) + st.bleedCrit * k); e.breachN = (e.breachN || 0) + k; // stacks, for the spokes
}
function rayHit(t, st, e, base, from) {
  const crit = Math.random() < ((st.crit || 0) + (e.bleedCrit || 0)) * (st.critScale || 1);
  const m = crit ? st.critMul : 1, d = shotDamage(t, st, e, base) * m;
  const n = st.beams || 1, part = d; // every beam is a FULL hit (owner, 2026-10-06; was a fitted share of the shot)
  beam(from, e, TOWERS[t.kind].color, RAY_BEAM_LIFE, m > 1 ? 5 : 3, d, true);
  if (n > 1 && from === t) fx[fx.length - 1].beams = n; // n converging beams from the tower; a Refract hop past the first enemy is ONE thick beam (owner)
  for (let i = 0; i < n && !e.dead; i++) {
    damage(e, part, t, false, crit, st); onHit(e, t, st, part); bleed(e, st, t); // a crit shows as a PINK number (owner); st: its shieldPop
  }
  if (e.dead && st.smash && !e.smashed) {
    // Nova / Supernova: the kill bursts (a filled blast that lingers, owner)
    e.smashed = true;
    fx.push({ k: "blast", x: e.x, y: e.y, r: st.smash.r, color: TOWERS[t.kind].color, t: 0, life: 0.35 });
    for (const o of G.enemies) {
      if (o !== e && !o.dead && Math.hypot(o.x - e.x, o.y - e.y) <= st.smash.r) damage(o, d * st.smash.frac, t, true);
    }
  }
}
function fireRay(t, st, e) {
  rayHit(t, st, e, st.dmg, t);
  if (st.refraction) { solRefraction(t, st, e); return; } // the chart SOL's Refract (aspira-skills.js)
  if (!st.ricochet) return;
  // Ricochet / Shredder: hop to the nearest enemy not yet hit, at full damage
  const hit = new Set([e]);
  let prev = e;
  for (let k = 0; k < st.ricochet; k++) {
    let nxt = null, nd = BOUNCE_R * BOUNCE_R;
    for (const o of G.enemies) {
      if (o.dead || hit.has(o)) continue;
      const dd = (o.x - prev.x) ** 2 + (o.y - prev.y) ** 2;
      if (dd < nd) { nd = dd; nxt = o; }
    }
    if (!nxt) break;
    rayHit(t, st, nxt, st.dmg, prev); hit.add(nxt); prev = nxt;
  }
}

function fire(t, st) {
  if (t.kind === "frz") { const hit = fireFrz(t, st); if (!hit) t.links = []; return hit; }
  const targets = pickTargets(t, st, st.targets);
  if (!targets.length) return false;
  t.shots = (t.shots || 0) + 1;
  // one chain per target: st.targets > 1 (Ion's Fork) starts several lines on
  // DIFFERENT enemies (pickTargets never repeats one)
  // (a chart ARC's two strikes are two SEPARATE attacks - owner: each its own tree)
  if (t.kind === "arc") { for (const e of targets) fireChain(t, st, e); return true; }
  if (t.kind === "sol") { fireRay(t, st, targets[0]); return true; }
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

// ---------- towers MOVE (owner, 2026-10-10: "all of the towers can be dragged") ----------
// The player DRAGS a tower, any time, and it follows the finger while held - firing the
// whole way (aspira-camera.js); it never moves itself in a real game (the simulator's
// stand-in player does: autoPosition, aspira-positioning.js). It stays inside its LEASH,
// a circle round its own slot (its SPAWN), radius leashR - the slide travel it had on its
// spoke (2026-10-03 .. 2026-10-09; slideLimits below), so it reaches as far out as it did.
// Slide tiers grow it (SKILL_MOVE `slide`, aspira-skills.js); `speed` no longer does
// anything - a tower is where the finger is.
// the old spoke's reach per kind (owner, 2026-10-04 .. 06): FRZ and ACD roam, ARC and SOL anchor
const TOWER_REACH = { frz: 400, acd: 350, arc: 350, sol: 180 }; // SOL: its travel halved (owner; was 250 - a slot sits ~110 out)
const SLIDE_K_HALF = 0.5, SLIDE_MAX = 2;
// FRZ's slide HALVED (owner, 2026-10-06; Rime tiers buy it back, III = the old extent)
const SLIDE_KIND = { acd: 1, frz: 0.5, arc: SLIDE_K_HALF, sol: SLIDE_K_HALF };
// towers may slide 50% further IN toward the core (owner, 2026-10-06; were 0.89 / 0.945)
const TOWER_IN_KIND = { acd: 0.835, frz: 0.9175 }; // the rest: TOWER_IN (FRZ halved too)
const TOWER_IN = 0.9175;
// a slot's own inner limit (the corner slots carry one, CORNER_IN) else TOWER_IN of its distance
const innerR = (c, r0, slide = 1, kind = null) => c.minR ?? r0 * (1 - (1 - (TOWER_IN_KIND[kind] ?? TOWER_IN)) * Math.min(slide, SLIDE_MAX));
// how far out a kind slid from a slot r0 from the core (slide = the tier's multiplier)
const slideOut = (kind, r0, slide = 1) => Math.max(0, TOWER_REACH[kind] - r0) * SLIDE_KIND[kind] * Math.min(slide, SLIDE_MAX);
// THE TRAVEL (owner, 2026-10-07): MOVE_SPAN (75%) of what innerR / slideOut give, worked from
// TRAVEL_R0 (the ring's old radius) so it did not change when the slots moved in snug
const MOVE_SPAN = 2.25 /* x1.5 (owner, 2026-10-12: "increase movement range (unless capped by screen) of all towers by 50%"; was 1.5); owner, 2026-10-11: "increase movement range of all towers by 2x" (was 0.75); the later cut to 1 REVERTED ("revert all the mvmt range reductions, only keep the screen limit") - the screen cap (leashR) is the only limit now */, NEAR_R = SLOT_R, CORNER_NEAR = 100;
function slideLimits(c, kind, sl = 1) {
  const r0 = Math.hypot(c.x - CX, c.y - CY) || 1, rt = c.unlock ? r0 : TRAVEL_R0;
  const span = (slideOut(kind, rt, sl) + rt - innerR(c, rt, sl, kind)) * MOVE_SPAN;
  const min = (c.unlock ? CORNER_NEAR : NEAR_R) - r0;
  return { r0, min, max: min + span };
}
// the leash's radius: the old travel, end to end - CAPPED so the whole leash (a tower's hex at its far edge, and a margin)
// stays on the narrowest phone's screen at the fixed zoom: slot + leash <= MOVE_MAX_R from the core (owner, 2026-10-11)
const MOVE_EDGE = 12; // world units kept clear of the screen's edge
const moveMaxR2d = () => PHONE_MIN_W / 2 / FIXED_ZOOM - CELL_S * TOWER_K - MOVE_EDGE;
// 3D (owner: "both modes"): the largest radius whose every point, PROJECTED, stays inside the 2D cap's on-screen box -
// found by bisection once per camera, under the 3D frame's own camera (cam x WARP_RES, as warp3d draws it - projecting
// with the plain camera read the view as x1.46 magnified and gave a cap a third too small); about the 2D cap, the view
// matching 2D across at the core and foreshortened up and down
let moveMax3d = { key: "", r: 0 };
function moveMaxR3d() {
  if (moveMax3d.lock) return moveMax3d.r; // inside a 3D frame cam is the TEXTURE's camera: keep the view's cap (warp3d)
  const key = [cam.k, cam.ox, cam.oy, WARP.tilt, WARP.fov].join();
  if (moveMax3d.key === key) return moveMax3d.r;
  const c0 = { k: cam.k, ox: cam.ox, oy: cam.oy };
  cam.k *= WARP_RES; cam.ox *= WARP_RES; cam.oy *= WARP_RES;
  let lo = 0;
  try {
    const lim = moveMaxR2d(), k = cam.k, c = warpProject(CX, CY, 0);
    const fits = R => { for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, p = warpProject(CX + R * Math.cos(a), CY + R * Math.sin(a), 0);
      if (!(p.s > 0) || Math.abs(p.x - c.x) / k > lim || Math.abs(p.y - c.y) / k > lim * 1.5) return false; } return true; };
    let hi = lim * 1.5;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  } finally { Object.assign(cam, c0); }
  moveMax3d = { key, r: lo };
  return lo;
}
const moveMaxR = () => (typeof q3d === "function" && q3d() && typeof warp !== "undefined" && warp.p ? moveMaxR3d() : moveMaxR2d());
// ...CAPPED, never scaled (owner, 2026-10-11: "don't scale all the ranges, just cap out the maximum range so that towers
// don't fly off screen (both modes)"): a leash is its own length up to the cap; in 3D the core's view keeps the 2D scale
// across the screen at the core (moveMaxR3d)
const leashR = t => {
  const c = CELLS[t.cell], { min, max } = slideLimits(c, t.kind, towerStats(t, true).slide);
  return Math.max(0, Math.min(max - min, moveMaxR() - Math.hypot(c.x - CX, c.y - CY)));
};
const slideSpan = t => Math.round(leashR(t)); // the card's Leash row
const towerAt = p => G.towers.find(t => Math.hypot(p.x - t.x, p.y - t.y) <= CELL_S);
// two towers' centres stay TOWER_GAP apart (a hex each plus a sliver), and the core
// blocks a tower only where their outlines would meet (owner, 2026-10-12: "right now
// there's an air gap"; was a SLOT_R circle): two pointy hexes of one orientation touch
// when the offset lies on a hex of their summed radii, coreKeep(a) out along angle a
const towerGap = () => 2 * CELL_S * TOWER_K + 4;
const coreKeepR = () => (typeof coreOuterR === "function" ? coreOuterR() : CORE_R) + CELL_S * TOWER_K + 2;
const coreKeep = a => { const s = Math.PI / 3, f = ((a % s) + s) % s; return coreKeepR() * Math.sqrt(3) / 2 / Math.cos(Math.min(f, s - f)); };
// the legal spot nearest p for t: inside its leash, off the core, clear of the
// other towers - or null when no nudge finds one (it then stays where it is)
function legalSpot(t, p) {
  const c = CELLS[t.cell], L = leashR(t), gap = towerGap();
  let x = p.x, y = p.y;
  const away = (ox, oy, min) => { const d = Math.hypot(x - ox, y - oy) || 1e-6; if (d < min) { x = ox + (x - ox) * min / d; y = oy + (y - oy) * min / d; } };
  for (let i = 0; i < 4; i++) {
    for (const o of G.towers) if (o !== t) away(o.x, o.y, gap);
    away(CX, CY, coreKeep(Math.atan2(y - CY, x - CX)));
    const d = Math.hypot(x - c.x, y - c.y);
    if (d > L) { x = c.x + (x - c.x) * L / d; y = c.y + (y - c.y) * L / d; }
  }
  const clear = G.towers.every(o => o === t || Math.hypot(x - o.x, y - o.y) >= gap - 0.5) && Math.hypot(x - CX, y - CY) >= coreKeep(Math.atan2(y - CY, x - CX)) - 0.5;
  return clear ? { x, y } : null;
}
function moveTo(t, p) { const s = legalSpot(t, p); if (s) { t.x = s.x; t.y = s.y; } return !!s; }

// UI only (aspira-draw.js): every moved tower's SPAWN, a faint hex in its colour on
// its slot, and the selected (or held) tower's LEASH, a dashed circle round it
// the leash SHOWN on its own for LEASH_HINT_S real seconds, its dashes marching, after the game's first tower is
// placed or a tower's leash grows (owner, 2026-10-10: "to indicate that it can be moved")
const LEASH_HINT_S = 4, LEASH_HINT_FADE_S = 1;
const hintLeash = t => { t.leashHint = performance.now() / 1000 + LEASH_HINT_S; };
function drawLeash() {
  ctx.lineWidth = 2;
  const now = performance.now() / 1000;
  for (const t of G.towers) {
    const c = CELLS[t.cell], col = COL[TOWERS[t.kind].color], held = towerHeld(t);
    ctx.strokeStyle = col;
    if (Math.hypot(t.x - c.x, t.y - c.y) > 1) { ctx.globalAlpha = 0.35; towerHex(c, TOWER_K); ctx.stroke(); }
    const hint = t.leashHint > now ? Math.min(1, (t.leashHint - now) / LEASH_HINT_FADE_S) : 0;
    if (t.id !== ui.sel && !held && !hint) continue;
    ctx.globalAlpha = Math.max(held ? 0.8 : t.id === ui.sel ? 0.5 : 0, 0.8 * hint); ctx.setLineDash([8, 8]);
    if (hint) ctx.lineDashOffset = -now * 24; // marching
    ctx.beginPath(); ctx.arc(c.x, c.y, leashR(t), 0, 6.283); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (!held) leashArrows(t, c, now, ctx.globalAlpha); // not while it is being dragged (owner, 2026-10-11)
  }
  ctx.globalAlpha = 1;
}
// ARROWS POINTING AWAY from the tower (owner, 2026-10-11: "movement indicator should have arrows pointing away from
// tower"): LEASH_ARROWS chevrons, each gliding out along its own spoke from the tower's edge to the leash ring every
// LEASH_ARROW_T s, fading in and out, so the circle reads as "drag me this far"
const LEASH_ARROWS = 6, LEASH_ARROW_T = 1.2, LEASH_ARROW_W = 6;
function leashArrows(t, c, now, A) {
  const R = leashR(t), r0 = CELL_S * TOWER_K + 8, f = (now / LEASH_ARROW_T) % 1;
  for (let i = 0; i < LEASH_ARROWS; i++) {
    const a = (i + 0.5) * 2 * Math.PI / LEASH_ARROWS, ux = Math.cos(a), uy = Math.sin(a);
    // how far this spoke runs from the tower before it leaves the leash circle (the tower may stand off its slot)
    const ox = t.x - c.x, oy = t.y - c.y, b = ox * ux + oy * uy, end = -b + Math.sqrt(Math.max(0, b * b - (ox * ox + oy * oy - R * R)));
    if (end - r0 < 2 * LEASH_ARROW_W) continue;
    const d = r0 + (end - r0 - LEASH_ARROW_W) * f, x = t.x + ux * d, y = t.y + uy * d, w = LEASH_ARROW_W;
    ctx.globalAlpha = A * Math.sin(Math.PI * f); // in from nothing, out to nothing
    ctx.beginPath(); ctx.moveTo(x - ux * w - uy * w, y - uy * w + ux * w); ctx.lineTo(x, y); ctx.lineTo(x - ux * w + uy * w, y - uy * w - ux * w); ctx.stroke();
  }
}

// A tower is its cell's hexagon, inset a little; its label at the centroid.
// Level shows as concentric rings OUTSIDE it (drawTower).
const TOWER_K = 0.85; // bigger to press (owner, 2026-10-11; was 0.705) // a tower's (and slot's) hex size in cell sizes - 25% SMALLER (owner, 2026-10-06; was 0.94; before that 0.88, then 0.66)
function towerHex(c, k) {
  ctx.beginPath();
  c.pts.forEach((p, i) => {
    const x = c.x + (p.x - c.x) * k, y = c.y + (p.y - c.y) * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
}
// LEVEL READS AT A GLANCE (owner, 2026-10-02): the main hex stays full size
// and each level past L1 adds a BOLD ring OUTSIDE it, LEVEL_GAP further out
// each (the cells are two tiles apart, so there is room), under a glow that
// grows with the level.
const TOWER_GLOW = [8, 20, 34, 52], LEVEL_GAP = 0.135; // (0.18 before the 25% shrink, owner 2026-10-06) // rings 25% tighter with the smaller towers (was 0.24) // glow: shadow blur per level, world px
