// /aspira — the END SCREEN's stats (owner, 2026-10-06): under "core breached" /
// "ascendant", a line for EVERY tower ranked by damage dealt (level, kills,
// damage, share; the core's copy too if it fought; named by its build), and ABOVE the
// title a line for each wave that TOOK LIVES - what it was (type x count, or the boss's
// name, from G.planLog) and how many (G.leaks, counted where an enemy reaches
// the core) - in a box that scrolls. UI only; gameOver / winGame call renderEndStats.
// a tower's NAME is its build (owner: "name the towers"): the tier names of its
// two strongest axes, strongest first - "Superconductor · Charge"
function buildName(t) {
  const tree = SKILL_TREES[t.kind] || [];
  return tree.map(ax => ({ n: skillOf(t, ax.id), ax })).filter(o => o.n).sort((a, b) => b.n - a.n).slice(0, 2)
    .map(o => o.ax.tiers[o.n - 1].name).join(" · ");
}
function renderEndStats() {
  const box = $("asp-ov-stats"), top = $("asp-ov-leaks"); // the leaks sit ABOVE the title (owner)
  if (!box || !top) return;
  const rows = [...G.towers];
  const total = rows.reduce((a, t) => a + (t.dealt || 0), 0) || 1;
  rows.sort((a, b) => (b.dealt || 0) - (a.dealt || 0));
  // no level and no base name (owner): the row's colour says which tower
  let html = '<table class="asp-end-towers"><tr><th>tower</th><th>kills</th><th>damage</th><th>share</th></tr>';
  for (const t of rows) {
    html += '<tr data-kind="' + t.kind + '"><td>' + (t.isCore ? "core · " : "") + (buildName(t) || TOWERS[t.kind].ab) + "</td><td>" +
      (t.kills || 0) + "</td><td>" + short(Math.round(t.dealt || 0)) + "</td><td>" + Math.round(100 * (t.dealt || 0) / total) + "%</td></tr>";
  }
  html += "</table>";
  box.innerHTML = html;
  html = '<div class="asp-end-waves"><table><tr><th>wave</th><th>what</th><th>lives</th></tr>';
  const leakWaves = Object.keys(G.leaks || {}).map(Number).sort((a, b) => a - b);
  if (!leakWaves.length) { top.innerHTML = '<p class="asp-end-leak">no lives lost</p>'; return; }
  for (const n of leakWaves) { // only the waves that took lives (owner)
    const p = (G.planLog || {})[n], lost = G.leaks[n];
    const what = !p ? "—" : p.type === "bonus" ? arcanaOf(n).name : p.count + " " + p.type;
    html += "<tr" + (lost ? ' class="asp-end-leak"' : "") + "><td>W" + n + "</td><td>" + what + "</td><td>" + (lost ? "−" + lost : "·") + "</td></tr>";
  }
  html += "</table></div>";
  top.innerHTML = html;
}
