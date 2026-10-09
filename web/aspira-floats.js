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
function burst(x, y, color, n) {
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
  if (bannerT > 0) bannerT -= dt;
}

function stepFloats(dt) {
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
function creditDot(x, y, b) { coins.push({ x, y, b, t: 0 }); }
function stepCoins(dt) {
  for (const c of coins) {
    c.t += dt;
    const dx = CX - c.x, dy = CY - c.y, d = Math.hypot(dx, dy), tm = c.t - COIN_HOLD, step = tm > 0 ? (COIN_V0 + COIN_ACC * tm) * dt : 0;
    if (d <= CORE_R || step >= d) {
      c.done = true; G.money += c.b;
      // SMALLER and from ABOVE the core, so it never hides it (owner, 2026-10-09): in 3D above its raised top too - a height
      // h stands h x tan(tilt) floor units up the screen
      const lift = typeof q3d === "function" && q3d() && warp.lightZ ? warp.lightZ * Math.tan(WARP.tilt) : 0;
      // SIZED LIKE A DAMAGE NUMBER (owner, 2026-10-09: "gold popups should also be sized like damage"): by its share of
      // the biggest payout yet, on the damage numbers' scale (was a flat 12px)
      G.maxGold = Math.max(G.maxGold || 1, c.b);
      const rel = (c.b / G.maxGold) ** DMG_SIZE_EXP;
      float(CX, CY - CORE_R - 22 - lift, "+" + (c.b < 10 ? +c.b.toFixed(1) : Math.round(c.b)) + "c", "orange", Math.round(DMG_PX_MIN + DMG_PX_SPAN * rel), 2.0); // credits read "Nc"
      fx[fx.length - 1].shrink = true; // it holds, then shrinks + fades like a damage number (owner)
    } else { c.x += dx / d * step; c.y += dy / d * step; }
  }
  coins = coins.filter(c => !c.done);
}
function drawCoins() {
  if (!coins.length) return;
  ctx.fillStyle = COL.orange; ctx.globalAlpha = 1; ctx.beginPath();
  for (const c of coins) { ctx.moveTo(c.x + COIN_R, c.y); ctx.arc(c.x, c.y, COIN_R, 0, 6.283); }
  ctx.fill();
}
