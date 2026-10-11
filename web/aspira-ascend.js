// THE ASCENDANTS (owner, 2026-10-11: "when a player beats a game let them save their initials in the Ascendants"):
// one SHARED board of winners on the server (/api/spire/ascendants, routes_aspira.py + spire_board.py), on the HONOUR
// SYSTEM - the game runs in the browser, so a win cannot be proven. The win screen asks for three letters, arcade
// style, and shows the board; a loss shows the board alone (showAscendants). UI only; winGame / gameOver (aspira-game.js) call in.
const ASC_URL = "/api/spire/ascendants", ASC_SHOW = 10;
const ASC_NAMES = { arc: "ARC", frz: "FRZ", sol: "SOL", acd: "ACD" };
function ascBox() {
  let el = $("asp-asc");
  if (!el) { el = document.createElement("div"); el.id = "asp-asc"; $("asp-ov-btn").after(el); } // BELOW Play again (owner, 2026-10-11)
  return el;
}
const ascTeam = () => [...new Set(G.towers.filter(t => !t.isCore).map(t => t.kind))];
const ascDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
function ascBoard(entries, mine) {
  const board = $("asp-asc-board");
  if (!board) return;
  board.textContent = "";
  if (!entries.length) { board.textContent = "No one has ascended yet."; return; }
  const table = document.createElement("table");
  table.className = "asp-asc-table";
  for (const e of entries.slice(0, ASC_SHOW)) {
    const tr = table.insertRow();
    if (mine && e.ts === mine.ts && e.initials === mine.initials) tr.className = "asp-asc-mine";
    for (const v of [e.initials, (e.team || []).map(k => ASC_NAMES[k] || "?").join(" "), e.lives + " lives", ascDate(e.ts)]) tr.insertCell().textContent = v;
  }
  board.append(table);
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
    const r = await fetch(ASC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initials, lives: G.lives, team: ascTeam() }) });
    if (!r.ok) throw new Error(r.status === 429 ? "Too many ascensions - try later." : "Could not save.");
    const entries = (await r.json()).entries || [];
    $("asp-asc-form").hidden = true; note.textContent = initials + " has ascended.";
    ascBoard(entries, entries[0]);
  } catch (e) { note.textContent = e.message; input.disabled = false; }
}
function showAscend() {
  const box = ascBox();
  box.hidden = false;
  box.innerHTML = '<form id="asp-asc-form"><input id="asp-asc-in" maxlength="3" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="AAA" aria-label="your initials">' +
    '<button class="asp-primary" type="submit">ascend</button></form><p id="asp-asc-note">Leave your initials among the Ascendants.</p><div id="asp-asc-board"></div>';
  const input = $("asp-asc-in");
  input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3); };
  $("asp-asc-form").onsubmit = ascSend;
  ascLoad();
}
function hideAscend() { const el = $("asp-asc"); if (el) el.hidden = true; }
// a LOSS shows the board too (owner, 2026-10-11: "on any game over screen show leaderboard") - no entry, just who ascended
function showAscendants() {
  const box = ascBox();
  box.hidden = false;
  box.innerHTML = '<p id="asp-asc-note">The Ascendants</p><div id="asp-asc-board"></div>';
  ascLoad();
}
