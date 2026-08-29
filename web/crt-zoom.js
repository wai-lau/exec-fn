// Lock the CRT scanline period to a constant ON-SCREEN size across browser
// (ctrl/cmd +/-) zoom. Browser zoom scales CSS px, so a fixed-px scanline would
// grow/shrink as you zoom. window.devicePixelRatio tracks browser zoom (note:
// pinch/visual-viewport zoom does NOT change it, so that case is not
// compensated). Capture DPR at load as the baseline, then set --crt-scale =
// baseline/current on zoom; chrome.css multiplies the scanline geometry
// (var(--crt-u)) by it, so the pattern holds its load-time on-screen size.
//
// We do NOT write --crt-scale on load: at load baseDPR == currentDPR, so the
// ratio is 1 — identical to the CSS default. Writing it anyway would invalidate
// the full-viewport gradient + backdrop-filter stack and force a visible
// top-down repaint. Only write when a later resize actually changes the ratio.
(function () {
  'use strict';
  var de = document.documentElement;
  var base = window.devicePixelRatio || 1;
  var last = '1';
  function update() {
    var cur = window.devicePixelRatio || 1;
    var v = (base / cur).toFixed(4);
    if (v !== last) {
      last = v;
      de.style.setProperty('--crt-scale', v);
    }
  }
  window.addEventListener('resize', update);
})();
