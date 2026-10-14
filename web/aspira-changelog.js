// /spire - WHAT'S NEW (owner, 2026-10-14: "construct a changelog, clicking the version number should pause the game and show the
// changelog on a card ... only include changes that affect the player, like graphics and balance changes"). Newest first; one
// short line a change, in the player's words. Add to the top day (or start a new one) with every change a player would notice.
// THE VERSION (web/aspira-version.txt, major.minor.tiny): a new day here is the next minor (its v); every deploy after bumps tiny.
const CHANGELOG = [
  { v: "4.3", day: "Oct 14", items: [
    "Enemies speed up through the mid-game and carry less HP to match; late waves keep getting faster.",
    "Boss escorts hand part of their HP to their boss again.",
    "Interest is 2% (was 3%).",
    "The +6 lives for every 100,000 score now arrive when the wave's boss falls.",
    "Acid Contagion: an enemy killed in a pool leaves a pool of its own (a dashed ring).",
    "Acid's late effects are calmer: piled-up pools no longer flood the board green, and Spray V shows its jets.",
    "Orbital Relay lasts 11.25 s (was 22.5).",
    "Temporal Drive ends once no enemies are left, and can't be used on an empty board.",
    "When an enemy gets close, a ring round the core shows its distance again.",
    "A power won from a boss flashes when the next wave starts; the flash lasts 4 s.",
    "The upgrade button always shows the cost (the tower name, then the level, give way first).",
    "Boss text and the power buttons no longer block dragging a tower.",
    "3D: shapes below the floor fade out again.",
    "3D runs much faster, most of all on phones.",
    "This card: tap the version number.",
    "The quality slider fills the rest of its line.",
  ] },
  { v: "4.2", day: "Oct 13", items: [
    "Bosses are tougher (x1.4 HP; the Empress and Strength x3.5, Death x2.8).",
    "Acid Corrosion: its goo strips more armor.",
    "Auto-move glides at half speed; using it marks the game (DQ) and keeps it off TOP PLAYERS.",
    "A tower's card opens from its home slot; an up arrow there means an upgrade you can afford.",
    "Swarms spread over twice as many lanes.",
    "From wave 97, augmented enemies wear their augment's colour.",
    "Solar Refraction's cone is a third tighter.",
    "A tower that can't stay where it is glides home instead of sitting stuck.",
  ] },
  { v: "4.1", day: "Oct 12", items: [
    "A boss every 12 waves; the game is won at wave 120.",
    "After a boss, the next wave waits for your Challenge tap.",
    "The game holds while the boss sky turns over.",
    "Enemies have x1.5 HP from wave 25; tower ranges x0.75, movement leash x1.5.",
    "Wave timers are 20% shorter.",
    "3D is the default view.",
    "Threat marks in red for the closest enemies; a leak bounces its ring back out.",
  ] },
  // the milestones before the changelog, one or two lines each (read back from the history, 2026-10-14)
  { v: "4.0", day: "Oct 11", items: ["Three towers a game, dragged anywhere on a leash and coasting when let go.", "TOP PLAYERS; tier VI capstones; core powers cool down by the wave."] },
  { v: "3.1", day: "Oct 10", items: ["Towers drag anywhere inside their leash."] },
  { v: "3.0", day: "Oct 9", items: ["3D: the board seen as a spire, enemies as rolling dice, towers as prisms.", "Every boss brings a fleet."] },
  { v: "2.3", day: "Oct 8", items: ["Capstones; each boss its own armor and shields; core powers as buttons."] },
  { v: "2.2", day: "Oct 7", items: ["Upgrade by dragging a tower's chart; bosses hand out the core powers; Orbital Relay."] },
  { v: "2.1", day: "Oct 6", items: ["Core powers (Temporal Drive and more); a range rework with tower roles; build by tapping a slot."] },
  { v: "2.0", day: "Oct 5", items: ["Skill charts: every tower upgrades along three axes.", "Corner slots open as bosses fall."] },
  { v: "1.3", day: "Oct 4", items: ["Every tower range cut to 75%."] },
  { v: "1.2", day: "Oct 3", items: ["Solar reworked: Impale and bleed."] },
  { v: "1.1", day: "Oct 2", items: ["Acid joins the towers; upgrade trees for all four; the ten tarot bosses; six build slots."] },
  { v: "1.0", day: "Oct 1", items: ["The Spire: a spiral tower defence on a star chart."] },
];
// the card: the game pauses while it is open and goes back as it was when it closes
let logWasPaused = null;
function openChangelog() {
  let card = $("asp-log");
  if (!card) {
    card = document.createElement("div");
    card.id = "asp-log"; card.className = "asp-deck asp-log";
    card.innerHTML = '<h2>changes</h2><div class="asp-log-list">' + CHANGELOG.map(d => "<h3>" + d.v + " · " + d.day + "</h3><ul>" + d.items.map(i => "<li>" + i + "</li>").join("") + "</ul>").join("") + "</div>";
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
