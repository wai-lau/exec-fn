// /aspira — VISUAL QUALITY (owner, 2026-10-07: "a visual quality toggle beside
// auto-wait; high the default; low should cut render time 20x, whatever it
// takes"). UI only; loaded just BEFORE aspira-draw.js, which reads `lowQ`.
// LOW trades looks for speed, everywhere at once:
//   - the canvas draws at LOW_RES device px per CSS px (fill cost is most of a
//     frame: 0.5 is 16x fewer pixels than the usual 2x, the browser upscales)
//   - NO shadow blur anywhere: the setter on every 2D context is muted
//   - no damage numbers, hit flashes, sparks, gradient discs, light cones,
//     twinkling stars, lane glow, faint range rings or puddle bubbles
//   - a boss sky snaps instead of spreading (one draw a frame, never two)
// THREE STEPS on a slider (owner, 2026-10-09: "change quality to a slider:
// low, high, 3D"): 3D is high's picture laid on the spire (aspira-warp.js).
// Remembered in localStorage ("spire.quality"); anything unknown is 3D - the DEFAULT (owner, 2026-10-12: "make 3d default
// quality"; it was high).
const LOW_RES = 0.5, QUALITIES = ["low", "high", "3d"], QUALITY_LABEL = { low: "low", high: "high", "3d": "3D" };
let qMode = "3d";
try { const q = localStorage.getItem("spire.quality"); if (QUALITIES.includes(q)) qMode = q; } catch (e) { qMode = "3d"; }
let lowQ = qMode === "low";
const q3d = () => qMode === "3d";

// shadowBlur muted at the prototype, so every context (sprites, lane layers,
// the main canvas) obeys without each draw site checking. The real setter is
// kept and called with 0 while low.
(function muteShadows() {
  const P = CanvasRenderingContext2D.prototype, d = Object.getOwnPropertyDescriptor(P, "shadowBlur");
  if (!d || !d.set) return;
  Object.defineProperty(P, "shadowBlur", { configurable: true, get: d.get, set(v) { d.set.call(this, lowQ ? 0 : v); } });
})();

function setQuality(q) {
  qMode = QUALITIES.includes(q) ? q : "3d"; lowQ = qMode === "low";
  try { localStorage.setItem("spire.quality", qMode); } catch (e) { /* not remembered */ }
  // every cache keyed on the canvas size rebuilds on its own once resize()
  // changes it; the tower sprites are keyed on cam.k, which changes with it
  if (typeof towerSprites !== "undefined") towerSprites.clear();
  if (typeof resize === "function") { resize(); if (typeof fitK !== "undefined") fitK = cam.fit; }
  if (typeof updateQuality === "function") updateQuality();
}

// the slider, in the auto-wait row (aspira-ui.js autoWaitBox calls this)
function qualityBox(row) {
  const box = document.createElement("label");
  box.className = "asp-quality";
  box.innerHTML = '<span>quality</span><input type="range" min="0" max="2" step="1" id="asp-quality" aria-label="visual quality"><b id="asp-quality-v"></b>';
  row.append(box);
  $("asp-quality").addEventListener("input", ev => { setQuality(QUALITIES[ev.target.value]); try { localStorage.setItem("spire.qpick", "1"); } catch (e) { /* not remembered */ } }); // a PICK on the slider pins it (autoQuality)
  updateQuality();
}
function updateQuality() {
  const sl = $("asp-quality");
  if (sl) sl.value = QUALITIES.indexOf(qMode);
  if ($("asp-quality-v")) $("asp-quality-v").textContent = QUALITY_LABEL[qMode];
  $("asp").classList.toggle("asp-3d", q3d());
}
// the effect kinds drawFx leaves out while low (the beams, rings and texts stay)
const LOW_SKIP_FX = { hit: 1, spark: 1, cone: 1, flash: 1, blast: 1, zen: 1 };
// DETAIL BY DISTANCE (owner, 2026-10-12: "details by distance yes"): in 3D, past DETAIL_FAR_R from the core - the far half of
// the board, where little is decided - no tracers, no hit flashes, no damage numbers, and swarmers draw flat (CPU per frame
// was the slow machines' limit); the centre keeps everything
// ...SCALED BY THE FRAME RATE (owner, 2026-10-12: "3d detail by distance should be scaled based on FPS - try to stay above 600
// units"): the radius shrinks while frames run slow (an average over DETAIL_SLOW_MS) and grows back while they are quick, never
// under DETAIL_MIN_R; a fast machine keeps every detail everywhere
const DETAIL_MIN_R = 600, DETAIL_MAX_R = 1600, DETAIL_SLOW_MS = 28, DETAIL_FAST_MS = 20, DETAIL_RATE = 300; // RATE: world units a second
let detailFarR = DETAIL_MAX_R, detailEma = 16;
// ...and once the radius is at its floor and frames are STILL slow, the 3D board's picture shrinks too, 2048 down to 1024 a
// side (slow log, 2026-10-12: a Brave spent ~5 ms of a 25 ms frame in JS - the rest was handing that picture to the GPU)
const TEX_CAP_MIN = 1024, TEX_CAP_MAX = 2048, TEX_CAP_RATE = 400; // RATE: px a second
let warpTexCap = TEX_CAP_MAX;
const WARP_RES_MIN = 0.5, WARP_RES_MAX = 0.75, DPR_3D_MIN = 1.25, DPR_3D_MAX = 2; // DPR: the very last step (a resize)
// the 3D canvases' pixel density - the LAST thing a slow frame gives up (owner, 2026-10-12: "pixel density should only be reduced
// if fps drops too low"); applied (a resize) only when it crosses a 0.25 step
let dpr3dRaw = DPR_3D_MAX;
function setDpr3d(v) {
  if (typeof RES_CAP_3D === "undefined") return;
  dpr3dRaw = Math.max(DPR_3D_MIN, Math.min(DPR_3D_MAX, v));
  const stepped = Math.round(dpr3dRaw * 4) / 4;
  if (stepped !== RES_CAP_3D) { RES_CAP_3D = stepped; if (q3d() && typeof resize === "function") resize(); }
}
function stepDetail(dt) {
  if (!(dt > 0) || dt > 0.5) return;
  detailEma += (dt * 1000 - detailEma) * 0.05;
  const slow = detailEma > DETAIL_SLOW_MS, quick = detailEma < DETAIL_FAST_MS;
  // slow: first the detail radius comes in, then the 3D picture shrinks (glows always stay - owner, 2026-10-12); quick: back the other way
  // ...and last, the 3D view's own resolution, 0.75 down to WARP_RES_MIN (slow logs: the paint, not the code, was the cost)
  const res = typeof WARP_RES !== "undefined";
  if (slow) { if (detailFarR > DETAIL_MIN_R) detailFarR = Math.max(DETAIL_MIN_R, detailFarR - DETAIL_RATE * dt); else if (warpTexCap > TEX_CAP_MIN) warpTexCap = Math.max(TEX_CAP_MIN, warpTexCap - TEX_CAP_RATE * dt); else if (res && WARP_RES > WARP_RES_MIN) WARP_RES = Math.max(WARP_RES_MIN, WARP_RES - 0.1 * dt); else setDpr3d(dpr3dRaw - 0.25 * dt); }
  else if (quick) { if (dpr3dRaw < DPR_3D_MAX) setDpr3d(dpr3dRaw + 0.25 * dt); else if (res && WARP_RES < WARP_RES_MAX) WARP_RES = Math.min(WARP_RES_MAX, WARP_RES + 0.1 * dt); else if (warpTexCap < TEX_CAP_MAX) warpTexCap = Math.min(TEX_CAP_MAX, warpTexCap + TEX_CAP_RATE * dt); else detailFarR = Math.min(DETAIL_MAX_R, detailFarR + DETAIL_RATE * dt); }
}
const farFx = e => q3d() && (e.x - CX) ** 2 + (e.y - CY) ** 2 > detailFarR * detailFarR;
// AUTO STEP-DOWN (owner, 2026-10-12: "extremely laggy on my partner's brave browser" - 3D is the default now): while the
// player has NOT chosen a quality (nothing stored), a frame time averaging over AUTO_Q_MS for AUTO_Q_HOLD real seconds
// drops 3D to high, then high to low, with a float that says so. A choice on the slider is never overridden
const AUTO_Q_MS = 34, AUTO_Q_HOLD = 3; // 34 (slow logs, 2026-10-12: a Brave averaged 36-40 ms in 3D and never stepped at 40)
let autoQ = { ema: 16, slow: 0 }, autoQSteps = 0; // autoQSteps: how many step-downs this session (the slow log reads it)
function autoQuality(dt) {
  stepDetail(dt); // the 3D detail radius follows the frame rate, chosen quality or not
  try { if (localStorage.getItem("spire.qpick")) return; } catch (e) { /* no storage: still step down */ } // only a slider PICK stops it - a quality merely remembered from before does not (slow log, 2026-10-12)
  if (qMode === "low" || !(dt > 0) || dt > 0.5) return; // (a stall, a tab switch: not a frame time)
  autoQ.ema += (dt * 1000 - autoQ.ema) * 0.05;
  autoQ.slow = autoQ.ema > AUTO_Q_MS ? autoQ.slow + dt : 0;
  if (autoQ.slow < AUTO_Q_HOLD) return;
  const to = qMode === "3d" ? "high" : "low";
  qMode = to; lowQ = to === "low"; autoQ = { ema: 16, slow: 0 }; autoQSteps++; // (set directly: setQuality would STORE it as a choice)
  if (typeof towerSprites !== "undefined") towerSprites.clear();
  if (typeof resize === "function") { resize(); if (typeof fitK !== "undefined") fitK = cam.fit; }
  updateQuality();
  if (typeof float === "function") float(CX, CY - 120, "quality lowered for speed", "white", 18, 3, 1, 3);
}
