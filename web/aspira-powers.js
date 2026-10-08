// /aspira - the CORE POWERS as BUTTONS above the title (owner, 2026-10-08: "move
// powers to buttons above game title showing cooldown"; was a dial of arcs round the
// core). One button per OWNED power, in its colour: a bar that fills as it recharges
// and the seconds left, "ready" (flashing) when it can go, and while it RUNS the
// seconds it has left. Temporal: a tap fires it. Relay: a tap on it with a tower
// selected relays that tower; with none it ARMS - the next tower tapped takes it, a
// tap anywhere else disarms (onTap, aspira-ui.js). The core's own gestures (hold /
// drag, aspira-camera.js) still work. UI only; loaded after aspira-core-fx.js (DIAL)
// and before aspira-ui.js, whose HUD tick calls updatePowers.
const POWER_SHORT = { temporal: "time stop", relay: "relay" };
function powerTap(d) {
  if (d.id === "temporal") { if (temporalFreeze()) refreshPanels(); return; }
  const t = ui.sel && G.towers.find(x => x.id === ui.sel);
  if (t) { if (relay(t)) refreshPanels(); return; }
  ui.relayArm = !ui.relayArm && cooldownLeft("relay") <= 0;
  if (ui.relayArm) banner("ORBITAL RELAY · TAP A TOWER", "white", 1.5);
}
// from onTap: an armed Relay goes to the tower tapped; any tap disarms it
function relayArmTap(hit) {
  if (!ui.relayArm) return false;
  ui.relayArm = false;
  return G.towers.includes(hit) && relay(hit);
}
function updatePowers() {
  const box = $("asp-powers"), c = G.core, owned = DIAL.filter(d => powerLvl(d.id));
  box.hidden = !owned.length;
  for (const d of owned) {
    let b = box.querySelector('[data-pw="' + d.id + '"]');
    if (!b) { b = button(box, "asp-power " + d.color, "", () => powerTap(d)); b.dataset.pw = d.id; }
    const lv = powerLvl(d.id), cd = cooldownLeft(d.id), full = d.tab()[lv].cd, run = d.active(c);
    const state = run > 0 ? Math.ceil(run) + "s on" : cd > 0 ? Math.ceil(cd) + "s" : "ready";
    setHtml(b, "<span>" + POWER_SHORT[d.id] + "</span><b>" + state + '</b><i style="width:' + Math.round(100 * (run > 0 ? 1 : 1 - Math.min(1, cd / full))) + '%"></i>');
    b.classList.toggle("ready", run <= 0 && cd <= 0); b.classList.toggle("run", run > 0);
    b.classList.toggle("armed", d.id === "relay" && !!ui.relayArm);
    // a power coming off cooldown pops "<NAME> READY" where the interest pops up, under the core (was the dial's)
    const was = (c.cdSeen ||= {})[d.id];
    if (was > 0 && cd <= 0) float(CX, CY + CORE_R + LIFE_GAP * LIFE_RINGS + 16, d.label + " READY", d.color, READY_POP, 1.6, 1, 30);
    c.cdSeen[d.id] = cd;
  }
}
