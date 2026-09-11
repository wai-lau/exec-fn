/* Tap-to-zoom for anything in the /cc transcript that is a picture: an SVG
 * diagram Claude drew, or a screenshot pasted into the conversation.
 *
 * A diagram is authored for a page, not for a 430px phone held at 1am. Scaled
 * into the column its axis labels land around 6px, and the CRT scanlines cross
 * them, so the thing most worth reading is the thing you cannot read. This
 * opens it full-screen, ABOVE the cyber-* layers (nothing crosses it there),
 * and lets it be pinched.
 *
 * Loaded before cc.js, same global scope, like cc-svg.js. Delegated off
 * #terminal, so it covers content that streams in later with no re-binding.
 *
 * The gesture rules are the ones the landing wheel and the /rd calendar swipe
 * each learned the hard way: touch-action none so the browser does not claim
 * the pan, the PREFIXED -webkit-user-select none (WebKit computes the
 * unprefixed one to `text`, and a drag off a text selection fires the native
 * dragstart, which eats the rest of the gesture), and pointermove/up bound to
 * WINDOW with no setPointerCapture.
 */
'use strict';

const CC_ZOOM_MAX = 8;
// Below fit, deliberately. An svg is fitted by its declared viewBox, and a
// model routinely draws a label past that box -- with overflow visible the ink
// is there but off the screen edge, and pulling back is the only way to see it.
const CC_ZOOM_MIN = 0.5;
const CC_ZOOM_TAP_PX = 8;        // a press that travelled further is a drag
const CC_ZOOM_DBL_MS = 300;
const CC_ZOOM_DBL_K = 2.5;

let ccZoomEl = null;             // the overlay
let ccZoomPan = null;            // the transformed layer
let ccZoomBase = null;           // content rect at k=1, overlay coords
let ccZoomK = 1, ccZoomTx = 0, ccZoomTy = 0;
const ccZoomPtrs = new Map();
let ccZoomStart = null;          // gesture anchor
let ccZoomLastTap = 0;
let ccZoomMoved = 0;

function ccZoomBuild() {
  if (ccZoomEl) return;
  ccZoomEl = document.createElement('div');
  ccZoomEl.id = 'cc-zoom';
  ccZoomEl.hidden = true;
  ccZoomEl.innerHTML =
    '<div id="cc-zoom-pan"></div>' +
    '<button id="cc-zoom-x" aria-label="close">[x]</button>';
  document.body.appendChild(ccZoomEl);
  ccZoomPan = ccZoomEl.querySelector('#cc-zoom-pan');
  ccZoomEl.querySelector('#cc-zoom-x').addEventListener('click', ccZoomClose);
  ccZoomEl.addEventListener('pointerdown', ccZoomDown);
  ccZoomEl.addEventListener('wheel', ccZoomWheel, { passive: false });
  window.addEventListener('pointermove', ccZoomMove);
  window.addEventListener('pointerup', ccZoomUp);
  window.addEventListener('pointercancel', ccZoomUp);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ccZoomEl.hidden) ccZoomClose();
  });
}

/** Open with a CLONE -- the transcript copy is never moved or mutated, so
 *  closing cannot leave a hole where the diagram was. */
function ccZoomOpen(node) {
  ccZoomBuild();
  ccZoomPan.textContent = '';
  ccZoomPan.appendChild(node.cloneNode(true));
  ccZoomK = 1; ccZoomTx = 0; ccZoomTy = 0;
  ccZoomEl.hidden = false;
  ccZoomApply();
  // Measure AFTER the first paint at k=1: that rect is what every later clamp
  // and pinch is expressed against.
  requestAnimationFrame(() => {
    const kid = ccZoomPan.firstElementChild;
    if (!kid) return;
    const r = kid.getBoundingClientRect();
    ccZoomBase = { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

function ccZoomClose() {
  if (!ccZoomEl) return;
  ccZoomEl.hidden = true;
  ccZoomPan.textContent = '';
  ccZoomPtrs.clear();
  ccZoomStart = null;
}

function ccZoomApply() {
  ccZoomPan.style.transform =
    'translate(' + ccZoomTx + 'px,' + ccZoomTy + 'px) scale(' + ccZoomK + ')';
}

/** Keep the picture on screen: centred while it is smaller than the viewport,
 *  and never draggable past its own edge once it is bigger. */
function ccZoomClamp() {
  if (!ccZoomBase) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = ccZoomBase.w * ccZoomK, h = ccZoomBase.h * ccZoomK;
  const x0 = ccZoomBase.x * ccZoomK, y0 = ccZoomBase.y * ccZoomK;
  ccZoomTx = w <= vw ? (vw - w) / 2 - x0
    : Math.min(-x0, Math.max(vw - x0 - w, ccZoomTx));
  ccZoomTy = h <= vh ? (vh - h) / 2 - y0
    : Math.min(-y0, Math.max(vh - y0 - h, ccZoomTy));
}

/** Scale about a viewport point, keeping whatever sits under it fixed. */
function ccZoomTo(k, px, py) {
  const next = Math.max(CC_ZOOM_MIN, Math.min(CC_ZOOM_MAX, k));
  ccZoomTx = px - ((px - ccZoomTx) / ccZoomK) * next;
  ccZoomTy = py - ((py - ccZoomTy) / ccZoomK) * next;
  ccZoomK = next;
  ccZoomClamp();
  ccZoomApply();
}

function ccZoomMid() {
  const p = Array.from(ccZoomPtrs.values());
  if (p.length < 2) return { x: p[0].x, y: p[0].y, d: 0 };
  const dx = p[0].x - p[1].x, dy = p[0].y - p[1].y;
  return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(dx, dy) };
}

function ccZoomDown(e) {
  if (e.target.id === 'cc-zoom-x') return;
  ccZoomPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  ccZoomMoved = 0;
  const m = ccZoomMid();
  ccZoomStart = { x: m.x, y: m.y, d: m.d, k: ccZoomK, tx: ccZoomTx, ty: ccZoomTy };
}

function ccZoomMove(e) {
  if (!ccZoomPtrs.has(e.pointerId) || !ccZoomStart) return;
  const prev = ccZoomPtrs.get(e.pointerId);
  ccZoomMoved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
  ccZoomPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const m = ccZoomMid();

  if (ccZoomPtrs.size >= 2 && ccZoomStart.d > 0) {
    const k = Math.max(CC_ZOOM_MIN, Math.min(CC_ZOOM_MAX, ccZoomStart.k * (m.d / ccZoomStart.d)));
    // The pinch pans as well as scales: the content point under the ORIGINAL
    // midpoint stays under the CURRENT one.
    ccZoomTx = m.x - ((ccZoomStart.x - ccZoomStart.tx) / ccZoomStart.k) * k;
    ccZoomTy = m.y - ((ccZoomStart.y - ccZoomStart.ty) / ccZoomStart.k) * k;
    ccZoomK = k;
  } else {
    ccZoomTx = ccZoomStart.tx + (m.x - ccZoomStart.x);
    ccZoomTy = ccZoomStart.ty + (m.y - ccZoomStart.y);
  }
  ccZoomClamp();
  ccZoomApply();
  e.preventDefault();
}

function ccZoomUp(e) {
  if (!ccZoomPtrs.has(e.pointerId)) return;
  ccZoomPtrs.delete(e.pointerId);
  const wasTap = ccZoomMoved < CC_ZOOM_TAP_PX && ccZoomPtrs.size === 0;
  if (ccZoomPtrs.size === 0) ccZoomStart = null;
  else {
    const m = ccZoomMid();
    ccZoomStart = { x: m.x, y: m.y, d: m.d, k: ccZoomK, tx: ccZoomTx, ty: ccZoomTy };
  }
  if (!wasTap) return;

  const now = Date.now();
  if (now - ccZoomLastTap < CC_ZOOM_DBL_MS) {
    ccZoomLastTap = 0;
    ccZoomTo(Math.abs(ccZoomK - 1) < 0.01 ? CC_ZOOM_DBL_K : 1, e.clientX, e.clientY);
    return;
  }
  ccZoomLastTap = now;
  // A single tap closes only at rest. Once zoomed in, a tap is how you stop a
  // fling, and closing there would throw away the position you just found.
  if (Math.abs(ccZoomK - 1) < 0.01) setTimeout(() => { if (ccZoomLastTap === now) ccZoomClose(); }, CC_ZOOM_DBL_MS);
}

function ccZoomWheel(e) {
  e.preventDefault();
  ccZoomTo(ccZoomK * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
}

/** Delegated: one listener for every picture the transcript will ever hold. */
function ccZoomBind(terminal) {
  if (!terminal) return;
  terminal.addEventListener('click', (e) => {
    const svg = e.target.closest('.cc-svg');
    const img = e.target.closest('.cc-imgs img');
    if (img) { ccZoomOpen(img); return; }
    if (svg && svg.querySelector('svg')) ccZoomOpen(svg.querySelector('svg'));
  });
}

// #terminal is declared above this script in the template, so binding now is
// safe and does not wait on DOMContentLoaded.
ccZoomBind(document.getElementById('terminal'));
