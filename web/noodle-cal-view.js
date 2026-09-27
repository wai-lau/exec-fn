// Noodle calendar controller: builds the grid once (noodle-cal.js), then
// repaints classes in place on every change so the scroll position and the
// sticky header never jump.
//
// opts: {start, end, onChange(sel)}
// api:  setSel(Set), getSel(), setOthers([{slots:Set, hue} | {self:true, hue}])

// The big month number behind the grid follows whichever week row is at the
// scroller's vertical middle.
function ndcWatchMonth(scroller, grid, mark) {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) mark.textContent = en.target.dataset.month; });
  }, { root: scroller, rootMargin: '-50% 0px -50% 0px' });
  grid.querySelectorAll('.nd-wk').forEach(function (w) { io.observe(w); });
}

// Open on the first week that holds a day of the window, just under the
// sticky header. Measured from live rects, and again once the webfonts land:
// a font swap reflows the rows and would leave it half hidden.
function ndcOpenAtWindow(scroller, grid, cells) {
  var firstIn = cells.find(function (c) { return !c.classList.contains('out'); });
  var head = grid.querySelector('.nd-hd');
  if (!firstIn) return;
  function go() {
    scroller.scrollTop += firstIn.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top - head.offsetHeight;
  }
  go();
  if (document.fonts) document.fonts.ready.then(go);
}

function NoodleCal(wrap, opts) {
  var P = window.NoodleCalParts, T = window.NoodleToggle;
  var weeks = P.weeks(opts.start, opts.end);
  var groups = P.groups(weeks, opts.start, opts.end);
  var sel = new Set(), others = [];

  wrap.innerHTML = '<div class="nd-mark" aria-hidden="true"></div>' +
    '<div class="nd-scroll"><div class="nd-grid">' +
    P.gridHtml(weeks, opts.start, opts.end) + '</div></div>';
  var scroller = wrap.querySelector('.nd-scroll');
  var grid = wrap.querySelector('.nd-grid');
  var mark = wrap.querySelector('.nd-mark');
  var cells = Array.from(grid.querySelectorAll('.nd-d'));

  function groupOf(el) {
    var hd = el.closest('.nd-hd'), wk = el.closest('.nd-wk');
    if (hd) return { slots: groups.cols[+hd.dataset.col], subject: T.colSubject(+hd.dataset.col), el: hd };
    if (wk) {
      var r = +wk.dataset.row;
      return { slots: groups.rows[r], subject: T.rowSubject(weeks[r][0]), el: wk };
    }
    return null;
  }

  function paintToggle(el, g) {
    var st = T.groupState(g.slots, sel), label = T.label(g.subject, st);
    el.dataset.state = st;
    var btn = el.querySelector('.nd-tg');
    btn.setAttribute('aria-label', label);
    btn.title = label;
    if (el.classList.contains('nd-wk')) btn.textContent = st === 'on' ? '■' : '□';
    btn.disabled = st === 'none';
  }

  function paint() {
    cells.forEach(function (c) {
      var iso = c.dataset.day;
      c.classList.toggle('mid', sel.has(iso + ':m'));
      c.classList.toggle('nit', sel.has(iso + ':n'));
    });
    grid.querySelectorAll('.nd-hd[data-col], .nd-wk').forEach(function (el) {
      paintToggle(el, groupOf(el));
    });
  }

  function paintDots() {
    var fit = P.dotsFit(cells[0], others.length);
    cells.forEach(function (c) {
      c.querySelector('.nd-dots').innerHTML = others.length ? P.dotsHtml(c.dataset.day, others, fit, sel) : '';
    });
  }

  function change(next) {
    sel = next;
    paint();
    paintDots(); // your own column follows your taps
    if (opts.onChange) opts.onChange(new Set(sel));
  }

  function onTap(e) {
    var set = e.target.closest('[data-set]'), tg = e.target.closest('.nd-tg');
    var cell = e.target.closest('.nd-d');
    if (set || tg) {
      var g = groupOf(e.target);
      if (!g || !g.slots.length) return;
      var st = T.groupState(g.slots, sel);
      change(T.apply(g.slots, sel, set ? set.dataset.set : T.clickAction(st)));
    } else if (cell && !cell.classList.contains('out')) {
      var r = cell.getBoundingClientRect();
      var slot = cell.dataset.day + ':' + P.half(e.clientX - r.left, e.clientY - r.top, cell.clientWidth, cell.clientHeight);
      var next = new Set(sel);
      if (next.has(slot)) next.delete(slot); else next.add(slot);
      change(next);
    }
  }

  grid.addEventListener('click', onTap);

  ndcWatchMonth(scroller, grid, mark);
  new ResizeObserver(paintDots).observe(scroller);

  ndcOpenAtWindow(scroller, grid, cells);
  mark.textContent = opts.start.slice(5, 7);
  paint();

  return {
    setSel: function (s) { sel = new Set(s); paint(); paintDots(); },
    getSel: function () { return new Set(sel); },
    setOthers: function (o) { others = o; paintDots(); },
  };
}

if (typeof window !== 'undefined') window.NoodleCal = NoodleCal;
