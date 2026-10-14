// /aspira - THE THREAT MARKS (split from aspira-ui.js at its 500-line cap): drawThreat (aspira-draw.js) and
// threatBounce (a leak, aspira-game.js); AUTO_WAIT_S and etaToCore come from aspira-ui.js
// THE THREAT, SHOWN (owner, 2026-10-12): each enemy within THREAT_FROM s of the core (the soonest THREAT_N) is marked, fainter
// far off and stronger as it closes - since 2026-10-13 a circle and two triangles on the enemy itself (drawThreat, below)
const THREAT_A_MIN = 0.1, THREAT_A_MAX = 0.75, THREAT_W_MAX = 6; // (W_MAX: a leak's bounce, world units wide)
// LATER and SHARPER (owner, 2026-10-12: "make threat ring appear later and fade in faster"; "increase threat ring visibility
// when thickness increases, maybe add white ring inside amber"): from THREAT_FROM s out (was auto-wait's 6), fully in after
// THREAT_FADE s, and a WHITE core inside the ember that grows with the width, THREAT_CORE of it, as strong as k
const THREAT_FROM = 4, THREAT_FADE = 0.4, THREAT_CORE = 0.4;
const THREAT_N = 3; // the closest 3 only (owner, 2026-10-12)
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
// THE MARK (owner, 2026-10-13: "change the threat indicator to be two triangles pointing at the unit with a circle around the
// unit" - then "no flashing triangles, only show circle when too close"; was a ring round the core at the enemy's distance):
// each of the closest THREAT_N gets two triangles either side of it, across its way to the core, pointing in, stronger and
// bigger as it nears - and once inside auto-wait's last stage (AUTO_WAIT3_S), a circle THREAT_GAP outside its body
const THREAT_GAP = 7, THREAT_TRI = [6, 12];
function threatTri(x, y, a, s) { // a triangle at (x, y) pointing along angle a, s long
  const c = Math.cos(a), n = Math.sin(a);
  ctx.beginPath(); ctx.moveTo(x + c * s / 2, y + n * s / 2);
  ctx.lineTo(x - c * s / 2 - n * s * 0.45, y - n * s / 2 + c * s * 0.45); ctx.lineTo(x - c * s / 2 + n * s * 0.45, y - n * s / 2 - c * s * 0.45); ctx.closePath();
}
// ...and with that circle the RING round the core at its distance comes back (owner, 2026-10-14: "bring back threat indicator
// circles when the circle shows, do not cross circle around the enemy"): open wherever it would run through ANY enemy's circle
function threatCoreRing(d, circles, al, w, core) {
  const gaps = [];
  for (const [x, y, R] of circles) { // where this ring crosses that circle: the angle either side of its centre (cosine rule)
    const dc = Math.hypot(x - CX, y - CY), R2 = R + w;
    if (dc < 1e-6 || Math.abs(dc - d) >= R2) continue;
    const c = (d * d + dc * dc - R2 * R2) / (2 * d * dc), h = Math.acos(Math.max(-1, Math.min(1, c))), a = Math.atan2(y - CY, x - CX);
    if (h >= Math.PI) return; // the whole ring inside one circle
    gaps.push([a - h, a + h]);
  }
  if (!gaps.length) { ctx.beginPath(); ctx.arc(CX, CY, d, 0, 6.283); threatStroke(al, w, core); return; }
  // the gaps as one sorted, merged list round the circle from the first gap's start; the arcs are what lies between
  const a0 = gaps[0][0], norm = v => { let t = (v - a0) % 6.2832; return t < 0 ? t + 6.2832 : t; };
  const g = gaps.map(([s, e]) => [norm(s), norm(s) + (e - s)]).sort((p, q) => p[0] - q[0]), merged = [];
  for (const q of g) { const m = merged[merged.length - 1]; if (m && q[0] <= m[1]) m[1] = Math.max(m[1], q[1]); else merged.push(q.slice()); }
  ctx.beginPath();
  merged.forEach((m, i) => { const next = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + 6.2832; if (next > m[1]) { ctx.moveTo(CX + d * Math.cos(a0 + m[1]), CY + d * Math.sin(a0 + m[1])); ctx.arc(CX, CY, d, a0 + m[1], a0 + next); } });
  threatStroke(al, w, core);
}
function drawThreat() {
  const near = [];
  for (const e of G.enemies) if (!e.dead) { const t = etaToCore(e); if (t <= THREAT_FROM) near.push([t, e]); }
  if (!near.length && !threatBounces.length) return;
  near.sort((a, b) => a[0] - b[0]);
  ctx.save(); /* Ember, the palette's red (owner, 2026-10-12: "use red for threat indicators ... not SOL pink") */
  drawThreatBounces();
  const circles = near.slice(0, THREAT_N).filter(([t]) => t <= AUTO_WAIT3_S).map(([, e]) => [e.x, e.y, ENEMIES[e.type].size * (e.sizeMul || 1) + THREAT_GAP]); // (threatCoreRing)
  for (const [t, e] of near.slice(0, THREAT_N)) {
    // STRONGER and THICKER the nearer (owner, 2026-10-12), squared: a far one a whisper, one about to land loud
    const k = (1 - t / THREAT_FROM) ** 2, fade = Math.min(1, (THREAT_FROM - t) / THREAT_FADE);
    const al = fade * (THREAT_A_MIN + (THREAT_A_MAX - THREAT_A_MIN) * k), core = fade * k, w = 1.2 + 1.8 * k;
    const R = ENEMIES[e.type].size * (e.sizeMul || 1) + THREAT_GAP;
    if (t <= AUTO_WAIT3_S) { ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, 6.283); threatStroke(al, w, core); threatCoreRing(Math.hypot(e.x - CX, e.y - CY), circles, al, w, core); } // the circle only when TOO close: auto-wait's LAST stage, 1 s out ("much later than the triangles", owner 2026-10-13; was its second, 2 s)
    const a = Math.atan2(CY - e.y, CX - e.x) + Math.PI / 2, s = THREAT_TRI[0] + (THREAT_TRI[1] - THREAT_TRI[0]) * k, d = R + s / 2 + 3;
    for (const side of [1, -1]) {
      threatTri(e.x + Math.cos(a) * d * side, e.y + Math.sin(a) * d * side, a + (side > 0 ? Math.PI : 0), s);
      ctx.fillStyle = COL.glow; ctx.globalAlpha = Math.min(1, al * 1.3); ctx.fill();
      if (core > 0.02) { ctx.strokeStyle = COL.white; ctx.globalAlpha = Math.min(1, core); ctx.lineWidth = 1; ctx.stroke(); }
    }
  }
  ctx.restore();
}
