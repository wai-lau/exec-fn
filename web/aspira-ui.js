// /aspira — DOM: HUD, build/inspect/power decks, input, overlay, main loop.

const ui = { build: null, sel: null, hover: null, speed: 1, paused: false };
const $ = id => document.getElementById(id);
function setText(el, v) { v = String(v); if (el.textContent !== v) el.textContent = v; }

// ---------- placement / input ----------
function canPlace(x, y) {
  const r = Math.hypot(x - CX, y - CY);
  if (r > BUILD_R - 20 || r < CORE_R + 24) return false;
  return !G.towers.some(t => Math.hypot(t.x - x, t.y - y) < 40);
}
function toWorld(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * W };
}
function placeTower(p) {
  const b = TOWERS[ui.build];
  if (!canPlace(p.x, p.y)) { float(p.x, p.y, "blocked", "pink"); return; }
  if (G.money < b.cost) { float(p.x, p.y, "need " + b.cost, "pink"); return; }
  G.money -= b.cost;
  const t = { id: G.id++, kind: ui.build, x: p.x, y: p.y, lvl: 1, cd: 0, mode: "close", spent: b.cost };
  G.towers.push(t);
  ring(t.x, t.y, 30, b.color);
}
cv.addEventListener("pointermove", ev => { ui.hover = toWorld(ev); });
cv.addEventListener("pointerleave", () => { ui.hover = null; });
cv.addEventListener("pointerdown", ev => {
  if (G.over) return;
  const p = toWorld(ev);
  ui.hover = p;
  const hit = G.towers.find(t => Math.abs(t.x - p.x) < 22 && Math.abs(t.y - p.y) < 22);
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
  btn.title = b.name + " (" + (i + 1) + ")";
});
POWERS.forEach(([code, label]) => {
  button($("asp-powers"), "asp-pw", code, () => usePower(code), "asp-pw-" + code).title = label;
});
[["pause", "pause"], [1, "1×"], [2, "2×"], [3, "3×"]].forEach(([v, label]) => {
  button($("asp-speed"), "", label, () => {
    if (v === "pause") ui.paused = !ui.paused; else { ui.speed = v; ui.paused = false; }
  }, "asp-sp-" + v);
});
$("asp-send").onclick = sendWave;

const EXTRA = {
  rapid: st => ["Rate", st.rate.toFixed(1) + "/s"], chain: st => ["Arcs", st.chains],
  nuke: st => ["Crit", Math.round(st.crit * 100) + "%"], slower: st => ["Slow", Math.round(st.slow * 100) + "%"],
  pusher: st => ["Push", Math.round(st.push)], stopper: st => ["Stun", st.stun.toFixed(1) + "s"],
  reaper: st => ["Life", Math.round(st.life * 100) + "%"], gold: st => ["Bounty", "×" + st.mark.toFixed(1)],
};

function inspectTower(el, t) {
  const b = TOWERS[t.kind], st = towerStats(t), maxed = t.lvl >= MAX_LVL, extra = EXTRA[t.kind](st);
  el.innerHTML =
    '<h3>Selected</h3><div class="name">' + b.name + " · L" + t.lvl + "</div>" +
    '<p class="asp-hint">' + b.blurb + "</p>" +
    "<dl>" + (b.dmg ? "<dt>Damage</dt><dd>" + Math.round(st.dmg) + "</dd>" : "") +
    "<dt>Range</dt><dd>" + Math.round(st.range) + "</dd><dt>" + extra[0] + "</dt><dd>" + extra[1] + "</dd></dl>" +
    '<div class="asp-row" id="asp-modes"></div><div class="asp-row" id="asp-acts"></div>';
  MODES.forEach(([m, label]) => {
    button($("asp-modes"), t.mode === m ? "on" : "", label, () => { t.mode = m; refreshPanels(); });
  });
  button($("asp-acts"), "asp-primary", maxed ? "max level" : "upgrade " + b.up + " · " + upCost(t), () => {
    if (t.lvl >= MAX_LVL || G.money < upCost(t)) return;
    const c = upCost(t); G.money -= c; t.spent += c; t.lvl++;
    ring(t.x, t.y, 34, b.color); refreshPanels();
  }, "asp-up");
  button($("asp-acts"), "", "sell · " + sellValue(t), () => {
    G.money += sellValue(t); G.towers = G.towers.filter(x => x !== t); ui.sel = null; refreshPanels();
  });
}

function refreshPanels() {
  const el = $("asp-inspect");
  const t = ui.sel && G.towers.find(x => x.id === ui.sel);
  if (t) { inspectTower(el, t); return; }
  if (ui.build) {
    const b = TOWERS[ui.build];
    el.innerHTML = '<h3>Placing</h3><div class="name">' + b.name + " · " + b.cost + "</div>" +
      '<p class="asp-hint">' + b.blurb + " Upgrades improve " + b.up + ".</p>" +
      '<p class="asp-hint">Tap inside the central ring. Tap the button again to stop placing.</p>';
    return;
  }
  el.innerHTML = '<h3>Inspector</h3><p class="asp-hint">Pick a tower to build, or tap one on the field.</p>' +
    '<p class="asp-hint">Squares are standard, triangles fast, hexagons tough. Stars drop a bonus. ' +
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
  const full = G.charge >= POWER_FULL;
  $("asp-pw-bar").style.width = (G.charge / POWER_FULL * 100) + "%";
  setText($("asp-pw-state"), full ? "· ready" : "");
  for (const [code] of POWERS) {
    const btn = $("asp-pw-" + code);
    btn.disabled = !full || G.over || !G.started;
    btn.classList.toggle("live", (G.power[code] || 0) > 0);
  }
  const send = $("asp-send");
  setText(send, G.wave === 0 ? "send wave 1" : "send wave " + (G.wave + 1) + " · " + Math.max(0, Math.ceil(G.nextIn)) + "s");
  send.disabled = G.over;
  $("asp-sp-pause").classList.toggle("on", ui.paused);
  for (const v of [1, 2, 3]) $("asp-sp-" + v).classList.toggle("on", !ui.paused && ui.speed === v);
  const up = $("asp-up"), t = ui.sel && G.towers.find(x => x.id === ui.sel);
  if (up && t) up.disabled = t.lvl >= MAX_LVL || G.money < upCost(t);
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
  const n = parseInt(ev.key, 10);
  if (n >= 1 && n <= KINDS.length) selectBuild(KINDS[n - 1]);
  else if (ev.key === " ") { ev.preventDefault(); if ($("asp-ov").hidden) sendWave(); }
  else if (ev.key === "p" || ev.key === "P") ui.paused = !ui.paused;
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
  render(); updateHud();
  requestAnimationFrame(frame);
}

resolveColors();
resize();
refreshPanels();
requestAnimationFrame(t => { last = t; frame(t); });
