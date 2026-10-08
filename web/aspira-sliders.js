// /aspira - the TOWER CARD and its UPGRADE SLIDERS (owner, 2026-10-07): a chart tower is upgraded
// by DRAGGING each axis of its triangle outward, a stop per tier. Several axes
// may be pulled before buying - the BASKET - and the card previews the result:
// stat rows read now -> next, the description shows its change as TRACK
// CHANGES (removed words struck through, added ones underlined, like Word or
// Docs), the upgrade button prices the whole basket and LOCKS IT IN. A handle
// stops where it must and the card SAYS why (#asp-slider-note): the top tier,
// the tier already locked in, or the point the bank cannot cover. The U key
// locks in (1-3 stay the speed keys). UI only; loaded after aspira-chart.js and
// before aspira-ui.js, whose helpers (statRow, button, noFunds, SPEC, ...) it
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

// ---------- the chart as a control ----------
const SL_R = 46, SL_C = 60, SL_R0 = 8; // the card chart's outer radius, centre and tier-0 radius (viewBox units)
function axisPt(i, k, n) {
  const a = -Math.PI / 2 + i * 2 * Math.PI / n, r = SL_R0 + (SL_R - SL_R0) * k / SKILL_TIERS;
  return [SL_C + Math.cos(a) * r, SL_C + Math.sin(a) * r];
}
const tierTxt = k => (k ? roman(k) : "0");
const tierSpan = (lock, at) => (at > lock ? tierTxt(lock) + "→" + tierTxt(at) : tierTxt(lock));
// the HANDLE is a TRIANGLE pointing out along its axis (owner): its tip HANDLE_TIP
// past the tier point, its base HANDLE_BACK behind it and HANDLE_HALF wide
const HANDLE_TIP = 6, HANDLE_BACK = 3, HANDLE_HALF = 4;
function handlePts(i, k, n) {
  const [hx, hy] = axisPt(i, k, n), a = axisAngle(i, n), ux = Math.cos(a), uy = Math.sin(a);
  return [[hx + ux * HANDLE_TIP, hy + uy * HANDLE_TIP], [hx - ux * HANDLE_BACK - uy * HANDLE_HALF, hy - uy * HANDLE_BACK + ux * HANDLE_HALF], [hx - ux * HANDLE_BACK + uy * HANDLE_HALF, hy - uy * HANDLE_BACK - ux * HANDLE_HALF]]
    .map(p => p.map(v => v.toFixed(1)).join(",")).join(" ");
}
// a handle FLASHES while the bank covers one more point on its axis (owner: it must read as slidable)
const canPull = (t, ax) => { const r = axisRoom(t, ax.id); return r.left > 0 && r.afford > 0; };
// the FULL axis name (owner) on one line, the tier on the next; the bottom
// corners' labels run inward from their corner so the longest names stay inside the chart
const LABEL_ANCHOR = ["middle", "end", "start"], LABEL_LINE = 8;
const axisLabel = (ax, lock, at, i, n) => {
  const [tx, ty] = axisPt(i, SKILL_TIERS + 0.75, n);
  return '<text x="' + tx.toFixed(1) + '" y="' + (ty - LABEL_LINE / 2).toFixed(1) + '" text-anchor="' + (LABEL_ANCHOR[i] || "middle") + '"><tspan x="' + tx.toFixed(1) + '">' + ax.name + '</tspan><tspan x="' + tx.toFixed(1) + '" dy="' + LABEL_LINE + '">' + tierSpan(lock, at) + "</tspan></text>";
};
function sliderChart(t) {
  const axes = SKILL_TREES[t.kind], n = axes.length, add = basketFor(t), pv = previewTower(t);
  const P = (i, k) => axisPt(i, k, n).map(v => v.toFixed(1)).join(",");
  const shape = sk => axes.map((ax, i) => P(i, (sk && sk[ax.id]) || 0)).join(" ");
  let svg = '<div class="asp-chart-box"><svg class="asp-chart asp-sliders" viewBox="0 0 120 120">';
  for (let k = 1; k <= SKILL_TIERS; k++) svg += '<polygon class="grid" points="' + axes.map((_, i) => P(i, k)).join(" ") + '"/>';
  svg += '<polygon class="next" points="' + shape(pv.skills) + '"/><polygon class="now" points="' + shape(t.skills) + '"/>';
  axes.forEach((ax, i) => {
    const lock = skillOf(t, ax.id), at = lock + (add[ax.id] || 0);
    const [ex, ey] = axisPt(i, SKILL_TIERS, n), [lx, ly] = axisPt(i, lock, n);
    svg += '<line class="grid" x1="' + SL_C + '" y1="' + SL_C + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"/>';
    for (let k = 1; k <= SKILL_TIERS; k++) { const [sx, sy] = axisPt(i, k, n); svg += '<circle class="stop" cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="1.6"/>'; }
    // the wide invisible TRACK is what a finger drags on; the handle rides the axis
    svg += '<line class="track" data-axis="' + i + '" x1="' + SL_C + '" y1="' + SL_C + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"/>';
    svg += '<circle class="lock" cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="2"/>';
    svg += '<polygon class="handle' + (canPull(t, ax) ? " can" : "") + '" data-axis="' + i + '" points="' + handlePts(i, at, n) + '"/>';
    svg += axisLabel(ax, lock, at, i, n);
  });
  return svg + "</svg>" + '<div class="asp-slider-note" id="asp-slider-note"></div></div>';
}
// the chart updated IN PLACE while a drag holds the pointer (a rebuilt card would drop the capture)
function updateSliderChart(t, svg) {
  const axes = SKILL_TREES[t.kind], n = axes.length, add = basketFor(t), pv = previewTower(t);
  svg.querySelector(".next").setAttribute("points", axes.map((ax, i) => axisPt(i, pv.skills[ax.id] || 0, n).map(v => v.toFixed(1)).join(",")).join(" "));
  const handles = svg.querySelectorAll(".handle"), labels = svg.querySelectorAll("text");
  axes.forEach((ax, i) => {
    const lock = skillOf(t, ax.id), at = lock + (add[ax.id] || 0);
    handles[i].setAttribute("points", handlePts(i, at, n)); handles[i].classList.toggle("can", canPull(t, ax));
    labels[i].querySelectorAll("tspan")[1].textContent = tierSpan(lock, at);
  });
}
// the HUD tick (aspira-ui.js updateHud): income may have brought a point within reach - the flash follows the bank
function refreshHandleFlash(t) {
  const svg = document.querySelector(".asp-sliders");
  if (!svg) return;
  svg.querySelectorAll(".handle").forEach((h, i) => h.classList.toggle("can", canPull(t, SKILL_TREES[t.kind][i])));
}
// the pointer in chart units, and its tier along axis i: the projection on the axis, snapped to a stop
const chartPt = (svg, ev) => new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
const axisAngle = (i, n) => -Math.PI / 2 + i * 2 * Math.PI / n;
function tierAt(p, i, n) {
  const a = axisAngle(i, n), d = (p.x - SL_C) * Math.cos(a) + (p.y - SL_C) * Math.sin(a);
  return Math.round((d - SL_R0) / (SL_R - SL_R0) * SKILL_TIERS);
}
// the axis a pointer means: the one whose direction from the centre is nearest
// its own (the three tracks and the tier-0 handles all meet at the centre, so a
// press there is settled by which way the drag goes)
function nearestAxis(p, n) {
  const ang = Math.atan2(p.y - SL_C, p.x - SL_C);
  let best = 0, bd = 9;
  for (let i = 0; i < n; i++) { const d = Math.abs(Math.atan2(Math.sin(ang - axisAngle(i, n)), Math.cos(ang - axisAngle(i, n)))); if (d < bd) { bd = d; best = i; } }
  return best;
}
const CENTRE_DEAD = 4; // chart units within which a press has no direction yet
function bindSliders(t, root) {
  const svg = root.querySelector(".asp-sliders");
  if (!svg) return;
  const n = SKILL_TREES[t.kind].length;
  svg.onpointerdown = ev => {
    const el = ev.target.closest(".track, .handle");
    if (!el) return;
    svg.setPointerCapture(ev.pointerId); ev.preventDefault();
    const p0 = chartPt(svg, ev);
    let i = el.classList.contains("handle") ? Number(el.dataset.axis) : Math.hypot(p0.x - SL_C, p0.y - SL_C) > CENTRE_DEAD ? nearestAxis(p0, n) : -1;
    const move = e => {
      const p = chartPt(svg, e);
      if (i < 0 && Math.hypot(p.x - SL_C, p.y - SL_C) > CENTRE_DEAD) i = nearestAxis(p, n);
      if (i >= 0) pullAxis(t, i, tierAt(p, i, n));
    };
    svg.onpointermove = move; move(ev);
    // the release lands the LAST position too (a fast drag's final move may never arrive as a move)
    svg.onpointerup = svg.onpointercancel = e => { svg.onpointermove = null; move(e); };
  };
}
// pull axis i to tier `want`, as far as the rules allow, and say what stopped it
function pullAxis(t, i, want) {
  const ax = SKILL_TREES[t.kind][i], add = basketFor(t), lock = skillOf(t, ax.id), { others, left, afford } = axisRoom(t, ax.id);
  const max = lock + Math.min(left, afford), to = Math.max(lock, Math.min(max, want));
  let why = "";
  if (want > max && max === SKILL_TIERS) why = ax.name + " " + roman(SKILL_TIERS) + " is the top tier";
  else if (want > max) why = "next point " + cr(skillPointsCost(t, others + afford + 1) - skillPointsCost(t, others + afford)) + " · need " + cr(short(skillPointsCost(t, others + afford + 1) - G.money)) + " more";
  else if (want < lock) why = ax.name + " " + roman(lock) + " is locked in · sell to undo";
  const was = add[ax.id] || 0;
  add[ax.id] = to - lock;
  if (was !== to - lock) refreshUpgradePreview(t);
  const note = $("asp-slider-note"), svg = document.querySelector(".asp-sliders");
  if (note) note.innerHTML = why; // (cr() marks the credits with a span)
  if (svg) svg.querySelectorAll(".handle").forEach((h, k) => h.classList.toggle("stuck", !!why && k === i));
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
// the two stat columns, "now -> next" where the pulled points change a value
// (statRow paints a change for the worse red); rows the tower has not got yet ("—") are left out
function cardStats(t, pv) {
  const b = TOWERS[t.kind], st = towerStats(t), nx = pv ? towerStats(pv) : null, spN = nx ? SPEC[t.kind](nx, pv) : null;
  const row = (label, now, next) => statRow(label, now, nx && String(next) !== String(now) ? next : null);
  const base = (b.dmg ? row("Damage", Math.round(st.dmg), nx && Math.round(nx.dmg)) : "") +
    row("Range", Math.round(st.range), nx && Math.round(nx.range)) + row("Rate", st.rate.toFixed(2) + "/s", nx && nx.rate.toFixed(2) + "/s") +
    row("Slide", slideSpan(t), nx && slideSpan(pv)) + row("Speed", Math.round(moveSpeed(t)), nx && Math.round(moveSpeed(pv)));
  const spec = SPEC[t.kind](st, t).map((r, k) => [r[0], r[1], spN ? spN[k][1] : null])
    .filter(r => r[1] !== "—" || (r[2] != null && r[2] !== "—")).map(r => row(r[0], r[1], r[2])).join("");
  return '<div class="asp-cols"><dl>' + base + '<dt>Kills</dt><dd id="asp-kills"></dd></dl><dl class="asp-spec">' + spec + "</dl></div>";
}
// the description: ONE evolving sentence per axis (its `base` at tier 0, the
// tier's `desc` above it - aspira-skills.js) and, while points are pulled, the
// change from the locked tier's sentence to the pulled one in TRACK CHANGES
const axisSentence = (ax, k) => (k ? ax.tiers[k - 1].desc : ax.base);
function skillDesc(t, pv) {
  return '<div class="asp-desc">' + SKILL_TREES[t.kind].map(ax => "<p>" + wordDiff(axisSentence(ax, skillOf(t, ax.id)).split(" "), axisSentence(ax, skillOf(pv, ax.id)).split(" ")) + "</p>").join("") + "</div>";
}
// a word-level diff (longest common subsequence): removed words in <del>, added in <ins>
function wordDiff(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0, del = [], ins = [];
  const flush = () => { if (del.length) out.push("<del>" + del.join(" ") + "</del>"); if (ins.length) out.push("<ins>" + ins.join(" ") + "</ins>"); del = []; ins = []; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); out.push(a[i]); i++; j++; }
    else if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) ins.push(b[j++]);
    else del.push(a[i++]);
  }
  flush();
  return out.join(" ");
}
// CONFIRM and CANCEL (owner): the upgrade button prices the basket (or says why
// there is nothing to buy); beside it, cancel drops the pulled points - and with
// none pulled it is the card's close
function upgradeButton(t) {
  const box = $("asp-upbox");
  if (!box) return;
  box.innerHTML = "";
  const n = basketPoints(t), cost = basketCost(t), maxed = t.lvl >= maxLvl(t);
  const label = "upgrade<span>" + (maxed ? "every axis at the top" : !n ? "pull an axis" : n + (n > 1 ? " points · " : " point · ") + cr(cost)) + "</span>";
  const btn = button(box, "asp-primary asp-up-big", label, () => lockIn(t), "asp-up");
  btn.disabled = maxed || !n;
  btn.classList.toggle("poor", n > 0 && G.money < cost);
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
  // the TITLE is its own grid item: over the info half on a wide screen, over the chart stacked (owner)
  el.innerHTML = '<div class="asp-tower-grid">' +
    '<div class="name asp-tower-title">' + towerTitle(t) + " · " + (chart ? (t.lvl - 1) + " of " + SKILL_POINTS + " points" : "L" + t.lvl + " of " + maxLvl(t)) + "</div>" +
    '<div class="asp-tower-ctl">' +
    (chart ? sliderChart(t) : "") + // the chart IS the upgrade control (owner, 2026-10-07)
    '<div class="asp-row" id="asp-upbox"></div>' + // confirm + cancel (aspira-sliders.js upgradeButton)
    '</div><div class="asp-tower-info">' +
    // the description (owner): a chart tower's tier lines, in track changes while
    // points are pulled (aspira-sliders.js); else the current upgrade's tagline
    '<div id="asp-desc-box">' + (chart ? skillDesc(t, previewTower(t)) : '<p class="asp-hint">' + towerTagline(t) + "</p>") + "</div>" +
    // two columns (owner): what every tower has | what only this type has; kills and
    // damage dealt share ONE row, and stats the tower has not got yet ("—") are left out
    '<div id="asp-stats-box">' + cardStats(t, pv) + "</div>" +
    // TARGETING PRIORITY (owner, 2026-10-06): a SLIDER that snaps to its stops,
    // labelled under it (the labels are tappable too); was three buttons
    '<div class="asp-prio"><b>Targeting priority:</b></div>' +
    '<input type="range" class="asp-prio-slider" id="asp-prio" min="0" max="' + (MODES.length - 1) + '" step="1" value="' + Math.max(0, MODES.findIndex(m => m[0] === t.mode)) + '">' +
    '<div class="asp-prio-labels">' + MODES.map(([m, label], i) => '<span data-i="' + i + '"' + (t.mode === m ? ' class="on"' : "") + ">" + label + "</span>").join("") + "</div>" +
    '<div class="asp-row" id="asp-acts"></div></div></div>'; // sell, last (owner)
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
