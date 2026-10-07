// /aspira - the UPGRADE CHOOSER (split from aspira-ui.js at its 500-line cap):
// the cards an upgrade button opens. UI only; loaded before aspira-ui.js,
// whose helpers (button, cardLift, statRow, ...) it calls at run time.
// Upgrading (owner, 2026-10-02): the upgrade button opens CARDS - one per
// option at a branch (2-3 paths or forms), a single card for a plain step -
// each laid out like the tower's card with the stats it changes. Nothing is
// charged until a card is tapped; clicking outside (or Esc) just closes. The
// game pauses meanwhile. Keys 1-3 pick a card.
const chooser = { t: null, opts: [], wasPaused: false };
function upgradeOptions(t) {
  if (hasSkills(t)) return skillOptions(t); // a chart tower: the next tier of each open axis
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
  const base = [["Range", Math.round(st.range), Math.round(nx.range)], ["Rate", st.rate.toFixed(2) + "/s", nx.rate.toFixed(2) + "/s"],
    ["Slide", slideSpan(t), slideSpan(nt)], ["Speed", Math.round(moveSpeed(t)), Math.round(moveSpeed(nt))]];
  if (b.dmg) base.unshift(["Damage", Math.round(st.dmg), Math.round(nx.dmg)]);
  const spec = SPEC[t.kind](st, t).map((r, k) => [r[0], r[1], spN[k][1]]);
  const changed = rows => rows.filter(r => String(r[1]) !== String(r[2])).map(r => statRow(r[0], r[1], r[2])).join("");
  const title = hasSkills(t) ? o.name : towerTitle(nt) + " · L" + nt.lvl + " of " + maxLvl(nt);
  return '<div class="name">' + (chooser.opts.length > 1 ? i + 1 + " · " : "") + title + "</div>" +
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
  if (!t || t.lvl >= maxLvl(t)) return;
  if (G.money < upCost(t)) { noFunds($("asp-up")); return; }
  const opts = upgradeOptions(t);
  const el = chooserEl();
  chooser.t = t; chooser.opts = opts;
  chooser.wasPaused = ui.paused; ui.paused = true;
  el.dataset.kind = t.kind;
  // one small solid line, not a big heading (owner, phone-first: the heading
  // overlapped the tower card behind) - the cards' own titles name the upgrade
  el.innerHTML = '<p class="asp-chooser-cost">upgrade · ' + cr(upCost(t)) + (opts.length > 1 ? (hasSkills(t) ? " · pick an axis" : " · choose one") : "") + "</p>" + '<div class="asp-cards"></div>';
  const row = el.querySelector(".asp-cards");
  // (a chart tower's Stand chart is on its TOWER card, not here - owner)
  opts.forEach((o, i) => button(row, "asp-card", upgradeCard(t, o, i), () => chooseUpgrade(i)));
  showSpend(upCost(t), "cancel", closeChooser, t.kind); // the spend bar's cancel: the same as clicking off the cards (owner)
  // ONE line (owner): side by side if they all fit across, else one column
  el.hidden = false;
  // measured once shown (a hidden element has no width)
  row.classList.toggle("asp-cards-col", opts.length * CARD_W + (opts.length - 1) * 16 > el.clientWidth - 32);
  // at the bottom, lifted exactly like the tower card (cardLift), and never up
  // into the HUD: the top stops below the speed row (the cards scroll instead)
  el.style.paddingBottom = chooserLift(row) + "px";
  el.style.paddingTop = Math.max(8, document.querySelector(".asp-head").getBoundingClientRect().bottom - el.getBoundingClientRect().top + 8) + "px";
  $("asp").classList.add("asp-choosing"); // the board blurs and darkens beneath (aspira.css)
}
const CARD_W = 380; // .asp-card's width (aspira.css)
// the cards sit clear of the SPEND BAR too (owner: on a wide screen the centred
// bar landed on the middle card): above whichever is higher, the bar or the lift
function chooserLift(row) {
  const lift = cardLift(row.offsetWidth).lift, sp = $("asp-spend"), cv0 = cv.getBoundingClientRect();
  return sp.hidden ? lift : Math.max(lift, cv0.bottom - sp.getBoundingClientRect().top + 12);
}
// close the cards (nothing was charged); a pick pays through upgradeTower
function closeChooser() {
  if (!chooser.t) return;
  chooser.t = null; chooser.ci = null; chooserEl().classList.remove("asp-building");
  $("asp-chooser").hidden = true; ui.paused = chooser.wasPaused;
  $("asp").classList.remove("asp-choosing");
  hideSpend(); refreshPanels(); // the card under it (if any) takes the spend bar back
}
function chooseUpgrade(i) {
  if (chooser.ci != null) { chooseBuild(i); return; } // the BUILD cards
  const o = chooser.opts[i], t = chooser.t;
  if (!o || !t) return;
  closeChooser();
  upgradeTower(t, o.choice);
}

// BUILDING (owner, 2026-10-06): no build buttons - every free slot shows a
// faint outline, and tapping one opens FOUR tower cards (name, price, what it
// does, its base stats) and a cancel, the same chooser as an upgrade's. Each
// card wears its tower's colour. chooser.t is a stand-in while it is open (the
// loop and the keys test it); chooser.ci is the slot.
function buildCard(k, i) {
  const b = TOWERS[k], st = towerStats({ kind: k, lvl: 1, skills: {} }), cost = towerCost(k);
  // "good vs" right under the title (owner); the base stats on ONE line so all
  // four cards fit on a phone above the spend bar (owner: everything fits)
  return '<div class="name">' + (i + 1) + " · " + b.name + " · " + cr(cost) + "</div>" + '<div class="asp-goodvs">good vs ' + GOOD_VS[k] + "</div>" +
    '<p class="asp-hint">' + b.blurb + "</p>" +
    '<div class="asp-goodvs">' + Math.round(st.dmg) + " dmg · " + Math.round(st.range) + " range · " + st.rate.toFixed(2) + "/s</div>";
}
function openBuildChooser(ci) {
  const el = chooserEl(), kinds = Object.keys(TOWERS);
  chooser.t = { build: true }; chooser.ci = ci; chooser.opts = kinds;
  chooser.wasPaused = ui.paused; ui.paused = true;
  el.dataset.kind = ""; el.classList.add("asp-building"); // (never inverted on a boss sky)
  el.innerHTML = '<p class="asp-chooser-cost">build a tower</p><div class="asp-cards asp-build-cards"></div>';
  const row = el.querySelector(".asp-cards");
  kinds.forEach((k, i) => {
    const c = button(row, "asp-card", buildCard(k, i), () => chooseBuild(i));
    c.dataset.kind = k; c.dataset.cost = towerCost(k);
  });
  showSpend(towerCost(kinds[0]), "cancel", closeChooser); // every kind costs the same (towerCost counts towers)
  el.hidden = false;
  row.classList.toggle("asp-cards-col", kinds.length * CARD_W + (kinds.length - 1) * 16 > el.clientWidth - 32);
  el.style.paddingBottom = chooserLift(row) + "px";
  el.style.paddingTop = Math.max(8, document.querySelector(".asp-head").getBoundingClientRect().bottom - el.getBoundingClientRect().top + 8) + "px";
  $("asp").classList.add("asp-choosing");
}
function chooseBuild(i) {
  const k = chooser.opts[i], ci = chooser.ci;
  if (!k || ci == null) return;
  if (G.money < towerCost(k)) { noFunds(chooserEl().querySelectorAll(".asp-card")[i]); return; } // stays open: pick another
  closeChooser();
  ui.build = k; placeTower({ x: CELLS[ci].x, y: CELLS[ci].y }); refreshPanels();
}

// FIRST LOAD (owner): until the first tower stands, a bobbing white TRIANGLE
// points down at the topmost free slot - "tap here to build" (was an arrow)
const ARROW_GAP = 26, ARROW_BOB = 10, ARROW_W = 16, ARROW_H = 20;
function drawSlotArrow() {
  let c = null;
  // the TOP-LEFT free slot (owner): topmost, then leftmost
  CELLS.forEach((cell, ci) => { if (cellOpen(ci) && canPlace(ci) && (!c || cell.y < c.y - 1 || (Math.abs(cell.y - c.y) <= 1 && cell.x < c.x))) c = cell; });
  if (!c) return;
  const tip = c.y - ARROW_GAP + ARROW_BOB * Math.sin(performance.now() / 220);
  ctx.fillStyle = COL.white; ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.moveTo(c.x, tip); ctx.lineTo(c.x - ARROW_W, tip - ARROW_H); ctx.lineTo(c.x + ARROW_W, tip - ARROW_H); ctx.closePath(); ctx.fill();
}

// THE SPEND BAR (owner, 2026-10-06): on EVERY screen that spends money - the
// build cards, the upgrade cards, the tower card, the core's card - the same
// spot (bottom right, where the build buttons were) shows the credits and,
// beside them, "(-Xc)" in red for what is on offer, above the ONE cancel /
// close button, centred on the screen (owner). The HUD tick keeps it current.
const spend = { cost: null, onClose: null };
function showSpend(cost, label, onClose, kind = "") {
  spend.cost = cost; spend.onClose = onClose;
  $("asp-spend").dataset.kind = kind; // the button wears the card's colour (owner)
  $("asp-spend").hidden = false; $("asp-spend-btn").textContent = label;
  $("asp").classList.add("asp-spending");
  updateSpend();
}
function hideSpend() { $("asp-spend").hidden = true; $("asp").classList.remove("asp-spending"); spend.cost = null; spend.onClose = null; }
function updateSpend() {
  if ($("asp-spend").hidden) return;
  $("asp-spend-cred").innerHTML = cr(Math.floor(G.money).toLocaleString("en-US")) +
    (spend.cost != null ? ' <span class="asp-spend-cost">(−' + cr(spend.cost) + ")</span>" : ""); // white credits, the cost in red brackets (owner)
}
