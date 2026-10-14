// /spire - WHAT'S NEW (owner, 2026-10-14: "construct a changelog, clicking the version number should pause the game and show the
// changelog on a card ... only include changes that affect the player, like graphics and balance changes"). Newest first; one
// short line a change, in the player's words. Add to the top day (or start a new one) with every change a player would notice.
// THE VERSION (web/aspira-version.txt, major.minor.tiny): a new day here is the next minor (its v); every deploy after bumps tiny.
const CHANGELOG = [ // each day's lines in two groups: b = Balance, u = Perf/UI
  { v: "4.3", day: "Oct 14", b: [
    "Enemies speed up through the mid-game and carry less HP to match; mid-game enemies are tougher; late waves are faster, with less HP, so they end sooner.",
    "Boss escorts hand part of their HP to their boss again.",
    "Interest is 2% (was 3%).",
    "The +6 lives for every 100,000 score now arrive when the wave's boss falls.",
    "Acid Contagion: an enemy killed in a pool leaves a pool of its own.",
    "Orbital Relay lasts 11.25 s (was 22.5), and stays on the tower you give it (dragging another no longer moves it).",
    "Temporal Drive ends once no enemies are left, and can't be used on an empty board.",
  ], u: [
    "Autosave: after a crash or a reload, resume from the start of the wave you were on.",
    "Boss lanes turn to keep the boss on screen as long as they can.",
    "The threat ring round the core runs into the two triangles beside the enemy.",
    "The pause button flashes while the game is paused.",
    "Game speeds are 1x, 1.5x, 2x and 3x (keys 1-4).",
    "3D runs much faster, most of all on phones, and keeps its full resolution (it no longer drops it when frames run slow).",
    "Acid's late effects are calmer: piled-up pools no longer flood the board green, Spray V shows its jets, Contagion's pools are dashed rings.",
    "When an enemy gets close, a ring round the core shows its distance again.",
    "A power won from a boss flashes when the next wave starts; the flash lasts 4 s.",
    "The upgrade button always shows the cost (the tower name, then the level, give way first).",
    "Boss text and the power buttons no longer block dragging a tower.",
    "3D: shapes below the floor fade out again.",
    "The quality slider stretches to line up with the stats above it.",
    "This card: tap the version number (V, top bar).",
  ] },
  { v: "4.2", day: "Oct 13", b: [
    "Bosses are tougher (x1.4 HP; the Empress and Strength x3.5, Death x2.8).",
    "Acid Corrosion: its goo strips more armor.",
    "Solar Refraction's cone is a third tighter.",
  ], u: [
    "Auto-move glides at half speed; using it marks the game (DQ) and keeps it off TOP PLAYERS.",
    "A tower's card opens from its home slot; an up arrow there means an upgrade you can afford.",
    "Swarms spread over twice as many lanes.",
    "From wave 97, augmented enemies wear their augment's colour.",
    "A tower that can't stay where it is glides home instead of sitting stuck.",
  ] },
  { v: "4.1", day: "Oct 12", b: [
    "A boss every 12 waves; the game is won at wave 120.",
    "Enemies have x1.5 HP from wave 25; tower ranges x0.75, movement leash x1.5.",
    "Wave timers are 20% shorter.",
  ], u: [
    "After a boss, the next wave waits for your Challenge tap.",
    "The game holds while the boss sky turns over.",
    "3D is the default view.",
    "Threat marks in red for the closest enemies; a leak bounces its ring back out.",
  ] },
  // the milestones before the changelog, read back from the history (2026-10-14)
  { v: "4.0", day: "Oct 11", b: ["Three towers a game; tier VI capstones; core powers cool down by the wave."], u: ["Towers drag anywhere on a leash and coast when let go.", "TOP PLAYERS."] },
  { v: "3.1", day: "Oct 10", u: ["Towers drag anywhere inside their leash."] },
  { v: "3.0", day: "Oct 9", b: ["Every boss brings a fleet."], u: ["3D: the board seen as a spire, enemies as rolling dice, towers as prisms."] },
  { v: "2.3", day: "Oct 8", b: ["Capstones; each boss its own armor and shields."], u: ["Core powers as buttons."] },
  { v: "2.2", day: "Oct 7", b: ["Bosses hand out the core powers; Orbital Relay."], u: ["Upgrade by dragging a tower's chart."] },
  { v: "2.1", day: "Oct 6", b: ["Core powers (Temporal Drive and more); a range rework with tower roles."], u: ["Build by tapping a slot."] },
  { v: "2.0", day: "Oct 5", b: ["Skill charts: every tower upgrades along three axes.", "Corner slots open as bosses fall."] },
  { v: "1.3", day: "Oct 4", b: ["Every tower range cut to 75%."] },
  { v: "1.2", day: "Oct 3", b: ["Solar reworked: Impale and bleed."] },
  { v: "1.1", day: "Oct 2", b: ["Acid joins the towers; upgrade trees for all four; the ten tarot bosses; six build slots."] },
  { v: "1.0", day: "Oct 1", b: ["The Spire: a spiral tower defence on a star chart."] },
];
// the card: the game pauses while it is open and goes back as it was when it closes
let logWasPaused = null;
function openChangelog() {
  let card = $("asp-log");
  if (!card) {
    card = document.createElement("div");
    card.id = "asp-log"; card.className = "asp-deck asp-log";
    const group = (name, items) => (items && items.length ? "<h4>" + name + "</h4><ul>" + items.map(i => "<li>" + i + "</li>").join("") + "</ul>" : "");
    // the Balance / Perf/UI headings only where a version has more than one line (owner, 2026-10-14), and only over a group that has one
    const day = d => { const all = [...(d.b || []), ...(d.u || [])]; return "<h3>" + d.v + " · " + d.day + "</h3>" + (all.length > 1 ? group("Balance", d.b) + group("Perf/UI", d.u) : "<ul>" + all.map(i => "<li>" + i + "</li>").join("") + "</ul>"); };
    card.innerHTML = '<h2>changes</h2><div class="asp-log-list">' + CHANGELOG.map(day).join("") + "</div>";
    button(card, "asp-primary", "close", closeChangelog);
    document.querySelector(".asp-board").appendChild(card);
  }
  if (!card.hidden && logWasPaused !== null) return;
  logWasPaused = ui.paused; ui.paused = true; card.hidden = false;
}
function closeChangelog() {
  const card = $("asp-log");
  if (card) card.hidden = true;
  if (logWasPaused !== null) { ui.paused = logWasPaused; logWasPaused = null; }
}
(() => {
  const ver = document.querySelector(".asp-ver");
  if (!ver) return;
  ver.setAttribute("role", "button"); ver.setAttribute("aria-label", "what's new"); ver.tabIndex = 0;
  ver.addEventListener("click", openChangelog);
  ver.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openChangelog(); } });
})();
