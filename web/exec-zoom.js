/* Tap-to-zoom for anything in the Exec transcript that is a picture: an SVG
 * diagram Claude drew, or a screenshot pasted into the conversation.
 *
 * A diagram is authored for a page, not for a 430px phone held at 1am. Scaled
 * into the column its axis labels land around 6px, and the CRT scanlines cross
 * them, so the thing most worth reading is the thing you cannot read. This
 * opens it full-screen, ABOVE the cyber-* layers (nothing crosses it there),
 * and lets it be pinched.
 *
 * Loaded before exec-bubble.js, same global scope, like exec-svg.js. Delegated off
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

const EXEC_ZOOM_MAX = 8;
// Below fit, deliberately. An svg is fitted by its declared viewBox, and a
// model routinely draws a label past that box -- with overflow visible the ink
// is there but off the screen edge, and pulling back is the only way to see it.
const EXEC_ZOOM_MIN = 0.5;
const EXEC_ZOOM_TAP_PX = 8;        // a press that travelled further is a drag
const EXEC_ZOOM_DBL_MS = 300;
const EXEC_ZOOM_DBL_K = 2.5;

let execZoomEl = null;             // the overlay
let execZoomPan = null;            // the transformed layer
let execZoomBase = null;           // content rect at k=1, overlay coords
let execZoomK = 1, execZoomTx = 0, execZoomTy = 0;
const execZoomPtrs = new Map();
let execZoomStart = null;          // gesture anchor
let execZoomLastTap = 0;
let execZoomMoved = 0;

function execZoomBuild() {
  if (execZoomEl) return;
  execZoomEl = document.createElement('div');
  execZoomEl.id = 'exec-zoom';
  execZoomEl.hidden = true;
  execZoomEl.innerHTML =
    '<div id="exec-zoom-pan"></div>' +
    '<button id="exec-zoom-x" aria-label="close">[x]</button>';
  document.body.appendChild(execZoomEl);
  execZoomPan = execZoomEl.querySelector('#exec-zoom-pan');
  execZoomEl.querySelector('#exec-zoom-x').addEventListener('click', execZoomClose);
  execZoomEl.addEventListener('pointerdown', execZoomDown);
  execZoomEl.addEventListener('wheel', execZoomWheel, { passive: false });
  window.addEventListener('pointermove', execZoomMove);
  window.addEventListener('pointerup', execZoomUp);
  window.addEventListener('pointercancel', execZoomUp);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !execZoomEl.hidden) execZoomClose();
  });
}

/** Open with a CLONE -- the transcript copy is never moved or mutated, so
 *  closing cannot leave a hole where the diagram was. */
function execZoomOpen(node) {
  execZoomBuild();
  execZoomPan.textContent = '';
  execZoomPan.appendChild(node.cloneNode(true));
  execZoomK = 1; execZoomTx = 0; execZoomTy = 0;
  execZoomEl.hidden = false;
  execZoomApply();
  // Measure AFTER the first paint at k=1: that rect is what every later clamp
  // and pinch is expressed against.
  requestAnimationFrame(() => {
    const kid = execZoomPan.firstElementChild;
    if (!kid) return;
    const r = kid.getBoundingClientRect();
    execZoomBase = { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

function execZoomClose() {
  if (!execZoomEl) return;
  execZoomEl.hidden = true;
  execZoomPan.textContent = '';
  execZoomPtrs.clear();
  execZoomStart = null;
}

function execZoomApply() {
  execZoomPan.style.transform =
    'translate(' + execZoomTx + 'px,' + execZoomTy + 'px) scale(' + execZoomK + ')';
}

/** Keep the picture on screen: centred while it is smaller than the viewport,
 *  and never draggable past its own edge once it is bigger. */
function execZoomClamp() {
  if (!execZoomBase) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = execZoomBase.w * execZoomK, h = execZoomBase.h * execZoomK;
  const x0 = execZoomBase.x * execZoomK, y0 = execZoomBase.y * execZoomK;
  execZoomTx = w <= vw ? (vw - w) / 2 - x0
    : Math.min(-x0, Math.max(vw - x0 - w, execZoomTx));
  execZoomTy = h <= vh ? (vh - h) / 2 - y0
    : Math.min(-y0, Math.max(vh - y0 - h, execZoomTy));
}

/** Scale about a viewport point, keeping whatever sits under it fixed. */
function execZoomTo(k, px, py) {
  const next = Math.max(EXEC_ZOOM_MIN, Math.min(EXEC_ZOOM_MAX, k));
  execZoomTx = px - ((px - execZoomTx) / execZoomK) * next;
  execZoomTy = py - ((py - execZoomTy) / execZoomK) * next;
  execZoomK = next;
  execZoomClamp();
  execZoomApply();
}

function execZoomMid() {
  const p = Array.from(execZoomPtrs.values());
  if (p.length < 2) return { x: p[0].x, y: p[0].y, d: 0 };
  const dx = p[0].x - p[1].x, dy = p[0].y - p[1].y;
  return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(dx, dy) };
}

function execZoomDown(e) {
  if (e.target.id === 'exec-zoom-x') return;
  execZoomPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  execZoomMoved = 0;
  const m = execZoomMid();
  execZoomStart = { x: m.x, y: m.y, d: m.d, k: execZoomK, tx: execZoomTx, ty: execZoomTy };
}

function execZoomMove(e) {
  if (!execZoomPtrs.has(e.pointerId) || !execZoomStart) return;
  const prev = execZoomPtrs.get(e.pointerId);
  execZoomMoved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
  execZoomPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const m = execZoomMid();

  if (execZoomPtrs.size >= 2 && execZoomStart.d > 0) {
    const k = Math.max(EXEC_ZOOM_MIN, Math.min(EXEC_ZOOM_MAX, execZoomStart.k * (m.d / execZoomStart.d)));
    // The pinch pans as well as scales: the content point under the ORIGINAL
    // midpoint stays under the CURRENT one.
    execZoomTx = m.x - ((execZoomStart.x - execZoomStart.tx) / execZoomStart.k) * k;
    execZoomTy = m.y - ((execZoomStart.y - execZoomStart.ty) / execZoomStart.k) * k;
    execZoomK = k;
  } else {
    execZoomTx = execZoomStart.tx + (m.x - execZoomStart.x);
    execZoomTy = execZoomStart.ty + (m.y - execZoomStart.y);
  }
  execZoomClamp();
  execZoomApply();
  e.preventDefault();
}

function execZoomUp(e) {
  if (!execZoomPtrs.has(e.pointerId)) return;
  execZoomPtrs.delete(e.pointerId);
  const wasTap = execZoomMoved < EXEC_ZOOM_TAP_PX && execZoomPtrs.size === 0;
  if (execZoomPtrs.size === 0) execZoomStart = null;
  else {
    const m = execZoomMid();
    execZoomStart = { x: m.x, y: m.y, d: m.d, k: execZoomK, tx: execZoomTx, ty: execZoomTy };
  }
  if (!wasTap) return;

  const now = Date.now();
  if (now - execZoomLastTap < EXEC_ZOOM_DBL_MS) {
    execZoomLastTap = 0;
    execZoomTo(Math.abs(execZoomK - 1) < 0.01 ? EXEC_ZOOM_DBL_K : 1, e.clientX, e.clientY);
    return;
  }
  execZoomLastTap = now;
  // A single tap closes only at rest. Once zoomed in, a tap is how you stop a
  // fling, and closing there would throw away the position you just found.
  if (Math.abs(execZoomK - 1) < 0.01) setTimeout(() => { if (execZoomLastTap === now) execZoomClose(); }, EXEC_ZOOM_DBL_MS);
}

function execZoomWheel(e) {
  e.preventDefault();
  execZoomTo(execZoomK * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
}

/** Delegated: one listener for every picture the transcript will ever hold. */
function execZoomBind(terminal) {
  if (!terminal) return;
  terminal.addEventListener('click', (e) => {
    const svg = e.target.closest('.exec-svg');
    const img = e.target.closest('.exec-imgs img');
    if (img) { execZoomOpen(img); return; }
    if (svg && svg.querySelector('svg')) execZoomOpen(svg.querySelector('svg'));
  });
}

// Bound by exec-bubble.js once #exec-term exists.
