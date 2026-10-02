// /aspira — DOM: HUD, build/inspect/power decks, input, overlay, main loop.

// ui.speed is a setting (0.5/1/2/3); SPEED_MULT turns it into simulation rate.
// 1x is REAL TIME (owner): every rate/duration in the code is in real seconds.
const SPEED_MULT = { 0.5: 0.5, 1: 1, 2: 2, 3: 3 }; // 0.5x added (owner)
const SPEEDS = [0.5, 1, 2, 3], speedId = v => "asp-sp-" + String(v).replace(".", "_");
const ui = { build: null, sel: null, hover: null, speed: 1, paused: false };
const $ = id => document.getElementById(id);
function setText(el, v) { v = String(v); if (el.textContent !== v) el.textContent = v; }
// big counts shorten so they never run into the tower buttons: 12345 stays,
// 123k, 4.0M
function short(n) {
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
  // every tower targets the closest by default (owner, 2026-10-02)
  const t = { id: G.id++, kind: ui.build, cell: ci, x: c.x, y: c.y, lvl: 1, cd: 0, mode: "close", spent: cost };
  G.towers.push(t);
  sfx("build");
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
  const ci = cellAt(p.x, p.y), hit = ci >= 0 && G.towers.find(t => t.cell === ci);
  if (hit) { ui.sel = hit.id; ui.build = null; }
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
function selectBuild(k) { ui.build = ui.build === k ? null : k; ui.sel = null; refreshPanels(); }

KINDS.forEach((k, i) => {
  const b = TOWERS[k];
  const btn = button($("asp-build"), "asp-tw " + b.color,
    '<span class="ab">' + b.ab + '</span><span class="c">' + b.cost + "</span>", () => selectBuild(k), "asp-tw-" + k);
  btn.title = b.name;
});
[["pause", "pause"], [0.5, "½×"], [1, "1×"], [2, "2×"], [3, "3×"]].forEach(([v, label]) => {
  button($("asp-speed"), "", label, () => {
    if (v === "pause") ui.paused = !ui.paused; else { ui.speed = v; ui.paused = false; }
  }, v === "pause" ? "asp-sp-pause" : speedId(v));
});
$("asp-send").onclick = sendWave;

button($("asp-speed"), "", "", () => setMuted(!muted), "asp-mute");

// SOL's form, in one short line for the popup (the same row at every level, so
// the next-level preview lines up)
function rayForm(st) {
  if (st.longshot) return "+" + Math.round(st.longshot * 100) + "% / 10u";
  if (st.splash) return Math.round(st.splash.frac * 100) + "% r" + st.splash.r;
  if (st.execute) return "kills <" + Math.round(st.execute * 100) + "%";
  if (st.bounce) return "bounce " + Math.round(st.bounce * 100) + "%";
  if (st.refund) return "refund " + Math.round(st.refund * 100) + "%";
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
    ["Shatter", st.shatter ? Math.round(st.shatter.frac * 100) + "% r" + st.shatter.r : "—"],
    ["Extra", st.frostbite ? "blast slows " + st.frostbite + "s" : st.brittle ? "+" + Math.round((st.brittle - 1) * 100) + "% taken"
      : st.chillStop ? "95% for " + st.chillStop + "s" : "—"]],
  acid: st => [["Burn", Math.round(st.dmg) + "/s"], ["Ramp", "×2 / " + st.double + "s"],
    ["Max", "×" + st.cap + " (" + Math.round(st.dmg * st.cap) + "/s)"], ["Lines", st.allInRange ? "all in range" : st.targets],
    ["Circle", st.plagueR ? Math.round(st.plagueR) + (st.bloom ? "→" + Math.round(st.plagueR * st.bloom) : "") : "—"],
    ["Armor", st.corrode ? "−" + st.corrode + " / tick" : "—"], ["Shields", "−1 / tick"]],
  reaper: st => [["Crit", Math.round(st.crit * 100) + "%"], ["Crit ×", st.critMul], ["Locks", st.targets],
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
  if (need === "form") t.form = choice;
  const c = upCost(t);
  G.money -= c; t.spent += c; t.lvl++; ui.pick = null;
  sfx("up");
  ring(t.x, t.y, 64, TOWERS[t.kind].color); refreshPanels();
}

// The tower an upgrade option WOULD make: one level up, with the chosen path
// or final form applied when this step needs one.
function nextTower(t, choice) {
  const need = pendingChoice(t);
  return { ...t, lvl: t.lvl + 1, path: need === "path" ? choice : t.path, form: need === "form" ? choice : t.form };
}
// Upgrading is TWO clicks (owner): picking an option (ui.pick) only previews
// its stat changes in the columns; the confirm button then buys it.
function pickUpgrade(t, choice) { ui.pick = { tid: t.id, choice }; refreshPanels(); }
function inspectTower(el, t) {
  const b = TOWERS[t.kind], maxed = t.lvl >= MAX_LVL;
  const pick = !maxed && ui.pick && ui.pick.tid === t.id ? ui.pick : null;
  const nt = pick && nextTower(t, pick.choice);
  const st = towerStats(t), nx = nt && towerStats(nt);
  const sp = SPEC[t.kind](st, t), spN = nx && SPEC[t.kind](nx, nt);
  el.innerHTML =
    '<div class="name">' + towerTitle(t) + " · L" + t.lvl + " of " + MAX_LVL + "</div>" +
    '<div id="asp-upbox"></div>' +
    // two columns (owner): what every tower has | what only this type has
    '<div class="asp-cols"><dl>' + (b.dmg ? statRow("Damage", Math.round(st.dmg), nx && Math.round(nx.dmg)) : "") +
    statRow("Range", Math.round(st.range), nx && Math.round(nx.range)) +
    statRow("Rate", st.rate.toFixed(2) + "/s", nx && nx.rate.toFixed(2) + "/s") +
    '<dt>Kills</dt><dd id="asp-kills"></dd><dt>Dealt</dt><dd id="asp-dealt"></dd></dl>' +
    '<dl class="asp-spec">' + sp.map((r, i) => statRow(r[0], r[1], spN && spN[i][1])).join("") + "</dl></div>" +
    '<div class="asp-row" id="asp-modes"></div><div class="asp-row" id="asp-acts"></div>' +
    '<p class="asp-hint">' + b.blurb + "</p>";
  const need = !maxed && pendingChoice(t);
  if (need) {
    // a branch point: one button per option, each showing what it does
    const opts = need === "path" ? UPGRADES[t.kind] : UPGRADES[t.kind][t.path].finals;
    opts.forEach((o, i) => {
      button($("asp-upbox"), "asp-primary asp-choice" + (pick && pick.choice === i ? " on" : ""),
        "<b>" + o.name + " · " + upCost(t) + "</b><span>" + o.desc + "</span>", () => pickUpgrade(t, i));
    });
  } else if (!maxed && t.lvl + 1 === MAX_LVL && t.form != null) {
    // the L4 step names the form's own super and says what it does
    const f = UPGRADES[t.kind][t.path].finals[t.form], sup = f.super || { name: "Super " + f.name, desc: "a stronger " + f.name };
    button($("asp-upbox"), "asp-primary asp-choice" + (pick ? " on" : ""),
      "<b>→ L" + MAX_LVL + " " + sup.name + " · " + upCost(t) + "</b><span>" + sup.desc + "</span>", () => pickUpgrade(t, null));
  } else {
    button($("asp-upbox"), "asp-primary asp-up-big" + (pick ? " on" : ""),
      maxed ? "max level" : "upgrade → L" + (t.lvl + 1) + " · " + upCost(t), () => { if (!maxed) pickUpgrade(t, null); });
  }
  if (pick) button($("asp-upbox"), "asp-primary asp-up-big", "confirm · " + upCost(t) + " (U)", () => upgradeTower(t, pick.choice), "asp-up");
  MODES.forEach(([m, label]) => {
    button($("asp-modes"), t.mode === m ? "on" : "", label, () => { t.mode = m; refreshPanels(); });
  });
  button($("asp-acts"), "", "sell · " + sellValue(t), () => {
    G.money += sellValue(t); G.towers = G.towers.filter(x => x !== t); ui.sel = null;
    sfx("sell"); refreshPanels();
  });
}

// Only what is needed is shown (owner): a selected tower's stats in a popup
// pinned beside it (placePop re-anchors it every frame), and, while placing,
// one line about the tower being placed just above the build bar.
function refreshPanels() {
  const pop = $("asp-pop"), placing = $("asp-placing");
  const t = ui.sel && G.towers.find(x => x.id === ui.sel);
  pop.hidden = !t;
  pop.dataset.kind = t ? t.kind : ""; // the card takes the tower's colour (aspira.css)
  if (t) { inspectTower(pop, t); placePop(); }
  placing.hidden = !ui.build;
  if (ui.build) {
    const b = TOWERS[ui.build];
    placing.textContent = b.name + " · " + towerCost(ui.build) + " — " + b.blurb + " Tap a free slot.";
  }
}

function updateHud() {
  setText($("asp-lives"), G.lives);
  setText($("asp-money"), short(G.money));
  setText($("asp-int"), (G.interest * 100).toFixed(1) + "%");
  setText($("asp-wave"), G.wave);
  setText($("asp-score"), G.score.toLocaleString());
  setText($("asp-best"), Math.max(best.score, G.score).toLocaleString());
  for (const k of KINDS) {
    const btn = $("asp-tw-" + k);
    btn.disabled = G.money < towerCost(k) && ui.build !== k;
    setText(btn.querySelector(".c"), short(towerCost(k)));
    btn.classList.toggle("on", ui.build === k);
  }
  const send = $("asp-send");
  const label = G.wave === 0 ? "send wave 1" : "send wave " + (G.wave + 1) + " · " + Math.ceil(Math.max(0, G.nextIn)) + "s";
  setText(send, label);
  send.disabled = G.over;
  $("asp-sp-pause").classList.toggle("on", ui.paused);
  setText($("asp-mute"), muted ? "sound off" : "sound on");
  for (const v of SPEEDS) $(speedId(v)).classList.toggle("on", !ui.paused && ui.speed === v);
  const up = $("asp-up"), t = ui.sel && G.towers.find(x => x.id === ui.sel);
  if (up && t) up.disabled = t.lvl >= MAX_LVL || G.money < upCost(t);
  // the open popup's tallies update live
  if (t && $("asp-kills")) { setText($("asp-kills"), t.kills || 0); setText($("asp-dealt"), Math.round(t.dealt || 0).toLocaleString()); }
}

function placePop() {
  const pop = $("asp-pop"), t = ui.sel && G.towers.find(x => x.id === ui.sel);
  if (pop.hidden || !t) return;
  const dpr = window.devicePixelRatio || 1, cw = cv.clientWidth, ch = cv.clientHeight;
  const sx = (cam.ox + t.x * cam.k) / dpr, sy = (cam.oy + t.y * cam.k) / dpr, half = 40 * cam.k / dpr;
  const w = pop.offsetWidth, h = pop.offsetHeight, gap = 12;
  // right of the tower if it fits, else left; vertically centred, kept on screen
  let x = sx + half + gap;
  if (x + w > cw - 8) x = sx - half - gap - w;
  const y = Math.max(8, Math.min(ch - h - 8, sy - h / 2));
  pop.style.left = Math.max(8, x) + "px"; pop.style.top = y + "px";
}

// U: confirm the picked upgrade; with none picked, pick the plain one (a
// branch point needs its option clicked first)
function keyUpgrade(t) {
  if (!t) return;
  if (ui.pick && ui.pick.tid === t.id) upgradeTower(t, ui.pick.choice);
  else if (!pendingChoice(t) && t.lvl < MAX_LVL) pickUpgrade(t, null);
}

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
  if (["1", "2", "3"].includes(ev.key)) { ui.speed = Number(ev.key); ui.paused = false; }
  else if (ev.key === "m" || ev.key === "M") setMuted(!muted);
  else if (ev.key === " ") { ev.preventDefault(); ui.paused = !ui.paused; }
  else if (ev.key === "Tab") { ev.preventDefault(); if ($("asp-ov").hidden) sendWave(); }
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
  render(); updateHud(); placePop(); tickFps(now);
  requestAnimationFrame(frame);
}

resolveColors();
resize();
refreshPanels();
requestAnimationFrame(t => { last = t; frame(t); });
