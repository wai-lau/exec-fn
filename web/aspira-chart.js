// /aspira — the skill CHART drawn (UI only; split off aspira-skills.js at the
// 500-line cap): the triangle radar on the tower card (skillChart) and the
// small one inside a tower's hex on the board (boardChart). Loaded after
// aspira-skills.js; the simulator does not load it.
// ---------- the chart (UI only; the upgrade cards draw it) ----------
// a triangle radar, an axis per corner, a ring per tier; the filled shape is
// what the tower has, the dashed one what this pick would make (owner: JoJo)
// the same chart drawn INSIDE the tower's hex on the board (owner): its outer
// triangle's corners ARE three of the hex's corners (every other one, at the
// outline), with the inner tier triangles and the three axes drawn faint, and
// the build's shape filled in the tower's colour
const BOARD_CHART_MIN = 8 / 46; // skillChart's inner radius over its outer
function boardChart(t, x, y, alpha, c0) {
  const axes = SKILL_TREES[t.kind], col = COL[TOWERS[t.kind].color];
  // axis i points where the CARD's chart puts it (owner: same orientation - the
  // first axis up, then clockwise every 120 deg), snapped to the nearest hex corner
  const corner = i => {
    const want = -Math.PI / 2 + i * 2 * Math.PI / axes.length;
    let best = c0.pts[0], bd = 9;
    for (const p of c0.pts) {
      const d = Math.abs(Math.atan2(Math.sin(Math.atan2(p.y - c0.y, p.x - c0.x) - want), Math.cos(Math.atan2(p.y - c0.y, p.x - c0.x) - want)));
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const pt = (i, k) => {
    // tier 0 sits at a small inner triangle, like the card's (8 of 46), so a
    // one-axis build is a thin triangle, never a bare line (owner)
    const p = corner(i), f = TOWER_K * (BOARD_CHART_MIN + (1 - BOARD_CHART_MIN) * k / SKILL_TIERS);
    return [x + (p.x - c0.x) * f, y + (p.y - c0.y) * f];
  };
  const path = ks => { ctx.beginPath(); ks.forEach((k, i) => { const [px, py] = pt(i, k); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.closePath(); };
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineJoin = "round";
  ctx.globalAlpha = 0.25 * alpha; ctx.lineWidth = 1.5;
  for (let k = 1; k <= SKILL_TIERS; k++) { path(axes.map(() => k)); ctx.stroke(); }
  axes.forEach((_, i) => { const [px, py] = pt(i, SKILL_TIERS); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(px, py); ctx.stroke(); });
  path(axes.map(ax => skillOf(t, ax.id)));
  ctx.globalAlpha = 0.6 * alpha; ctx.fill();
  ctx.globalAlpha = alpha; ctx.lineWidth = 2; ctx.stroke();
}
function skillChart(t, next) {
  const axes = SKILL_TREES[t.kind], R = 46, C = 60, pt = (i, k) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / axes.length, r = 8 + (R - 8) * k / SKILL_TIERS;
    return (C + Math.cos(a) * r).toFixed(1) + "," + (C + Math.sin(a) * r).toFixed(1);
  };
  const shape = sk => axes.map((ax, i) => pt(i, (sk && sk[ax.id]) || 0)).join(" ");
  let svg = '<svg class="asp-chart" viewBox="0 0 120 120">';
  for (let k = 1; k <= SKILL_TIERS; k++) svg += '<polygon class="grid" points="' + axes.map((_, i) => pt(i, k)).join(" ") + '"/>';
  axes.forEach((ax, i) => {
    svg += '<line class="grid" x1="' + C + '" y1="' + C + '" x2="' + pt(i, SKILL_TIERS).replace(",", '" y2="') + '"/>';
  });
  if (next) svg += '<polygon class="next" points="' + shape(next) + '"/>';
  svg += '<polygon class="now" points="' + shape(t.skills) + '"/>';
  axes.forEach((ax, i) => {
    const [x, y] = pt(i, SKILL_TIERS + 0.9).split(",");
    svg += '<text x="' + x + '" y="' + y + '">' + ax.name.slice(0, 4).toUpperCase() + " " + skillOf(t, ax.id) + "</text>";
  });
  return svg + "</svg>";
}
