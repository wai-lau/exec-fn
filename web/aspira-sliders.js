// /aspira - the TOWER CARD and its UPGRADE SLIDERS (owner, 2026-10-07): a chart tower is upgraded
// by DRAGGING each axis of its triangle outward, a stop per tier. Several axes
// may be pulled before buying - the BASKET - and the card previews the result:
// stat rows read now -> next, the description shows its change as TRACK
// CHANGES (removed words struck through, added ones underlined, like Word or
// Docs), the upgrade button prices the whole basket and LOCKS IT IN. A handle
// stops at the tier already locked in and the card SAYS so (#asp-slider-note). The bank is no limit to a pull (owner, 2026-10-07):
// a basket it cannot cover shows its cost in red on a button that will not take
// the tap (the handles flash only where a point IS affordable). The U key
// locks in (1-3 stay the speed keys). UI only; loaded after aspira-chart.js and
// before aspira-ui.js, whose helpers (button, noFunds, ...) and aspira-stats.js's (statRow, SPEC) it
// calls at run time.
const basket = { id: null, add: {} }; // the pulled points per axis of the selected tower
function basketFor(t) { if (basket.id !== t.id) { basket.id = t.id; basket.add = {}; } return basket.add; }
const basketPoints = t => Object.values(basketFor(t)).reduce((a, b) => a + b, 0);
const basketCost = t => skillPointsCost(t, basketPoints(t));
const previewTower = t => ({ ...t, lvl: t.lvl + basketPoints(t), skills: withSkills(t, basketFor(t)) });
// how many more points axis `id` may take: the tiers it has left, and how many
// of those the bank covers on top of the other axes' pulls (points are priced
// in order, whatever the axis)
function axisRoom(t, id) {
  const add = basketFor(t), others = basketPoints(t) - (add[id] || 0), left = SKILL_TIERS - skillOf(t, id);
  let afford = 0;
  while (afford < left && skillPointsCost(t, others + afford + 1) <= G.money) afford++;
  return { others, left, afford };
}

// ---------- the control: three sliders, and the chart beside them ----------
// (owner, 2026-10-07; was handles dragged on the chart's own axes): each axis
// is a REAL range slider with its full name and tier under it, the three
// stacked to the LEFT of the chart; the chart is the picture - the tier rings,
// what the tower has (filled), what the pull would make (dashed), the axes'
// short names at the corners and no numbers
// the chart's outer radius (bigger, owner), centre and tier-0 radius (viewBox units); each label
// sits LABEL_GAP past its corner along the axis - the same gap on all three (owner: COND looked
// further off than CAPA / VOLT); the viewBox is CROPPED to the triangle and its labels (from
// SL_TOP to SL_TOP + SL_H: no empty band under it - owner)
const SL_R = 50, SL_C = 60, SL_R0 = 8, LABEL_GAP = 7, SL_TOP = -3, SL_H = 97;
const labelPt = (i, n) => { const a = axisAngle(i, n), r = SL_R + LABEL_GAP; return [SL_C + Math.cos(a) * r, SL_C + Math.sin(a) * r]; };
const axisAngle = (i, n) => -Math.PI / 2 + i * 2 * Math.PI / n;
function axisPt(i, k, n) {
  const a = axisAngle(i, n), r = SL_R0 + (SL_R - SL_R0) * k / SKILL_TIERS;
  return [SL_C + Math.cos(a) * r, SL_C + Math.sin(a) * r];
}
const tierTxt = k => (k ? roman(k) : "0");
const tierSpan = (lock, at) => (at > lock ? tierTxt(lock) + "→" + tierTxt(at) : tierTxt(lock));
// a slider's thumb FLASHES while the bank covers one more point on its axis (owner: it must read as slidable)
const canPull = (t, ax) => { const r = axisRoom(t, ax.id); return r.left > 0 && r.afford > 0; };
const shapeOf = (axes, sk, n) => axes.map((ax, i) => axisPt(i, (sk && sk[ax.id]) || 0, n).map(v => v.toFixed(1)).join(",")).join(" ");
function sliderChart(t) {
  const axes = SKILL_TREES[t.kind], n = axes.length, add = basketFor(t), pv = previewTower(t);
  let svg = '<svg class="asp-chart asp-sliders" viewBox="0 ' + SL_TOP + ' 120 ' + SL_H + '">';
  for (let k = 1; k <= SKILL_TIERS; k++) svg += '<polygon class="grid" points="' + axes.map((_, i) => axisPt(i, k, n).map(v => v.toFixed(1)).join(",")).join(" ") + '"/>';
  axes.forEach((ax, i) => { const [ex, ey] = axisPt(i, SKILL_TIERS, n); svg += '<line class="grid" x1="' + SL_C + '" y1="' + SL_C + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"/>'; });
  svg += '<polygon class="next" points="' + shapeOf(axes, pv.skills, n) + '"/><polygon class="now" points="' + shapeOf(axes, t.skills, n) + '"/>';
  axes.forEach((ax, i) => { const [tx, ty] = labelPt(i, n); svg += '<text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="middle">' + ax.name.slice(0, 4).toUpperCase() + "</text>"; });
  svg += "</svg>";
  const sliders = axes.map((ax, i) => {
    const lock = skillOf(t, ax.id), at = lock + (add[ax.id] || 0);
    return '<label class="asp-axis-row"><span class="asp-axis-name">' + ax.name + '<b class="asp-axis-tier">' + tierSpan(lock, at) + "</b></span>" + // the name ABOVE its slider (owner)
      '<input type="range" class="asp-axis' + (canPull(t, ax) ? " can" : "") + '" data-axis="' + i + '" min="0" max="' + SKILL_TIERS + '" step="1" value="' + at + '" aria-label="' + ax.name + '"></label>';
  }).join("");
  return '<div class="asp-ctl-row"><div class="asp-axes">' + sliders + '</div><div class="asp-chart-box">' + svg + '<div class="asp-slider-note" id="asp-slider-note"></div></div></div>';
}
// the control updated IN PLACE after a pull (a rebuilt input would lose the thumb under the finger)
function updateSliderChart(t, svg) {
  const axes = SKILL_TREES[t.kind], n = axes.length, add = basketFor(t), pv = previewTower(t);
  svg.querySelector(".next").setAttribute("points", shapeOf(axes, pv.skills, n));
  const inputs = document.querySelectorAll(".asp-axis"), tiers = document.querySelectorAll(".asp-axis-tier");
  axes.forEach((ax, i) => {
    const lock = skillOf(t, ax.id), at = lock + (add[ax.id] || 0);
    if (inputs[i]) { inputs[i].value = at; inputs[i].classList.toggle("can", canPull(t, ax)); }
    if (tiers[i]) tiers[i].textContent = tierSpan(lock, at);
  });
}
// the HUD tick (aspira-ui.js updateHud): income may have brought a point within reach - the flash follows the bank
function refreshHandleFlash(t) {
  document.querySelectorAll(".asp-axis").forEach((s, i) => s.classList.toggle("can", canPull(t, SKILL_TREES[t.kind][i])));
}
function bindSliders(t, root) {
  for (const s of root.querySelectorAll(".asp-axis")) { s.oninput = () => pullAxis(t, Number(s.dataset.axis), Number(s.value)); s.onpointerdown = ev => dragAxis(t, s, ev); }
}
// a finger slides the axis from ANYWHERE on its track (owner, 2026-10-08: a native range
// on iOS moves only when its thumb is caught): the tier nearest the finger, live, on
// window listeners (no setPointerCapture - CLAUDE.md gesture rule). A mouse keeps the
// native control, which already jumps on a click
function dragAxis(t, s, ev) {
  if (ev.pointerType === "mouse") return;
  ev.preventDefault();
  const i = Number(s.dataset.axis), id = ev.pointerId;
  const tierAt = x => { const r = s.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * SKILL_TIERS); };
  let last = -1;
  const move = e => { if (e.pointerId !== id) return; const k = tierAt(e.clientX); if (k !== last) { last = k; pullAxis(t, i, k); } };
  const up = e => { if (e.pointerId !== id) return; removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
  addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  move(ev);
}
// pull axis i to tier `want`, as far as the rules allow, and say what stopped it: a
// pull below the locked-in tier snaps back (the bank is no limit - upgradeButton)
function pullAxis(t, i, want) {
  const ax = SKILL_TREES[t.kind][i], add = basketFor(t), lock = skillOf(t, ax.id);
  const to = Math.max(lock, Math.min(SKILL_TIERS, want)), why = want < lock ? ax.name + " " + roman(lock) + " is locked in · sell to undo" : "";
  const was = add[ax.id] || 0;
  add[ax.id] = to - lock;
  if (was !== to - lock) refreshUpgradePreview(t);
  else { const s = document.querySelectorAll(".asp-axis")[i]; if (s) s.value = to; }
  const note = $("asp-slider-note");
  if (note) note.innerHTML = why; // (no "tap to lock it in" line: the button's flashing says it - owner)
  document.querySelectorAll(".asp-axis").forEach((s, k) => s.classList.toggle("stuck", !!why && k === i));
}
// the card's preview parts, re-rendered: the chart (in place), the stats, the description, the button, the spend bar
function refreshUpgradePreview(t) {
  const svg = document.querySelector(".asp-sliders"), pv = basketPoints(t) ? previewTower(t) : null;
  if (svg) updateSliderChart(t, svg);
  const stats = $("asp-stats-box"), desc = $("asp-desc-box");
  if (stats) stats.innerHTML = cardStats(t, pv);
  if (desc) desc.innerHTML = skillDesc(t, previewTower(t));
  upgradeButton(t);
  if (!chooser.t) showSpend(basketPoints(t) ? basketCost(t) : null, "close", closeCard, t.kind);
  $("asp-pop").__fitDirty = true; // the description may have grown a line: refit (never scroll)
}

// ---------- the card's preview: stats, description, button ----------
// the two stat columns (owner, 2026-10-07): the rows that MATTER for this kind on
// the left, bigger (KEY_STATS, in that order), everything else on the right, small;
// "now -> next" where the pulled points change a value (statRow paints a change for
// the worse red); rows the tower has not got yet ("—") are left out
const KEY_STATS = { arc: ["Damage", "Hits", "Arc dmg", "Charge", "Range"], frz: ["Aura slow", "Range", "Rime", "Moons", "Aura dmg"], sol: ["Damage", "Beams", "Crit", "Crit ×", "Breach", "Refract"], acd: ["Corrode", "Jets", "Peak", "Builds", "Pool burn"] };
function cardStats(t, pv) {
  const b = TOWERS[t.kind], st = towerStats(t), nx = pv ? towerStats(pv) : null, spN = nx ? SPEC[t.kind](nx, pv) : null;
  const rows = [];
  if (b.dmg && t.kind !== "acd") rows.push(["Damage", Math.round(st.dmg), nx && Math.round(nx.dmg)]); // (ACD's Corrode row is its damage)
  rows.push(["Range", Math.round(st.range), nx && Math.round(nx.range)], ["Rate", st.rate.toFixed(2) + "/s", nx && nx.rate.toFixed(2) + "/s"],
    ["Slide", slideSpan(t), nx && slideSpan(pv)], ["Speed", Math.round(moveSpeed(t)), nx && Math.round(moveSpeed(pv))]);
  SPEC[t.kind](st, t).forEach((r, k) => rows.push([r[0], r[1], spN ? spN[k][1] : null]));
  const shown = rows.filter(r => r[1] !== "—" || (r[2] != null && r[2] !== "—")), key = KEY_STATS[t.kind] || [];
  const left = key.map(l => shown.find(r => r[0] === l)).filter(Boolean), right = shown.filter(r => !key.includes(r[0]));
  const row = ([label, now, next]) => statRow(label, now, nx && String(next) !== String(now) ? next : null);
  return '<div class="asp-cols"><dl class="asp-key">' + left.map(row).join("") + '</dl><dl class="asp-spec">' + right.map(row).join("") + '<dt>Kills</dt><dd id="asp-kills"></dd></dl></div>';
}
// the description: ONE evolving sentence per axis (its `base` at tier 0, the
// tier's `desc` above it - aspira-skills.js) and, while points are pulled, the
// change from the locked tier's sentence to the pulled one in TRACK CHANGES
// The tower's prose (aspira-desc.js describeTower) for the locked tiers against the
// pulled ones, in a box of FIXED height (owner, 2026-10-07)
// PUNCTUATION is its own token (owner: "holds." -> "holds, and ..." marked "holds" as changed),
// so only the mark that changed is struck or inserted; it renders with no space before it
const words = s => (s ? s.split(" ").flatMap(w => { const m = w.match(/^(.*?)([.,;:]+)$/); return m && m[1] ? [m[1], m[2]] : [w]; }) : []);
const isPunct = w => /^[.,;:]+$/.test(w);
const joinWords = ws => ws.reduce((acc, w) => (acc && !isPunct(w) ? acc + " " : acc) + w, "");
function skillDesc(t, pv) {
  return '<div class="asp-desc">' + wordDiff(words(describeTower(t.kind, t.skills)), words(describeTower(t.kind, pv.skills))) + "</div>";
}
// a word-level diff (longest common subsequence): removed words in <del>, added in
// <ins>; a word that only changed CASE counts as the same word ("Arcs" -> "Harder arcs"
// marks only "Harder") and is shown in the new text's spelling
const sameWord = (x, y) => x.toLowerCase() === y.toLowerCase();
function wordDiff(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = sameWord(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0, del = [], ins = [];
  // out: [html, first token] pairs; a piece opening on punctuation takes no space before it
  const flush = () => { if (del.length) out.push(["<del>" + joinWords(del) + "</del>", del[0]]); if (ins.length) out.push(["<ins>" + joinWords(ins) + "</ins>", ins[0]]); del = []; ins = []; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && sameWord(a[i], b[j])) { flush(); out.push([b[j], b[j]]); i++; j++; }
    else if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) ins.push(b[j++]);
    else del.push(a[i++]);
  }
  flush();
  return out.reduce((acc, [h, w]) => (acc && !isPunct(w) ? acc + " " : acc) + h, "");
}
// CONFIRM and CANCEL (owner, 2026-10-07): the upgrade button IS the tower's title -
// "Arc IV", its points locked in, on one line - and while axes are pulled it reads
// what they would make, "Arc VI (-440c)", the cost in the spend bar's red; a tap
// locks them in. Beside it, cancel drops the pulled points - and with none pulled it
// is the card's close
function upgradeButton(t) {
  const box = $("asp-upbox");
  if (!box) return;
  box.innerHTML = "";
  const n = basketPoints(t), cost = basketCost(t), pts = t.lvl - 1 + n;
  const label = towerTitle(t) + (pts ? " " + roman(pts) : "") + (n ? ' <span class="asp-spend-cost">(−' + cr(cost) + ")</span>" : "");
  const btn = button(box, "asp-primary asp-up-big" + (n && G.money >= cost ? " asp-confirm" : ""), label, () => lockIn(t), "asp-up"); // pulses while a pull waits to be locked in (owner)
  btn.classList.toggle("poor", n > 0 && G.money < cost); btn.disabled = !n || G.money < cost; // greyed until a slider moves; red, no tap, when the bank cannot cover it (owner)
  button(box, "asp-up-cancel", n ? "cancel" : "close", () => { if (basketPoints(t)) { basket.add = {}; refreshPanels(); } else closeCard(); }, "asp-up-cancel");
}
// buy every pulled point, in axis order, each at its own ladder step (upgradeTower pays one)
function lockIn(t) {
  const add = basketFor(t), n = basketPoints(t), cost = basketCost(t);
  if (!n) return;
  if (G.money < cost) { noFunds($("asp-up"), cost); return; }
  for (const ax of SKILL_TREES[t.kind]) for (let k = 0; k < (add[ax.id] || 0); k++) upgradeTower(t, ax.id, true);
  basket.add = {};
  sfxFor("up", t.kind); ring(t.x, t.y, 64, TOWERS[t.kind].color); refreshPanels();
}

// ---------- the tower card (moved from aspira-ui.js at its 500-line cap) ----------
// TWO HALVES (owner, 2026-10-07): the CONTROL - the chart at the full width of
// its half, confirm + cancel under it - and the INFO - name, description, stats,
// the targeting slider, sell. Side by side on a wide screen, stacked on a phone
// with the info on top and the control under it, at the thumb (aspira.css .asp-tower-grid)
function inspectTower(el, t) {
  const maxed = t.lvl >= maxLvl(t), chart = hasSkills(t), pv = chart && basketPoints(t) ? previewTower(t) : null;
  // no title line (owner): the upgrade button names the tower and its points (upgradeButton);
  // the DESCRIPTION tops the card, across its width (owner) - the tower's prose in track
  // changes while points are pulled (aspira-sliders.js); else the current upgrade's tagline
  el.innerHTML = '<div class="asp-tower-grid">' +
    '<div id="asp-desc-box">' + (chart ? skillDesc(t, previewTower(t)) : '<p class="asp-hint">' + towerTagline(t) + "</p>") + "</div>" +
    (chart ? "" : '<div class="name asp-tower-title">' + towerTitle(t) + " · L" + t.lvl + " of " + maxLvl(t) + "</div>") +
    '<div class="asp-tower-ctl">' +
    (chart ? sliderChart(t) : "") + // the sliders and the chart (owner, 2026-10-07)
    '<div class="asp-row" id="asp-upbox"></div>' + // confirm + cancel (aspira-sliders.js upgradeButton)
    '</div><div class="asp-tower-info">' +
    // two columns (owner): what every tower has | what only this type has; kills and
    // damage dealt share ONE row, and stats the tower has not got yet ("—") are left out
    '<div id="asp-stats-box">' + cardStats(t, pv) + "</div>" +
    // TARGETING PRIORITY (owner, 2026-10-06): a SLIDER that snaps to its stops,
    // labelled under it (the labels are tappable too); was three buttons
    '<div class="asp-prio"><b>Targeting priority:</b></div>' +
    '<input type="range" class="asp-prio-slider" id="asp-prio" min="0" max="' + (MODES.length - 1) + '" step="1" value="' + Math.max(0, MODES.findIndex(m => m[0] === t.mode)) + '">' +
    '<div class="asp-prio-labels">' + MODES.map(([m, label], i) => '<span data-i="' + i + '"' + (t.mode === m ? ' class="on"' : "") + ">" + label + "</span>").join("") + "</div>" +
    "</div>" +
    // sell, small: the card's LAST row on a phone (owner, 2026-10-08), under the control half on a wide screen (aspira.css)
    '<div class="asp-row" id="asp-acts"></div>' +
    "</div>";
  const setMode = i => { t.mode = MODES[i][0]; refreshPanels(); };
  $("asp-prio").oninput = ev => setMode(Number(ev.target.value));
  el.querySelectorAll(".asp-prio-labels span").forEach(s => { s.onclick = () => setMode(Number(s.dataset.i)); });
  // a chart tower's upgrade button locks the pulled points in (aspira-sliders.js);
  // a path / form tower's opens the card chooser
  if (chart) { bindSliders(t, el); upgradeButton(t); }
  else button($("asp-upbox"), "asp-primary asp-up-big",
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
