'use strict';
// /rd date bar (#rd-date), between the reminders and the calendar: today in
// English, centred ("Thursday, November 19"). Its height is published as
// --date-h, which rd.css folds into --bars-h, so the calendar, the notes and
// the board all re-anchor under it with no extra wiring.

// Longest first; the bar takes the first that fits its half of a phone
// ("Thursday, November 19" clipped at 430px).
const _DATE_FORMATS = [
  { weekday: 'long', month: 'long', day: 'numeric' },
  { weekday: 'short', month: 'long', day: 'numeric' },
  { weekday: 'short', month: 'short', day: 'numeric' },
];

function _syncDateH() {
  const el = document.getElementById('rd-date');
  if (el) document.documentElement.style.setProperty('--date-h', el.offsetHeight + 'px');
}

function renderDate() {
  const el = document.getElementById('rd-date');
  if (!el) return;
  const now = new Date();
  for (const fmt of _DATE_FORMATS) {
    el.textContent = now.toLocaleDateString('en-US', fmt);
    if (el.scrollWidth <= el.clientWidth) break;
  }
}

// Turn over at midnight. A backgrounded tab throttles timers, so re-render
// the moment the page is visible again.
let _dateTimer = null;
function _scheduleDate() {
  clearTimeout(_dateTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  _dateTimer = setTimeout(() => { renderDate(); _scheduleDate(); }, next - now + 1000);
}

(function initDate() {
  renderDate();
  _syncDateH();
  _scheduleDate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { renderDate(); _scheduleDate(); }
  });
  const el = document.getElementById('rd-date');
  if (el && typeof ResizeObserver !== 'undefined') new ResizeObserver(_syncDateH).observe(el);
  window.addEventListener('resize', renderDate);
  // the bit webfont landing changes every width; re-fit once it is in
  if (document.fonts) document.fonts.ready.then(renderDate);
})();
