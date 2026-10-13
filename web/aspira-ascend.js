// THE ASCENDANTS (owner, 2026-10-11: "when a player beats a game let them save their initials in the Ascendants"):
// one SHARED board on the server (/api/spire/ascendants, routes_aspira.py + spire_board.py), on the HONOUR SYSTEM - the
// game runs in the browser, so nothing can be proven. TOP PLAYERS (owner, 2026-10-11): a win, or any game past wave
// ASC_MIN_WAVE - 1, may post three letters, arcade style; the board ranks the Ascendants (wins, GOLD rows) first, then
// everyone else by the wave reached (GREEN rows), tower names in their own colours. A game over before that shows the
// board alone. UI only; winGame / gameOver (aspira-game.js) call in.
const ASC_URL = "/api/spire/ascendants", ASC_SHOW = 10, ASC_MIN_WAVE = 11;
const ASC_TITLE = '<p class="asp-asc-title">Top players</p>';
function ascBox() {
  let el = $("asp-asc");
  if (!el) { el = document.createElement("div"); el.id = "asp-asc"; $("asp-ov-btn").after(el); } // BELOW Play again (owner, 2026-10-11)
  return el;
}
const ascTeam = () => [...new Set(G.towers.filter(t => !t.isCore).map(t => t.kind))];
const ascDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
const ascWon = e => e.won !== false; // (rows from before `won` existed were all wins)
function ascTeamCell(td, team) {
  (team || []).forEach((k, i) => {
    if (i) td.append(" ");
    const s = document.createElement("span");
    s.className = "asp-asc-k"; s.dataset.kind = k; s.textContent = (TOWERS[k] && TOWERS[k].ab) || "?";
    td.append(s);
  });
}
function ascBoard(entries, mine) {
  const board = $("asp-asc-board");
  if (!board) return;
  board.textContent = "";
  if (!entries.length) { board.textContent = "No one on the board yet."; return; }
  const table = document.createElement("table");
  table.className = "asp-asc-table";
  // EVERY entry, but only ASC_SHOW rows tall - the rest a scroll away (owner, 2026-10-12: "show only top 10 players, but allow
  // the leaderboard to be scrollable"); your own row scrolled into view
  for (const e of entries) {
    const tr = table.insertRow();
    tr.className = (ascWon(e) ? "asp-asc-gold" : "asp-asc-green") + (mine && e.ts === mine.ts && e.initials === mine.initials ? " asp-asc-mine" : "");
    tr.insertCell().textContent = e.initials;
    ascTeamCell(tr.insertCell(), e.team);
    tr.insertCell().textContent = ascWon(e) ? e.lives + " lives" : "wave " + e.wave;
    tr.insertCell().textContent = ascDate(e.ts);
  }
  board.append(table);
  const rows = table.rows;
  board.style.maxHeight = rows.length > ASC_SHOW ? rows[ASC_SHOW].offsetTop - rows[0].offsetTop + "px" : "";
  const me = table.querySelector(".asp-asc-mine");
  if (me && rows.length > ASC_SHOW) board.scrollTop = Math.max(0, me.offsetTop - rows[0].offsetTop - board.clientHeight / 2);
}
async function ascLoad() {
  try { const r = await fetch(ASC_URL); if (r.ok) ascBoard((await r.json()).entries || []); } catch (_e) { ascBoard([]); }
}
async function ascSend(ev) {
  ev.preventDefault();
  const input = $("asp-asc-in"), note = $("asp-asc-note"), initials = input.value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(initials)) { note.textContent = "Three letters."; return; }
  input.disabled = true;
  try {
    const won = !!G.won, body = { initials, lives: Math.max(0, G.lives), team: ascTeam(), won, wave: won ? WIN_WAVE : G.wave };
    const r = await fetch(ASC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status === 429 ? "Too many posts - try later." : "Could not save.");
    const res = await r.json();
    $("asp-asc-form").hidden = true; note.textContent = initials + (won ? " has ascended." : " is on the board.");
    ascBoard(res.entries || [], res.entry);
  } catch (e) { note.textContent = e.message; input.disabled = false; }
}
// the entry form: a win, or a game over past wave 10
function showAscend() {
  const box = ascBox(), won = !!G.won;
  box.hidden = false;
  box.innerHTML = ASC_TITLE + '<form id="asp-asc-form"><input id="asp-asc-in" maxlength="3" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="AAA" aria-label="your initials">' +
    '<button class="asp-primary" type="submit">' + (won ? "ascend" : "post") + '</button></form><p id="asp-asc-note">' +
    (won ? "Leave your initials among the Ascendants." : "Wave " + G.wave + " - leave your initials on the board.") + '</p><div id="asp-asc-board"></div>';
  const input = $("asp-asc-in");
  input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3); };
  $("asp-asc-form").onsubmit = ascSend;
  ascLoad();
}
function hideAscend() { const el = $("asp-asc"); if (el) el.hidden = true; }
// a game over: the entry form past wave 10, else the board alone (owner, 2026-10-11: "on any game over screen show leaderboard")
function showAscendants() {
  if (G.wave >= ASC_MIN_WAVE) { showAscend(); return; }
  const box = ascBox();
  box.hidden = false;
  box.innerHTML = ASC_TITLE + '<div id="asp-asc-board"></div>';
  ascLoad();
}
