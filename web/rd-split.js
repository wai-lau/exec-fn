// /rd desktop pane splitters + calendar auto-fit (rd-split.css).
//
// Three panes: the left stack (books, date, calendar, reminders), the notes
// beside it, the board under both. On desktop (>= 1000px) two handles move the
// lines between them:
//   --rd-split-x  the left stack's width (vertical handle)
//   --rd-top-h    the whole band's height (horizontal handle); unset = the
//                 band is as tall as its content, the old layout
// Both are kept as fractions of the window in localStorage (rd.split), so a
// resized window keeps the proportions. Double-click a handle to reset it.
//
// Auto-fit: the calendar's date size and pill size follow its cells. With no
// band height set the date only SHRINKS to fit a narrow pane (the default look
// is unchanged); with one set, it grows to fill the taller cells as well.

const RD_SPLIT_KEY = 'rd.split';
const RD_DESK = window.matchMedia('(min-width: 1000px)');
const RD_MIN_LEFT = 300, RD_MIN_RIGHT = 240;   // px, either side of the line
const RD_MIN_BOARD = 160;                      // px of board above the nav
const RD_MIN_CELL = 30;                        // px, smallest calendar row

let _rdSplit = _rdLoadSplit();
let _rdCalBaseFs = 0;

function _rdLoadSplit() {
  try { return JSON.parse(localStorage.getItem(RD_SPLIT_KEY)) || {}; } catch (e) { return {}; }
}
function _rdSaveSplit() {
  try { localStorage.setItem(RD_SPLIT_KEY, JSON.stringify(_rdSplit)); } catch (e) { /* private mode: sizes just do not persist */ }
}

function _rdVar(name) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}
function _rdBarsH() { return _rdVar('--books-bar-h') + _rdVar('--date-h') + _rdVar('--rem-bar-h'); }
function _rdCalRows() {
  const cal = document.getElementById('rd-calendar');
  return cal ? Math.max(4, Math.ceil(cal.children.length / 7)) : 6;
}

function _rdClampX(px) {
  return Math.min(Math.max(px, RD_MIN_LEFT), window.innerWidth - RD_MIN_RIGHT);
}
function _rdClampTop(px) {
  const lo = _rdBarsH() + _rdCalRows() * RD_MIN_CELL;
  const hi = window.innerHeight - _rdVar('--nav-h') - RD_MIN_BOARD;
  return Math.max(lo, Math.min(px, hi));
}

// Publish the stored split as CSS vars (desktop) or clear it (phone).
function rdApplySplit() {
  const root = document.documentElement;
  const desk = RD_DESK.matches;
  root.classList.toggle('rd-split-on', desk);
  if (desk && _rdSplit.x) root.style.setProperty('--rd-split-x', _rdClampX(_rdSplit.x * window.innerWidth) + 'px');
  else root.style.removeProperty('--rd-split-x');
  const fixed = desk && !!_rdSplit.top;
  root.classList.toggle('rd-top-fixed', fixed);
  if (fixed) root.style.setProperty('--rd-top-h', _rdClampTop(_rdSplit.top * window.innerHeight) + 'px');
  else root.style.removeProperty('--rd-top-h');
  rdFitCalendar();
}

// Size the pills to the cell's width, pack them, then size the date to what
// is left. Packing depends only on width and the date only on height, so one
// pass settles it. Called from buildCalendar in place of packCalDots.
function rdFitCalendar() {
  const cal = document.getElementById('rd-calendar');
  if (!cal) return;
  if (!RD_DESK.matches) {
    cal.style.fontSize = '';
    cal.style.removeProperty('--cal-dot-fit');
    packCalDots();
    if (typeof _syncCalH === 'function') _syncCalH();
    return;
  }
  if (!_rdCalBaseFs) {
    cal.style.fontSize = '';
    _rdCalBaseFs = parseFloat(getComputedStyle(cal).fontSize) || 21;
  }
  const cellW = cal.clientWidth / 7;
  cal.style.setProperty('--cal-dot-fit', Math.max(4, Math.min(10, Math.round(cellW / 26))) + 'px');
  packCalDots();
  // Two bold mono digits are ~1.2em wide; keep a margin either side.
  let fs = Math.min(_rdCalBaseFs, cellW * 0.4);
  if (document.documentElement.classList.contains('rd-top-fixed')) {
    const rowH = cal.clientHeight / _rdCalRows();
    let dotsH = 0;
    cal.querySelectorAll('.cal-dots').forEach(d => { dotsH = Math.max(dotsH, d.offsetHeight); });
    const cell = cal.querySelector('.cal-d');
    const cs = cell ? getComputedStyle(cell) : null;
    const chrome = cs ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth) : 17;
    fs = Math.min(cellW * 0.4, (rowH - chrome - dotsH) * 0.85);
  }
  cal.style.fontSize = Math.max(10, Math.floor(fs)) + 'px';
  if (typeof _syncCalH === 'function') _syncCalH();
}

let _rdFitQueued = false;
function _rdQueueFit() {
  if (_rdFitQueued) return;
  _rdFitQueued = true;
  requestAnimationFrame(() => { _rdFitQueued = false; rdApplySplit(); });
}

function _rdWireHandle(el, axis) {
  function move(e) {
    if (axis === 'x') _rdSplit.x = _rdClampX(e.clientX) / window.innerWidth;
    else _rdSplit.top = _rdClampTop(e.clientY) / window.innerHeight;
    _rdQueueFit();
  }
  function end() {
    el.classList.remove('active');
    document.body.classList.remove('rd-resizing', 'rd-resizing-x', 'rd-resizing-y');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    _rdSaveSplit();
  }
  // Window listeners, no setPointerCapture: same reason as wireCalendarSwipe.
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.classList.add('active');
    document.body.classList.add('rd-resizing', 'rd-resizing-' + axis);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
  el.addEventListener('dblclick', () => {
    delete _rdSplit[axis === 'x' ? 'x' : 'top'];
    _rdSaveSplit();
    rdApplySplit();
  });
}

(function initRdSplit() {
  for (const [cls, axis, title] of [['rd-split-v', 'x', 'drag to resize, double-click to reset'],
                                    ['rd-split-h', 'y', 'drag to resize, double-click to reset']]) {
    const el = document.createElement('div');
    el.className = cls;
    el.title = title;
    document.body.appendChild(el);
    _rdWireHandle(el, axis);
  }
  RD_DESK.addEventListener('change', rdApplySplit);
  // A bar above or below the calendar changing height (a reminder added, the
  // webfont landing) resizes a fixed-height calendar; refit when its box moves.
  const cal = document.getElementById('rd-calendar');
  if (cal && typeof ResizeObserver !== 'undefined') {
    let last = '';
    new ResizeObserver(() => {
      const key = cal.clientWidth + 'x' + (document.documentElement.classList.contains('rd-top-fixed') ? cal.clientHeight : 0);
      if (key !== last) { last = key; _rdQueueFit(); }
    }).observe(cal);
  }
  window.addEventListener('resize', _rdQueueFit);
  rdApplySplit();
})();
