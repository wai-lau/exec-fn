// Landing wheel: drives the ferris wheel on `/`. Same global scope as the rest
// of web/*.js (loaded via <script src>, not a module).
//
// It is a real wheel, not a styled list. The sections are spokes DTH radians
// apart on a ring of radius R, seen EDGE-ON: an item's angle theta decides
// where it sits (y = R sin theta), how far into the screen it has swung
// (1 - cos theta), and therefore how big and how solid it looks. Items stay
// upright as they travel -- ferris wheel gondolas hang level -- so the copy is
// always readable, and the arc shows itself in the spacing instead: slots bunch
// up toward the rim exactly the way the seats of a turning wheel do.
//
// DTH = PI / n is the load-bearing choice. It puts the SEAM -- where an item
// wraps from the bottom of the ring back round to the top -- at exactly 90
// degrees, where a spoke is edge-on and cos(theta) is 0. An item is therefore
// already fully transparent at the instant it teleports, so the ring closes
// with no pop. It also settles how many are on screen: everything inside the
// front half is drawn, which is every item except the one at the seam.
//
// Position is a FLOAT, animated frame by frame, so the wheel really turns
// through the arc instead of tweening in a straight line between two states --
// scale and opacity sweep through the same functions on the way. It is only the
// resting position that is a whole slot: a scroll or a drag always ends snapped
// to an item.
//
// Gesture listeners sit on `window`, not on .landing-wheel: the wheel box is
// pointer-events:none so the admin link underneath stays clickable. Pointer
// move/up bind to window with NO setPointerCapture -- same rule the R&D
// calendar swipe learned, and it keeps a drag alive when it leaves the item.

var WHEEL_PERSPECTIVE = 0.55;  // focal length as a fraction of the radius
var WHEEL_FADE_POW = 1.6;      // how hard a spoke fades as it turns away
var WHEEL_BLUR_PX = 8;         // depth-of-field blur at the seam, in px
var WHEEL_REACH = 1.12;        // how far past the viewport edge the rim may sit
var WHEEL_FILL = 0.68;         // ring radius as a fraction of the half-viewport
var WHEEL_MIN_GAP = 4;         // px of clearance between the two front items
var WHEEL_TAU = 95;            // ms time constant of the settle
var WHEEL_SETTLE = 0.004;      // slots: close enough to call it landed
var WHEEL_STEP_DELTA = 60;     // wheel-event pixels per slot
var WHEEL_MAX_BURST = 3;       // slots a SINGLE wheel event may carry
var WHEEL_GESTURE_MS = 220;    // idle gap that ends a scroll gesture
var WHEEL_TAP_SLOP = 8;        // px of movement that still counts as a tap
var WHEEL_NAV_MAX_MS = 900;    // never hold a tap's navigation longer than this

var wheelItems = [];
var wheelN = 0;
var wheelDth = 0;      // radians between spokes
var wheelR = 0;        // ring radius, px
var wheelPitch = 0;    // px of travel per slot at the front of the wheel
var wheelPos = 0;      // where the wheel is now, in slots (fractional)
var wheelTarget = 0;   // where it is settling to (always a whole slot at rest)
var wheelRaf = 0;
var wheelPrevFrame = 0;
var wheelPending = '';  // href a tap is waiting on the spin to reach
var wheelAcc = 0;       // unspent scroll pixels within the current gesture
var wheelLastTick = 0;
var wheelDragging = false;
var wheelStartY = 0;
var wheelDragFrom = 0;  // wheel position when the drag began
var wheelMoved = 0;     // furthest the live press has travelled

function wheelReduced() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Pick the tightest ring that still fits. K is how many slots it takes to get
// from the front of the wheel to the SEAM, and DTH = (PI/2)/K puts that seam at
// exactly 90 degrees -- edge-on, cos 0, already fully transparent -- so the ring
// closes with no pop whatever K comes out to be. K therefore sets the count:
// 2K-1 items are lit. The loop takes the largest K that neither collides the
// front pair nor pushes the outermost lit item off the screen, which is what
// makes "as many as will fit" an answer the page works out rather than a number
// baked in: seven across a desktop, five on a phone where the same copy runs to
// three and four lines.
//
// WHEEL_FILL is the spacing knob. A ring drawn to the full half-height sets its
// front slots a third of the screen apart, which reads as a list with gaps
// rather than as a wheel; pulling it in tightens every gap at once, as far as
// the front pair will allow.
function wheelGeometry() {
  var half = innerHeight / 2;
  var hs = wheelItems.map(function (el) { return el.offsetHeight; });
  for (var k = Math.floor(wheelN / 2); k >= 1; k--) {
    var dth = Math.PI / 2 / k;
    var s1 = WHEEL_PERSPECTIVE / (WHEEL_PERSPECTIVE + 1 - Math.cos(dth));
    // Only the front pair can collide -- furthest apart in y, and both near full
    // size -- so the clearance is measured over the pairs that actually sit
    // together, with the taller of the two at the front where it is unshrunk.
    var need = 0;
    for (var i = 0; i < wheelN; i++) {
      var a = hs[i], bh = hs[(i + 1) % wheelN];
      var pair = (Math.max(a, bh) + Math.min(a, bh) * s1) / 2 + WHEEL_MIN_GAP;
      if (pair > need) need = pair;
    }
    var r = Math.max(half * WHEEL_FILL, need / Math.sin(dth));
    // The outermost lit item sits one slot inside the seam, and only its CENTRE
    // has to be on screen: a real wheel is bigger than what you can see of it,
    // so the rim bleeds past the edges. Those items are the blurriest and
    // faintest ones, which is what makes the bleed read as depth rather than as
    // clipping -- and letting them go is what keeps the ring tight.
    if (r * Math.sin((k - 1) * dth) <= half * WHEEL_REACH || k === 1) {
      wheelDth = dth;
      wheelR = r;
      wheelPitch = r * dth;   // dy per slot at theta 0, for 1:1 dragging
      return;
    }
  }
}

function wheelRender() {
  var half = wheelN / 2;
  for (var i = 0; i < wheelN; i++) {
    var off = i - wheelPos;
    while (off > half) off -= wheelN;    // always the short way round the ring
    while (off < -half) off += wheelN;
    var c = Math.cos(off * wheelDth);
    var y = wheelR * Math.sin(off * wheelDth);
    // how far the spoke has swung into the screen, and the perspective shrink
    // that follows from it: full size at the front, smallest at the rim.
    var s = WHEEL_PERSPECTIVE / (WHEEL_PERSPECTIVE + 1 - c);
    var o = c > 0 ? Math.pow(c, WHEEL_FADE_POW) : 0;
    // Depth of field: what has swung back is out of focus as well as small and
    // faint. Quantised to a half-pixel, and anything under a pixel dropped
    // outright: a blur radius that changes every frame is a fresh rasterisation
    // every frame, and the nearest pair's sub-pixel blur would buy a full one of
    // those to be invisible. So a spin hands the compositor two distinct radii
    // across four elements rather than a new value on six. WebKit at 430x932
    // holds a 17ms median frame through a spin with the blur on -- 60fps, the
    // same median as with it off.
    var blur = Math.round(WHEEL_BLUR_PX * (1 - c) * 2) / 2;
    if (blur < 1) blur = 0;
    var el = wheelItems[i];
    el.style.transform = 'translate(-50%, calc(-50% + ' + y.toFixed(2) + 'px)) scale(' + s.toFixed(4) + ')';
    el.style.opacity = o.toFixed(4);
    el.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : 'none';
    var lit = o > 0.02;
    el.style.visibility = lit ? 'visible' : 'hidden';
    el.style.pointerEvents = lit ? 'auto' : 'none';
    if (lit) el.removeAttribute('tabindex');
    else el.setAttribute('tabindex', '-1');
  }
}

// Keep the resting position in [0, n) so neither number can drift off across a
// long session; only ever called once the wheel has actually landed.
function wheelNormalize() {
  wheelTarget = ((wheelTarget % wheelN) + wheelN) % wheelN;
  wheelPos = wheelTarget;
}

function wheelLand() {
  wheelNormalize();
  wheelRender();
  if (wheelPending) { var href = wheelPending; wheelPending = ''; location.href = href; }
}

function wheelFrame(now) {
  wheelRaf = 0;
  var dt = wheelPrevFrame ? Math.min(64, now - wheelPrevFrame) : 16;
  wheelPrevFrame = now;
  var diff = wheelTarget - wheelPos;
  if (Math.abs(diff) < WHEEL_SETTLE) { wheelPrevFrame = 0; wheelLand(); return; }
  // exponential approach, driven off real elapsed time so the settle takes the
  // same wall-clock however the frame rate wanders
  wheelPos += diff * (1 - Math.exp(-dt / WHEEL_TAU));
  wheelRender();
  wheelRaf = requestAnimationFrame(wheelFrame);
}

function wheelTick() {
  if (wheelReduced()) { wheelPos = wheelTarget; wheelLand(); return; }
  if (!wheelRaf) { wheelPrevFrame = 0; wheelRaf = requestAnimationFrame(wheelFrame); }
}

function wheelStep(d) {
  if (!d) return;
  wheelTarget += d;
  wheelTick();
}

// Turn to a given item the short way round, wherever the wheel is standing.
function wheelSeek(i) {
  var d = ((i - wheelTarget) % wheelN + wheelN) % wheelN;
  if (d > wheelN / 2) d -= wheelN;
  wheelTarget += d;
  wheelTick();
}

// One scroll gesture can carry several slots -- a hard flick spins further --
// but the wheel always comes to rest ON an item. Leftover pixels are kept so a
// slow scroll accumulates, and dropped once the gesture goes idle so they can't
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
  // Past the cap there is unspent delta left over -- a single 1000px flick banks
  // enough for three more bursts, and a trackpad's momentum train would cash it
  // in and spin the wheel half way round. Only a capped event can leave a whole
  // slot behind, so that is exactly the case this drops.
  if (Math.abs(wheelAcc) >= WHEEL_STEP_DELTA) wheelAcc = 0;
  wheelStep(steps);
}

function wheelOnDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  wheelDragging = true;
  wheelStartY = e.clientY;
  wheelDragFrom = wheelPos;
  wheelMoved = 0;
}

// A drag turns the wheel under the finger, continuously and at 1:1 -- there is
// no stepping while the hand is down, which is what makes it feel like a wheel
// rather than a list. The snap happens on release.
function wheelOnMove(e) {
  if (!wheelDragging) return;
  var dy = e.clientY - wheelStartY;
  if (Math.abs(dy) > wheelMoved) wheelMoved = Math.abs(dy);
  wheelPos = wheelDragFrom - dy / wheelPitch;
  wheelTarget = wheelPos;
  wheelRender();
}

function wheelOnUp() {
  if (!wheelDragging) return;
  wheelDragging = false;
  wheelTarget = Math.round(wheelPos);
  wheelTick();
}

// A tap on any lit item turns the wheel to that slot FIRST, then follows the
// link once it has landed. The one already at the front goes straight through.
// A press that travelled is a drag, not a tap, and navigates nowhere.
function wheelOnClick(e, i) {
  e.preventDefault();
  if (wheelMoved > WHEEL_TAP_SLOP) return;
  var href = wheelItems[i].getAttribute('href');
  if (i === (((Math.round(wheelTarget) % wheelN) + wheelN) % wheelN)) { location.href = href; return; }
  wheelPending = href;
  wheelSeek(i);
  // a stalled rAF (backgrounded tab) must never strand the tap
  setTimeout(function () {
    if (wheelPending === href) { wheelPending = ''; location.href = href; }
  }, WHEEL_NAV_MAX_MS);
}

function wheelOnKey(e) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); wheelStep(-1); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); wheelStep(1); }
}

function wheelRemeasure() { wheelGeometry(); wheelRender(); }

function wheelInit() {
  var root = document.getElementById('landing-wheel');
  if (!root) return;
  wheelItems = [].slice.call(root.querySelectorAll('.wheel-item'));
  wheelN = wheelItems.length;
  if (!wheelN) return;
  wheelItems.forEach(function (el, i) {
    el.addEventListener('click', function (e) { wheelOnClick(e, i); });
  });
  window.addEventListener('wheel', wheelOnScroll, {passive: false});
  window.addEventListener('pointerdown', wheelOnDown);
  window.addEventListener('pointermove', wheelOnMove);
  window.addEventListener('pointerup', wheelOnUp);
  window.addEventListener('pointercancel', wheelOnUp);
  window.addEventListener('keydown', wheelOnKey);
  window.addEventListener('resize', wheelRemeasure);
  // The radius is derived from the tallest item, so it has to be re-derived
  // whenever an item's box changes -- the bit webfont landing re-wraps every
  // blurb, and no resize event fires for a reflow. Same idiom as --nav-h.
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(wheelRemeasure);
    wheelItems.forEach(function (el) { ro.observe(el); });
  }
  wheelRemeasure();
}

wheelInit();
