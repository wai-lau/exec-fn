// /aspira — DOM: HUD, build/inspect/power decks, input, overlay, main loop.

// ui.speed is a setting (0.5/1/2/3); SPEED_MULT turns it into simulation rate.
// 1x is REAL TIME (owner): every rate/duration in the code is in real seconds.
// the old 2x is the new 1x (owner, 2026-10-02): every button runs the game
// twice as fast as its label used to (0.5x added, 10x for testing - owner)
const BASE_SPEED = 2;
const SPEED_MULT = { 0.25: 0.25 * BASE_SPEED, 0.5: 0.5 * BASE_SPEED, 1: BASE_SPEED, 2: 2 * BASE_SPEED, 3: 3 * BASE_SPEED, 10: 10 * BASE_SPEED };
const SPEEDS = [0.25, 0.5, 1, 2, 3, 10], speedId = v => "asp-sp-" + String(v).replace(".", "_");
const ui = { build: null, sel: null, hover: null, speed: 1, paused: false };
const $ = id => document.getElementById(id);
function setText(el, v) { v = String(v); if (el.textContent !== v) el.textContent = v; }
// a CREDITS amount reads "40c" (owner); the c takes the text's own colour
const cr = n => n + '<span class="asp-c">c</span>';
function setHtml(el, v) { if (el.dataset.html !== v) { el.dataset.html = v; el.innerHTML = v; } }
// big counts shorten so they never run into the tower buttons: 12345 stays,
// 123k, 4.0M
function short(n) {
  n = Math.floor(n); // money is fractional now (swarm bounties); show whole credits
  if (n < 1e5) return String(n);
  if (n < 1e6) return Math.floor(n / 1e3) + "k";
  return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + "M";
}

// ---------- placement / input ----------
// Towers snap to the triangular cells of the build disc (CELLS in
// aspira-defs.js); a cell holds at most one tower.
function canPlace(ci) {
  return cellOpen(ci) && !occupied(ci);
}
function toWorld(ev) {
  const r = cv.getBoundingClientRect(), dpr = canvasDpr();
  let x = (ev.clientX - r.left) * dpr, y = (ev.clientY - r.top) * dpr;
  if (q3d()) ({ x, y } = unwarp(x, y) || { x: -1e6, y: -1e6 }); // 3D: back through the spire to the 2D spot drawn there (aspira-warp.js); off it, nowhere
  return { x: (x - cam.ox) / cam.k, y: (y - cam.oy) / cam.k };
}
function placeTower(p) {
  const ci = snapCell(p.x, p.y);
  // a failed placement also ends placing mode, same as a successful one
  if (!canPlace(ci)) { float(p.x, p.y, "blocked", "pink"); ui.build = null; return; }
  const cost = towerCost(ui.build);
  if (G.money < cost) { float(p.x, p.y, "need " + cost + "c", "pink"); ui.build = null; return; }
  G.money -= cost;
  const c = CELLS[ci];
  const t = { id: G.id++, kind: ui.build, cell: ci, x: c.x, y: c.y, lvl: 1, cd: 0, mode: DEFAULT_MODE[ui.build], spent: cost };
  G.towers.push(t);
  sfxFor("build", t.kind);
  ring(t.x, t.y, 60, TOWERS[t.kind].color);
  // one tower per pick: placing ends placing mode (the menu stays closed)
  ui.build = null;
  // the first tower placed starts wave 1 (owner)
  if (!G.started) sendWave();
}
// a TAP on the board (aspira-camera.js decides tap vs drag/pinch): select a
// tower, place the one being built, or clear the selection
// every CSS blink on ONE phase (owner, 2026-10-08): an animation starts when its class lands, so two
// blinkers drift apart - pin each to the timeline's zero, where blinkWave() is bright too
const BLINKS = new Set(["asp-flash", "asp-build-pulse"]);
function syncBlinks() {
  for (const a of $("asp").getAnimations({ subtree: true })) if (BLINKS.has(a.animationName) && a.startTime !== 0) a.startTime = 0;
}
function onTap(ev) {
  if (G.over) return;
  const p = toWorld(ev);
  ui.hover = p;
  // a tower is tapped where it IS now (it may have slid out along its spoke)
  const ci = cellAt(p.x, p.y), hit = towerAt(p) || (ci >= 0 && G.towers.find(t => t.cell === ci)) || (!ui.build && trackAt(p));
  if (relayArmTap(p, hit)) { refreshPanels(); return; } // an armed Relay: this tower (or track) takes it, anything else disarms (aspira-powers.js)
  if (hit) { ui.sel = hit.id; ui.build = null; }
  else if (!ui.build && Math.hypot(p.x - CX, p.y - CY) <= CORE_R) { ui.sel = "core"; } // the core's card (aspira-core.js)
  else if (ui.build) placeTower(p);
  else if (ci >= 0 && canPlace(ci)) { ui.sel = null; openBuildChooser(ci); } // a free slot: the tower cards (aspira-chooser.js)
  else ui.sel = null;
  refreshPanels();
}

// ---------- decks ----------
function button(parent, cls, html, onclick, id) {
  const btn = document.createElement("button");
  btn.className = cls; btn.innerHTML = html; btn.onclick = onclick;
  if (id) btn.id = id;
  parent.appendChild(btn);
  return btn;
}
function selectBuild(k) {
  if (ui.build !== k && G.money < towerCost(k)) { noFunds($("asp-tw-" + k), towerCost(k)); return; }
  ui.build = ui.build === k ? null : k; ui.sel = null; refreshPanels();
}

KINDS.forEach((k, i) => {
  const b = TOWERS[k];
  const btn = button($("asp-build"), "asp-tw " + b.color,
    '<span class="ab">' + b.ab + '</span><span class="c">' + b.cost + "</span>", () => selectBuild(k), "asp-tw-" + k);
  btn.title = b.name;
});
[["pause", "pause"], [0.25, "¼×"], [0.5, "½×"], [1, "1×"], [2, "2×"], [3, "3×"], [10, "10×"]].forEach(([v, label]) => {
  button($("asp-speed"), "", label, () => {
    if (v === "pause") ui.paused = !ui.paused; else { ui.speed = v; ui.paused = false; }
  }, v === "pause" ? "asp-sp-pause" : speedId(v));
});

// AUTO-WAIT (owner): a checkbox under the pause button; while ticked, the game
// drops to 1/2x whenever an enemy is within AUTO_WAIT_S game-seconds of
// reaching the core at its current speed (owner: time, not distance), and goes
// back to the chosen speed once none is. Remembered in localStorage.
const AUTO_WAIT_S = 8;
const etaToCore = e => { const v = effSpeed(e); return v > 0 ? (PATHS[e.pi].len - e.s) / v : Infinity; };
let autoWait = true;
// ON by default (owner); only an explicit "0" (unticked before) turns it off
try { autoWait = localStorage.getItem("spire.autowait") !== "0"; } catch (e) { autoWait = true; }
// TWO stages (owner): 1/2x within AUTO_WAIT_S of the core, 1/4x within half
// that. Returns the speed key to run at (0.25 / 0.5), or 0 when not waiting.
// NO JITTER (owner): the nearest ETA jumps as enemies are slowed, die or swap,
// so a stage is entered at its line but only LEFT past AUTO_RELEASE x it (8s in,
// 10s out; 4s in, 5s out), and a slower speed holds at least AUTO_HOLD_MS of
// real time before it may speed up again. Slowing down is always immediate.
// Worked out at most once a frame (it is asked several times).
const AUTO_RELEASE = 1.25, AUTO_HOLD_MS = 1500;
let awLevel = 0, awSince = 0, awAt = -1;
const autoWaiting = () => {
  if (!autoWait || ui.paused) { awLevel = 0; return 0; }
  const now = performance.now();
  if (now - awAt < 8) return awLevel;
  awAt = now;
  let eta = Infinity;
  for (const e of G.enemies) if (!e.dead) eta = Math.min(eta, etaToCore(e));
  const hold = (lvl, line) => awLevel && awLevel <= lvl && eta <= line * AUTO_RELEASE; // already this slow or slower, still near
  const want = eta <= AUTO_WAIT_S / 2 || hold(0.25, AUTO_WAIT_S / 2) ? 0.25 : eta <= AUTO_WAIT_S || hold(0.5, AUTO_WAIT_S) ? 0.5 : 0;
  const slower = want && (!awLevel || want < awLevel);
  if (want !== awLevel && (slower || now - awSince >= AUTO_HOLD_MS)) { awLevel = want; awSince = now; }
  return awLevel;
};
(function autoWaitBox() {
  const row = document.createElement("div");
  row.className = "asp-row asp-autowait";
  $("asp-wavenote").after(row); // UNDER the wave list (owner; was under the speed row)
  const btn = button(row, "asp-check", "", () => {
    autoWait = !autoWait;
    try { localStorage.setItem("spire.autowait", autoWait ? "1" : "0"); } catch (e) { /* not remembered */ }
  }, "asp-autowait");
  btn.setAttribute("role", "checkbox");
  qualityBox(row); // the visual quality toggle beside it (aspira-quality.js)
})();
// the checkbox as an SVG, not a font glyph (owner: the glyph sat off-centre
// from its label); centred against the words by the button's flex row
const ICON_UNCHECKED = '<svg class="asp-box" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" rx="2"/></svg>';
const ICON_CHECKED = '<svg class="asp-box" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" rx="2"/><path d="M5.5 10.5l3 3 6-7"/></svg>';
function updateAutoWait() {
  const btn = $("asp-autowait"), html = (autoWait ? ICON_CHECKED : ICON_UNCHECKED) + "<span>auto-wait</span>"; // the box bigger than the words (owner)
  if (btn.dataset.html !== html) { btn.dataset.html = html; btn.innerHTML = html; btn.setAttribute("aria-checked", String(autoWait)); }
  btn.classList.toggle("on", autoWaiting()); // lit while it is holding the game at 1/2x
}

// the sound toggle is an ICON (owner: was "sound on"/"sound off"): a speaker
// with waves, or crossed out
const ICON_SOUND = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
// the bottom speed bar's height, live, so the wave list and build buttons sit
// just above it (--foot-h, aspira.css)
new ResizeObserver(() => $("asp").style.setProperty("--foot-h", document.querySelector(".asp-foot").getBoundingClientRect().height + "px")).observe(document.querySelector(".asp-foot"));
// the mute button sits ABOVE the vertical volume slider, top-right (owner)
const volBox = document.createElement("div");
volBox.className = "asp-volbox";
$("asp").appendChild(volBox);
button(volBox, "", "", () => setMuted(!muted), "asp-mute");
// volume slider: VERTICAL, top-right (owner; was beside the sound toggle) - a
// plain range input turned -90deg in its own box (.asp-volbox), up = louder
(function volumeSlider() {
  const s = document.createElement("input");
  Object.assign(s, { type: "range", id: "asp-vol", min: 0, max: 2, step: 0.05, value: volume, title: "volume" });
  s.setAttribute("aria-label", "volume");
  s.oninput = () => { setVolume(Number(s.value)); if (muted && Number(s.value) > 0) setMuted(false); };
  const slot = document.createElement("div");
  slot.className = "asp-volslot";
  slot.appendChild(s);
  volBox.appendChild(slot);
})();

// the card's stat rows (rayForm, SPEC, statRow) live in aspira-stats.js
// choice: the path (at level 5) or final form (at level 10) being bought;
// those two upgrades cannot happen without one
// quiet: no sound, ring or refresh - the sliders' lock-in buys several and plays once
function upgradeTower(t, choice = null, quiet = false) {
  if (!t || t.lvl >= maxLvl(t) || G.money < upCost(t)) return;
  const need = pendingChoice(t);
  if (need && choice == null) return;
  if (need === "skill") t.skills = withSkill(t, choice); // one tier up the chosen axis
  if (need === "path") t.path = choice;
  if (need === "form") { t.form = choice; t.mode = UPGRADES[t.kind][t.path].finals[choice].mode || t.mode; } // a form may set targeting (Residue)
  const c = upCost(t);
  G.money -= c; t.spent += c; t.lvl++;
  if (quiet) return;
  sfxFor("up", t.kind);
  ring(t.x, t.y, 64, TOWERS[t.kind].color); refreshPanels();
}

// The tower an upgrade option WOULD make: one level up, with the chosen path
// or final form applied when this step needs one.
function nextTower(t, choice) {
  const need = pendingChoice(t);
  return { ...t, lvl: t.lvl + 1, path: need === "path" ? choice : t.path, form: need === "form" ? choice : t.form,
    skills: need === "skill" ? withSkill(t, choice) : t.skills };
}
// the tower card itself (inspectTower) lives in aspira-sliders.js with its upgrade control
const SELL_ARM_MS = 2000;
// the card's CLOSE is the spend bar's button (owner; aspira-chooser.js showSpend)
const closeCard = () => { ui.sel = null; refreshPanels(); };
// a tap on something the credits cannot cover flashes its cost red and shakes
// it (owner), instead of the button just sitting greyed out
// cost (optional): also SAY so (owner, 2026-10-07) - "need Nc more" on the
// button for NEED_MS, long enough to read, then gone
function noFunds(btn, cost) {
  if (cost != null) {
    const n = btn.querySelector(".asp-need") || btn.insertAdjacentElement("afterbegin", document.createElement("div"));
    n.className = "asp-need"; n.innerHTML = "need " + cr(short(Math.ceil(cost - G.money))) + " more";
    clearTimeout(btn.needT); btn.needT = setTimeout(() => n.remove(), NEED_MS);
  }
  btn.classList.remove("asp-nofunds"); void btn.offsetWidth; // restart the animation
  btn.classList.add("asp-nofunds");
  // ...and only for the shake: the red must not stick (owner saw it stay red).
  // A timer, not animationend, which a backgrounded or throttled tab may never fire
  clearTimeout(btn.nofundsT);
  btn.nofundsT = setTimeout(() => btn.classList.remove("asp-nofunds"), NOFUNDS_MS);
}
const NOFUNDS_MS = 450, NEED_MS = 1600; // the shake's 0.4s, and a little; the "need" note

// the upgrade chooser lives in aspira-chooser.js

// Only what is needed is shown (owner): a selected tower's stats in a popup
// pinned beside it (placePop re-anchors it every frame), and, while placing,
// one line about the tower being placed just above the build bar.
// the four build buttons flash until the first tower is placed (owner)
function flashBuild() {
  $("asp-build").classList.toggle("asp-flash", !G.started && !G.towers.length);
  // every slot taken: the build buttons go (owner), and so does any half-made pick
  const full = G.towers.length >= openCells(); // a corner slot opening brings them back
  // HIDDEN, not removed: the title under them keeps its place (owner)
  $("asp-build").style.visibility = full ? "hidden" : "";
  if (full && ui.build) { ui.build = null; $("asp-placing").hidden = true; }
}
// the game PAUSES while a card is open (owner, 2026-10-07; the build and
// upgrade choosers already did): the tower's or the core's card, and the pause
// the player had before it is put back when it closes
const cardPause = { on: false, was: false };
function refreshPanels() {
  flashBuild();
  const pop = $("asp-pop"), placing = $("asp-placing");
  const t = ui.sel && G.towers.find(x => x.id === ui.sel), core = ui.sel === "core";
  if ((t || core) && !cardPause.on) { cardPause.on = true; cardPause.was = ui.paused; ui.paused = true; }
  else if (!t && !core && cardPause.on) { cardPause.on = false; ui.paused = cardPause.was; }
  if (!t) { basket.id = null; basket.add = {}; } // a card closed without upgrading drops its pulled points (owner): the sliders reopen at the locked tiers (aspira-sliders.js)
  pop.hidden = !t && !core;
  pop.dataset.kind = core ? "core" : t ? t.kind : ""; // the card takes the tower's colour (aspira.css)
  pop.classList.toggle("asp-tower", !!t); $("asp").classList.toggle("asp-towercard", !!t); // the two-half tower card, and its wide-screen width (aspira.css)
  if (t) { inspectTower(pop, t); pop.__fitDirty = true; placePop(); }
  if (core) { inspectCore(pop); placePop(); }
  // the spend bar: the chooser owns it while open, else the open card's next buy
  if (!chooser.t) {
    if (t) showSpend(hasSkills(t) ? (basketPoints(t) ? basketCost(t) : null) : t.lvl >= maxLvl(t) ? null : upCost(t), "close", closeCard, t.kind); // a chart tower offers its basket
    else if (core) showSpend(null, "close", closeCard, "core") // the core is never bought (aspira-core.js);
    else hideSpend();
  }
  // while placing, a small card above the credits (owner): the tower's name,
  // cost and TAGLINE only - no stats
  placing.hidden = !ui.build;
  if (ui.build) {
    const k = ui.build, b = TOWERS[k];
    placing.dataset.kind = k;
    placing.innerHTML = '<div class="name">' + b.name + " · " + cr(towerCost(k)) + "</div>" + '<p class="asp-hint">' + b.blurb +
      " Good against " + GOOD_VS[k] + ".</p>"; // what it counters (owner)
  }
}

let lastNote = "", waveListAt = 0, hudAt = 0;
function updateHud() {
  updateSpend(); // the spend bar's credits (aspira-chooser.js)
  updatePowers(); // the core powers' buttons above the title (aspira-powers.js)
  { const h = bossHint(); if ($("asp-bosshint").textContent !== h) $("asp-bosshint").textContent = h; } // the boss's haiku above the title
  setText($("asp-lives"), G.lives);
  setText($("asp-int"), (G.interest * 100).toFixed(1) + "%");
  setText($("asp-wave"), G.wave); // the HUD keeps Arabic numerals (owner); the upcoming-wave list is Roman
  updateAutoWait();
  // BEST is the furthest WAVE reached (owner: no one cares about score; the score
  // still counts underneath, it is what pays the extra lives - addScore)
  setText($("asp-best"), Math.max(best.wave || 0, G.wave));
  flashBuild();
  for (const k of KINDS) {
    const btn = $("asp-tw-" + k);
    btn.classList.toggle("poor", G.money < towerCost(k) && ui.build !== k); // tappable: a tap flashes the cost
    setHtml(btn.querySelector(".c"), cr(short(towerCost(k))));
    btn.classList.toggle("on", ui.build === k);
  }
  // the upcoming-wave list (aspira-wavelist.js), 4x a second: rebuilding its
  // HTML every frame was a visible share of a late-game frame (2026-10-05)
  if (!(performance.now() < waveListAt)) { waveListAt = performance.now() + 250; updateWaveList(); }
  // THE SPIRE becomes ASCENDANT once the game has been beaten (owner), and stays so
  setText(document.querySelector(".asp-title"), best.ascended ? "ascendant" : "the spire");
  $("asp-sp-pause").classList.toggle("on", ui.paused);
  const mute = $("asp-mute");
  if (mute.dataset.muted !== String(muted)) { // redraw the icon only when it changes
    mute.dataset.muted = String(muted); mute.innerHTML = muted ? ICON_MUTED : ICON_SOUND;
    mute.setAttribute("aria-label", muted ? "sound off" : "sound on"); mute.title = mute.getAttribute("aria-label");
  }
  for (const v of SPEEDS) $(speedId(v)).classList.toggle("on", !ui.paused && (freezing() ? 1 : ui.speed) === v); // a freeze lights 1x while it holds
  const up = $("asp-up"), t = ui.sel && G.towers.find(x => x.id === ui.sel);
  if (up && t) { const poor = hasSkills(t) ? basketPoints(t) > 0 && G.money < basketCost(t) : t.lvl < maxLvl(t) && G.money < upCost(t); up.classList.toggle("poor", poor); if (hasSkills(t)) up.disabled = poor || !basketPoints(t); } // income may bring a pulled basket within reach; greyed with nothing pulled
  if (t && hasSkills(t)) refreshHandleFlash(t); // the sliders flash while the bank covers a point (aspira-sliders.js)
  // the core's one-click options follow the money too (aspira-core.js)
  for (const btn of document.querySelectorAll("#asp-pop [data-cost]")) btn.disabled = G.money < Number(btn.dataset.cost);
  for (const c of document.querySelectorAll(".asp-build-cards .asp-card")) c.classList.toggle("poor", G.money < Number(c.dataset.cost)); // faint red (aspira.css)
  // the open popup's tallies update live
  if (t && $("asp-kills")) setText($("asp-kills"), (t.kills || 0) + " · " + short(Math.round(t.dealt || 0)) + " dealt");
}


// the tower's / core's card sits BOTTOM CENTRE and stays there (owner: it no
// longer follows the tower, which now moves); where it would cover the wave
// list or the build buttons it lifts above whichever it overlaps
// how far above the board's bottom a centred box of width w must sit to clear
// the wave list and build buttons beneath it (the tower card and the upgrade
// cards share it, so they sit in the same place - owner)
const CARD_GAP = 8;
function cardLift(w) {
  const cr = cv.getBoundingClientRect(), x = Math.max(CARD_GAP, (cr.width - w) / 2);
  let lift = CARD_GAP;
  for (const sel of [".asp-left", ".asp-buildcol", ".asp-foot"]) { // the build buttons + the title under them
    const r = document.querySelector(sel).getBoundingClientRect();
    if (!r.height || r.right - cr.left <= x || r.left - cr.left >= x + w) continue; // beside it, not under it
    lift = Math.max(lift, cr.bottom - r.top + CARD_GAP);
  }
  return { x, lift };
}
const POP_MIN_H = 160, CHART_MIN = 140, CHART_FLOOR = 80, TOWER_CARD_H = 520; // the chart's floor: the triangle is the card's focus (owner); CHART_FLOOR only when the WINDOW itself is too short
const towerWide = () => matchMedia("(orientation: landscape) and (min-width: 700px)").matches; // the two-half card (aspira.css)
// fit the card to `room` WITHOUT scrolling (owner): wide, the chart fills its
// half's height (aspira.css) and the card stands TOWER_CARD_H tall when the room
// allows; stacked, the chart is shrunk until the card fits, and at the chart's
// floor the card grows past the bar rather than clip. Runs when the content or
// the room changed, not every frame
// winRoom: from the card's highest top to the window's bottom
function fitPop(pop, room, winRoom) {
  pop.__fitRoom = room; pop.__fitDirty = false;
  pop.style.maxHeight = room + "px";
  const chart = pop.querySelector(".asp-chart");
  pop.style.minHeight = ""; // (a forced TOWER_CARD_H left empty bands - owner)
  if (!chart) return;
  chart.style.width = "";
  if (towerWide()) return;
  // narrowing the chart by the overflow does not cut the card by as much (labels, gaps): iterate
  const shrink = floor => {
    for (let i = 0; i < 6; i++) {
      const over = pop.scrollHeight - pop.clientHeight;
      if (over <= 0) return true;
      const w = chart.getBoundingClientRect().width, nw = Math.max(floor, w - over);
      if (nw >= w) return false;
      chart.style.width = nw + "px";
    }
    return pop.scrollHeight <= pop.clientHeight;
  };
  if (shrink(CHART_MIN)) return;
  // at the chart's floor and still over the room: the card runs past the bar rather than
  // clip, but never past the WINDOW - against the window the chart may go down to CHART_FLOOR
  pop.style.maxHeight = Math.max(room, winRoom) + "px";
  shrink(CHART_FLOOR);
}
function placePop() {
  const pop = $("asp-pop");
  if (pop.hidden) return;
  const { x } = cardLift(pop.offsetWidth);
  // ...but never up over the speed row (a short phone: it then sits over the wave list)
  const cr = cv.getBoundingClientRect(), top = document.querySelector(".asp-head").getBoundingClientRect().bottom - cr.top + CARD_GAP + CRED_ROOM; // room for the credits above
  // CENTRED between that and the bottom bar less the close button's room (owner, 2026-10-07)
  // the tower card carries its own cancel / close (aspira-sliders.js), so the spend bar's
  // button under it is hidden (aspira.css) and its room (BTN_ROOM) goes to the card
  const bottom = cr.height - spendRoom() + (pop.classList.contains("asp-tower") ? BTN_ROOM : 0);
  // a short screen: the card is CAPPED to that room and NEVER scrolls (owner,
  // 2026-10-07) - the chart gives way instead (fitPop), so the buttons stay on screen
  const room = Math.max(POP_MIN_H, bottom - top);
  if (pop.__fitRoom !== room || pop.__fitDirty) fitPop(pop, room, cr.height - top - CARD_GAP);
  const h2 = pop.offsetHeight; // after the fit
  pop.style.left = x + "px"; pop.style.top = Math.max(top, (top + bottom - h2) / 2) + "px";
  placeCred(); // the credits ride above the card (aspira-chooser.js)
}

// U: lock the pulled points in (a chart tower) or open the upgrade chooser
function keyUpgrade(t) { if (!t) return; if (hasSkills(t)) lockIn(t); else openChooser(t); }

// ---------- overlay ----------
function showOverlay(title, body, btn) {
  setText($("asp-ov-title"), title); setText($("asp-ov-text"), body); setText($("asp-ov-btn"), btn);
  $("asp-ov").hidden = false;
}
$("asp-spend-btn").onclick = () => { if (spend.onClose) spend.onClose(); }; // the spend bar's cancel / close (aspira-chooser.js)
$("asp-ov-btn").onclick = () => {
  if (G.over) { G = newGame(); fx = []; dmgLive = []; ui.sel = null; ui.build = null; refreshPanels(); }
  // no intro (owner): the overlay is only the game-over card; the first tower starts wave 1
  $("asp-ov").hidden = true;
};

document.addEventListener("keydown", ev => {
  if (ev.target.closest("input, textarea, [contenteditable]")) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  // the chooser is open: only a card choice gets through (1-3)
  if (chooser.t) {
    if (["1", "2", "3", "4"].includes(ev.key)) chooseUpgrade(Number(ev.key) - 1);
    else if (ev.key === "Escape") closeChooser();
    ev.preventDefault(); return;
  }
  if (["1", "2", "3"].includes(ev.key)) { ui.speed = Number(ev.key); ui.paused = false; }
  else if (ev.key === "m" || ev.key === "M") setMuted(!muted);
  else if (ev.key === " ") { ev.preventDefault(); ui.paused = !ui.paused; }
  else if (ev.key === "u" || ev.key === "U") keyUpgrade(ui.sel && G.towers.find(x => x.id === ui.sel));
  else if (ev.key === "Escape") { ui.build = null; ui.sel = null; refreshPanels(); }
});

// ---------- loop ----------
// FPS for the HUD: frames counted over half-second windows, not per frame,
// so the number is readable rather than a flicker.
const fps = { frames: 0, since: performance.now() };
function tickFps(now) {
  fps.frames++;
  if (now - fps.since >= 500) {
    setText($("asp-fps"), Math.round(fps.frames * 1000 / (now - fps.since)));
    fps.frames = 0; fps.since = now;
  }
}

// while the TEMPORAL DRIVE's freeze runs the game plays at 1x, whatever the speed setting (owner,
// 2026-10-08: "during time freeze, temporarily set speed to 1x"); the setting itself is kept
const freezing = () => timeStopped();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!ui.paused) {
    let left = dt * SPEED_MULT[freezing() ? 1 : Math.min(autoWaiting() || Infinity, ui.speed)]; // auto-wait only ever SLOWS; a time freeze runs at 1x
    while (left > 0) { const h = Math.min(0.02, left); step(h); stepFx(h); left -= h; }
    stepFloats(dt); // real time: unaffected by the game speed
  }
  // while the upgrade cards are up the board is paused AND frozen: no redraw,
  // so its CSS blur (aspira.css .asp-choosing) is computed once, not per frame
  if (!chooser.t) { if (q3d()) { warpRender(); warpDraw(); } else render(); } // 3D lays the frame, drawn to fit the whole board, on the spire (aspira-warp.js)
  // the HUD's text and buttons 10x a second, not every frame (perf, 2026-10-05)
  if (!(now < hudAt)) { hudAt = now + 100; updateHud(); syncBlinks(); }
  placePop(); tickFps(now);
  // while a boss lives the board draws inverted (render, bossSkyStep); the HTML over it
  // flips too once the inversion fills the screen, so it stays readable
  $("asp").classList.toggle("asp-boss", bossInv.full);
  requestAnimationFrame(frame);
}

resolveColors();
resize();
refreshPanels();
requestAnimationFrame(t => { last = t; frame(t); });
