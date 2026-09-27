// Noodle calendar controller. The calendar is ENDLESS: it opens on this week
// and appends weeks as a sentinel under the grid scrolls into view -- unless
// the voter has CROPPED it to a span (noodle-crop.js), which renders exactly
// that span and loads nothing more. Past days are greyed and inert. Classes
// are repainted in place on every change so scroll position never jumps.
//
// opts: {halves, crop: {from, to} | null, onChange(sel)}
// api:  setSel(Set), getSel(), setOthers([{slots:Set, ink} | {self:true, ink}]),
//       setAllowed(Set | null, prune), rows(), weekOf(row), more(), scroller

var NDC_FIRST = 12;   // weeks rendered up front
var NDC_MORE = 8;     // weeks appended each time the sentinel shows
var NDC_MAX = 160;    // ~3 years: past this, stop (a slot that far out is refused anyway)

// The big month number behind the grid follows whichever week row is at the
// scroller's vertical middle; a year that is not this year shows under it.
function ndcMonthWatcher(scroller, mark) {
  var thisYear = String(new Date().getFullYear());
  return new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var y = en.target.dataset.year; // digits from our own row markup, never user text
      mark.innerHTML = en.target.dataset.month + (y !== thisYear ? '<small>' + y + '</small>' : '');
    });
  }, { root: scroller, rootMargin: '-50% 0px -50% 0px' });
}

// Every group button shows the MODE's tool -- pencil (fill in) or eraser
// (clear) -- whatever its cells hold; the corner shows the OTHER tool and
// flips them all. Glyphs are Font Awesome U+F040 / U+F12D from the Nerd Font
// build of the site's face, shipped in noodle-seal.woff2.
var NDC_ICON = { fill: '', clear: '' };

function ndcPaintButtons(grid, mode, groupOf, offered) {
  var T = window.NoodleToggle;
  grid.querySelectorAll('.nd-hd[data-col], .nd-wk').forEach(function (el) {
    var g = groupOf(el), label = T.label(g.subject, mode), btn = el.querySelector('.nd-tg');
    btn.textContent = NDC_ICON[mode];
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.disabled = !offered(g.slots).length;
  });
  var b = grid.querySelector('.nd-mode'), other = T.flipMode(mode);
  b.textContent = NDC_ICON[other];
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

function NoodleCal(wrap, opts) {
  var P = window.NoodleCalParts, T = window.NoodleToggle;
  var today = P.iso(new Date()), crop = opts.crop || null;
  var bound = { from: crop && crop.from > today ? crop.from : today, to: crop ? crop.to : null };
  var weeks = [], groups = { cols: [[], [], [], [], [], [], []], rows: [] }, cells = [];
  var sel = new Set(), others = [], allowed = null, mode = 'fill';
  var codes = new Set(P.codes(opts.halves));

  wrap.innerHTML = '<div class="nd-mark" aria-hidden="true"></div><div class="nd-scroll">' +
    '<div class="nd-grid' + (opts.halves ? '' : ' single') + '">' + P.headHtml() + '</div>' +
    '<div class="nd-more-weeks" aria-hidden="true"></div></div>';
  var scroller = wrap.querySelector('.nd-scroll');
  var grid = wrap.querySelector('.nd-grid');
  var months = ndcMonthWatcher(scroller, wrap.querySelector('.nd-mark'));

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
    var from = weeks.length ? P.addDays(weeks[weeks.length - 1][0], 7) : P.sunday(bound.from);
    var fresh = P.weeksFrom(from, n).filter(function (wk) { return !bound.to || wk[0] <= bound.to; });
    if (!fresh.length) return;
    grid.insertAdjacentHTML('beforeend', fresh.map(function (wk, i) {
      return P.rowHtml(wk, weeks.length + i, bound, today);
    }).join(''));
    fresh.forEach(function (wk) { weeks.push(wk); P.groupAdd(groups, wk, bound, opts.halves); });
    cells = Array.from(grid.querySelectorAll('.nd-d'));
    grid.querySelectorAll('.nd-wk:not([data-seen])').forEach(function (w) { w.dataset.seen = '1'; months.observe(w); });
    paint();
    paintDots();
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
  addWeeks(crop ? NDC_MAX : NDC_FIRST);
  if (!crop) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && weeks.length < NDC_MAX) addWeeks(NDC_MORE);
    }, { root: scroller, rootMargin: '0px 0px 300px 0px' }).observe(wrap.querySelector('.nd-more-weeks'));
  }
  new ResizeObserver(paintDots).observe(scroller);

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
    more: function () { if (!crop && weeks.length < NDC_MAX) addWeeks(NDC_MORE); },
  };
}

if (typeof window !== 'undefined') window.NoodleCal = NoodleCal;
