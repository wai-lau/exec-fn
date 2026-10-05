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
  return { x: ((ev.clientX - r.left) * dpr - cam.ox) / cam.k, y: ((ev.clientY - r.top) * dpr - cam.oy) / cam.k };
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
function onTap(ev) {
  if (G.over) return;
  const p = toWorld(ev);
  ui.hover = p;
  // a tower is tapped where it IS now (it may have slid out along its spoke)
  const ci = cellAt(p.x, p.y), hit = towerAt(p) || (ci >= 0 && G.towers.find(t => t.cell === ci)) || (!ui.build && trackAt(p));
  if (hit) { ui.sel = hit.id; ui.build = null; }
  else if (!ui.build && Math.hypot(p.x - CX, p.y - CY) <= CORE_R) { ui.sel = "core"; } // the core's card (aspira-core.js)
  else if (ui.build) placeTower(p);
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
  if (ui.build !== k && G.money < towerCost(k)) { noFunds($("asp-tw-" + k)); return; }
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
const autoWaiting = () => {
  if (!autoWait || ui.paused) return 0;
  let eta = Infinity;
  for (const e of G.enemies) if (!e.dead) eta = Math.min(eta, etaToCore(e));
  return eta <= AUTO_WAIT_S / 2 ? 0.25 : eta <= AUTO_WAIT_S ? 0.5 : 0;
};
(function autoWaitBox() {
  const row = document.createElement("div");
  row.className = "asp-row asp-autowait";
  $("asp-speed").after(row);
  const btn = button(row, "asp-check", "", () => {
    autoWait = !autoWait;
    try { localStorage.setItem("spire.autowait", autoWait ? "1" : "0"); } catch (e) { /* not remembered */ }
  }, "asp-autowait");
  btn.setAttribute("role", "checkbox");
})();
function updateAutoWait() {
  const btn = $("asp-autowait"), html = '<span class="asp-box">' + (autoWait ? "☑" : "☐") + "</span> auto-wait"; // the box bigger than the words (owner)
  if (btn.dataset.html !== html) { btn.dataset.html = html; btn.innerHTML = html; btn.setAttribute("aria-checked", String(autoWait)); }
  btn.classList.toggle("on", autoWaiting()); // lit while it is holding the game at 1/2x
}

// the sound toggle is an ICON (owner: was "sound on"/"sound off"): a speaker
// with waves, or crossed out
const ICON_SOUND = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
button($("asp-speed"), "", "", () => setMuted(!muted), "asp-mute");
// volume slider: VERTICAL, top-right (owner; was beside the sound toggle) - a
// plain range input turned -90deg in its own box (.asp-volbox), up = louder
(function volumeSlider() {
  const s = document.createElement("input");
  Object.assign(s, { type: "range", id: "asp-vol", min: 0, max: 2, step: 0.05, value: volume, title: "volume" });
  s.setAttribute("aria-label", "volume");
  s.oninput = () => { setVolume(Number(s.value)); if (muted && Number(s.value) > 0) setMuted(false); };
  const box = document.createElement("div");
  box.className = "asp-volbox";
  box.appendChild(s);
  $("asp").appendChild(box);
})();

// SOL's form, in one short line for the popup (the same row at every level, so
// the next-level preview lines up)
function rayForm(st) {
  if (st.critScale) return "crit chance ×" + st.critScale;
  if (st.ricochet) return "chains to " + st.ricochet;
  if (st.smash) return "kill bursts " + Math.round(st.smash.frac * 100) + "% r" + st.smash.r;
  if (st.beams > 2) return st.beams + " beams";
  return "—";
}
// The popup's RIGHT column (owner): stats only that tower type has, as
// [label, value] rows, computed for a level so the next one can be previewed.
const SPEC = {
  chain: st => {
    const tree = [1]; for (let l = 1; l <= st.layers; l++) tree.push(st.branch ** l);
    return [["Hits", tree.join("→")], ["Arc dmg", Math.round(st.dmg * st.arcFall)],
      ["Arc hop", Math.round(st.arcRange)], ["Reach", Math.round(chainReach(st))], ["Delay", hopDelay(st).toFixed(2) + "s"]];
  },
  slower: st => [["Slow", Math.round(st.slow * 100) + "%"], ["Lasts", st.permafrost ? "forever" : SLOW_TIME.toFixed(1) + "s"],
    ["Targets", st.all ? "all" : st.targets], ["Shields", "−1 / pulse"],
    ["Shatter", st.shatter ? Math.round(st.dmg * st.shatter.mul) + " r" + st.shatter.r : "—"],
    ["Extra", st.frostbite ? "blast slows " + st.frostbite + "s" : st.brittle ? "+" + Math.round((st.brittle - 1) * 100) + "% taken"
      : st.chillStop ? "95% for " + st.chillStop + "s" : "—"]],
  acid: st => [["Burn", Math.round(st.dmg) + "/s"], ["Ramp", "×2 / " + st.double + "s"],
    ["Max", "×" + st.cap + " (" + Math.round(st.dmg * st.cap) + "/s)"], ["Lines", st.allInRange ? "all in range" : st.targets],
    ["Circle", st.plagueR ? Math.round(st.plagueR) + (st.bloom ? "→" + Math.round(st.plagueR * st.bloom) : "") : "—"],
    ["Armor", st.corrode ? "−" + st.corrode + " / tick" : "—"], ["Shields", "−1 / tick"]],
  reaper: st => [["Crit", Math.round(st.crit * 100) + "%"], ["Crit ×", st.critMul], ["Locks", st.targets],
    ["Beams", st.beams || 1], ["Bleed", st.bleedArmor ? "−" + st.bleedArmor + " armor, +" + Math.round(st.bleedCrit * 100) + "% crit / hit" : "—"],
    ["Armor", "ignored"], ["Form", rayForm(st)]],
};

// One stat row: "now" alone at max level, "now -> next" when an upgrade
// would change it, so the payoff of the upgrade is visible before buying it.
// A change for the WORSE shows red and bold (owner): compared on the last
// number in each value, lower-is-better for the rows in LOWER_BETTER, and a
// number giving way to "—" (a stat the upgrade removes) counts as worse.
const LOWER_BETTER = new Set(["Delay", "Ramp"]);
function lastNum(v) { const m = String(v).match(/\d+(\.\d+)?/g); return m ? Number(m[m.length - 1]) : NaN; }
function worse(label, now, next) {
  const a = lastNum(now), b = lastNum(next);
  if (isNaN(b)) return !isNaN(a) && String(next) === "—";
  return !isNaN(a) && (LOWER_BETTER.has(label) ? b > a : b < a);
}
function statRow(label, now, next) {
  const cls = next !== null && worse(label, now, next) ? "asp-next asp-worse" : "asp-next";
  const arrow = next !== null && next !== now ? ' <span class="' + cls + '">→ ' + next + "</span>" : "";
  return "<dt>" + label + "</dt><dd>" + now + arrow + "</dd>";
}

// choice: the path (at level 5) or final form (at level 10) being bought;
// those two upgrades cannot happen without one
function upgradeTower(t, choice = null) {
  if (!t || t.lvl >= MAX_LVL || G.money < upCost(t)) return;
  const need = pendingChoice(t);
  if (need && choice == null) return;
  if (need === "path") t.path = choice;
  if (need === "form") { t.form = choice; t.mode = UPGRADES[t.kind][t.path].finals[choice].mode || t.mode; } // a form may set targeting (Residue)
  const c = upCost(t);
  G.money -= c; t.spent += c; t.lvl++;
  sfxFor("up", t.kind);
  ring(t.x, t.y, 64, TOWERS[t.kind].color); refreshPanels();
}

// The tower an upgrade option WOULD make: one level up, with the chosen path
// or final form applied when this step needs one.
function nextTower(t, choice) {
  const need = pendingChoice(t);
  return { ...t, lvl: t.lvl + 1, path: need === "path" ? choice : t.path, form: need === "form" ? choice : t.form };
}
function inspectTower(el, t) {
  const b = TOWERS[t.kind], maxed = t.lvl >= MAX_LVL, st = towerStats(t);
  el.innerHTML =
    '<div class="name">' + towerTitle(t) + " · L" + t.lvl + " of " + MAX_LVL + "</div>" +
    '<p class="asp-hint">' + b.blurb + "</p>" + // the tagline under the title (owner)
    // two columns (owner): what every tower has | what only this type has
    '<div class="asp-cols"><dl>' + (b.dmg ? statRow("Damage", Math.round(st.dmg), null) : "") +
    statRow("Range", Math.round(st.range), null) + statRow("Rate", st.rate.toFixed(2) + "/s", null) +
    // compact for the phone (owner): kills and damage dealt share ONE row, and
    // stats this tower does not have yet ("—") are left out
    '<dt>Kills</dt><dd id="asp-kills"></dd></dl>' +
    '<dl class="asp-spec">' + SPEC[t.kind](st, t).filter(r => r[1] !== "—").map(r => statRow(r[0], r[1], null)).join("") + "</dl></div>" +
    // upgrade, then sell, then the targeting - SMALL, under sell (owner)
    '<div class="asp-row" id="asp-upbox"></div><div class="asp-row" id="asp-acts"></div>' +
    '<div class="asp-prio">Priority:</div><div class="asp-row asp-modes" id="asp-modes"></div>';
  MODES.forEach(([m, label]) => {
    button($("asp-modes"), t.mode === m ? "on" : "", label, () => { t.mode = m; refreshPanels(); });
  });
  // the upgrade button opens the card chooser
  button($("asp-upbox"), "asp-primary asp-up-big",
    maxed ? "max level" : "upgrade → L" + (t.lvl + 1) + " · " + cr(upCost(t)), () => openChooser(t), "asp-up").disabled = maxed;
  // SELL sits last, away from the often-tapped rows, and takes TWO taps (owner):
  // the first arms it for SELL_ARM_MS, the second sells
  const label = "sell · " + cr(sellValue(t)), sell = button($("asp-acts"), "asp-sell", label, () => {
    if (!sell.classList.contains("armed")) {
      sell.classList.add("armed"); sell.innerHTML = "tap again to sell · " + cr(sellValue(t));
      setTimeout(() => { if (sell.isConnected) { sell.classList.remove("armed"); sell.innerHTML = label; } }, SELL_ARM_MS);
      return;
    }
    G.money += sellValue(t); G.towers = G.towers.filter(x => x !== t); ui.sel = null;
    sfx("sell"); refreshPanels();
  });
}
const SELL_ARM_MS = 2000;
// a tap on something the credits cannot cover flashes its cost red and shakes
// it (owner), instead of the button just sitting greyed out
function noFunds(btn) {
  btn.classList.remove("asp-nofunds"); void btn.offsetWidth; // restart the animation
  btn.classList.add("asp-nofunds");
  // ...and only for the shake: the red must not stick (owner saw it stay red).
  // A timer, not animationend, which a backgrounded or throttled tab may never fire
  clearTimeout(btn.nofundsT);
  btn.nofundsT = setTimeout(() => btn.classList.remove("asp-nofunds"), NOFUNDS_MS);
}
const NOFUNDS_MS = 450; // the shake's 0.4s, and a little

// the upgrade chooser lives in aspira-chooser.js

// Only what is needed is shown (owner): a selected tower's stats in a popup
// pinned beside it (placePop re-anchors it every frame), and, while placing,
// one line about the tower being placed just above the build bar.
// the four build buttons flash until the first tower is placed (owner)
function flashBuild() {
  $("asp-build").classList.toggle("asp-flash", !G.started && !G.towers.length);
  // every slot taken: the build buttons go (owner), and so does any half-made pick
  const full = G.towers.length >= openCells(); // a corner slot opening brings them back
  $("asp-build").style.display = full ? "none" : "";
  if (full && ui.build) { ui.build = null; $("asp-placing").hidden = true; }
}
function refreshPanels() {
  flashBuild();
  const pop = $("asp-pop"), placing = $("asp-placing");
  const t = ui.sel && G.towers.find(x => x.id === ui.sel), core = ui.sel === "core";
  pop.hidden = !t && !core;
  pop.dataset.kind = core ? "core" : t ? t.kind : ""; // the card takes the tower's colour (aspira.css)
  if (t) { inspectTower(pop, t); placePop(); }
  if (core) { inspectCore(pop); placePop(); }
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
  for (const v of SPEEDS) $(speedId(v)).classList.toggle("on", !ui.paused && ui.speed === v);
  const up = $("asp-up"), t = ui.sel && G.towers.find(x => x.id === ui.sel);
  if (up && t) up.classList.toggle("poor", t.lvl < MAX_LVL && G.money < upCost(t));
  // the core's one-click options follow the money too (aspira-core.js)
  for (const btn of document.querySelectorAll("#asp-pop [data-cost]")) btn.disabled = G.money < Number(btn.dataset.cost);
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
  for (const sel of [".asp-left", ".asp-buildcol"]) { // the build buttons + the title under them
    const r = document.querySelector(sel).getBoundingClientRect();
    if (!r.height || r.right - cr.left <= x || r.left - cr.left >= x + w) continue; // beside it, not under it
    lift = Math.max(lift, cr.bottom - r.top + CARD_GAP);
  }
  return { x, lift };
}
function placePop() {
  const pop = $("asp-pop");
  if (pop.hidden) return;
  const h = pop.offsetHeight, { x, lift } = cardLift(pop.offsetWidth);
  // ...but never up over the speed row (a short phone: it then sits over the wave list)
  const cr = cv.getBoundingClientRect(), top = document.querySelector(".asp-controls").getBoundingClientRect().bottom - cr.top + CARD_GAP;
  pop.style.left = x + "px"; pop.style.top = Math.max(top, cr.height - h - lift) + "px";
}

// U: open the upgrade chooser for the selected tower
function keyUpgrade(t) { openChooser(t); }

// ---------- overlay ----------
function showOverlay(title, body, btn) {
  setText($("asp-ov-title"), title); setText($("asp-ov-text"), body); setText($("asp-ov-btn"), btn);
  $("asp-ov").hidden = false;
}
$("asp-ov-btn").onclick = () => {
  if (G.over) { G = newGame(); fx = []; ui.sel = null; ui.build = null; refreshPanels(); }
  // no intro (owner): the overlay is only the game-over card; the first tower starts wave 1
  $("asp-ov").hidden = true;
};

document.addEventListener("keydown", ev => {
  if (ev.target.closest("input, textarea, [contenteditable]")) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  // the chooser is open: only a card choice gets through (1-3)
  if (chooser.t) {
    if (["1", "2", "3"].includes(ev.key)) chooseUpgrade(Number(ev.key) - 1);
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

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!ui.paused) {
    let left = dt * SPEED_MULT[Math.min(autoWaiting() || Infinity, ui.speed)]; // auto-wait only ever SLOWS
    while (left > 0) { const h = Math.min(0.02, left); step(h); stepFx(h); left -= h; }
    stepFloats(dt); // real time: unaffected by the game speed
  }
  // while the upgrade cards are up the board is paused AND frozen: no redraw,
  // so its CSS blur (aspira.css .asp-choosing) is computed once, not per frame
  if (!chooser.t) render();
  // the HUD's text and buttons 10x a second, not every frame (perf, 2026-10-05)
  if (!(now < hudAt)) { hudAt = now + 100; updateHud(); }
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
