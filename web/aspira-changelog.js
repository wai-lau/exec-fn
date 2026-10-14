// /spire - WHAT'S NEW (owner, 2026-10-14: "construct a changelog, clicking the version number should pause the game and show the
// changelog on a card ... only include changes that affect the player, like graphics and balance changes"). Newest first; one
// short line a change, in the player's words - a FACT, no reason or explanation (owner, 2026-10-14). Add to the top day (or start a new one) with every change a player would notice.
// THE VERSION (web/aspira-version.txt, major.minor.tiny): a new day here is the next minor (its v); every deploy after bumps tiny.
const CHANGELOG = [ // each day's lines in two groups: b = Balance, u = Perf/UI. Facts only, no reasons (owner, 2026-10-14)
  { v: "4.3", day: "Oct 14", b: [
    "Enemies speed up through the mid-game and have less HP.",
    "Mid-game enemies: up to x1.5 HP.",
    "Late enemies: faster, less HP.",
    "Boss escorts give 20% of their HP to their boss.",
    "Interest: 2% (was 3%).",
    "Swarms: half as many enemies, x1.15 HP, x2 credits, 2 lives per leak.",
    "+6 lives per 100,000 score now arrive when the wave's boss falls.",
    "Acid Contagion: a kill in a pool leaves a new pool.",
    "Acid Corrosion: goo lasts 40 s (was 8).",
    "Orbital Relay: 11.25 s (was 22.5); stays on its tower.",
    "Temporal Drive: ends when no enemies are left; can't be used on an empty board.",
  ], u: [
    "Autosave: resume from the start of the last wave.",
    "Game speeds: 1x, 1.5x, 2x, 3x (keys 1-4).",
    "3D: faster, most of all on phones; resolution no longer drops.",
    "Acid effects: pools don't stack brightness; Spray V shows its jets; Contagion pools are dashed rings.",
    "Threat ring round the core when an enemy is close, joined to its triangles.",
    "Every lane turned to stay on screen longer.",
    "Powers won from a boss flash when the next wave starts, for 4 s.",
    "Pause button flashes while paused.",
    "Numbers and text: outline only, no glow.",
    "3D: beams are hidden where a tower covers them.",
    "Temporal Drive: no screen shake; the first ring goes out as the core lands.",
    "3D: movement range rings evenly dashed all round.",
    "Upgrade button always shows the cost.",
    "Boss text and power buttons no longer block dragging.",
    "Phone-screen limit: shown only where it blocks a tower, as three thin lines.",
    "3D: shapes below the floor fade out.",
    "Quality slider matches the width of the stats row.",
    "Version number opens this card.",
    "TOP PLAYERS shows the owner's games from Oct 14 on.",
  ] },
  { v: "4.2", day: "Oct 13", b: [
    "Bosses: x1.4 HP; the Empress and Strength x3.5, Death x2.8.",
    "Acid Corrosion: goo strips more armor.",
    "Solar Refraction: cone a third narrower.",
  ], u: [
    "Auto-move glides at half speed; using it marks the game (DQ), off TOP PLAYERS.",
    "Tower cards open from the home slot; an up arrow marks an affordable upgrade.",
    "Swarms spread over twice as many lanes.",
    "From wave 97, augmented enemies wear their augment's colour.",
    "A tower that can't stay put glides home.",
  ] },
  { v: "4.1", day: "Oct 12", b: [
    "A boss every 12 waves; the game is won at wave 120.",
    "Enemies: x1.5 HP from wave 25.",
    "Tower ranges x0.75; movement leash x1.5.",
    "Wave timers 20% shorter.",
  ], u: [
    "After a boss, the next wave waits for Challenge.",
    "The game holds while the boss sky turns over.",
    "3D is the default view.",
    "Red threat marks on the closest enemies.",
  ] },
  // the milestones before the changelog, read back from the history (2026-10-14)
  { v: "4.0", day: "Oct 11", b: ["Three towers a game; tier VI capstones; core powers cool down by wave."], u: ["Towers drag on a leash and coast.", "TOP PLAYERS."] },
  { v: "3.1", day: "Oct 10", u: ["Towers drag anywhere inside their leash."] },
  { v: "3.0", day: "Oct 9", b: ["Every boss brings a fleet."], u: ["3D view: the board as a spire, dice enemies, prism towers."] },
  { v: "2.3", day: "Oct 8", b: ["Capstones; each boss has its own armor and shields."], u: ["Core powers as buttons."] },
  { v: "2.2", day: "Oct 7", b: ["Bosses grant the core powers; Orbital Relay."], u: ["Upgrades by dragging the tower's chart."] },
  { v: "2.1", day: "Oct 6", b: ["Core powers, including Temporal Drive; range rework; tower roles."], u: ["Build by tapping a slot."] },
  { v: "2.0", day: "Oct 5", b: ["Skill charts: three upgrade axes per tower.", "Corner slots open as bosses fall."] },
  { v: "1.3", day: "Oct 4", b: ["Tower ranges x0.75."] },
  { v: "1.2", day: "Oct 3", b: ["Solar rework: Impale and bleed."] },
  { v: "1.1", day: "Oct 2", b: ["Acid tower; upgrade trees for all four towers; ten tarot bosses; six build slots."] },
  { v: "1.0", day: "Oct 1", b: ["The Spire: spiral tower defence on a star chart."] },
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
