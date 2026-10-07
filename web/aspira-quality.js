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
// Remembered in localStorage ("spire.quality"); anything but "low" is high.
const LOW_RES = 0.5;
let lowQ = false;
try { lowQ = localStorage.getItem("spire.quality") === "low"; } catch (e) { lowQ = false; }

// shadowBlur muted at the prototype, so every context (sprites, lane layers,
// the main canvas) obeys without each draw site checking. The real setter is
// kept and called with 0 while low.
(function muteShadows() {
  const P = CanvasRenderingContext2D.prototype, d = Object.getOwnPropertyDescriptor(P, "shadowBlur");
  if (!d || !d.set) return;
  Object.defineProperty(P, "shadowBlur", { configurable: true, get: d.get, set(v) { d.set.call(this, lowQ ? 0 : v); } });
})();

function setQuality(q) {
  lowQ = q === "low";
  try { localStorage.setItem("spire.quality", lowQ ? "low" : "high"); } catch (e) { /* not remembered */ }
  // every cache keyed on the canvas size rebuilds on its own once resize()
  // changes it; the tower sprites are keyed on cam.k, which changes with it
  if (typeof towerSprites !== "undefined") towerSprites.clear();
  if (typeof resize === "function") { resize(); if (typeof fitK !== "undefined") fitK = cam.fit; }
  if (typeof updateQuality === "function") updateQuality();
}

// the toggle, in the auto-wait row (aspira-ui.js autoWaitBox calls this)
function qualityBox(row) {
  const btn = button(row, "asp-check", "", () => setQuality(lowQ ? "high" : "low"), "asp-quality");
  btn.setAttribute("aria-label", "visual quality");
  updateQuality();
}
function updateQuality() {
  const btn = $("asp-quality");
  if (btn) btn.innerHTML = "<span>quality: " + (lowQ ? "low" : "high") + "</span>";
}
// the effect kinds drawFx leaves out while low (the beams, rings and texts stay)
const LOW_SKIP_FX = { hit: 1, spark: 1, cone: 1, flash: 1, blast: 1, zen: 1 };
