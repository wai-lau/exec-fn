// /aspira - the CORE POWERS as BUTTONS above the title (owner, 2026-10-08: "move
// powers to buttons above game title showing cooldown"; was a dial of arcs round the
// core). One button per OWNED power, in its colour: a bar that fills as it recharges
// and the seconds left, "online" (flashing) when it can go, and while it RUNS the
// seconds it has left. Temporal: a tap fires it. Relay: a tap on it with a tower
// selected relays that tower; with none it ARMS - the next tower tapped takes it, a
// tap anywhere else disarms (onTap, aspira-ui.js). The core's own gestures (hold /
// drag, aspira-camera.js) still work. UI only; loaded after aspira-core-fx.js (DIAL)
// and before aspira-ui.js, whose HUD tick calls updatePowers.
// each power's word when it can go (owner, 2026-10-08): TEMPORAL DRIVE online, ORBITAL RELAY ready
const POWER_READY = { temporal: "online", relay: "ready" };
function powerTap(d) {
  if (d.id === "temporal") { if (temporalFreeze()) refreshPanels(); return; }
  // the Relay ALWAYS arms and waits for a tower (owner, 2026-10-08: "keep waiting for tower selection"),
  // whatever is selected; a second tap on the button disarms
  ui.relayArm = !ui.relayArm && cooldownLeft("relay") <= 0; // armed: every tower FLASHES a white ring (drawRelayArm), no banner (owner, 2026-10-08)
}
// while the Relay is armed, a flashing white ring round every tower says "tap one" - on the
// same 0.7s beat as the online buttons (aspira.css asp-flash); drawScene calls it after the towers
const RELAY_RING_K = 1.3;
function drawRelayArm() {
  if (!ui.relayArm) return;
  const a = 0.3 + 0.7 * blinkWave(); // the one blink, a touch softer (was 0.15 + 0.85)
  ctx.strokeStyle = COL.white; ctx.lineWidth = 3; ctx.shadowColor = COL.white; ctx.shadowBlur = 14 * cam.k * a;
  for (const t of G.towers) {
    const c0 = CELLS[t.cell], r = Math.hypot(c0.pts[0].x - c0.x, c0.pts[0].y - c0.y) * TOWER_K * RELAY_RING_K;
    ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(t.x ?? c0.x, t.y ?? c0.y, r, 0, 6.283); ctx.stroke();
    // ...and its TRAVEL TRACK, which takes the Relay too (owner, 2026-10-08)
    const k = spokeOf(t);
    ctx.globalAlpha = a * 0.6; ctx.beginPath(); ctx.moveTo(CX + k.ux * (k.r0 + Math.min(0, k.min)), CY + k.uy * (k.r0 + Math.min(0, k.min))); ctx.lineTo(CX + k.ux * (k.r0 + k.max), CY + k.uy * (k.r0 + k.max)); ctx.stroke();
  }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}
// from onTap: an armed Relay goes to the tower tapped, or the tower whose TRAVEL TRACK was tapped (even with
// a build pending); a tap on anything else only disarms it (owner, 2026-10-08) - the tap is used up either way
function relayArmTap(p, hit) {
  if (!ui.relayArm) return false;
  ui.relayArm = false;
  const t = G.towers.includes(hit) ? hit : trackAt(p);
  if (t) relay(t);
  return true;
}
function updatePowers() {
  const box = $("asp-powers"), c = G.core, owned = DIAL.filter(d => powerLvl(d.id));
  box.hidden = !owned.length;
  for (const d of owned) {
    let b = box.querySelector('[data-pw="' + d.id + '"]');
    if (!b) { b = button(box, "asp-power " + d.color, "", () => powerTap(d)); b.dataset.pw = d.id; }
    const lv = powerLvl(d.id), cd = cooldownLeft(d.id), full = d.tab()[lv].cd, run = d.active(c);
    const state = run > 0 ? Math.ceil(run) + "s on" : cd > 0 ? Math.ceil(cd) + "s" : POWER_READY[d.id]; // (owner, 2026-10-08: "should say temporal drive online"; was TIME STOP / ready)
    setHtml(b, "<span>" + d.label + "</span><b>" + state + '</b><i style="width:' + Math.round(100 * (run > 0 ? 1 : 1 - Math.min(1, cd / full))) + '%"></i>');
    b.classList.toggle("ready", run <= 0 && cd <= 0); b.classList.toggle("run", run > 0);
    b.classList.toggle("armed", d.id === "relay" && !!ui.relayArm);
    // a power coming off cooldown pops "<NAME> ONLINE" where the interest pops up, under the core (was the dial's)
    const was = (c.cdSeen ||= {})[d.id];
    if (was > 0 && cd <= 0) float(CX, CY + CORE_R + LIFE_GAP * LIFE_RINGS + 16, d.label + " " + POWER_READY[d.id].toUpperCase(), d.color, READY_POP, 1.6, 1, 30);
    c.cdSeen[d.id] = cd;
  }
}
