// /spire — FLOATING TEXT and the bits that fly: damage numbers, pop-ups, sparks, the banner, the credits' dots.
// Split out of aspira-game.js (500-line cap, 2026-10-09); same global scope, loaded right after it.

// a floating damage number, sized RELATIVE to the biggest hit seen this game
// (owner): the largest so far is 27px / 2s, a tiny one 11px / 0.8s, spaced by
// sqrt(size / maxHit) - size being the hit before armor or shield
// At most DMG_MAX on screen, a HARD cap (owner, 2026-10-06): every hit gets a
// number, small ones too, and past the cap the SMALLEST number on screen is
// culled to make room - unless the new hit is smaller still, which then goes
// unshown. (They age in REAL time while the game runs up to 20x, so late
// waves at speed piled thousands up - drawing them was most of the frame;
// profiled 2026-10-05, waves 80-85, 9 max towers.)
const DMG_MAX = 120;
let dmgLive = []; // the live damage-number floats, each carrying its hit size `v`
// a number's size follows its hit against the biggest hit yet - steeper and wider than it was (owner, 2026-10-08:
// "big numbers bigger!!"; was sqrt, 11..27px)
const DMG_SIZE_EXP = 0.7, DMG_PX_MIN = 10, DMG_PX_SPAN = 28, DMG_FLY = 90; // DMG_FLY: units/s away from the hitter (owner: "make all damage numbers fly off more", was 30)
// src: the tower that dealt it - the number flies AWAY from it (owner, 2026-10-09: "instead of having them fly upwards,
// have them fly in the direction away from the source of damage"); none: upward, as before
// grey: the share of the hit armor took (0..1) - the number is drawn that far from white toward Silver (dmgColor)
function dmgNumber(e, label, size, color, src, grey = 0) {
  G.maxHit = Math.max(G.maxHit || 1, size);
  const rel = (size / G.maxHit) ** DMG_SIZE_EXP;
  if (dmgLive.length >= DMG_MAX) {
    dmgLive = dmgLive.filter(f => f.t < f.life);
    if (dmgLive.length >= DMG_MAX) {
      let lo = 0;
      for (let i = 1; i < dmgLive.length; i++) if (dmgLive[i].v < dmgLive[lo].v) lo = i;
      if (dmgLive[lo].v >= size) return; // this hit is the smallest: no number
      dmgLive[lo].t = dmgLive[lo].life; // cull the smallest on screen
      dmgLive.splice(lo, 1);
    }
  }
  float(e.x + (Math.random() - 0.5) * 24, e.y - 14, label, color, Math.round(DMG_PX_MIN + DMG_PX_SPAN * rel), 0.8 + 1.2 * rel, 1, DMG_FLY, true);
  fx[fx.length - 1].grey = grey;
  const f = fx[fx.length - 1], sx = src ? e.x - (src.x ?? e.x) : 0, sy = src ? e.y - (src.y ?? e.y) : 0, sl = Math.hypot(sx, sy);
  if (sl) { f.x = e.x; f.y = e.y; f.vx = DMG_FLY * sx / sl; f.vy = -DMG_FLY * sy / sl; } // (vy is UP: y -= vy)
  f.v = size; dmgLive.push(f);
}

// SLOW-MOTION TICKS (owner, 2026-10-13: "when game speed is slow, the damage on tick logic should speed up so that the numbers
// come out at about the same rate" - display only, so shields and armor take each tick as ever - "keep that display damage
// rate", one a TICK_SHOW_S real s): at speed x a TICKING tower's tick (ACD, FRZ - `rate` a game second) spans 1 / (rate x) real
// seconds; when that is longer than TICK_SHOW_S its number is cut into that many smaller ones, shown TICK_SHOW_S apart
const tickQ = [], TICK_SPLIT_MAX = 8, TICK_SHOW_S = 0.5;
// the FIRST tick a tower lands on an enemy shows whole, at once; only the ones after are split (owner, 2026-10-13: "start ticking
// asap", "only sample after first tick")
function dmgTick(e, amt, raw, color, t, grey, rate) {
  const first = t && rate > 0 && !(e.ticked ||= new Set()).has(t.id);
  if (first) e.ticked.add(t.id);
  const sp = typeof speedX === "function" ? Math.max(speedX(), 0.01) : 1, k = rate > 0 && !first ? Math.min(TICK_SPLIT_MAX, Math.round(1 / (rate * sp * TICK_SHOW_S))) : 1;
  if (k <= 1) { dmgNumber(e, String(dmgUnits(amt)), raw, color, t, grey); return; }
  const now = performance.now();
  for (let i = 0; i < k; i++) tickQ.push({ e, label: String(dmgUnits(amt / k)), size: raw / k, color, t, grey, at: now + i * TICK_SHOW_S * 1000 });
}
function drainTicks() {
  if (!tickQ.length) return;
  const now = performance.now();
  for (let i = 0; i < tickQ.length;) { const q = tickQ[i]; if (q.at > now) { i++; continue; } dmgNumber(q.e, q.label, q.size, q.color, q.t, q.grey); tickQ.splice(i, 1); }
}

// vy: upward drift (units/s); long-lived floats drift slowly so they stay on screen
// every pop-up has the black outline + dark glow (owner); `under` marks the
// damage numbers, which draw beneath everything but the background
// a damage number's colour: its own, or white mixed toward the graticule's Silver by `grey` - resolved when DRAWN, so the
// boss sky's inverted palette still applies
function dmgColor(f) {
  if (!(f.grey > 0)) return f.color;
  const a = (COL.white.match(/[\d.]+/g) || [255, 255, 255]).map(Number), b = (COL.grid.match(/[\d.]+/g) || [128, 128, 128]).map(Number), k = Math.min(1, f.grey);
  const mix = i => (a[i] ?? 1) + ((b[i] ?? 1) - (a[i] ?? 1)) * k; // [3]: the alpha (Silver is a dim one)
  return "rgba(" + [0, 1, 2].map(i => Math.round(mix(i))).join(",") + "," + mix(3).toFixed(3) + ")";
}
function float(x, y, text, color, size = 28, life = 1.1, alpha = 1, vy = 30, under = false) {
  fx.push({ k: "text", x, y, text, color, t: 0, life, size, alpha, vy, outline: true, under });
}
// THE LAST SHIELDS BREAK (owner, 2026-10-11: "make the last 5 layers of shield falling off way more intense
// visually"): once fewer than SHIELD_BREAK_N charges are left, every pop throws a shockwave and a spray of shards,
// bigger the fewer remain - the last one biggest of all, with a white flash
const SHIELD_BREAK_N = 5;
function shieldBreak(e) {
  const k = 1 - e.shield / SHIELD_BREAK_N, r = ENEMIES[e.type].size * (e.sizeMul || 1); // k: 0.2 at 4 left .. 1 at none
  ring(e.x, e.y, r * (2 + 3 * k), "cyan", 0.2 + 0.3 * k, true);
  burst(e.x, e.y, "cyan", Math.round(8 + 22 * k));
  if (e.shield <= 0) { ring(e.x, e.y, r * 7, "white", 0.45, true); burst(e.x, e.y, "white", 24); }
}
// SPARKS ON A BUDGET (perf, 2026-10-13: a late swarm wave kept ~2,300 alive - shield breaks and kills each throw 14-54 - and
// they were most of a 3D frame's board picture): at most SPARK_MAX alive, a burst past it throws only what is left
const SPARK_MAX = 300;
let sparkN = 0; // alive now (stepFx recounts)
function burst(x, y, color, n) {
  n = Math.min(n, SPARK_MAX - sparkN); sparkN += Math.max(0, n);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = 40 + Math.random() * 120;
    fx.push({ k: "spark", x, y, vx: Math.cos(a) * v * 3, vy: Math.sin(a) * v * 3, color, t: 0, life: (0.4 + Math.random() * 0.3) / 3 });
  }
}
let bannerText = "", bannerT = 0, bannerCol = "orange";
// a banner across the top; `life` in seconds, `col` a palette key
function banner(t, col = "orange", life = 2 / 3) { bannerText = t; bannerT = life; bannerCol = col; }

// floating text ages in REAL time (stepFloats) so a 1s damage number is 1s
// on screen at any speed (owner).
function stepFx(dt) {
  for (const f of fx) {
    if (f.k === "text") continue;
    f.t += dt;
    if (f.k === "spark") { f.x += f.vx * dt; f.y += f.vy * dt; }
  }
  // beams run their full life and keep following their target, ghost or not
  fx = fx.filter(f => f.t < f.life);
  sparkN = 0; for (const f of fx) if (f.k === "spark") sparkN++;
  if (bannerT > 0) bannerT -= dt;
}

function stepFloats(dt) {
  drainTicks(); // the slow-motion tick numbers due by now
  for (const f of fx) if (f.k === "text") { f.t += dt; f.x += (f.vx || 0) * dt; f.y -= f.vy * dt; }
  fx = fx.filter(f => f.k !== "text" || f.t < f.life);
  dmgLive = dmgLive.filter(f => f.t < f.life);
}


// the KILL's CREDITS (owner, 2026-10-09: "instead of showing a popup, show a small yellow dot that flies towards the core,
// and when it hits the core, that's when the credits are added and the popup shows"): a gold dot from the kill, gathering
// speed toward the core (COIN_V0 + COIN_ACC x its age, units/s); on reaching it the credits are banked and "+Nc" pops
// there. Game time (step, aspira-game.js), so the simulator banks them too, a beat later than it used to.
const COIN_V0 = 0, COIN_ACC = 25, COIN_HOLD = 3, COIN_R = 2.5; // owner, 2026-10-09: "gold should start with no velocity, and then very slowly accelerate towards core" (was 200 / 900), then "reduce gold acceleration" (150 -> 60), then "slow down gold acceleration even more, make gold stationary for 2s" (HOLD s still, then 25), then "make gold stationary for 3s"
let coins = [];
// COINS (owner, 2026-10-12): a kill's credits break into coins - 20, 10, 5, then 1s (the old dot) - each dropped with some
// jitter from the enemy (COIN_JIT units); every coin banks its own value, and the kill's "+Nc" pops once, when its LAST
// coin lands (the group's `left`). A fraction rides on the last coin; a sub-1 bounty is one plain dot.
const COIN_FACES = [20, 10, 5], COIN_JIT = 14;
function creditDot(x, y, b) {
  const vals = [];
  let rest = b;
  for (const f of COIN_FACES) while (rest >= f) { vals.push(f); rest -= f; }
  while (rest >= 1) { vals.push(1); rest -= 1; }
  if (rest > 1e-9) { if (vals.length) vals[vals.length - 1] += rest; else vals.push(rest); }
  const grp = { b, left: vals.length };
  for (const v of vals) {
    const a = Math.random() * 6.283, r = vals.length > 1 ? COIN_JIT * Math.sqrt(Math.random()) : 0;
    coins.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, b: v, face: COIN_FACES.find(f => v >= f && v < f + 1) || 1, grp, t: 0, ph: Math.random() * 6.283 });
  }
}
// coins GRAVITATE to the NEAREST of the core and the towers (owner, 2026-10-12), re-picked every step since towers
// slide; a tower takes a coin within COIN_TOWER_R of its centre and pops the kill's "+Nc" above itself
const COIN_TOWER_R = 12;
function coinHome(c) {
  let best = { x: CX, y: CY, r: CORE_R, core: true }, bd = Math.hypot(CX - c.x, CY - c.y);
  for (const t of G.towers) {
    const d = Math.hypot(t.x - c.x, t.y - c.y);
    if (d < bd) { bd = d; best = { x: t.x, y: t.y, r: COIN_TOWER_R, core: false }; }
  }
  return best;
}
const CRED_POP_MAX = (DMG_PX_MIN + DMG_PX_SPAN) / 2; // a credit pop-up's biggest: HALF a damage number's (owner, 2026-10-13: "reduce max size of credit popups to half")
function stepCoins(dt) {
  for (const c of coins) {
    c.t += dt;
    const h = coinHome(c), dx = h.x - c.x, dy = h.y - c.y, d = Math.hypot(dx, dy), tm = c.t - COIN_HOLD, step = tm > 0 ? (COIN_V0 + COIN_ACC * tm) * dt : 0;
    if (d <= h.r || step >= d) {
      c.done = true; G.money += c.b;
      if (--c.grp.left > 0) continue; // the kill's popup waits for its last coin
      // SMALLER and from ABOVE the core, so it never hides it (owner, 2026-10-09): in 3D above its raised top too - a height
      // h stands h x tan(tilt) floor units up the screen
      const lift = h.core && typeof q3d === "function" && q3d() && warp.lightZ ? warp.lightZ * Math.tan(WARP.tilt) : 0;
      // SIZED LIKE A DAMAGE NUMBER (owner, 2026-10-09: "gold popups should also be sized like damage"): by its share of
      // the biggest payout yet, on the damage numbers' scale (was a flat 12px)
      const gb = c.grp.b;
      G.maxGold = Math.max(G.maxGold || 1, gb);
      const rel = (gb / G.maxGold) ** DMG_SIZE_EXP;
      float(h.x, h.y - h.r - 22 - lift, "+" + (gb < 10 ? +gb.toFixed(1) : Math.round(gb)) + "c", "orange", Math.round(DMG_PX_MIN + (CRED_POP_MAX - DMG_PX_MIN) * rel), 2.0); // credits read "Nc"
      fx[fx.length - 1].shrink = true; // it holds, then shrinks + fades like a damage number (owner)
    } else { c.x += dx / d * step; c.y += dy / d * step; }
  }
  coins = coins.filter(c => !c.done);
}
// a coin's look by face (owner): 1 the plain gold dot; 5 a gold ring around black; 10 a gold ring around white;
// 20 a white ring around gold - [radius, ring colour, fill colour]. SMALLER, fainter, and each TWINKLES slowly on its
// own phase (owner, 2026-10-12: "make all coins smaller, less opaque and twinkle slowly"; were r 2.5 / 4 / 4.5 / 5, opaque)
const COIN_LOOK = { 1: [1.8, "orange", "orange"], 5: [2.8, "orange", "bg"], 10: [3.1, "orange", "white"], 20: [3.5, "white", "orange"] };
const COIN_ALPHA = 0.55, COIN_TWINKLE = 0.3, COIN_TWINKLE_HZ = 0.35; // alpha swings COIN_ALPHA +- COIN_TWINKLE, real time
function drawCoins() {
  if (!coins.length) return;
  const now = performance.now() / 1000;
  ctx.lineWidth = 1.1;
  for (const c of coins) {
    const [r, ring, fill] = COIN_LOOK[c.face];
    ctx.globalAlpha = COIN_ALPHA + COIN_TWINKLE * Math.sin(now * COIN_TWINKLE_HZ * 6.283 + c.ph);
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 6.283);
    ctx.fillStyle = COL[fill]; ctx.fill();
    if (ring !== fill) { ctx.strokeStyle = COL[ring]; ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}
