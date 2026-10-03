// /aspira — DOM: HUD, build/inspect/power decks, input, overlay, main loop.

// ui.speed is a setting (0.5/1/2/3); SPEED_MULT turns it into simulation rate.
// 1x is REAL TIME (owner): every rate/duration in the code is in real seconds.
// the old 2x is the new 1x (owner, 2026-10-02): every button runs the game
// twice as fast as its label used to (0.5x added, 10x for testing - owner)
const BASE_SPEED = 2;
const SPEED_MULT = { 0.5: 0.5 * BASE_SPEED, 1: BASE_SPEED, 2: 2 * BASE_SPEED, 3: 3 * BASE_SPEED, 10: 10 * BASE_SPEED };
const SPEEDS = [0.5, 1, 2, 3, 10], speedId = v => "asp-sp-" + String(v).replace(".", "_");
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
  return ci >= 0 && !occupied(ci);
}
function toWorld(ev) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  return { x: ((ev.clientX - r.left) * dpr - cam.ox) / cam.k, y: ((ev.clientY - r.top) * dpr - cam.oy) / cam.k };
}
function placeTower(p) {
  const ci = snapCell(p.x, p.y);
  // a failed placement also ends placing mode, same as a successful one
  if (!canPlace(ci)) { float(p.x, p.y, "blocked", "pink"); ui.build = null; return; }
  const cost = towerCost(ui.build);
  if (G.money < cost) { float(p.x, p.y, "need " + cost, "pink"); ui.build = null; return; }
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
  const ci = cellAt(p.x, p.y), hit = towerAt(p) || (ci >= 0 && G.towers.find(t => t.cell === ci));
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
[["pause", "pause"], [0.5, "½×"], [1, "1×"], [2, "2×"], [3, "3×"], [10, "10×"]].forEach(([v, label]) => {
  button($("asp-speed"), "", label, () => {
    if (v === "pause") ui.paused = !ui.paused; else { ui.speed = v; ui.paused = false; }
  }, v === "pause" ? "asp-sp-pause" : speedId(v));
});

// the sound toggle is an ICON (owner: was "sound on"/"sound off"): a speaker
// with waves, or crossed out
const ICON_SOUND = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
button($("asp-speed"), "", "", () => setMuted(!muted), "asp-mute");
// volume slider beside the sound toggle (owner)
(function volumeSlider() {
  const s = document.createElement("input");
  Object.assign(s, { type: "range", id: "asp-vol", min: 0, max: 2, step: 0.05, value: volume, title: "volume" });
  s.setAttribute("aria-label", "volume");
  s.oninput = () => { setVolume(Number(s.value)); if (muted && Number(s.value) > 0) setMuted(false); };
  $("asp-speed").appendChild(s);
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
    '<div class="asp-row" id="asp-modes"></div><div class="asp-row" id="asp-upbox"></div>' +
    '<div class="asp-row" id="asp-acts"></div>';
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
}

// ---------- the upgrade chooser ----------
// Upgrading (owner, 2026-10-02): the upgrade button opens CARDS - one per
// option at a branch (2-3 paths or forms), a single card for a plain step -
// each laid out like the tower's card with the stats it changes. Nothing is
// charged until a card is tapped; clicking outside (or Esc) just closes. The
// game pauses meanwhile. Keys 1-3 pick a card.
const chooser = { t: null, opts: [], wasPaused: false };
function upgradeOptions(t) {
  const need = pendingChoice(t);
  if (need) return (need === "path" ? UPGRADES[t.kind] : UPGRADES[t.kind][t.path].finals).map((o, i) => ({ choice: i, name: o.name, desc: o.desc }));
  if (t.lvl + 1 === MAX_LVL && t.form != null) {
    // the L4 step names the form's own super and says what it does
    const f = UPGRADES[t.kind][t.path].finals[t.form];
    return [{ choice: null, ...(f.super || { name: "Super " + f.name, desc: "a stronger " + f.name }) }];
  }
  return [{ choice: null }];
}
// one option's card, laid out like the tower's own card (owner): the tower it
// would make as the title, every stat in the two columns ("now -> next" where
// it changes), then the tagline
function upgradeCard(t, o, i) {
  const nt = nextTower(t, o.choice), st = towerStats(t), nx = towerStats(nt), b = TOWERS[t.kind];
  const spN = SPEC[t.kind](nx, nt);
  // only the stats this option CHANGES (owner), in the tower card's two columns
  const base = [["Range", Math.round(st.range), Math.round(nx.range)], ["Rate", st.rate.toFixed(2) + "/s", nx.rate.toFixed(2) + "/s"]];
  if (b.dmg) base.unshift(["Damage", Math.round(st.dmg), Math.round(nx.dmg)]);
  const spec = SPEC[t.kind](st, t).map((r, k) => [r[0], r[1], spN[k][1]]);
  const changed = rows => rows.filter(r => String(r[1]) !== String(r[2])).map(r => statRow(r[0], r[1], r[2])).join("");
  return '<div class="name">' + (chooser.opts.length > 1 ? i + 1 + " · " : "") + towerTitle(nt) + " · L" + nt.lvl + " of " + MAX_LVL + "</div>" +
    (o.desc ? '<p class="asp-hint">' + o.desc + "</p>" : "") + // the tagline under the title (owner)
    '<div class="asp-cols"><dl>' + changed(base) + "</dl>" + (changed(spec) ? '<dl class="asp-spec">' + changed(spec) + "</dl>" : "") + "</div>";
}
function chooserEl() {
  let el = $("asp-chooser");
  if (!el) {
    el = document.createElement("div");
    el.id = "asp-chooser"; el.className = "asp-ov asp-chooser"; el.hidden = true;
    el.onclick = ev => { if (!ev.target.closest(".asp-card")) closeChooser(); }; // click out = cancel
    $("asp-ov").parentNode.appendChild(el);
  }
  return el;
}
function openChooser(t) {
  if (!t || t.lvl >= MAX_LVL) return;
  if (G.money < upCost(t)) { noFunds($("asp-up")); return; }
  const opts = upgradeOptions(t);
  const el = chooserEl();
  chooser.t = t; chooser.opts = opts;
  chooser.wasPaused = ui.paused; ui.paused = true;
  el.dataset.kind = t.kind;
  // one small solid line, not a big heading (owner, phone-first: the heading
  // overlapped the tower card behind) - the cards' own titles name the upgrade
  el.innerHTML = '<p class="asp-chooser-cost">upgrade · ' + cr(upCost(t)) + (opts.length > 1 ? " · choose one" : "") + "</p>" + '<div class="asp-cards"></div>';
  const row = el.querySelector(".asp-cards");
  opts.forEach((o, i) => button(row, "asp-card", upgradeCard(t, o, i), () => chooseUpgrade(i)));
  button(el, "asp-cancel", "cancel", closeChooser); // the same as clicking off the cards (owner)
  // ONE line (owner): side by side if they all fit across, else one column
  el.hidden = false;
  // measured once shown (a hidden element has no width)
  row.classList.toggle("asp-cards-col", opts.length * CARD_W + (opts.length - 1) * 16 > el.clientWidth - 32);
  // at the bottom, lifted exactly like the tower card (cardLift), and never up
  // into the HUD: the top stops below the speed row (the cards scroll instead)
  el.style.paddingBottom = cardLift(row.offsetWidth).lift + "px";
  el.style.paddingTop = Math.max(8, document.querySelector(".asp-controls").getBoundingClientRect().bottom - el.getBoundingClientRect().top + 8) + "px";
  $("asp").classList.add("asp-choosing"); // the board blurs and darkens beneath (aspira.css)
}
const CARD_W = 380; // .asp-card's width (aspira.css)
// close the cards (nothing was charged); a pick pays through upgradeTower
function closeChooser() {
  if (!chooser.t) return;
  chooser.t = null;
  $("asp-chooser").hidden = true; ui.paused = chooser.wasPaused;
  $("asp").classList.remove("asp-choosing");
}
function chooseUpgrade(i) {
  const o = chooser.opts[i], t = chooser.t;
  if (!o || !t) return;
  closeChooser();
  upgradeTower(t, o.choice);
}

// Only what is needed is shown (owner): a selected tower's stats in a popup
// pinned beside it (placePop re-anchors it every frame), and, while placing,
// one line about the tower being placed just above the build bar.
// the four build buttons flash until the first tower is placed (owner)
function flashBuild() {
  $("asp-build").classList.toggle("asp-flash", !G.started && !G.towers.length);
  // every slot taken: the build buttons go (owner), and so does any half-made pick
  const full = G.towers.length >= CELLS.length;
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

// the enemy itself (owner): the same polygon the board draws (poly() in
// aspira-draw.js), as a small inline SVG in the type's colour
function enemyIcon(type) {
  const d = ENEMIES[type], n = d.pointy ? d.sides * 2 : d.sides, pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n, r = d.pointy && i % 2 ? 3.6 : 8;
    pts.push((10 + Math.cos(a) * r).toFixed(1) + "," + (10 + Math.sin(a) * r).toFixed(1));
  }
  return '<svg class="asp-eicon" viewBox="0 0 20 20" aria-label="' + type + '"><polygon points="' + pts.join(" ") + '"/></svg>';
}
let lastNote = "";
function updateHud() {
  setText($("asp-lives"), G.lives);
  setText($("asp-int"), (G.interest * 100).toFixed(1) + "%");
  setText($("asp-wave"), G.wave);
  setText($("asp-score"), G.score.toLocaleString());
  setText($("asp-best"), Math.max(best.score, G.score).toLocaleString());
  flashBuild();
  for (const k of KINDS) {
    const btn = $("asp-tw-" + k);
    btn.classList.toggle("poor", G.money < towerCost(k) && ui.build !== k); // tappable: a tap flashes the cost
    setHtml(btn.querySelector(".c"), cr(short(towerCost(k))));
    btn.classList.toggle("on", ui.build === k);
  }
  // the next TEN waves under the send button, one per row (owner; waves are
  // fixed, so they are known): number : enemy x count, star. A grid
  // keeps the ":" in one column down the middle.
  let note = "", prev = G.lastType;
  for (let i = 1; i <= 10; i++) {
    const n = G.wave + i, w = wavePlan(n, prev);
    if (w.type !== "bonus") prev = w.type; // the boss wave does not break the alternation
    // five columns (owner): number : enemies, HP, NAME - HPs and names line
    // up down the list. A plain enemy is named by its type in lowercase; a
    // boss by its arcana (capitalised), its icon inverted as on its own sky.
    const boss = w.type === "bonus";
    note += "<span>" + n + "</span><span>:</span><span>" +
      '<b class="e-' + ENEMIES[w.type].color + (boss ? " e-boss" : "") + '">' + enemyIcon(w.type) + "×" + w.count + "</b></span>" +
      // each one's HP (owner), a boss's with its own multiplier
      "<span>" + short(enemyHp(w.type, n) * (boss ? BOSS_HP[arcanaOf(n).id] || 1 : 1)) + "hp</span>" +
      "<span>" + (boss ? arcanaOf(n).name : w.type) + "</span>";
  }
  // the time to the next wave, on its OWN line above the list (owner)
  const nextIn = $("asp-nextin") || (() => {
    const el = document.createElement("div");
    el.id = "asp-nextin"; el.className = "asp-nextin";
    $("asp-wavenote").before(el);
    return el;
  })();
  setText(nextIn, G.started && !bossUp() ? "next wave in " + Math.ceil(Math.max(0, G.nextIn)) + "s" : "");
  if (note !== lastNote) { $("asp-wavenote").innerHTML = note; lastNote = note; } // innerHTML re-reads normalised, so compare the source
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
  updateBossBar();
}

// a live BOSS gets an HP bar under the speed row (owner): its name and the
// HP left across every boss on the field (the Devil's six, the Lovers' two)
function updateBossBar() {
  let bar = $("asp-bossbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "asp-bossbar"; bar.className = "asp-bossbar"; bar.hidden = true;
    bar.innerHTML = '<span class="asp-bossname"></span><div class="asp-bar"><i></i></div>';
    document.querySelector(".asp-controls").after(bar);
  }
  const bosses = G.enemies.filter(e => e.arcana && !e.dead);
  bar.hidden = !bosses.length;
  if (!bosses.length) return;
  const hp = bosses.reduce((a, e) => a + Math.max(0, e.hp), 0), max = bosses.reduce((a, e) => a + e.max, 0);
  setText(bar.firstChild, arcanaOf(bosses[0].n).name + (bosses.length > 1 ? " ×" + bosses.length : ""));
  bar.querySelector("i").style.width = (100 * hp / max).toFixed(1) + "%";
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
  for (const sel of [".asp-left", "#asp-build"]) {
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
  // ...but never up over the speed row or the boss bar (a short phone: it then sits over the wave list)
  const cr = cv.getBoundingClientRect(), bar = $("asp-bossbar"), top = (bar && !bar.hidden ? bar : document.querySelector(".asp-controls")).getBoundingClientRect().bottom - cr.top + CARD_GAP;
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
    let left = dt * SPEED_MULT[ui.speed];
    while (left > 0) { const h = Math.min(0.02, left); step(h); stepFx(h); left -= h; }
    stepFloats(dt); // real time: unaffected by the game speed
  }
  // while the upgrade cards are up the board is paused AND frozen: no redraw,
  // so its CSS blur (aspira.css .asp-choosing) is computed once, not per frame
  if (!chooser.t) render();
  updateHud(); placePop(); tickFps(now);
  // while a boss lives the canvas inverts (drawBossInvert); the HTML over it
  // flips too once the inversion fills the screen, so it stays readable
  $("asp").classList.toggle("asp-boss", bossInv.full);
  requestAnimationFrame(frame);
}

resolveColors();
resize();
refreshPanels();
requestAnimationFrame(t => { last = t; frame(t); });
