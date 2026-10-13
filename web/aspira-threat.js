// /aspira - THE THREAT RINGS (split from aspira-ui.js at its 500-line cap): drawThreat (aspira-draw.js) and
// threatBounce (a leak, aspira-game.js); AUTO_WAIT_S and etaToCore come from aspira-ui.js
// THE THREAT, SHOWN (owner, 2026-10-12: "when units get close, draw a faint red around the core under the enemies - the radius
// the distance between the enemy and core - and a spoke from core to the nearest enemy, at the distances where auto-wait
// engages (regardless if it is on or not)"): each enemy within AUTO_WAIT_S of the core (the soonest THREAT_N) rings the
// core at its own distance with a spoke out to it, fainter far off and stronger as it closes
const THREAT_A_MIN = 0.1, THREAT_A_MAX = 0.75, THREAT_W_MIN = 1, THREAT_W_MAX = 6; // world units wide
// LATER and SHARPER (owner, 2026-10-12: "make threat ring appear later and fade in faster"; "increase threat ring visibility
// when thickness increases, maybe add white ring inside amber"): from THREAT_FROM s out (was auto-wait's 6), fully in after
// THREAT_FADE s, and a WHITE core inside the ember that grows with the width, THREAT_CORE of it, as strong as k
const THREAT_FROM = 4, THREAT_FADE = 0.4, THREAT_CORE = 0.4;
const THREAT_SEG = 36, THREAT_FALL = 0.35; // the ring's arcs, and the angle (radians) over which it falls to 1/e
const THREAT_N = 3, THREAT_RINGS = 3; // spokes AND rings for the closest 3 only (owner, 2026-10-12; spokes were 10) // up to the 10 soonest (owner, 2026-10-12: "nearest up to 10 enemies")
// ...and when one REACHES the core its ring BOUNCES back out (owner, 2026-10-12: "bounce that threat indicator back outwards at
// current thickness and fade out opacity"): from where it touched, THREAT_BOUNCE_R further out over THREAT_BOUNCE_T s (real
// time, eased out), its width kept, its alpha down to nothing
const THREAT_BOUNCE_T = 1.6, THREAT_BOUNCE_R = 520, /* twice as far, as slow to fade (owner, 2026-10-12; were 0.8 / 260) */ threatBounces = [];
function threatBounce(e) {
  if (threatBounces.length < 20) threatBounces.push({ r: Math.hypot(e.x - CX, e.y - CY), at: performance.now() / 1000 });
}
// the ember line at alpha a, width w, and its white core at alpha core (the current path)
function threatStroke(a, w, core) {
  ctx.strokeStyle = COL.glow; ctx.globalAlpha = Math.min(1, a); ctx.lineWidth = w; ctx.stroke();
  if (core > 0.02) { ctx.strokeStyle = COL.white; ctx.globalAlpha = Math.min(1, core); ctx.lineWidth = w * THREAT_CORE; ctx.stroke(); }
}
function drawThreatBounces() {
  const now = performance.now() / 1000;
  for (let i = threatBounces.length - 1; i >= 0; i--) {
    const b = threatBounces[i], p = (now - b.at) / THREAT_BOUNCE_T;
    if (p >= 1) { threatBounces.splice(i, 1); continue; }
    ctx.beginPath(); ctx.arc(CX, CY, b.r + THREAT_BOUNCE_R * (1 - (1 - p) ** 3), 0, 6.283);
    threatStroke(THREAT_A_MAX * (1 - p), THREAT_W_MAX * 2, 1 - p); // as wide as it was on contact
  }
}
function drawThreat() {
  const near = [];
  for (const e of G.enemies) if (!e.dead) { const t = etaToCore(e); if (t <= THREAT_FROM) near.push([t, e]); }
  if (!near.length && !threatBounces.length) return;
  near.sort((a, b) => a[0] - b[0]);
  ctx.save(); /* Ember, the palette's red (owner, 2026-10-12: "use red for threat indicators ... not SOL pink") */
  drawThreatBounces();
  near.slice(0, THREAT_N).forEach(([t, e], i) => {
    // STRONGER and THICKER the nearer (owner, 2026-10-12: "increase intensity and thickness of threat rings as they approach"):
    // squared, so a far one stays a whisper and one about to land is loud
    const k = (1 - t / THREAT_FROM) ** 2, fade = Math.min(1, (THREAT_FROM - t) / THREAT_FADE), w = (THREAT_W_MIN + (THREAT_W_MAX - THREAT_W_MIN) * k) * (t <= AUTO_WAIT2_S ? 2 : 1); // THICKER as it nears again (owner, 2026-10-12), doubled inside auto-wait's second stage
    const al = fade * (THREAT_A_MIN + (THREAT_A_MAX - THREAT_A_MIN) * k), core = fade * k;
    ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(e.x, e.y); threatStroke(al, w, core); // the spoke, full strength
    // the RING fades fast with the angle away from its enemy (owner, 2026-10-12: "ring opacity should fade quickly relative to
    // distance from enemy"): THREAT_SEG arcs, each exp(-angle / THREAT_FALL) as strong; the faint far side is skipped
    if (i >= THREAT_RINGS) return; // a RING for the closest THREAT_RINGS only (owner, 2026-10-12), spokes for all THREAT_N
    const r = Math.hypot(e.x - CX, e.y - CY), a0 = Math.atan2(e.y - CY, e.x - CX), step = 2 * Math.PI / THREAT_SEG;
    for (let j = -THREAT_SEG / 2; j < THREAT_SEG / 2; j++) {
      const f = Math.exp(-Math.min(Math.abs(j), Math.abs(j + 1)) * step / THREAT_FALL);
      if (f < 0.03) continue;
      ctx.beginPath(); ctx.arc(CX, CY, r, a0 + j * step, a0 + (j + 1) * step); threatStroke(al * f, w, core * f);
    }
  });
  ctx.restore();
}
