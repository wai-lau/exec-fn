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
// AUTO STEP-DOWN (owner, 2026-10-12: "extremely laggy on my partner's brave browser" - 3D is the default now): while the
// player has NOT chosen a quality (nothing stored), a frame time averaging over AUTO_Q_MS for AUTO_Q_HOLD real seconds
// drops 3D to high, then high to low, with a float that says so. A choice on the slider is never overridden
const AUTO_Q_MS = 40, AUTO_Q_HOLD = 3;
let autoQ = { ema: 16, slow: 0 };
function autoQuality(dt) {
  try { if (localStorage.getItem("spire.qpick")) return; } catch (e) { /* no storage: still step down */ } // only a slider PICK stops it - a quality merely remembered from before does not (slow log, 2026-10-12)
  if (qMode === "low" || !(dt > 0) || dt > 0.5) return; // (a stall, a tab switch: not a frame time)
  autoQ.ema += (dt * 1000 - autoQ.ema) * 0.05;
  autoQ.slow = autoQ.ema > AUTO_Q_MS ? autoQ.slow + dt : 0;
  if (autoQ.slow < AUTO_Q_HOLD) return;
  const to = qMode === "3d" ? "high" : "low";
  qMode = to; lowQ = to === "low"; autoQ = { ema: 16, slow: 0 }; // (set directly: setQuality would STORE it as a choice)
  if (typeof towerSprites !== "undefined") towerSprites.clear();
  if (typeof resize === "function") { resize(); if (typeof fitK !== "undefined") fitK = cam.fit; }
  updateQuality();
  if (typeof float === "function") float(CX, CY - 120, "quality lowered for speed", "white", 18, 3, 1, 3);
}
