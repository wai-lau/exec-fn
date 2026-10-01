// /aspira — DOM: HUD, build/inspect/power decks, input, overlay, main loop.

const ui = { build: null, sel: null, hover: null, speed: 1, paused: false };
const $ = id => document.getElementById(id);
function setText(el, v) { v = String(v); if (el.textContent !== v) el.textContent = v; }

// ---------- placement / input ----------
// Towers snap to the triangular cells of the build disc (CELLS in
// aspira-defs.js); a cell holds at most one tower.
function canPlace(ci) {
  return ci >= 0 && !G.towers.some(t => t.cell === ci);
}
function toWorld(ev) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  return { x: ((ev.clientX - r.left) * dpr - cam.ox) / cam.k, y: ((ev.clientY - r.top) * dpr - cam.oy) / cam.k };
}
function placeTower(p) {
  const b = TOWERS[ui.build];
  const ci = cellAt(p.x, p.y);
  if (!canPlace(ci)) { float(p.x, p.y, "blocked", "pink"); return; }
  if (G.money < b.cost) { float(p.x, p.y, "need " + b.cost, "pink"); return; }
  G.money -= b.cost;
  const c = CELLS[ci];
  const t = { id: G.id++, kind: ui.build, cell: ci, x: c.x, y: c.y, lvl: 1, cd: 0, mode: "close", spent: b.cost };
  G.towers.push(t);
  sfx("build");
  ring(t.x, t.y, 60, b.color);
  // one tower per pick: placing ends placing mode and selects the new tower
  ui.build = null; ui.sel = t.id;
}
cv.addEventListener("pointermove", ev => { ui.hover = toWorld(ev); });
cv.addEventListener("pointerleave", () => { ui.hover = null; });
cv.addEventListener("pointerdown", ev => {
  if (G.over) return;
  const p = toWorld(ev);
  ui.hover = p;
  const ci = cellAt(p.x, p.y), hit = ci >= 0 && G.towers.find(t => t.cell === ci);
  if (hit) { ui.sel = hit.id; ui.build = null; }
  else if (ui.build) placeTower(p);
  else ui.sel = null;
  refreshPanels();
});

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
[["pause", "pause"], [1, "1×"], [2, "2×"], [3, "3×"]].forEach(([v, label]) => {
  button($("asp-speed"), "", label, () => {
    if (v === "pause") ui.paused = !ui.paused; else { ui.speed = v; ui.paused = false; }
  }, "asp-sp-" + v);
});
$("asp-send").onclick = sendWave;
button($("asp-speed"), "", "", () => setMuted(!muted), "asp-mute");

const EXTRA = {
  rapid: st => ["Rate", st.rate.toFixed(1) + "/s"], chain: st => ["Arcs", st.chains],
  nuke: st => ["Crit", Math.round(st.crit * 100) + "%"], slower: st => ["Slow", Math.round(st.slow * 100) + "%"],
  pusher: st => ["Push", Math.round(st.push)], stopper: st => ["Stun", st.stun.toFixed(1) + "s"],
  reaper: st => ["Life", Math.round(st.life * 100) + "%"], gold: st => ["Bounty", "×" + st.mark.toFixed(1)],
};

// One stat row: "now" alone at max level, "now -> next" when an upgrade
// would change it, so the payoff of the upgrade is visible before buying it.
function statRow(label, now, next) {
  const arrow = next !== null && next !== now ? ' <span class="asp-next">→ ' + next + "</span>" : "";
  return "<dt>" + label + "</dt><dd>" + now + arrow + "</dd>";
}

function upgradeTower(t) {
  if (!t || t.lvl >= MAX_LVL || G.money < upCost(t)) return;
  const c = upCost(t);
  G.money -= c; t.spent += c; t.lvl++;
  sfx("up");
  ring(t.x, t.y, 64, TOWERS[t.kind].color); refreshPanels();
}

function inspectTower(el, t) {
  const b = TOWERS[t.kind], maxed = t.lvl >= MAX_LVL;
  const st = towerStats(t), nx = maxed ? null : towerStats({ ...t, lvl: t.lvl + 1 });
  const ex = EXTRA[t.kind](st), exN = nx && EXTRA[t.kind](nx);
  el.innerHTML =
    '<div class="name">' + b.name + " · L" + t.lvl + " of " + MAX_LVL + "</div>" +
    '<div id="asp-upbox"></div>' +
    "<dl>" + (b.dmg ? statRow("Damage", Math.round(st.dmg), nx && Math.round(nx.dmg)) : "") +
    statRow("Range", Math.round(st.range), nx && Math.round(nx.range)) +
    statRow(ex[0], ex[1], exN && exN[1]) + "</dl>" +
    '<div class="asp-row" id="asp-modes"></div><div class="asp-row" id="asp-acts"></div>' +
    '<p class="asp-hint">' + b.blurb + "</p>";
  button($("asp-upbox"), "asp-primary asp-up-big",
    maxed ? "max level" : "upgrade → L" + (t.lvl + 1) + " · " + upCost(t) + " (U)", () => upgradeTower(t), "asp-up");
  MODES.forEach(([m, label]) => {
    button($("asp-modes"), t.mode === m ? "on" : "", label, () => { t.mode = m; refreshPanels(); });
  });
  button($("asp-acts"), "", "sell · " + sellValue(t), () => {
    G.money += sellValue(t); G.towers = G.towers.filter(x => x !== t); ui.sel = null;
    sfx("sell"); refreshPanels();
  });
}

// A selected tower's stats live in a popup pinned beside it on the board,
// never in the side deck; placePop() re-anchors it every frame.
function refreshPanels() {
  const el = $("asp-inspect"), pop = $("asp-pop");
  const t = ui.sel && G.towers.find(x => x.id === ui.sel);
  pop.hidden = !t;
  if (t) { inspectTower(pop, t); placePop(); }
  if (ui.build) {
    const b = TOWERS[ui.build];
    el.innerHTML = '<h3>Placing</h3><div class="name">' + b.name + " · " + b.cost + "</div>" +
      '<p class="asp-hint">' + b.blurb + " Upgrades improve " + b.up + ".</p>" +
      '<p class="asp-hint">Tap inside the central ring. Placing one ends placing mode.</p>';
    return;
  }
  el.innerHTML = '<h3>Inspector</h3><p class="asp-hint">Pick a tower to build, or tap one on the field.</p>' +
    '<p class="asp-hint">Squares are standard, pentagons fast, heptagons tough. Stars drop a bonus. ' +
    "An octagon boss comes every 8th wave and costs 5 lives if it lands.</p>" +
    '<p class="asp-hint">Every 8 waves pays a bonus. Extra lives at 50,000 points and every 100,000 after.</p>';
}

function updateHud() {
  setText($("asp-lives"), G.lives);
  setText($("asp-money"), G.money);
  setText($("asp-int"), (G.interest * 100).toFixed(1) + "%");
  setText($("asp-wave"), G.wave);
  setText($("asp-score"), G.score.toLocaleString());
  setText($("asp-best"), Math.max(best.score, G.score).toLocaleString());
  for (const k of KINDS) {
    const btn = $("asp-tw-" + k);
    btn.disabled = G.money < TOWERS[k].cost && ui.build !== k;
    btn.classList.toggle("on", ui.build === k);
  }
  const send = $("asp-send");
  setText(send, G.wave === 0 ? "send wave 1" : "send wave " + (G.wave + 1) + " · " + Math.max(0, Math.ceil(G.nextIn)) + "s");
  send.disabled = G.over;
  $("asp-sp-pause").classList.toggle("on", ui.paused);
  setText($("asp-mute"), muted ? "sound off" : "sound on");
  for (const v of [1, 2, 3]) $("asp-sp-" + v).classList.toggle("on", !ui.paused && ui.speed === v);
  const up = $("asp-up"), t = ui.sel && G.towers.find(x => x.id === ui.sel);
  if (up && t) up.disabled = t.lvl >= MAX_LVL || G.money < upCost(t);
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

// ---------- overlay ----------
function showOverlay(title, body, btn) {
  setText($("asp-ov-title"), title); setText($("asp-ov-text"), body); setText($("asp-ov-btn"), btn);
  $("asp-ov").hidden = false;
}
$("asp-ov-btn").onclick = () => {
  if (G.over) { G = newGame(); fx = []; ui.sel = null; ui.build = null; refreshPanels(); }
  $("asp-ov").hidden = true;
  if (!G.started) sendWave();
};

document.addEventListener("keydown", ev => {
  if (ev.target.closest("input, textarea, [contenteditable]")) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (["1", "2", "3"].includes(ev.key)) { ui.speed = Number(ev.key); ui.paused = false; }
  else if (ev.key === "m" || ev.key === "M") setMuted(!muted);
  else if (ev.key === " ") { ev.preventDefault(); ui.paused = !ui.paused; }
  else if (ev.key === "Tab") { ev.preventDefault(); if ($("asp-ov").hidden) sendWave(); }
  else if (ev.key === "u" || ev.key === "U") upgradeTower(ui.sel && G.towers.find(x => x.id === ui.sel));
  else if (ev.key === "Escape") { ui.build = null; ui.sel = null; refreshPanels(); }
});
// leaving the tab pauses: a wave should not eat the core while nobody watches
document.addEventListener("visibilitychange", () => { if (document.hidden) ui.paused = true; });

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!ui.paused) {
    let left = dt * ui.speed;
    while (left > 0) { const h = Math.min(0.02, left); step(h); stepFx(h); left -= h; }
  }
  render(); updateHud(); placePop();
  requestAnimationFrame(frame);
}

resolveColors();
resize();
refreshPanels();
requestAnimationFrame(t => { last = t; frame(t); });
