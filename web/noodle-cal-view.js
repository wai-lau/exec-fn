// Noodle calendar controller: builds the grid once (noodle-cal.js), then
// repaints classes in place on every change so the scroll position and the
// sticky header never jump.
//
// opts: {start, end, halves, onChange(sel)} -- halves: split into midday +
//       night (two triangles a day) or one whole-day slot
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

// Every group button shows the MODE's tool -- pencil (fill in) or eraser
// (clear) -- whatever its cells hold; the corner shows the OTHER tool and
// flips them all. Glyphs are Font Awesome U+F040 / U+F12D from the Nerd Font
// build of the site's face, shipped in noodle-seal.woff2.
var NDC_ICON = { fill: '\uf040', clear: '\uf12d' };

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
  grid.dataset.mode = mode;
}

function NoodleCal(wrap, opts) {
  var P = window.NoodleCalParts, T = window.NoodleToggle;
  var weeks = P.weeks(opts.start, opts.end);
  var groups = P.groups(weeks, opts.start, opts.end, opts.halves);
  // every slot this calendar can hold; anything else handed to setSel (a
  // draft from before the host changed the dates or the split) is dropped
  var valid = new Set([].concat.apply([], groups.rows));
  var sel = new Set(), others = [], allowed = null, mode = 'fill';

  // Only the host's halves are on offer to everyone else: a group's toggle
  // acts on those alone, and a tap on any other half does nothing.
  function offered(slots) {
    return allowed ? slots.filter(function (s) { return allowed.has(s); }) : slots;
  }

  wrap.innerHTML = '<div class="nd-mark" aria-hidden="true"></div>' +
    '<div class="nd-scroll"><div class="nd-grid' + (opts.halves ? '' : ' single') + '">' +
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

  function paint() {
    cells.forEach(function (c) {
      var iso = c.dataset.day;
      // unsplit: the whole day is one slot, drawn across both triangles
      var m = opts.halves ? iso + ':m' : iso + ':d', n = opts.halves ? iso + ':n' : iso + ':d';
      c.classList.toggle('mid', sel.has(m));
      c.classList.toggle('nit', sel.has(n));
      var noM = !!allowed && !allowed.has(m), noN = !!allowed && !allowed.has(n);
      c.classList.toggle('no-m', noM);
      c.classList.toggle('no-n', noN);
      c.classList.toggle('shut', noM && noN);
    });
    ndcPaintButtons(grid, mode, groupOf, offered);
  }

  function paintDots() {
    var fit = P.dotsFit(cells[0], others.length);
    cells.forEach(function (c) {
      c.querySelector('.nd-dots').innerHTML = others.length ? P.dotsHtml(c.dataset.day, others, fit, sel, opts.halves) : '';
    });
  }

  function change(next) {
    sel = next;
    paint();
    paintDots(); // your own column follows your taps
    if (opts.onChange) opts.onChange(new Set(sel));
  }

  function onTap(e) {
    var tg = e.target.closest('.nd-tg'), flip = e.target.closest('.nd-mode');
    var cell = e.target.closest('.nd-d');
    if (flip) {
      mode = T.flipMode(mode);
      paint();
    } else if (tg) {
      var g = groupOf(e.target), on = g ? offered(g.slots) : [];
      if (!on.length) return;
      change(T.apply(on, sel, T.modeAction(mode)));
    } else if (cell && !cell.classList.contains('out')) {
      var r = cell.getBoundingClientRect();
      var slot = cell.dataset.day + ':' + (opts.halves
        ? P.half(e.clientX - r.left, e.clientY - r.top, cell.clientWidth, cell.clientHeight) : 'd');
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
    setSel: function (s) {
      sel = new Set(Array.from(s).filter(function (x) { return valid.has(x); }));
      paint();
      paintDots();
    },
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
