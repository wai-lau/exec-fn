// Lock the CRT scanline period to a constant ON-SCREEN size across browser
// (ctrl/cmd +/-) zoom. Browser zoom scales CSS px, so a fixed-px scanline would
// grow/shrink as you zoom. window.devicePixelRatio tracks browser zoom (note:
// pinch/visual-viewport zoom does NOT change it, so that case is not
// compensated). Capture DPR at load as the baseline, then set --crt-scale =
// baseline/current on every resize (zoom fires resize); chrome.css multiplies
// the scanline geometry (var(--crt-u)) by it, so the pattern holds its
// load-time on-screen size regardless of later zoom.
(function () {
  'use strict';
  var de = document.documentElement;
  var base = window.devicePixelRatio || 1;
  function update() {
    var cur = window.devicePixelRatio || 1;
    de.style.setProperty('--crt-scale', (base / cur).toFixed(4));
  }
  update();
  window.addEventListener('resize', update);
})();
