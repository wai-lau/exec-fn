// /aspira — the CORE's own upgrades (owner, 2026-10-02). Click the core to
// open its card (the tower card, in white). From wave CORE_UNLOCK the core can
// be upgraded. L1 is one of three effects; L2 deepens it, two options each:
//   Zen      every ZEN_EVERY s a pulse near-freezes (95%) enemies within ZEN_R for ZEN_T s
//     Stillness  the pulse reaches STILL_R
//     Echo       enemies held by the pulse take ECHO_MUL damage
//   Space    (id "nullify") the six slots (and their towers) move NULL_PUSH
//            further from the core, and every tower gains NULL_RANGE range
//     Expanse    the same again: 2x the push, 2x the range
//     Vacuum     every enemy moves at VACUUM_SPD of its speed
//   Sinter   every tower deals +30% damage
//     Temper     every tower fires TEMPER_RATE faster
//     Quench     Fast enemies at half speed, armor and shield charges halved
// Loaded after aspira-towers.js (the simulator loads it too); the card code
// only runs from the UI.
const CORE_UNLOCK = 30, CORE_COST = [2500, 5000];
const ZEN_EVERY = 5, ZEN_R = 250, ZEN_SLOW = 0.95, ZEN_T = 1, SINTER_MUL = 1.3, NULL_PUSH = 100, NULL_RANGE = 100;
const ZEN_WAVE_T = 1.5; // the pulse's visible wave, seconds (owner: slower, was 0.5)
const STILL_R = 400, ECHO_MUL = 1.5, VACUUM_SPD = 0.75, TEMPER_RATE = 1.3;
const CORE_L1 = [
  { id: "zen", name: "Zen", desc: "every 5s a pulse near-freezes enemies within 250 of the core (95% slow) for 1s" },
  { id: "nullify", name: "Space", desc: "towers move 100 further out and gain +100 range" },
  { id: "sinter", name: "Sinter", desc: "every tower deals +30% damage" },
];
const CORE_L2 = {
  zen: [
    { id: "stillness", name: "Stillness", desc: "the pulse reaches 400 (was 250)" },
    { id: "echo", name: "Echo", desc: "enemies held by the pulse take +50% damage" },
  ],
  nullify: [
    { id: "expanse", name: "Expanse", desc: "towers move another 100 out and gain another +100 range" },
    { id: "vacuum", name: "Vacuum", desc: "every enemy moves 25% slower" },
  ],
  sinter: [
    { id: "temper", name: "Temper", desc: "every tower fires 30% faster" },
    { id: "quench", name: "Quench", desc: "Fast enemies at half speed; armor and shields halved" },
  ],
};
const CORE_MAX = CORE_COST.length;

const coreLvl = () => (G.core ? G.core.lvl : 0);
const coreHas = id => !!G.core && (G.core.l1 === id || G.core.l2 === id);
const coreCost = () => CORE_COST[coreLvl()];
const coreOpen = () => G.wave >= CORE_UNLOCK;
// what the next core level offers: L1's three, or the two under the L1 taken
const coreOptions = () => (coreLvl() === 0 ? CORE_L1 : CORE_L2[G.core.l1]);
const zenR = () => (coreHas("stillness") ? STILL_R : ZEN_R);
// Space's push and range, doubled by Expanse
const spaceK = () => (coreHas("nullify") ? (coreHas("expanse") ? 2 : 1) : 0);

function buyCore(choice) {
  if (!coreOpen() || coreLvl() >= CORE_MAX || G.money < coreCost()) return false;
  const opt = coreOptions()[choice];
  if (!opt) return false;
  G.money -= coreCost();
  if (!G.core) G.core = { lvl: 1, l1: opt.id, zenT: ZEN_EVERY };
  else { G.core.lvl++; G.core.l2 = opt.id; }
  if (coreHas("nullify")) pushCells(NULL_PUSH * spaceK());
  if (coreHas("quench")) for (const e of G.enemies) if (!e.dead) quench(e);
  return true;
}
// move every slot d further out from the core (0 = home), towers with them;
// newGame() calls pushCells(0), so a restart puts them back
function pushCells(d) {
  for (const c of CELLS) {
    if (!c.home) c.home = { x: c.x, y: c.y, pts: c.pts.map(p => ({ ...p })) };
    const len = Math.hypot(c.home.x - CX, c.home.y - CY), ox = (c.home.x - CX) / len * d, oy = (c.home.y - CY) / len * d;
    c.x = c.home.x + ox; c.y = c.home.y + oy;
    c.pts = c.home.pts.map(p => ({ x: p.x + ox, y: p.y + oy }));
  }
  if (typeof G !== "undefined" && G) for (const t of G.towers) { t.x = CELLS[t.cell].x; t.y = CELLS[t.cell].y; }
}
// Quench, once per enemy: on everything alive when bought, then at spawn
function quench(e) {
  if (e.quenched) return;
  e.quenched = true;
  if (e.shield) { e.shield = Math.ceil(e.shield / 2); e.shieldMax = Math.ceil(e.shieldMax / 2); }
  if (e.armor > 0) e.armor /= 2;
  if (e.type === "fast") e.spd = (e.spd || 1) * 0.5;
}
// Zen's pulse, from step()
function stepCore(dt) {
  if (!coreHas("zen")) return;
  G.core.zenT -= dt;
  if (G.core.zenT > 0) return;
  G.core.zenT += ZEN_EVERY;
  const r = zenR();
  for (const e of G.enemies) if (!e.dead && Math.hypot(e.x - CX, e.y - CY) <= r) applySlow(e, ZEN_SLOW, ZEN_T, "core:zen");
  ring(CX, CY, r, "white", ZEN_WAVE_T, true, false); // a slow gradient wave, no outline (owner)
}
// Echo: extra damage on an enemy the Zen pulse is holding (from damage())
const echoMul = e => (coreHas("echo") && e.slows && e.slows["core:zen"] ? ECHO_MUL : 1);

// ---------- the core's card (UI only) ----------
function inspectCore(el) {
  const lvl = coreLvl(), pick = ui.pick && ui.pick.tid === "core" ? ui.pick : null;
  const l1 = lvl ? CORE_L1.find(o => o.id === G.core.l1) : null;
  const l2 = G.core && G.core.l2 ? CORE_L2[G.core.l1].find(o => o.id === G.core.l2) : null;
  el.innerHTML = '<div class="name">Core · L' + lvl + " of " + CORE_MAX + (l1 ? " · " + l1.name : "") + (l2 ? " · " + l2.name : "") + "</div>" +
    '<div id="asp-upbox"></div>' +
    '<p class="asp-hint">' + (l1 ? l1.desc + (l2 ? "; " + l2.desc : "") : "The heart of the chart. Upgrades unlock at wave " + CORE_UNLOCK + ".") + "</p>";
  const box = $("asp-upbox");
  if (lvl >= CORE_MAX) { button(box, "asp-primary asp-up-big", "max level", () => {}); return; }
  if (!coreOpen()) { button(box, "asp-primary asp-up-big", "unlocks at wave " + CORE_UNLOCK, () => {}); return; }
  coreOptions().forEach((o, i) => {
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
