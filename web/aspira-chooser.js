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
  button(el, "asp-cancel", "cancel", closeChooser); // the same as clicking off the cards (owner)
  // ONE line (owner): side by side if they all fit across, else one column
  el.hidden = false;
  // measured once shown (a hidden element has no width)
  row.classList.toggle("asp-cards-col", opts.length * CARD_W + (opts.length - 1) * 16 > el.clientWidth - 32);
  // at the bottom, lifted exactly like the tower card (cardLift), and never up
  // into the HUD: the top stops below the speed row (the cards scroll instead)
  el.style.paddingBottom = cardLift(row.offsetWidth).lift + "px";
  el.style.paddingTop = Math.max(8, document.querySelector(".asp-head").getBoundingClientRect().bottom - el.getBoundingClientRect().top + 8) + "px";
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
