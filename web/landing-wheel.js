// Landing wheel: drives the vertical carousel on `/`. Same global scope as the
// rest of web/*.js (loaded via <script src>, not a module).
//
// The wheel holds every section but shows five: the active one plus two rings
// each side. Position is a whole slot index -- never a free-floating scroll
// offset -- so the wheel is ALWAYS snapped to an item; a scroll or a drag just
// decides how many slots it travels. Geometry (--off, --sc) lives in
// landing.css; this file only ever moves the index and re-stamps the ring.
//
// Gesture listeners sit on `window`, not on .landing-wheel: the wheel box is
// pointer-events:none so the admin link underneath stays clickable. Pointer
// move/up bind to window with NO setPointerCapture -- same rule the R&D
// calendar swipe learned, and it keeps a drag alive when it leaves the item.

var WHEEL_RADIUS = 2;       // slots each side of centre -> five items on screen
var WHEEL_SPIN_MS = 420;    // CSS transition (0.38s) plus a little slack
var WHEEL_STEP_DELTA = 60;  // wheel-event pixels per slot
var WHEEL_DRAG_STEP = 64;   // finger/mouse-drag pixels per slot
var WHEEL_MAX_BURST = 3;    // slots a SINGLE wheel event may carry
var WHEEL_GESTURE_MS = 220; // idle gap that ends a scroll gesture
var WHEEL_TAP_SLOP = 8;     // px of movement that still counts as a tap

var wheelItems = [];
var wheelPos = 0;
var wheelAcc = 0;        // unspent scroll pixels within the current gesture
var wheelLastTick = 0;
var wheelDragging = false;
var wheelStartY = 0;
var wheelTaken = 0;      // slots already consumed by the live drag
var wheelMoved = 0;      // furthest the live press has travelled

function wheelReduced() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Signed slot distance from the active item, taking the SHORT way round the
// ring, so a step across the seam (last -> first) is one slot and not seven.
function wheelOffset(i) {
  var n = wheelItems.length;
  var off = i - wheelPos;
  if (off > n / 2) off -= n;
  if (off < -n / 2) off += n;
  return off;
}

function wheelRender() {
  var park = WHEEL_RADIUS + 1;
  for (var i = 0; i < wheelItems.length; i++) {
    var el = wheelItems[i];
    var off = wheelOffset(i);
    if (Math.abs(off) > WHEEL_RADIUS) {
      // Parked one slot outside the visible ring: transparent, inert, untabbable
      // -- and already in the right place to animate in from when it comes round.
      el.removeAttribute('data-depth');
      el.setAttribute('tabindex', '-1');
      el.style.setProperty('--off', String(off < 0 ? -park : park));
      continue;
    }
    el.setAttribute('data-depth', String(Math.abs(off)));
    el.removeAttribute('tabindex');
    el.style.setProperty('--off', String(off));
  }
}

function wheelStep(d) {
  if (!d) return;
  var n = wheelItems.length;
  wheelPos = ((wheelPos + d) % n + n) % n;
  wheelRender();
}

// One scroll gesture can carry several slots -- a hard flick spins further --
// but every tick still lands ON an item. Leftover pixels are kept so a slow
// scroll accumulates, and dropped once the gesture goes idle so they can't
// bleed into the next one.
function wheelOnScroll(e) {
  if (e.ctrlKey) return;                 // ctrl+wheel is the browser's zoom
  e.preventDefault();
  var now = Date.now();
  if (now - wheelLastTick > WHEEL_GESTURE_MS) wheelAcc = 0;
  wheelLastTick = now;
  var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
  wheelAcc += e.deltaY * unit;
  var steps = (wheelAcc / WHEEL_STEP_DELTA) | 0;   // truncates toward zero
  if (!steps) return;
  if (steps > WHEEL_MAX_BURST) steps = WHEEL_MAX_BURST;
  if (steps < -WHEEL_MAX_BURST) steps = -WHEEL_MAX_BURST;
  wheelAcc -= steps * WHEEL_STEP_DELTA;
  wheelStep(steps);
}

function wheelOnDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  wheelDragging = true;
  wheelStartY = e.clientY;
  wheelTaken = 0;
  wheelMoved = 0;
}

// A drag spins the wheel live under the finger, a slot at a time; because it
// only ever moves in whole slots there is nothing to snap back on release.
function wheelOnMove(e) {
  if (!wheelDragging) return;
  var dy = e.clientY - wheelStartY;
  if (Math.abs(dy) > wheelMoved) wheelMoved = Math.abs(dy);
  var want = (-dy / WHEEL_DRAG_STEP) | 0;   // drag up = wheel forward
  if (want !== wheelTaken) {
    wheelStep(want - wheelTaken);
    wheelTaken = want;
  }
}

function wheelOnUp() { wheelDragging = false; }

// A tap on any of the five spins the wheel to that slot FIRST, then follows the
// link once it has landed. The centre one is already there, so it goes straight
// through. A press that travelled is a drag, not a tap, and navigates nowhere.
function wheelOnClick(e, i) {
  e.preventDefault();
  if (wheelMoved > WHEEL_TAP_SLOP) return;
  var href = wheelItems[i].getAttribute('href');
  if (i === wheelPos) { location.href = href; return; }
  wheelPos = i;
  wheelRender();
  setTimeout(function () { location.href = href; }, wheelReduced() ? 0 : WHEEL_SPIN_MS);
}

function wheelOnKey(e) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); wheelStep(-1); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); wheelStep(1); }
}

function wheelInit() {
  var root = document.getElementById('landing-wheel');
  if (!root) return;
  wheelItems = [].slice.call(root.querySelectorAll('.wheel-item'));
  if (!wheelItems.length) return;
  wheelItems.forEach(function (el, i) {
    el.addEventListener('click', function (e) { wheelOnClick(e, i); });
  });
  window.addEventListener('wheel', wheelOnScroll, {passive: false});
  window.addEventListener('pointerdown', wheelOnDown);
  window.addEventListener('pointermove', wheelOnMove);
  window.addEventListener('pointerup', wheelOnUp);
  window.addEventListener('pointercancel', wheelOnUp);
  window.addEventListener('keydown', wheelOnKey);
  wheelRender();
}

wheelInit();
