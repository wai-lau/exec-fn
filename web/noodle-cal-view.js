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

// Month boundaries: ONE stroked path per boundary, on the centre line of the
// 5px gaps between cells. Built from per-cell bars first, and half-transparent
// bars that meet overlap: every corner and step doubled into a brighter chip.
// A single path has real corners and nothing to overlap. When the 1st falls
// mid-week (column k) the line steps: along the bottom of that week under
// the old month's days, up between columns k-1 and k, along its top after.
function ndcPaintBoundaries(grid) {
  var old = grid.querySelector('.nd-mlines');
  if (old) old.remove();
  var W = grid.clientWidth, d = '', G = 2.5;   // G: half the gap, its centre
  grid.querySelectorAll('.nd-d[data-day$="-01"]').forEach(function (first) {
    var row = first.previousElementSibling, k = 0;
    while (row && !row.classList.contains('nd-wk')) { row = row.previousElementSibling; k++; }
    var top = first.offsetTop - G, bot = first.offsetTop + first.offsetHeight - G;
    if (k === 0) { d += 'M0 ' + top + 'H' + W; return; }
    var x = first.offsetLeft - G;
    d += 'M0 ' + bot + 'H' + x + 'V' + top + 'H' + W;
  });
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'nd-mlines');
  svg.setAttribute('width', W);
  svg.setAttribute('height', grid.scrollHeight);
  svg.innerHTML = '<path d="' + d + '"/>';
  // always BEFORE the crop lines: at the same z the later one paints on top,
  // and where the two coincide the crop line must win
  grid.insertBefore(svg, grid.querySelector('.nd-cropbox'));
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
    var from = weeks.length ? P.addDays(weeks[weeks.length - 1][0], 7) : P.sunday(endless ? today : bound.from);
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
    var tg = e.target.closest('.nd-tg'), cell = e.target.closest('.nd-d');
    if (e.target.closest('.nd-mode')) {
      mode = T.flipMode(mode);
      paint();
    } else if (tg) {
      var on = offered(groupOf(e.target).slots);
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
  new ResizeObserver(function () { paintDots(); ndcPaintMonths(grid); ndcCapHeight(scroller, grid); }).observe(scroller);

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
