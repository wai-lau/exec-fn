// CRT lite: drop the expensive half of the CRT stack on a machine that cannot
// composite it. Without a GPU the two backdrop-filter panes (.cyber-blur,
// .cyber-crt) are re-run on the CPU for every frame anything moves, and the
// .cyber-scan sweep moves every frame, forever: the landing measured 5fps idle
// at 1440x900 (Chromium, GPU off, 4x CPU throttle) and 60fps with those three
// gone -- the scanlines and tint, which are static, cost nothing and stay.
//
// So it is measured, not guessed: time a run of frames once the page has
// settled, and if the median is slow, add html.crt-lite (chrome.css hides the
// three layers). The verdict is remembered for a week so a slow machine's next
// visit starts light instead of lagging for the second it takes to find out.
(function () {
  'use strict';
  var KEY = 'crt.lite';
  var KEEP_MS = 7 * 24 * 3600 * 1000;
  var SAMPLES = 30;
  var WINDOW_MS = 1200; // or stop at this: a 5fps machine gives 30 frames in 6s
  var SLOW_MS = 25;     // median frame interval that counts as "cannot keep up"
  var de = document.documentElement;

  try {
    var at = parseInt(localStorage.getItem(KEY), 10);
    if (at && Date.now() - at < KEEP_MS) { de.classList.add('crt-lite'); return; }
  } catch (_) {}

  var times = [];
  var last = 0;
  var began = 0;
  function frame(now) {
    // a hidden tab gets no frames; a gap across one is not a slow frame
    if (document.hidden) { last = 0; requestAnimationFrame(frame); return; }
    if (!began) began = now;
    if (last) times.push(now - last);
    last = now;
    var done = times.length >= SAMPLES || (now - began >= WINDOW_MS && times.length >= 4);
    if (!done) { requestAnimationFrame(frame); return; }
    times.sort(function (a, b) { return a - b; });
    if (times[times.length >> 1] > SLOW_MS) {
      de.classList.add('crt-lite');
      try { localStorage.setItem(KEY, String(Date.now())); } catch (_) {}
    }
  }
  // after load, so font swap and the first layout do not read as a slow machine
  function start() { setTimeout(function () { requestAnimationFrame(frame); }, 500); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
