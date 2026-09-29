// noodle calendar controller. The calendar is ENDLESS: it opens on this week
// and appends weeks as a sentinel under the grid scrolls into view. The
// host's CROP (noodle-crop.js) greys every day outside it; a guest's calendar
// renders ONLY the crop (no `endless`), the host's always stays endless so
// the crop handles can be dragged anywhere. Past days are greyed and inert.
// Classes are repainted in place on every change so scroll never jumps.
//
// opts: {halves, crop: {from, to} | null, endless, onChange(sel), onRows()}
// api:  setSel(Set), getSel(), setOthers([{slots:Set, ink} | {self:true, ink}]), destroy(),
//       setAllowed(Set | null, prune), rows(), weekOf(row), more(), scroller

var NDC_FIRST = 12;   // weeks rendered up front
var NDC_MORE = 8;     // weeks appended each time the sentinel shows
var NDC_MAX = 160;    // ~3 years: past this, stop (a slot that far out is refused anyway)

// Each month's NAME, vertical, in the week column right of the fill/erase
// buttons, spanning its own run of weeks (a week belongs to the month of its
// Wednesday, the row's data-month) and scrolling with them. The longest of
// "october 2026" / "october" / "oct" that fits the run's height; a one-week
// run still gets "oct". It replaced a big blurred month NUMBER behind the
// cells, which read as decoration, not as the month. Months also alternate
// their cells' shade (.nd-d.alt, noodle-cal.js) -- the month divider line
// that did that job is gone.
var NDC_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

var NDC_LABEL_SLACK = 16;   // px a month name keeps clear of its band's ends

function ndcPaintLabels(grid) {
  var runs = [];
  grid.querySelectorAll('.nd-mlabel').forEach(function (m) { m.remove(); });
  grid.querySelectorAll('.nd-wk').forEach(function (w) {
    var last = runs[runs.length - 1], key = w.dataset.year + w.dataset.month;
    if (last && last.key === key) last.end = w; else runs.push({ key: key, start: w, end: w });
  });
  runs.forEach(function (r) {
    var name = NDC_MONTHS[+r.start.dataset.month - 1];
    var m = document.createElement('div');
    m.className = 'nd-mlabel';
    m.setAttribute('aria-hidden', 'true');
    m.style.top = r.start.offsetTop + 'px';
    m.style.height = (r.end.offsetTop + r.end.offsetHeight - r.start.offsetTop) + 'px';
    m.innerHTML = '<span></span>';
    // BEFORE the crop box: at the same z, DOM order decides, so a name sits
    // over the week column but UNDER the crop's shade panels (noodle-crop.js)
    grid.insertBefore(m, grid.querySelector('.nd-cropbox'));
    var span = m.firstChild, room = m.clientHeight;
    // with room to spare: a label that only just fit ran into the header
    // once the site font (wider than the fallback it was measured in) loaded
    [name + ' ' + r.start.dataset.year, name, name.slice(0, 3)].some(function (t) {
      span.textContent = t;
      return span.offsetHeight <= room - NDC_LABEL_SLACK;
    });
  });
}

function ndcPaintMonths(grid) {
  ndcPaintLabels(grid);
}

// Every group button shows the MODE's tool -- a paint bucket (fill in) or an
// eraser (clear) -- whatever its cells hold; the corner shows both and flips
// them all. Glyphs are Nerd Font icons from the site's face: U+F765
// (format-color-fill) and U+F12D (Font Awesome eraser), in noodle-seal.woff2.
var NDC_ICON = { fill: '\uf765', clear: '\uf12d' };

function ndcPaintButtons(grid, mode, groupOf, offered) {
  var T = window.NoodleToggle;
  grid.querySelectorAll('.nd-hd[data-col], .nd-wk').forEach(function (el) {
    var g = groupOf(el), btn = el.querySelector('.nd-tg');
    // no tool chosen yet: no row/column buttons at all (disabled = hidden)
    if (!mode) { btn.innerHTML = ''; btn.disabled = true; return; }
    var label = T.label(g.subject, mode);
    btn.innerHTML = '<i class="ic ' + mode + '">' + NDC_ICON[mode] + '</i>';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.disabled = !offered(g.slots).length;
  });
  // the corner shows BOTH tools, "fill / eraser", the current one bright
  // it starts OFF (both dim, no tool): the first tap picks fill
  var b = grid.querySelector('.nd-mode'), other = mode ? T.flipMode(mode) : 'fill';
  // split by the same 30deg hairline a split day cell has (noodle-cal.css)
  b.innerHTML = '<i class="ic fill">' + NDC_ICON.fill + '</i><i class="ic clear">' + NDC_ICON.clear + '</i>';
  b.dataset.mode = mode || 'off';
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

// Every pickable slot (not past, not outside the crop) on a day from..to.
function ndcOpenSlots(grid, from, to, halves) {
  var out = new Set();
  grid.querySelectorAll('.nd-d:not(.out)').forEach(function (c) {
    var d = c.dataset.day;
    if (d < from || d > to) return;
    if (halves) { out.add(d + ':m'); out.add(d + ':n'); } else out.add(d + ':d');
  });
  return out;
}

// The days a voter can pick on THIS page right now (loaded, not past, inside
// the crop, and -- for a guest -- offered by the host): what Ask noodle works on.
function ndcPickableDays(grid, from, to) {
  return Array.from(grid.querySelectorAll('.nd-d:not(.out):not(.shut)')).map(function (c) {
    return c.dataset.day;
  }).filter(function (d) { return (!from || d >= from) && (!to || d <= to); });
}

function ndcSlotAt(cell, e, halves) {
  var r = cell.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (!halves) return cell.dataset.day + ':d';
  // a guest taps the TRIANGLES, split by the cell's diagonal (noodle-cal.css
  // .nd-tri); the host, the 30deg split line
  var guest = !cell.closest('.nd-grid').classList.contains('host');
  var half = guest ? (x / r.width + y / r.height < 1 ? 'm' : 'n')
    : window.NoodleCalParts.half(x, y, cell.clientWidth, cell.clientHeight);
  return cell.dataset.day + ':' + half;
}

// Load more weeks whenever the bottom is near. An IntersectionObserver alone
// stalls: it fires only when the sentinel's visibility CHANGES, so if a batch
// lands and the sentinel is still in view (a fast fling, a tall screen) it
// never fires again. The scroll check loads however the bottom was reached.
// The window shows at most NDC_VISIBLE weeks (plus the frozen header): the
// cap is MEASURED -- a row's height follows the font and the width -- and
// re-measured on resize, since a fixed height would clip a row mid-way.
var NDC_VISIBLE = 6;

// Only an ENDLESS calendar (the host's) is capped to NDC_VISIBLE weeks and
// scrolls; a bounded one -- a guest's, just the host's offer -- shows every
// week at once, with no scroll inside the page's own.
function ndcCapHeight(scroller, grid, endless) {
  if (!endless) { scroller.style.maxHeight = 'none'; return; }
  var head = grid.querySelector('.nd-hd'), row = grid.querySelector('.nd-wk');
  if (!head || !row) return;
  scroller.style.maxHeight = (head.offsetHeight + NDC_VISIBLE * row.offsetHeight) + 'px';
}

function ndcWireLoader(scroller, sentinel, more) {
  var nearEnd = function () {
    if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 300) more();
  };
  scroller.addEventListener('scroll', nearEnd, { passive: true });
  var io = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) nearEnd();
  }, { root: scroller, rootMargin: '0px 0px 300px 0px' });
  io.observe(sentinel);
  return io;
}

// The first week drawn. The HOST's endless calendar starts a week EARLY: the
// past week above today (all greyed) holds the split box and keeps today off
// the top row. A guest's starts at its first offered week, nothing above.
function ndcFirstSunday(P, endless, from, today) {
  if (!endless) return P.sunday(from);
  var s = P.sunday(today);
  return P.addDays(s, -7);
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
  return ro;
}

// The calendar's observers: the endless one's week loader (more = null for a
// bounded calendar) and the width watcher -- on the GRID too, since a
// scrollbar arriving narrows the grid inside an unchanged scroller, and month
// lines drawn before that sat right of their gaps. Returned so destroy() can
// disconnect them: else every rebuild (a split flip, a crop drag) kept its
// old grid alive for the page's life.
function ndcWatch(scroller, grid, more, onWidth) {
  var obs = [ndcOnWidth([scroller, grid], onWidth)];
  if (more) obs.push(ndcWireLoader(scroller, scroller.querySelector('.nd-more-weeks'), more));
  return obs;
}

function NoodleCal(wrap, opts) {
  var P = window.NoodleCalParts, T = window.NoodleToggle;
  var today = P.iso(new Date()), crop = opts.crop || null;
  var bound = { from: crop && crop.from > today ? crop.from : today, to: crop ? crop.to : null };
  var endless = !!opts.endless || !crop;
  var weeks = [], groups = { cols: [[], [], [], [], [], [], []], rows: [] }, cells = [];
  var sel = new Set(), others = [], allowed = null, mode = null;   // no tool until the corner is tapped
  var codes = new Set(P.codes(opts.halves));

  wrap.innerHTML = '<div class="nd-scroll">' +
    '<div class="nd-grid' + (opts.halves ? '' : ' single') + (opts.endless ? ' host' : '') + '">' + P.headHtml() + '</div>' +
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
  }

  function paintDots() {
    var fit = P.dotsFit(cells[0], others.length);
    cells.forEach(function (c) {
      c.querySelector('.nd-dots').innerHTML = others.length ? P.dotsHtml(c.dataset.day, others, fit, sel, opts.halves) : '';
    });
  }

  function addWeeks(n) {
    var from = weeks.length ? P.addDays(weeks[weeks.length - 1][0], 7) : ndcFirstSunday(P, endless, bound.from, today);
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
      mode = mode ? T.flipMode(mode) : 'fill';
      paint();
    } else if (tg && mode) {
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

  grid.addEventListener('click', function (e) { if (!wrap.classList.contains('nd-readonly')) onTap(e); });   // not your key yet: look, don't touch
  addWeeks(endless ? NDC_FIRST : NDC_MAX);
  var observers = ndcWatch(scroller, grid, endless && function () { if (weeks.length < NDC_MAX) addWeeks(NDC_MORE); },
    function () { paintDots(); ndcPaintMonths(grid); ndcCapHeight(scroller, grid, endless); });
  ndcCapHeight(scroller, grid, endless);
  // the month names were measured in whatever font was ready; fit them again
  // once the site's own has loaded (it is wider)
  if (document.fonts) document.fonts.ready.then(function () { ndcPaintMonths(grid); });

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
    openSlots: function (a, b) { return ndcOpenSlots(grid, a, b, opts.halves); }, pickableDays: function (a, b) { return ndcPickableDays(grid, a, b); },
    clamp: function (list) { return offered(list); },   // to what this page may pick
    setOthers: function (o) { others = o; paintDots(); },
    setAllowed: function (a, prune) {
      allowed = a ? new Set(a) : null;
      var kept = allowed ? new Set(Array.from(sel).filter(function (s) { return allowed.has(s); })) : sel;
      if (prune && kept.size !== sel.size) change(kept); else paint();
    },
    rows: function () { return Array.from(grid.querySelectorAll('.nd-wk')); },
    weekOf: function (r) { return weeks[r]; },
    more: function () { if (endless && weeks.length < NDC_MAX) addWeeks(NDC_MORE); },
    destroy: function () { observers.forEach(function (o) { o.disconnect(); }); },   // before a rebuild replaces it
  };
}

if (typeof window !== 'undefined') window.NoodleCal = NoodleCal;
