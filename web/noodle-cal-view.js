// Noodle calendar controller. The calendar is ENDLESS: it opens on this week
// and appends weeks as a sentinel under the grid scrolls into view. The
// host's CROP (noodle-crop.js) greys every day outside it; a guest's calendar
// renders ONLY the crop (no `endless`), the host's always stays endless so
// the crop handles can be dragged anywhere. Past days are greyed and inert.
// Classes are repainted in place on every change so scroll never jumps.
//
// opts: {halves, crop: {from, to} | null, endless, onChange(sel), onRows()}
// api:  setSel(Set), getSel(), setOthers([{slots:Set, ink} | {self:true, ink}]),
//       setAllowed(Set | null, prune), rows(), weekOf(row), more(), scroller

var NDC_FIRST = 12;   // weeks rendered up front
var NDC_MORE = 8;     // weeks appended each time the sentinel shows
var NDC_MAX = 160;    // ~3 years: past this, stop (a slot that far out is refused anyway)

// Each month's big blurred number sits BEHIND ITS OWN WEEKS and scrolls with
// them -- unlike /rd's single fixed watermark. A week belongs to the month of its
// Wednesday (the row's data-month), so a month is a run of rows.
function ndcPaintMarks(grid) {
  var runs = [];
  grid.querySelectorAll('.nd-mmark').forEach(function (m) { m.remove(); });
  grid.querySelectorAll('.nd-wk').forEach(function (w) {
    var last = runs[runs.length - 1], key = w.dataset.year + w.dataset.month;
    if (last && last.key === key) last.end = w; else runs.push({ key: key, start: w, end: w });
  });
  runs.forEach(function (r) {
    // only a month COMPLETELY VISIBLE in the calendar gets one: its 1st and
    // its last day both drawn (greyed or not) -- not the part-month we open
    // in, nor one whose weeks are still loading or cut off
    var y = r.start.dataset.year, mo = r.start.dataset.month;
    var lastDay = new Date(+y, +mo, 0).getDate();
    if (!grid.querySelector('.nd-d[data-day="' + y + '-' + mo + '-01"]') ||
        !grid.querySelector('.nd-d[data-day="' + y + '-' + mo + '-' + lastDay + '"]')) return;
    var m = document.createElement('div');
    m.className = 'nd-mmark';
    m.setAttribute('aria-hidden', 'true');
    m.style.top = r.start.offsetTop + 'px';
    m.style.height = (r.end.offsetTop + r.end.offsetHeight - r.start.offsetTop) + 'px';
    m.textContent = r.start.dataset.month;
    m.dataset.ym = y + '-' + mo;
    grid.appendChild(m);
  });
}

// Month boundaries: a green step line through the GAPS between cells --
// under the last week of the old month, up the gap before the 1st, over the
// first week of the new one. Drawn as small segments INSIDE the cells
// (<i class="nd-ml b|v|t">), not one SVG over the grid: the gaps are the
// cells' own 5px borders, and a separate layer rounds independently of them,
// so at some widths and zooms (fractional DPR) it drifted a device pixel or
// two off the gap. A segment is laid out with the very box whose border it
// sits on, so it snaps with it. Segments TILE -- none overlap, since the
// colour is translucent and an overlap reads as a brighter chip.
function ndcPaintBoundaries(grid) {
  grid.querySelectorAll('.nd-ml').forEach(function (el) { el.remove(); });
  function mark(el, kind) { el.insertAdjacentHTML('beforeend', '<i class="nd-ml ' + kind + '" aria-hidden="true"></i>'); }
  grid.querySelectorAll('.nd-d[data-day$="-01"]').forEach(function (first) {
    var row = first.previousElementSibling, k = 0;
    while (row && !row.classList.contains('nd-wk')) { row = row.previousElementSibling; k++; }
    if (!row) return;
    var days = [], el = row.nextElementSibling;
    for (var i = 0; i < 7 && el; i++, el = el.nextElementSibling) days.push(el);
    if (k === 0) { mark(row, 't'); days.forEach(function (d) { mark(d, 't'); }); return; }
    mark(row, 'b');
    days.forEach(function (d, i) {
      if (i < k) mark(d, i === k - 1 ? 'b end' : 'b');
      else mark(d, i === k ? 't start' : 't');
    });
    mark(first, 'v');
  });
}

// A month's watermark is GREEN when at least one of its days is available
// (not past, inside the crop, offered by the host) and GREY when none is.
// Re-run on every paint: the host's offer can change availability without
// any week being added.
function ndcTintMarks(grid) {
  grid.querySelectorAll('.nd-mmark').forEach(function (m) {
    var open = grid.querySelector('.nd-d[data-day^="' + m.dataset.ym + '-"]:not(.out):not(.shut)');
    m.classList.toggle('closed', !open);
  });
}

function ndcPaintMonths(grid) {
  ndcPaintMarks(grid);
  ndcTintMarks(grid);
  ndcPaintBoundaries(grid);
}

// Every group button shows the MODE's tool -- a paint bucket (fill in) or an
// eraser (clear) -- whatever its cells hold; the corner shows both and flips
// them all. Glyphs are Nerd Font icons from the site's face: U+F765
// (format-color-fill) and U+F12D (Font Awesome eraser), in noodle-seal.woff2.
var NDC_ICON = { fill: '\uf765', clear: '\uf12d' };

function ndcPaintButtons(grid, mode, groupOf, offered) {
  var T = window.NoodleToggle;
  grid.querySelectorAll('.nd-hd[data-col], .nd-wk').forEach(function (el) {
    var g = groupOf(el), label = T.label(g.subject, mode), btn = el.querySelector('.nd-tg');
    btn.innerHTML = '<i class="ic ' + mode + '">' + NDC_ICON[mode] + '</i>';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.disabled = !offered(g.slots).length;
  });
  // the corner shows BOTH tools, "fill / eraser", the current one bright
  var b = grid.querySelector('.nd-mode'), other = T.flipMode(mode);
  // split by the same 30deg hairline a split day cell has (noodle-cal.css)
  b.innerHTML = '<i class="ic fill">' + NDC_ICON.fill + '</i><i class="ic clear">' + NDC_ICON.clear + '</i>';
  b.dataset.mode = mode;
  b.title = 'switch every button to ' + (other === 'fill' ? 'fill in' : 'clear');
  b.setAttribute('aria-label', b.title);
}

function ndcCellPaint(c, sel, allowed, halves) {
  var iso = c.dataset.day;
  // unsplit: the whole day is one slot, drawn across both triangles
  var m = halves ? iso + ':m' : iso + ':d', n = halves ? iso + ':n' : iso + ':d';
  c.classList.toggle('mid', sel.has(m));
  c.classList.toggle('nit', sel.has(n));
  var noM = !!allowed && !allowed.has(m), noN = !!allowed && !allowed.has(n);
  c.classList.toggle('no-m', noM);
  c.classList.toggle('no-n', noN);
  c.classList.toggle('shut', noM && noN);
}

function ndcSlotAt(cell, e, halves) {
  var r = cell.getBoundingClientRect();
  return cell.dataset.day + ':' + (halves
    ? window.NoodleCalParts.half(e.clientX - r.left, e.clientY - r.top, cell.clientWidth, cell.clientHeight) : 'd');
}

// Load more weeks whenever the bottom is near. An IntersectionObserver alone
// stalls: it fires only when the sentinel's visibility CHANGES, so if a batch
// lands and the sentinel is still in view (a fast fling, a tall screen) it
// never fires again. The scroll check loads however the bottom was reached.
// The window shows at most NDC_VISIBLE weeks (plus the frozen header): the
// cap is MEASURED -- a row's height follows the font and the width -- and
// re-measured on resize, since a fixed height would clip a row mid-way.
var NDC_VISIBLE = 6;

function ndcCapHeight(scroller, grid) {
  var head = grid.querySelector('.nd-hd'), row = grid.querySelector('.nd-wk');
  if (!head || !row) return;
  scroller.style.maxHeight = (head.offsetHeight + NDC_VISIBLE * row.offsetHeight) + 'px';
}

function ndcWireLoader(scroller, sentinel, more) {
  var nearEnd = function () {
    if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 300) more();
  };
  scroller.addEventListener('scroll', nearEnd, { passive: true });
  new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) nearEnd();
  }, { root: scroller, rootMargin: '0px 0px 300px 0px' }).observe(sentinel);
}

// The first week drawn. When it would be THIS week, the week before it is
// drawn too (all past, all greyed): today is then never the top row, so the
// calendar reads as continuing from somewhere rather than starting cold.
function ndcFirstSunday(P, from, today) {
  var s = P.sunday(from);
  return s === P.sunday(today) ? P.addDays(s, -7) : s;
}

// fn() whenever any of els changes WIDTH -- never on height alone: the
// repaint itself resizes the scroller's height (ndcCapHeight), and reacting
// to that looped ("ResizeObserver loop completed with undelivered
// notifications").
function ndcOnWidth(els, fn) {
  var seen = new WeakMap();
  var ro = new ResizeObserver(function (entries) {
    var changed = entries.some(function (en) {
      var w = en.contentRect.width, was = seen.get(en.target);
      seen.set(en.target, w);
      return was !== w;
    });
    if (changed) fn();
  });
  els.forEach(function (el) { ro.observe(el); });
}

function NoodleCal(wrap, opts) {
  var P = window.NoodleCalParts, T = window.NoodleToggle;
  var today = P.iso(new Date()), crop = opts.crop || null;
  var bound = { from: crop && crop.from > today ? crop.from : today, to: crop ? crop.to : null };
  var endless = !!opts.endless || !crop;
  var weeks = [], groups = { cols: [[], [], [], [], [], [], []], rows: [] }, cells = [];
  var sel = new Set(), others = [], allowed = null, mode = 'fill';
  var codes = new Set(P.codes(opts.halves));

  wrap.innerHTML = '<div class="nd-scroll">' +
    '<div class="nd-grid' + (opts.halves ? '' : ' single') + '">' + P.headHtml() + '</div>' +
    '<div class="nd-more-weeks" aria-hidden="true"></div></div>';
  var scroller = wrap.querySelector('.nd-scroll');
  var grid = wrap.querySelector('.nd-grid');

  function offered(slots) {
    return allowed ? slots.filter(function (s) { return allowed.has(s); }) : slots;
  }

  function groupOf(el) {
    var hd = el.closest('.nd-hd'), wk = el.closest('.nd-wk');
    if (hd) return { slots: groups.cols[+hd.dataset.col], subject: T.colSubject(+hd.dataset.col) };
    var r = +wk.dataset.row;
    return { slots: groups.rows[r], subject: T.rowSubject(weeks[r][0]) };
  }

  function paint() {
    cells.forEach(function (c) { ndcCellPaint(c, sel, allowed, opts.halves); });
    ndcPaintButtons(grid, mode, groupOf, offered);
    ndcTintMarks(grid);
  }

  function paintDots() {
    var fit = P.dotsFit(cells[0], others.length);
    cells.forEach(function (c) {
      c.querySelector('.nd-dots').innerHTML = others.length ? P.dotsHtml(c.dataset.day, others, fit, sel, opts.halves) : '';
    });
  }

  function addWeeks(n) {
    var from = weeks.length ? P.addDays(weeks[weeks.length - 1][0], 7) : ndcFirstSunday(P, endless ? today : bound.from, today);
    var fresh = P.weeksFrom(from, n).filter(function (wk) { return endless || wk[0] <= bound.to; });
    if (!fresh.length) return;
    grid.insertAdjacentHTML('beforeend', fresh.map(function (wk, i) {
      return P.rowHtml(wk, weeks.length + i, bound, today);
    }).join(''));
    fresh.forEach(function (wk) { weeks.push(wk); P.groupAdd(groups, wk, bound, opts.halves); });
    cells = Array.from(grid.querySelectorAll('.nd-d'));
    paint();
    paintDots();
    ndcPaintMonths(grid);
    if (opts.onRows) opts.onRows();
  }

  function change(next) {
    sel = next;
    paint();
    paintDots(); // your own column follows your taps
    if (opts.onChange) opts.onChange(new Set(sel));
  }

  function onTap(e) {
    // a group's WHOLE header or week-column cell is its button, not just the
    // drawn box inside it (a 28px target in a column of phone-sized cells)
    var head = e.target.closest('.nd-hd:not(.nd-corner), .nd-wk'), cell = e.target.closest('.nd-d');
    var tg = e.target.closest('.nd-tg') || (head && head.querySelector('.nd-tg'));
    if (e.target.closest('.nd-corner')) {
      mode = T.flipMode(mode);
      paint();
    } else if (tg) {
      var on = offered(groupOf(tg).slots);
      if (on.length) change(T.apply(on, sel, T.modeAction(mode)));
    } else if (cell && !cell.classList.contains('out')) {
      var slot = ndcSlotAt(cell, e, opts.halves);
      if (allowed && !allowed.has(slot)) return;
      var next = new Set(sel);
      if (next.has(slot)) next.delete(slot); else next.add(slot);
      change(next);
    }
  }

  grid.addEventListener('click', onTap);
  addWeeks(endless ? NDC_FIRST : NDC_MAX);
  if (endless) {
    ndcWireLoader(scroller, wrap.querySelector('.nd-more-weeks'), function () {
      if (weeks.length < NDC_MAX) addWeeks(NDC_MORE);
    });
  }
  ndcCapHeight(scroller, grid);
  // the GRID too: a scrollbar arriving narrows the grid inside an unchanged
  // scroller, and month lines drawn before that sat right of their gaps
  ndcOnWidth([scroller, grid], function () { paintDots(); ndcPaintMonths(grid); ndcCapHeight(scroller, grid); });

  return {
    scroller: scroller,
    // A draft or a stored vote may hold slots in weeks not loaded yet: they
    // are KEPT (only the kind -- whole day vs halves -- is checked), so nothing
    // picked is lost just because it is further down than anyone scrolled.
    setSel: function (s) {
      sel = new Set(Array.from(s).filter(function (x) { return codes.has(x.slice(11)); }));
      paint();
      paintDots();
    },
    getSel: function () { return new Set(sel); },
    setOthers: function (o) { others = o; paintDots(); },
    setAllowed: function (a, prune) {
      allowed = a ? new Set(a) : null;
      var kept = allowed ? new Set(Array.from(sel).filter(function (s) { return allowed.has(s); })) : sel;
      if (prune && kept.size !== sel.size) change(kept); else paint();
    },
    rows: function () { return Array.from(grid.querySelectorAll('.nd-wk')); },
    weekOf: function (r) { return weeks[r]; },
    more: function () { if (endless && weeks.length < NDC_MAX) addWeeks(NDC_MORE); },
  };
}

if (typeof window !== 'undefined') window.NoodleCal = NoodleCal;
