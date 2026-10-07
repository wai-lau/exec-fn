// /aspira - the TOWERS' EFFECTS drawn on the board: aims, acid pools, ARC
// tethers, FRZ moons (split from aspira-draw.js at its 500-line cap). Same
// global scope; render() in aspira-draw.js calls these each frame.
// RPR's charge-up: a thin line to the target it is reloading for, fading in
// as the reload fills (alpha ~ progress^2), so the shot is telegraphed.
// It deals nothing; the damage comes with the bright flash on firing.
function drawAims() {
  ctx.lineCap = "round"; ctx.lineWidth = 0.8;
  for (const t of [...G.towers, ...coreTowers()]) { // the core's Fortifications copy fires too (aspira-core.js)
    if (t.kind !== "sol" || !t.locks || !t.period) continue;
    ctx.strokeStyle = COL[TOWERS[t.kind].color];
    const st = towerStats(t), n = st.beams || 1; // as many lines as the shot has BEAMS (owner)
    for (const l of t.locks) { // each lock's line brightens on its own charge
      if (l.e.dead) continue;
      const p = Math.min(1, Math.max(0, 1 - l.cd / t.period));
      // Refraction's light CONE builds while it CHARGES (owner, 2026-10-06), then
      // the shot's own cone flashes as before
      if (st.refraction || st.refraction) {
        const d = Math.hypot(l.e.x - t.x, l.e.y - t.y);
        drawCone({ x: t.x, y: t.y, a: Math.atan2(l.e.y - t.y, l.e.x - t.x), half: SOL_CONE * Math.PI / 180, len: d * 1.6, color: TOWERS[t.kind].color }, Math.cbrt(p)); // up to half opacity at full charge
        ctx.strokeStyle = COL[TOWERS[t.kind].color];
      }
      ctx.globalAlpha = 0.32 + 0.32 * p * p; // never below half its full strength (owner)
      const len = Math.hypot(l.e.x - t.x, l.e.y - t.y) || 1, px = -(l.e.y - t.y) / len, py = (l.e.x - t.x) / len;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * 2 * TWIN_GAP;
        ctx.moveTo(t.x + px * o, t.y + py * o); ctx.lineTo(l.e.x, l.e.y); // converging on the target (owner)
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ACD: each line thin and faint at first, thicker and brighter as its burn
// ramps (a Residue line, out of range, at half strength); Plague's circle
// round each target; Contagion has no lines - its range glows instead.
function drawAcd() {
  ctx.lineCap = "round"; ctx.strokeStyle = COL.chatsubo;
  for (const t of [...G.towers, ...coreTowers()]) { // the core's Fortifications copy fires too (aspira-core.js)
    if (t.kind !== "acd") continue;
    drawPuddles(t); // the chart ACD's puddles, under its lines (aspira-skills.js)
    if (!t.lines || !t.lines.length) continue;
    const st = towerStats(t, true);
    if (st.allInRange) {
      gradDisc(t.x, t.y, st.range, COL.chatsubo);
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(performance.now() / 200); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(t.x, t.y, st.range, 0, 6.283); ctx.stroke();
      continue;
    }
    for (const l of t.lines) {
      if (l.e.dead) continue;
      // Catalyst: the line THROBS, faster the further its burn has ramped (owner)
      const f = acdFrac(l, st), cat = skillOf(t, "corrosion") > 0 || (t.path != null && UPGRADES.acd[t.path].name === "Catalyst");
      const k = (Math.hypot(l.e.x - t.x, l.e.y - t.y) > st.range ? 0.5 : 1) *
        (cat ? 0.7 + 0.3 * Math.sin(performance.now() / 1000 * (4 + 20 * f)) : 1);
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(l.e.x, l.e.y);
      for (const o of l.chain || []) if (!o.dead) ctx.lineTo(o.x, o.y); // Rain: on through its chain
      // as THICK as one burn tick's damage (beamWidth, owner)
      const bw = beamWidth(st.dmg * acdMulOf(l.held, st) / st.rate);
      ctx.globalAlpha = (0.1 + 0.2 * f) * k; ctx.lineWidth = bw * 3; ctx.stroke();
      ctx.globalAlpha = (0.6 + 0.4 * f) * k; ctx.lineWidth = bw; ctx.stroke();
      if (st.plagueR) {
        const pr = plagueRadius(l, st);
        gradDisc(l.e.x, l.e.y, pr, COL.chatsubo, k);
        ctx.globalAlpha = (0.15 + 0.25 * f) * k; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(l.e.x, l.e.y, pr, 0, 6.283); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

// SLW's continuous tethers: a live beam from each Slower to every enemy it
// is holding, redrawn each frame so it tracks them; it drops when the enemy
// dies or leaves range. A slow shimmer keeps it reading as a held effect.
function drawTethers() {
  const shimmer = 0.75 + 0.25 * Math.sin(performance.now() / 160);
  ctx.lineCap = "round";
  for (const t of [...G.towers, ...coreTowers()]) { // the core's Fortifications copy fires too (aspira-core.js)
    if (t.kind !== "frz") continue;
    const st = towerStats(t, true), r = st.range, col = COL[TOWERS[t.kind].color];
    if (st.skill) { ownColours(() => drawFrzSkill(t, st)); continue; } // the chart FRZ: aura, moons, Rime (aspira-skills.js)
    // Moons / Desolation: orbiting moons, always shown - in FRZ's OWN colour on a
    // boss sky, like the towers (owner)
    if (st.moons) { ownColours(() => drawMoons(t, st, COL[TOWERS[t.kind].color], shimmer)); continue; }
    if (!t.links || !t.links.length) continue;
    // Stasis (the slow path): a much THICKER tether (owner)
    const w = t.path != null && UPGRADES.frz[t.path].name === "Stasis" ? 2 : 1;
    for (const e of t.links) {
      if (e.dead || Math.hypot(e.x - t.x, e.y - t.y) > r) continue;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(e.x, e.y);
      // three rays now, so each FAINTER (owner); as THICK as its hit (beamWidth, owner)
      const bw = beamWidth(st.dmg) * w;
      ctx.globalAlpha = 0.1 * shimmer; ctx.lineWidth = bw * 3; ctx.stroke();
      ctx.globalAlpha = 0.45 * shimmer; ctx.lineWidth = bw; ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// FRZ's Moons / Desolation: each moon a bright body with a small glow, and a
// Stasis-thick tether from the moon (where it is NOW) to the enemy it holds
const MOON_GLOW = 0.35, MOON_GLOW_R = 26;
function drawMoons(t, st, col, shimmer) {
  const spots = moonSpots(t, st);
  for (const { i, e } of t.moonLinks || []) {
    const m = spots[i];
    if (!m || e.dead || Math.hypot(e.x - m.x, e.y - m.y) > st.range) continue;
    ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(e.x, e.y);
    ctx.globalAlpha = 0.15 * shimmer; ctx.lineWidth = 12; ctx.stroke();
    ctx.globalAlpha = 0.7 * shimmer; ctx.lineWidth = 3.2; ctx.stroke();
  }
  for (const m of spots) {
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, MOON_GLOW_R);
    g.addColorStop(0, col); g.addColorStop(1, "transparent");
    ctx.fillStyle = g; ctx.globalAlpha = MOON_GLOW;
    ctx.beginPath(); ctx.arc(m.x, m.y, MOON_GLOW_R, 0, 6.283); ctx.fill();
    ctx.fillStyle = col; ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(m.x, m.y, 8, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
