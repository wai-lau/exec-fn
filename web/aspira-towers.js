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
const chainReach = st => (st.skill ? st.range + st.arcRange * (1 - st.arcShrink ** st.layers) / (1 - st.arcShrink) // a chart ARC: its jumps, each shorter
  : st.range * (CHAIN_LEASH + LEASH_PER_LAYER * (st.layers - 1)));
const REAPER_HOLD = 2; // a Reaper's lock holds out to 2x the range it can start one in

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
  for (let n = node; n; n = n.up) n.fx.life = Math.max(n.fx.life, n.fx.t + left);
}
// queue st.branch pending arcs out of `node`, one tree layer deeper
function branchFrom(c, node, depth) {
  if (depth > c.st.layers) return;
  keepLit(node, hopDelay(c.st) + 0.05); // stay lit until the children land
  for (let i = 0; i < c.st.branch; i++) (G.chains ||= []).push({ c, node, depth, wait: hopDelay(c.st) });
}
function stepChains(dt) {
  stepStaticRings(dt); // ARC Static's discharge rings (aspira-skills.js)
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
function moonSpots(t, st) {
  const a = (t.spin || 0) * MOON_SPIN, n = st.moons || 1;
  return Array.from({ length: n }, (_, i) => {
    const m = a + i * 2 * Math.PI / n;
    return { x: t.x + Math.cos(m) * MOON_ORBIT, y: t.y + Math.sin(m) * MOON_ORBIT };
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
function fireSlower(t, st) {
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
    // a full charge RE-AIMS by the targeting before it fires (owner: Fresh kept
    // hitting the enemy it had already bled): the best enemy in range that no
    // other lock holds; the charge carries over, so no shot is lost
    const pick = pickTargets(t, st, st.targets + t.locks.length).find(e => e === l.e || !t.locks.some(o => o.e === e));
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
function bleed(e, st) {
  if (!st.bleedArmor || e.dead) return;
  const k = st.breach || 1; // the chart SOL: Breach stacks per hit (aspira-skills.js)
  e.armor = (e.armor || 0) - st.bleedArmor * k; // permanent, and on past zero (owner)
  e.bleedCrit = Math.min(BLEED_CRIT_CAP, (e.bleedCrit || 0) + st.bleedCrit * k); e.breachN = (e.breachN || 0) + k; // stacks, for the spokes
}
function rayHit(t, st, e, base, from) {
  const crit = Math.random() < ((st.crit || 0) + (e.bleedCrit || 0)) * (st.critScale || 1);
  const m = crit ? st.critMul : 1, d = shotDamage(t, st, e, base) * m;
  const n = st.beams || 1, part = d; // every beam is a FULL hit (owner, 2026-10-06; was a fitted share of the shot)
  beam(from, e, TOWERS[t.kind].color, RAY_BEAM_LIFE, m > 1 ? 5 : 3, d, true);
  if (n > 1 && from === t) fx[fx.length - 1].beams = n; // n converging beams from the tower; a Refract hop past the first enemy is ONE thick beam (owner)
  for (let i = 0; i < n && !e.dead; i++) {
    damage(e, part, t, false, crit); onHit(e, t, st, part); bleed(e, st); // a crit shows as a PINK number (owner)
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
  if (st.refract) { solRefract(t, st, e); return; } // the chart SOL's Refract (aspira-skills.js)
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
  if (t.kind === "slower") { const hit = fireSlower(t, st); if (!hit) t.links = []; return hit; }
  const targets = pickTargets(t, st, st.targets);
  if (!targets.length) return false;
  t.shots = (t.shots || 0) + 1;
  // one chain per target: st.targets > 1 (Ion's Fork) starts several lines on
  // DIFFERENT enemies (pickTargets never repeats one)
  // (a chart ARC's two strikes are two SEPARATE attacks - owner: each its own tree)
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

// ---------- towers MOVE (owner, 2026-10-03) ----------
// Each tower slides along its own SPOKE - the line from the core out through
// its slot - at its kind's MOVE SPEED, between its slot and its kind's
// REACH (a radius from the core), to wherever moveTower says. Its slot stays its own
// (placement, Space, Horizon).
// each kind moves at its own SPEED (units / game-s) and slides out to its own
// REACH (owner, 2026-10-04): ACD fastest, ARC next, SOL and FRZ slowest; FRZ
// reaches furthest, ACD and ARC next, SOL least (its weapon range was raised
// to make up for it); SOL then moves at half FRZ's speed (owner)
// MOVEMENT HALVED (owner, 2026-10-06: "halve their movement range, halve their
// movement speed"): TOWER_SPEED is half what it was (acid 120, chain 90, reaper
// 30, slower 60), the outward slide is SLIDE_KIND x (reach - slot) and the inward
// limit TOWER_IN went 0.89 -> 0.945 (half the slide in). A chart tier may buy
// the slide back (towerStats `slide` x the extent, `speed` x the speed; SKILL_MOVE
// in aspira-skills.js), never past the old extent (SLIDE_MAX 2).
// ROLES (owner, 2026-10-06): FRZ and ACD are HIGH-MOVEMENT, short-range roamers;
// ARC and SOL are LOW-MOVEMENT, long-range anchors. So FRZ/ACD keep their old
// (un-halved) speed and slide (SLIDE_KIND 1, TOWER_IN_KIND 0.89), and ARC/SOL move
// slowly (owner: "reduce greatly") over the halved slide; their Static / Breach
// tiers buy slide extent back (SKILL_MOVE, aspira-skills.js)
const TOWER_SPEED = { acid: 75, chain: 15, reaper: 6, slower: 55 }; // ACD 120 -> 75, FRZ 90 -> 55 (owner: reduce both)

const TOWER_REACH = { slower: 400, acid: 350, chain: 350, reaper: 180 }; // SOL: its travel halved (owner; was 250 - a slot sits ~110 out)
const SLIDE_K_HALF = 0.5, SLIDE_MAX = 2;
const SLIDE_KIND = { acid: 1, slower: 1, chain: SLIDE_K_HALF, reaper: SLIDE_K_HALF };
const TOWER_IN_KIND = { acid: 0.89, slower: 0.89 }; // the rest: TOWER_IN
const moveSpeed = t => TOWER_SPEED[t.kind] * towerStats(t, true).speed;
// the innermost a tower slides: this share of its slot's distance from the core.
// 0.945 = half the old 0.89's slide in (owner); the old 0.89 kept a 13.6 gap
// between ring neighbours at max level slid fully in with TOWER_K 0.94, so
// the gap only grows
const TOWER_IN = 0.945;
// a slot's own inner limit (the corner slots carry one, CORNER_IN) else TOWER_IN of its distance
const innerR = (c, r0, slide = 1, kind = null) => c.minR ?? r0 * (1 - (1 - (TOWER_IN_KIND[kind] ?? TOWER_IN)) * Math.min(slide, SLIDE_MAX));
// how far out a kind slides from a slot r0 from the core (slide = the tier's multiplier)
const slideOut = (kind, r0, slide = 1) => Math.max(0, TOWER_REACH[kind] - r0) * SLIDE_KIND[kind] * Math.min(slide, SLIDE_MAX);
// the spoke: its unit direction, the slot's radius and how far out it runs
function spokeOf(t) {
  const c = CELLS[t.cell], r0 = Math.hypot(c.x - CX, c.y - CY) || 1, sl = towerStats(t, true).slide;
  // min: it may also slide IN, to TOWER_IN of its slot's distance (owner: 25% closer, now half that)
  return { c, r0, ux: (c.x - CX) / r0, uy: (c.y - CY) / r0, slide: sl, max: slideOut(t.kind, r0, sl), min: -(r0 - innerR(c, r0, sl, t.kind)) };
}
// the whole travel of a tower on its spoke, out plus in (the card's Slide row)
const slideSpan = t => { const k = spokeOf(t); return Math.round(k.max - k.min); };
const towerAt = p => G.towers.find(t => Math.hypot(p.x - t.x, p.y - t.y) <= CELL_S);
// the tower whose TRACK passes nearest p, within TRACK_HIT (owner: tapping near
// the slider line opens its card too); its line runs from the core's edge to
// just past its reach (spokeTrack)
const TRACK_HIT = 16;
function trackAt(p) {
  let best = null, bd = TRACK_HIT;
  for (const t of G.towers) {
    const k = spokeOf(t), along = (p.x - CX) * k.ux + (p.y - CY) * k.uy;
    if (along < CORE_R || along > k.r0 + k.max + trackPast()) continue;
    const d = Math.abs((p.x - CX) * k.uy - (p.y - CY) * k.ux); // distance across the line
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
// WHERE it heads (owner, 2026-10-04): the spot that maximises ANTICIPATED
// HITS, re-scored live (aspira-positioning.js) - it replaced chasing one
// target, which walked away from groups. It gets there EASED: speed ramps at
// TOWER_ACCEL and brakes to stop on its mark.
const TOWER_ACCEL = 240;
function moveTower(t, dt) {
  const k = spokeOf(t), { c, ux, uy, max } = k, off = t.off || 0;
  t.posT = (t.posT || 0) - dt;
  if (t.posT <= 0) { t.posT = POS_EVERY; t.want = bestSpot(t, k, towerStats(t).range); }
  const want = Math.max(k.min, Math.min(max, t.want ?? max)); // nothing alive: rest OUTERMOST (owner)
  // eased: aim for the speed that still stops on the mark, then ramp to it
  const gap = want - off, vWant = Math.sign(gap) * Math.min(moveSpeed(t), Math.sqrt(2 * TOWER_ACCEL * Math.abs(gap)));
  const v = t.v || 0, dv = TOWER_ACCEL * dt;
  t.v = Math.abs(vWant - v) <= dv ? vWant : v + Math.sign(vWant - v) * dv;
  t.off = Math.max(k.min, Math.min(max, off + t.v * dt));
  if (Math.abs(gap) < 0.5 && Math.abs(t.v) < 5) { t.off = want; t.v = 0; }
  t.x = c.x + ux * t.off; t.y = c.y + uy * t.off;
}


// UI only (aspira-draw.js calls it): each tower's SPOKE (owner): the track it slides along
// one spoke: from the core's edge out through cell c to radius `to`, ending in a
// T just PAST it - a tower's own half-size further (trackPast), so a tower at
// full reach touches the T instead of covering it (owner)
// a tower's half-size (its L1 hex), so the T-bars mark where its EDGE can go
const trackPast = () => CELL_S * TOWER_K;
function spokeTrack(c, reach, slide = 1, kind = null) {
  // the line runs only over the range a tower can MOVE (owner: show the min):
  // from its inner limit out to its reach
  // both ends mark the tower's EDGE (owner): its reach plus a half-size out,
  // its inner limit minus a half-size in
  const r0 = Math.hypot(c.x - CX, c.y - CY) || 1, ux = (c.x - CX) / r0, uy = (c.y - CY) / r0;
  const to = reach + trackPast(), from = innerR(c, r0, slide, kind) - trackPast();
  ctx.beginPath(); ctx.moveTo(CX + ux * from, CY + uy * from); ctx.lineTo(CX + ux * to, CY + uy * to); ctx.stroke();
  // a T-bar at each LIMIT (owner): the outer reach, and the innermost a tower
  // slides, TOWER_IN of its slot's distance (shorter, so out and in read apart)
  const bar = (r, w) => { const ex = CX + ux * r, ey = CY + uy * r; ctx.beginPath(); ctx.moveTo(ex - uy * w, ey + ux * w); ctx.lineTo(ex + uy * w, ey - ux * w); ctx.stroke(); };
  bar(to, 14); bar(from, 9);
}
function drawSpokes() {
  // solid, from the core out to the limit, in the TOWER'S colour and a little
  // thicker (owner; was bright white)
  ctx.lineCap = "round"; ctx.lineWidth = 3;
  for (const t of G.towers) {
    const k = spokeOf(t);
    ctx.strokeStyle = COL[TOWERS[t.kind].color]; ctx.globalAlpha = t.id === ui.sel ? 0.95 : 0.6;
    spokeTrack(k.c, k.r0 + k.max, k.slide, t.kind);
  }
  // while PLACING, every free slot shows the track the tower being built would
  // slide along, in its colour (owner)
  if (ui.build) {
    ctx.strokeStyle = COL[TOWERS[ui.build].color]; ctx.globalAlpha = 0.7;
    CELLS.forEach((c, ci) => { if (canPlace(ci)) { const r0 = Math.hypot(c.x - CX, c.y - CY); spokeTrack(c, r0 + slideOut(ui.build, r0), 1, ui.build); } });
  }
  ctx.globalAlpha = 1;
}

// A tower is its cell's hexagon, inset a little; its label at the centroid.
// Level shows as concentric rings OUTSIDE it (drawTower).
const TOWER_K = 0.94; // the size of the slot hexes drawn while placing (owner, 2026-10-05; was 0.88, then 0.66)
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
const TOWER_GLOW = [8, 20, 34, 52], LEVEL_GAP = 0.18; // rings 25% tighter with the smaller towers (was 0.24) // glow: shadow blur per level, world px
