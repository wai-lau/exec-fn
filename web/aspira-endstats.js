// /aspira — the END SCREEN's stats (owner, 2026-10-06): under "core breached" /
// "ascendant", every tower ranked by damage dealt (its kills, level and share
// of the damage), the core's copy if it fought, and the waves where lives
// were lost (G.leaks, counted in aspira-game.js where an enemy reaches the
// core). UI only; gameOver / winGame call renderEndStats.
function renderEndStats() {
  const box = $("asp-ov-stats");
  if (!box) return;
  const rows = [...G.towers, ...coreTowers()].filter(t => t.dealt || t.kills);
  const total = rows.reduce((a, t) => a + (t.dealt || 0), 0) || 1;
  rows.sort((a, b) => (b.dealt || 0) - (a.dealt || 0));
  let html = '<table class="asp-end-towers"><tr><th>tower</th><th>lvl</th><th>kills</th><th>damage</th><th>share</th></tr>';
  for (const t of rows) {
    html += '<tr data-kind="' + t.kind + '"><td>' + (t.isCore ? "core · " : "") + TOWERS[t.kind].ab + "</td><td>" + t.lvl + "</td><td>" +
      (t.kills || 0) + "</td><td>" + short(Math.round(t.dealt || 0)) + "</td><td>" + Math.round(100 * (t.dealt || 0) / total) + "%</td></tr>";
  }
  html += "</table>";
  const leaks = Object.entries(G.leaks || {}).sort((a, b) => a[0] - b[0]);
  html += '<p class="asp-end-leaks">' + (leaks.length
    ? "lives lost: " + leaks.map(([w, n]) => "W" + w + "\u00a0−" + n).join(" · ")
    : "no lives lost") + "</p>";
  box.innerHTML = html;
}
