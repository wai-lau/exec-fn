// /aspira — the CORE's own upgrades (owner, 2026-10-02). Click the core to
// open its card (the tower card, in white). From wave CORE_UNLOCK the core can
// be upgraded; L1 is one of three powerful effects at a high price:
//   ZEN      every ZEN_EVERY s a pulse near-freezes (95%) enemies within ZEN_R for ZEN_T s
//   NULLIFY  enemy shield charges and armor halved, Fast enemies at half speed
//   Sinter   every tower deals +30% damage
// Loaded after aspira-towers.js (the simulator loads it too); the card code
// only runs from the UI.
const CORE_UNLOCK = 30, CORE_COST = [2500];
const ZEN_EVERY = 5, ZEN_R = 250, ZEN_SLOW = 0.95, ZEN_T = 1, SINTER_MUL = 1.3;
const CORE_L1 = [
  { id: "zen", name: "ZEN", desc: "every 5s a pulse near-freezes enemies within 250 of the core (95% slow) for 1s" },
  { id: "nullify", name: "NULLIFY", desc: "enemy shields and armor halved; Fast enemies at half speed" },
  { id: "sinter", name: "Sinter", desc: "every tower deals +30% damage" },
];
const CORE_MAX = CORE_COST.length;

const coreLvl = () => (G.core ? G.core.lvl : 0);
const coreHas = id => !!G.core && G.core.l1 === id;
const coreCost = () => CORE_COST[coreLvl()];
const coreOpen = () => G.wave >= CORE_UNLOCK;

function buyCore(choice) {
  if (!coreOpen() || coreLvl() >= CORE_MAX || G.money < coreCost()) return false;
  G.money -= coreCost();
  G.core = { lvl: 1, l1: CORE_L1[choice].id, zenT: ZEN_EVERY };
  if (coreHas("nullify")) for (const e of G.enemies) if (!e.dead) nullify(e);
  return true;
}
// NULLIFY, once per enemy: on everything alive when bought, then at spawn
function nullify(e) {
  if (e.nulled) return;
  e.nulled = true;
  if (e.shield) { e.shield = Math.ceil(e.shield / 2); e.shieldMax = Math.ceil(e.shieldMax / 2); }
  if (e.armor > 0) e.armor /= 2;
  if (e.type === "fast") e.spd = (e.spd || 1) * 0.5;
}
// ZEN's pulse, from step()
function stepCore(dt) {
  if (!coreHas("zen")) return;
  G.core.zenT -= dt;
  if (G.core.zenT > 0) return;
  G.core.zenT += ZEN_EVERY;
  for (const e of G.enemies) if (!e.dead && Math.hypot(e.x - CX, e.y - CY) <= ZEN_R) applySlow(e, ZEN_SLOW, ZEN_T, "core:zen");
  ring(CX, CY, ZEN_R, "white", 0.5, true);
}

// ---------- the core's card (UI only) ----------
function inspectCore(el) {
  const lvl = coreLvl(), pick = ui.pick && ui.pick.tid === "core" ? ui.pick : null;
  const now = lvl ? CORE_L1.find(o => o.id === G.core.l1) : null;
  el.innerHTML = '<div class="name">Core · L' + lvl + " of " + CORE_MAX + (now ? " · " + now.name : "") + "</div>" +
    '<div id="asp-upbox"></div>' +
    '<p class="asp-hint">' + (now ? now.desc : "The heart of the chart. Upgrades unlock at wave " + CORE_UNLOCK + ".") + "</p>";
  const box = $("asp-upbox");
  if (lvl >= CORE_MAX) { button(box, "asp-primary asp-up-big", "max level", () => {}); return; }
  if (!coreOpen()) { button(box, "asp-primary asp-up-big", "unlocks at wave " + CORE_UNLOCK, () => {}); return; }
  CORE_L1.forEach((o, i) => {
    button(box, "asp-primary asp-choice" + (pick && pick.choice === i ? " on" : ""),
      "<b>" + o.name + " · " + coreCost() + "</b><span>" + o.desc + "</span>", () => { ui.pick = { tid: "core", choice: i }; refreshPanels(); });
  });
  if (pick) {
    button(box, "asp-primary asp-up-big", "confirm · " + coreCost(), () => {
      if (buyCore(pick.choice)) { ui.pick = null; sfx("up"); ring(CX, CY, 80, "white"); }
      refreshPanels();
    }, "asp-up");
  }
}
