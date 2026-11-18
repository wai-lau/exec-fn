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
// A recurring card exists as exactly ONE live occurrence -- archiving it is what
// clones the next -- so the months ahead read empty even though a weekly series
// will land in them every week. Project each LIVE recurring card forward from
// its own day, out to this horizon, and dot the projections like the real thing:
// same commitment, just not instantiated yet. Past occurrences are never
// projected -- the archived cards already hold those.
const _RECUR_HORIZON_MONTHS = 2;

// One recurrence step, mirroring helpers._advance_recurrence on the server so
// the two never disagree about where the next one lands. Day-of-month is
// CLAMPED: a 31st stepping into a 30-day month lands on the 30th, where
// new Date(y, mo, 31) would roll over into the next month instead.
function _advanceRecur(d, type) {
  const y = d.getFullYear(), mo = d.getMonth(), dom = d.getDate();
  if (type === 'week') return new Date(y, mo, dom + 7);
  if (type === 'bi-week') return new Date(y, mo, dom + 14);
  if (type === 'month') {
    const ny = mo < 11 ? y : y + 1, nm = (mo + 1) % 12;
    return new Date(ny, nm, Math.min(dom, new Date(ny, nm + 1, 0).getDate()));
  }
  // Annual, so nothing inside a two-month horizon -- kept for parity with the
  // server's step table rather than for what it contributes here.
  if (type === 'holiday' || type === 'birthday') return new Date(y + 1, mo, dom);
  return null;
}

function calDots() {
  const m = {};
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const today = _isoLocal(now);
  const horizon = new Date(now.getFullYear(), now.getMonth() + _RECUR_HORIZON_MONTHS, now.getDate());
  cards.forEach(c => {
    if (c.is_book || c.column === 'exile') return;
    const day = c.scheduled_day || (c.due_date ? c.due_date.slice(0, 10) : null);
    if (!day) return;
    if (c.column === 'archives' && day > today) return;
    const dot = {color: dotColor(c), units: dotUnits(c)};
    (m[day] = m[day] || []).push(dot);
    if (!c.recur_type || c.column === 'archives') return;
    const [yy, mm, dd] = day.split('-').map(Number);
    let cur = new Date(yy, mm - 1, dd);   // built from parts: "2026-09-03" parses as UTC
    for (let i = 0; i < 64 && cur; i++) {
      cur = _advanceRecur(cur, c.recur_type);
      if (!cur || cur > horizon) break;
      const k = _isoLocal(cur);
      (m[k] = m[k] || []).push(dot);
    }
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
  // Every pill is rendered; packCalDots() lays them out once the cell has a
  // width, so the day grows instead of clipping.
  const day = dots[_isoLocal(d)] || [];
  // data-day marks the cell as a drop target (wireCalendarDrops); the
  // out-of-month padding cells deliberately have none.
  return `<div class="${cls.join(' ')}" data-day="${_isoLocal(d)}">
    <div class="cal-n">${String(d.getDate()).padStart(2, '0')}</div>
    <div class="cal-dots">${day.map(d => `<i data-u="${d.units}" style="background:${d.color}"></i>`).join('')}</div>
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
  packCalDots();
  wireCalendarDrops();
  _syncCalH();
}

// ── drop a card on a day ────────────────────────────────────────────────────
// Each in-month cell is a Sortable list in the board's own 'rd' group, so
// dragging a card onto a date is the same gesture as dragging it between
// columns -- it just lands on a day instead. sort:false and an immediate
// remove() in onAdd mean nothing ever actually lives in a cell; the card is
// only passing through, and rd.css hides it while it hovers (a real card laid
// into a 40px grid cell would resize the calendar mid-drag, which moves the
// board under the finger).
//
// Only the board columns can drop here. The reminders bar is excluded on
// purpose: its onRemove reads any exit as "no longer a reminder", so a chip
// dropped on a date would silently clear the flag as well as set the date.
let _calDrops = [];

function wireCalendarDrops() {
  _calDrops.forEach(s => s.destroy());
  _calDrops = [];
  if (typeof Sortable === 'undefined') return;
  document.querySelectorAll('#rd-calendar .cal-d[data-day]').forEach(cell => {
    _calDrops.push(Sortable.create(cell, {
      sort: false,
      group: {name: 'rd', pull: false, put: (to, from) => (from.el.id || '').startsWith('col-')},
      onAdd: evt => {
        evt.item.remove();
        queueCalDrop(evt.item.dataset.id, cell.dataset.day);
      },
    }));
  });
}

// The drop is POSTed only AFTER the board's own save() lands (rd.js chains
// flushCalDrop onto it). Both writes touch the same card: save() sends every
// card's {column, order} from the local array, where this one still reads as
// the column it was dragged OUT of -- fired concurrently it could land last
// and undo the promotion to hq. Sequenced, the board saves the stale column
// and the drop then moves it for real.
let _pendingCalDrop = null;

function queueCalDrop(id, day) {
  if (id && day) _pendingCalDrop = {id, day};
}

async function flushCalDrop() {
  if (!_pendingCalDrop) return;
  const {id, day} = _pendingCalDrop;
  _pendingCalDrop = null;
  let r;
  try {
    r = await fetch(`/api/rd/${id}/schedule`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({date: day}),
    });
  } catch (e) {
    calToast('offline — the drop did not save');
    return load();
  }
  const body = await r.json().catch(() => ({}));
  if (r.status === 409) calToast('active nudge — talk to Exec before moving this later');
  else if (!r.ok) calToast(body.detail || 'could not schedule that');
  else if (body.note) calToast(`due ${day} — beyond the week, waiting in r&d`);
  await load();
}

// Only ever says something the drop itself doesn't already show: a refusal, or
// a date too far out to have moved the card anywhere visible.
let _calToastTimer = null;

function calToast(msg) {
  let el = document.getElementById('rd-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rd-toast';
    el.className = 'rd-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_calToastTimer);
  _calToastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── pack a day's pills ──────────────────────────────────────────────────────
// A day is a grid of --cal-dot squares; a pill of length L covers L cells in
// a line, lying down or standing up. Find the fewest rows that hold every pill
// in the columns the cell has room for, then the fewest columns at that many
// rows -- the smallest box, centred. Exact search (first free cell in reading
// order: a pill across, a pill down, or leave it empty); days are small, and a
// node cap falls back to one more row rather than ever stalling a rebuild.
const _PACK_NODE_CAP = 20000;

function _packInto(lens, rows, cols) {
  const counts = [0, 0, 0, 0, 0];
  lens.forEach(l => { counts[l]++; });
  const area = lens.reduce((a, b) => a + b, 0);
  const free = new Array(rows * cols).fill(true);
  const out = [];
  let nodes = 0;
  const fits = (r, c, l, down) => {
    for (let k = 0; k < l; k++) {
      const rr = down ? r + k : r, cc = down ? c : c + k;
      if (rr >= rows || cc >= cols || !free[rr * cols + cc]) return false;
    }
    return true;
  };
  const mark = (r, c, l, down, v) => {
    for (let k = 0; k < l; k++) free[(down ? r + k : r) * cols + (down ? c : c + k)] = v;
  };
  function dfs(pos, spare, left) {
    if (left === 0) return true;
    if (++nodes > _PACK_NODE_CAP) return false;
    while (pos < free.length && !free[pos]) pos++;
    if (pos >= free.length) return false;
    const r = Math.floor(pos / cols), c = pos % cols;
    for (let l = 4; l >= 1; l--) {
      if (!counts[l]) continue;
      for (const down of l === 1 ? [false] : [false, true]) {
        if (!fits(r, c, l, down)) continue;
        mark(r, c, l, down, false); counts[l]--; out.push({r, c, l, down});
        if (dfs(pos + 1, spare, left - 1)) return true;
        out.pop(); counts[l]++; mark(r, c, l, down, true);
      }
    }
    if (spare > 0) {
      free[pos] = false;
      const ok = dfs(pos + 1, spare - 1, left);
      free[pos] = true;
      if (ok) return true;
    }
    return false;
  }
  return dfs(0, rows * cols - area, lens.length) ? out : null;
}

function packPills(lens, maxCols) {
  const area = lens.reduce((a, b) => a + b, 0);
  const cols0 = Math.max(1, maxCols);
  for (let rows = Math.ceil(area / cols0); rows <= area; rows++) {
    let best = null, bestCols = 0;
    for (let cols = cols0; cols >= 1 && cols * rows >= area; cols--) {
      const got = _packInto(lens, rows, cols);
      if (!got) break;
      best = got; bestCols = cols;
    }
    if (best) return {cols: bestCols, place: best};
  }
  return null;
}

function packCalDots() {
  document.querySelectorAll('#rd-calendar .cal-dots').forEach(row => {
    const pills = [...row.querySelectorAll('i')];
    if (!pills.length) return;
    const cs = getComputedStyle(row);
    const dot = parseFloat(cs.getPropertyValue('--cal-dot')) || 5;
    const gap = parseFloat(cs.columnGap) || 0;
    const inner = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const maxCols = Math.floor((inner + gap) / (dot + gap));
    const lens = pills.map(i => Math.min(4, Math.max(1, Number(i.dataset.u) || 1)));
    const res = packPills(lens, maxCols);
    if (!res) return;
    row.style.gridTemplateColumns = `repeat(${res.cols}, var(--cal-dot))`;
    // Longest pills first, as the packer placed them; colours follow their card.
    const byLen = [0, 1, 2, 3, 4].map(l => pills.filter((_, k) => lens[k] === l));
    res.place.forEach(p => {
      const el = byLen[p.l].shift();
      el.style.gridArea = p.down
        ? `${p.r + 1} / ${p.c + 1} / span ${p.l} / span 1`
        : `${p.r + 1} / ${p.c + 1} / span 1 / span ${p.l}`;
    });
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
