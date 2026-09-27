// Noodle calendar controller: builds the grid once (noodle-cal.js), then
// repaints classes in place on every change so the scroll position and the
// sticky header never jump.
//
// opts: {start, end, onChange(sel)}
// api:  setSel(Set), getSel(), setOthers([{slots:Set, ink} | {self:true, ink}]),
//       setAllowed(Set | null) -- the host's offered halves; null = everything

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
  var sel = new Set(), others = [], allowed = null;

  // Only the host's halves are on offer to everyone else: a group's toggle
  // acts on those alone, and a tap on any other half does nothing.
  function offered(slots) {
    return allowed ? slots.filter(function (s) { return allowed.has(s); }) : slots;
  }

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

  // One button: a PENCIL when the group is all off (fills it all in), an
  // ERASER otherwise (clears it). Font Awesome glyphs from the Nerd Font build
  // of the site's face (U+F040, U+F12D), shipped in noodle-seal.woff2.
  function paintToggle(el, g) {
    var st = T.groupState(offered(g.slots), sel), label = T.label(g.subject, st);
    el.dataset.state = st;
    var btn = el.querySelector('.nd-tg');
    btn.textContent = st === 'off' ? '\uf040' : '\uf12d';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.disabled = st === 'none';
  }

  function paint() {
    cells.forEach(function (c) {
      var iso = c.dataset.day;
      c.classList.toggle('mid', sel.has(iso + ':m'));
      c.classList.toggle('nit', sel.has(iso + ':n'));
      var noM = !!allowed && !allowed.has(iso + ':m'), noN = !!allowed && !allowed.has(iso + ':n');
      c.classList.toggle('no-m', noM);
      c.classList.toggle('no-n', noN);
      c.classList.toggle('shut', noM && noN);
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
    var tg = e.target.closest('.nd-tg');
    var cell = e.target.closest('.nd-d');
    if (tg) {
      var g = groupOf(e.target), on = g ? offered(g.slots) : [];
      if (!on.length) return;
      change(T.apply(on, sel, T.clickAction(T.groupState(on, sel))));
    } else if (cell && !cell.classList.contains('out')) {
      var r = cell.getBoundingClientRect();
      var slot = cell.dataset.day + ':' + P.half(e.clientX - r.left, e.clientY - r.top, cell.clientWidth, cell.clientHeight);
      if (allowed && !allowed.has(slot)) return;
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
    // With `prune`, picks outside the offer are dropped (a host who withdraws
    // a half takes it off everyone's calendar), reported through onChange like
    // a tap. Without it the offer is only DRAWN: before the voter's key is
    // known the page cannot tell the host from a guest, and pruning then
    // destroyed the host's own restored draft.
    setAllowed: function (a, prune) {
      allowed = a ? new Set(a) : null;
      var kept = allowed ? new Set(Array.from(sel).filter(function (s) { return allowed.has(s); })) : sel;
      if (prune && kept.size !== sel.size) change(kept); else paint();
    },
  };
}

if (typeof window !== 'undefined') window.NoodleCal = NoodleCal;
