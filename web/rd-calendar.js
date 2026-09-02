// R&D month calendar: the grid under the reminders/books bars, its dots, and
// the drag/swipe month paging. Same global scope as rd.js (loaded before it via
// <script>, not modules) -- it reads `cards` and calls esc()/dotColor()/
// dotUnits(), and rd.js calls buildCalendar()/wireCalendarSwipe()/_syncCalH().
// Split out of rd.js to keep both files under the 500-line cap.
// One month at a time, Sunday-first, so the grid is 4-6 rows depending on how
// the month falls. Cells are inert -- no hover, no click -- but the band itself
// is a gesture surface: drag or swipe it sideways to page months.

function _isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// one dot per card landing on a day: its scheduled_day, else its due date.
// Books live on their own bar and carry no meaningful day. ARCHIVED cards still
// count -- they happened on their day, and a month with the finished work
// erased reads as emptier than the month actually was. Exiled cards do not:
// those were dropped, so nothing happened on that day at all.
//
// But an archived card only counts on a day that has ALREADY happened. Its day
// here comes from due_date, and a card finished EARLY keeps a due_date in the
// future -- so finished work drew itself onto a day where nothing is going to
// happen. On a recurring card that also double-books the future: archiving one
// clones the next occurrence as its own card, so the series was represented
// twice from then on.
//
// Each value carries the dot's colour (category hue) AND
// its length in circle-widths (importance), so the day reads as both a mix of
// what's on it and how heavy it is -- not just how much.
function calDots() {
  const m = {};
  const today = _isoLocal(new Date());
  cards.forEach(c => {
    if (c.is_book || c.column === 'exile') return;
    const day = c.scheduled_day || (c.due_date ? c.due_date.slice(0, 10) : null);
    if (!day) return;
    if (c.column === 'archives' && day > today) return;
    (m[day] = m[day] || []).push({color: dotColor(c), units: dotUnits(c)});
  });
  return m;
}

function _calCellHtml(d, dots, todayMs) {
  const dow = d.getDay();
  const cls = ['cal-d'];
  if (dow === 0 || dow === 6) cls.push('we');
  if (dow === 6) cls.push('cal-eow');   // last column: no dangling right stub
  const ahead = Math.round((d.getTime() - todayMs) / 86400000);
  if (ahead >= 0 && ahead <= 6) cls.push('cw');
  if (ahead === 0) cls.push('today');
  if (typeof QcHolidays !== 'undefined' && QcHolidays.isQcHoliday(d)) cls.push('hol');
  // Every dot is rendered; fitCalDots() decides afterwards how many actually fit
  // on the row. The "+" ships with the cell (hidden) so the fitter can measure
  // with it in place instead of reflowing once to add it.
  const day = dots[_isoLocal(d)] || [];
  return `<div class="${cls.join(' ')}">
    <div class="cal-n">${String(d.getDate()).padStart(2, '0')}</div>
    <div class="cal-dots">${day.map(d => `<i class="cal-u${d.units}" style="background:${d.color}"></i>`).join('')}<b class="cal-more" hidden>+</b></div>
  </div>`;
}

// Months away from the present one. Deliberately a plain module variable, so a
// page load ALWAYS opens on the present month -- nothing is persisted.
let calOffset = 0;

function buildCalendar() {
  const el = document.getElementById('rd-calendar');
  if (!el) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  // today's classes are keyed off the REAL today, so a navigated month simply
  // has no today/this-week cells rather than lighting the wrong ones
  const shown = new Date(today.getFullYear(), today.getMonth() + calOffset, 1);
  const y = shown.getFullYear(), mo = shown.getMonth();
  const lead = new Date(y, mo, 1).getDay();          // blank cells before the 1st
  const days = new Date(y, mo + 1, 0).getDate();
  const rows = Math.ceil((lead + days) / 7);         // 4, 5 or 6 - never a spare row
  const dots = calDots();
  let html = '';
  for (let i = 0; i < rows * 7; i++) {
    const dom = i - lead + 1;
    if (dom < 1 || dom > days) {
      // out-of-month padding: no number, but the weekend column keeps its
      // shading so the two dark columns run unbroken top to bottom
      const edge = i % 7 === 6;
      html += `<div class="cal-d${(i % 7 === 0 || edge) ? ' we' : ''}${edge ? ' cal-eow' : ''}"></div>`;
      continue;
    }
    html += _calCellHtml(new Date(y, mo, dom), dots, todayMs);
  }
  // Month number as a big faint watermark BEHIND the grid (see .cal-mark) --
  // it takes no space, so it can be there always without costing a row and
  // without resizing the calendar mid-swipe.
  //
  // Arrows point the way BACK to the present month: a past month reads "08 >>"
  // (go forward to reach today), a future one "<< 10". The present month points
  // INWARD, "> 09 <" -- you are here, both ways lead away. Direction alone
  // carries it, so no year is shown: a month is only ambiguous once you are 12+
  // away, which is further than this is meant to be dragged.
  const mm = String(mo + 1).padStart(2, '0');
  const markEl = document.getElementById('cal-mark');
  if (markEl) markEl.textContent = calOffset === 0 ? `> ${mm} <` : calOffset < 0 ? `${mm} >>` : `<< ${mm}`;
  el.innerHTML = html;
  fitCalDots();
  _syncCalH();
}

// Dots are a single row that never wraps and never shrinks, so a busy day can
// hold more than the cell is wide. Show as many whole dots as fit and mark the
// remainder with a trailing "+" -- a clipped half-dot would misreport a card's
// size, which is the one thing the dot's length is for.
//
// Measured rather than counted: dots are 1-4 units wide, so "how many fit" has
// no fixed answer, and the cell width moves with the viewport.
// Span of the visible children vs the row's own width. NOT scrollWidth: the row
// is justify-content:center, so overflow spills out BOTH sides and scrollWidth
// never reports it -- it read "fits" for a row nine dots too wide.
function _dotsFit(row) {
  const kids = [...row.children].filter(k => !k.hidden);
  if (!kids.length) return true;
  const first = kids[0].getBoundingClientRect();
  const last = kids[kids.length - 1].getBoundingClientRect();
  return (last.right - first.left) <= row.getBoundingClientRect().width + 0.5;
}

function fitCalDots() {
  document.querySelectorAll('#rd-calendar .cal-dots').forEach(row => {
    const more = row.querySelector('.cal-more');
    const dots = [...row.querySelectorAll('i')];
    dots.forEach(d => { d.hidden = false; });
    if (more) more.hidden = true;
    if (_dotsFit(row)) return;                 // everything fits as-is
    if (more) more.hidden = false;             // from here on, measure WITH the "+"
    for (let i = dots.length - 1; i >= 0; i--) {
      dots[i].hidden = true;
      if (_dotsFit(row)) break;
    }
  });
}

function _syncCalH() {
  const el = document.getElementById('rd-calendar');
  if (el) document.documentElement.style.setProperty('--cal-h', el.offsetHeight + 'px');
}

// Step the calendar by whole months. A month with a different number of weeks
// changes the grid's height, and .rd-board's top inset is computed from
// --cal-h, so the board re-anchors itself as soon as _syncCalH runs.
function calStep(months) {
  calOffset += months;
  buildCalendar();
}

// Drag (mouse) / swipe (touch) the calendar sideways to page through months.
// Pointer events cover both. Dragging RIGHT reveals what came before, so it
// goes to the previous month; dragging left goes forward.
//
// Exactly ONE month per gesture: the step fires the moment the threshold is
// crossed and then locks until the pointer is released. Re-anchoring instead
// (letting a long drag page repeatedly) made the distance-to-months mapping
// depend on how many pointermove events the browser happened to coalesce, so
// the same swipe moved one month or two.
function wireCalendarSwipe() {
  const el = document.getElementById('rd-calendar');
  if (!el) return;
  const STEP_PX = 45;   // far enough that a stray tap or a jittery click never pages
  let x0 = null, stepped = false;

  // move/up live on WINDOW, not on the calendar, and there is deliberately no
  // setPointerCapture: stepping rebuilds the calendar's children mid-gesture,
  // and capturing to an element whose subtree is then replaced silently killed
  // the rest of the gesture -- the browser stopped delivering pointermove AND
  // pointerup, so the next swipe in the other direction went nowhere. Window
  // listeners are indifferent to the rebuild.
  function move(e) {
    if (x0 === null || stepped) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) < STEP_PX) return;
    stepped = true;
    calStep(dx > 0 ? -1 : 1);
  }
  function end() {
    x0 = null;
    stepped = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  }
  // Belt for the same failure the CSS user-select guards against: if a drag
  // ever does start a native text drag, the browser stops delivering pointer
  // events and the gesture dies silently. Refusing dragstart costs nothing --
  // there is nothing here anyone should be dragging out.
  el.addEventListener('dragstart', e => e.preventDefault());

  el.addEventListener('pointerdown', e => {
    x0 = e.clientX;
    stepped = false;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}
