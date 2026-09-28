// noodle crop: the HOST sets the first and last week anyone can pick, like
// cropping a picture. No button -- for the host (and anyone on a fresh poll,
// where the first to act becomes host) two thin lines sit on the calendar all
// the time: one on the top edge of the first week, one on the bottom edge
// of the last, each with a two-stroke grip across it. Drag one, let go, and
// the calendar is cropped here; Commit saves it (signed, with the split) for
// everyone -- so no passphrase is needed to crop, only to commit. Guests never
// see them: their calendar is simply the crop.
//
// Gesture surface rules from /rd's calendar (rd.css): touch-action:none and
// user-select:none on the handles, pointermove/up on WINDOW, no
// setPointerCapture -- a rebuilt subtree otherwise eats the gesture.

var NDX = { a: 0, b: 0, open: true, drag: null, moved: false };
var NDX_SPAN = 2;   // with no crop yet: this week and the next two
window.NDX = NDX;

function ndx$(id) { return document.getElementById(id); }

function ndxIsHost() {
  var pub = ndvPub(), role = window.ndhRole ? window.ndhRole(pub) : 'guest';
  return role === 'host' || role === 'fresh';
}

// The row index holding `iso` (loading more weeks until it is there).
function ndxRowOf(iso, fallback) {
  for (var guard = 0; guard < 40; guard++) {
    var rows = NDV.cal.rows();
    for (var r = 0; r < rows.length; r++) {
      var wk = NDV.cal.weekOf(r);
      if (wk[0] <= iso && iso <= wk[6]) return r;
    }
    if (!rows.length || NDV.cal.weekOf(rows.length - 1)[6] >= iso) return fallback;
    NDV.cal.more();
  }
  return fallback;
}

// The highest row the top line may sit on: this week's. The week drawn above
// it (noodle-cal-view.js ndcFirstSunday) is all past, never offered.
function ndxTopMin() {
  var iso = window.NoodleCalParts.iso(new Date()), rows = NDV.cal.rows();
  for (var r = 0; r < rows.length; r++) {
    var wk = NDV.cal.weekOf(r);
    if (wk[0] <= iso && iso <= wk[6]) return r;
  }
  return 0;
}

// Put the handles where the poll's crop is. With no crop the bottom one sits
// under week 12 and says there is no end yet -- it must NOT follow the last
// loaded week: weeks load as the grid scrolls, and a line that runs away as
// you reach for it cannot be grabbed.
function ndxFromPoll() {
  var c = ndhCrop(), rows = NDV.cal ? NDV.cal.rows() : [];
  if (!rows.length) return;
  NDX.a = Math.max(ndxTopMin(), c ? ndxRowOf(c.from, 0) : 0);
  NDX.open = !c;
  NDX.b = c ? ndxRowOf(c.to, rows.length - 1) : Math.min(ndxTopMin() + NDX_SPAN, rows.length - 1);
  // a FRESH poll starts cropped to those three weeks: pending, so the host's
  // first Commit saves it with everything else
  if (!c && NDV.poll && !NDV.poll.voters.length && NDV.pendingCrop === undefined) {
    NDV.pendingCrop = { from: NDV.cal.weekOf(NDX.a)[0], to: NDV.cal.weekOf(NDX.b)[6] };
    setTimeout(function () { ndvEnsureCal(true); }, 0);   // not from inside the rebuild that called us
  }
}

// Show / hide / place the handles. Called whenever the calendar is rebuilt,
// grows, or the poll reloads.
function ndxSync() {
  var wrap = ndx$('nd-cal'), grid = wrap && wrap.querySelector('.nd-grid');
  if (!grid || !NDV.cal) return;
  var box = grid.querySelector('.nd-cropbox');
  if (!ndxIsHost()) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.className = 'nd-cropbox';
    // two short strokes across each line (outside + inside the crop) are
    // the grip; no box, no text -- the aria-label says what it is
    box.innerHTML = '<div class="nd-shade top"></div><div class="nd-shade bot"></div>' +
      '<button type="button" class="nd-crop-h top" data-h="a" aria-label="drag: first week">' +
      '<i class="grip out"></i><i class="grip in"></i></button>' +
      '<button type="button" class="nd-crop-h bot" data-h="b" aria-label="drag: last week">' +
      '<i class="grip in"></i><i class="grip out"></i></button>';
    grid.appendChild(box);
    box.addEventListener('pointerdown', ndxDown);
  }
  // kept LAST in the grid: at the week column's z it paints over the column
  // (and the weeks loaded since) only if it comes after them in the DOM
  if (box !== grid.lastElementChild) grid.appendChild(box);
  if (!NDX.drag) ndxFromPoll();
  ndxPlace();
}

function ndxPlace() {
  var rows = NDV.cal.rows(), box = ndx$('nd-cal').querySelector('.nd-cropbox');
  if (!box || !rows.length) return;
  NDX.b = Math.min(NDX.b, rows.length - 1);
  NDX.a = Math.min(NDX.a, NDX.b);   // a rebuild can leave a stale index behind
  if (!NDX.drag) NDX.a = Math.max(ndxTopMin(), NDX.a);   // at rest, never above this week
  var t = box.querySelector('.nd-crop-h.top'), b = box.querySelector('.nd-crop-h.bot');
  t.style.top = rows[NDX.a].offsetTop + 'px';
  // on the FIRST week the gap above is the frozen header's own border, which
  // covers anything drawn there -- the line moves just inside the row instead
  t.classList.toggle('first', NDX.a === 0);   // (only when this week is the top row: a guest's crop)
  b.style.top = (rows[NDX.b].offsetTop + rows[NDX.b].offsetHeight) + 'px';
  // the shades end where the lines are drawn: in the middle of the row gap
  var lo = box.querySelector('.nd-shade.top'), hi = box.querySelector('.nd-shade.bot');
  lo.style.height = (NDX.a === 0 ? 0 : rows[NDX.a].offsetTop - 2.5) + 'px';   // shades the past week too
  hi.style.top = (rows[NDX.b].offsetTop + rows[NDX.b].offsetHeight - 2.5) + 'px';
  hi.hidden = NDX.open;   // no last week yet: nothing is cropped off below
  b.title = NDX.open ? 'no last week yet -- drag to set one' : 'last week';
  t.title = 'first week';
}

function ndxDown(e) {
  var h = e.target.closest('.nd-crop-h');
  if (!h || ndx$('nd-cal').classList.contains('nd-readonly')) return;
  e.preventDefault();
  NDX.drag = h.dataset.h;
  NDX.moved = false;
  // WebKit still starts a text selection off the MOUSE events a cancelled
  // pointerdown leaves behind, and drags it across the page with the handle
  document.body.classList.add('nd-dragging');
}

// The row edge nearest the pointer: top handle -> a row TOP, bottom handle ->
// a row BOTTOM. Dragging near the scroller's end scrolls and loads more.
function ndxMove(e) {
  if (!NDX.drag) return;
  var rows = NDV.cal.rows(), grid = ndx$('nd-cal').querySelector('.nd-grid');
  var y = e.clientY - grid.getBoundingClientRect().top, best = 0, gap = Infinity;
  rows.forEach(function (r, i) {
    var edge = NDX.drag === 'a' ? r.offsetTop : r.offsetTop + r.offsetHeight;
    if (Math.abs(edge - y) < gap) { gap = Math.abs(edge - y); best = i; }
  });
  // the top line may be DRAGGED above this week, but lands back on it (ndxUp)
  if (NDX.drag === 'a') NDX.a = Math.min(best, NDX.b);
  else { NDX.b = Math.max(best, NDX.a); NDX.open = false; }
  NDX.moved = true;
  var sc = NDV.cal.scroller, r = sc.getBoundingClientRect();
  if (e.clientY > r.bottom - 30) { sc.scrollTop += 24; if (NDX.b >= rows.length - 2) NDV.cal.more(); }
  if (e.clientY < r.top + 60) sc.scrollTop -= 24;
  ndxPlace();
}

// Letting go crops the calendar HERE; Commit saves it for everyone, signed
// as the host (on a fresh poll that is what makes you host).
async function ndxUp() {
  if (!NDX.drag) return;
  NDX.drag = null;
  document.body.classList.remove('nd-dragging');
  if (!NDX.moved) return;
  NDX.b = Math.min(NDX.b, NDV.cal.rows().length - 1);
  NDX.a = Math.max(ndxTopMin(), NDX.a);   // snap back: nothing before this week is offered
  ndxPlace();
  var crop = { from: NDV.cal.weekOf(NDX.a)[0], to: NDV.cal.weekOf(NDX.b)[6] };
  await ndxSave(crop);
}

async function ndxSave(crop) {
  NDV.pendingCrop = crop;
  ndvEnsureCal(true);   // regrey around the new crop, keeping the scroll
  ndvSaveDraft();       // marks it unsaved
}

(function () {
  if (!ndx$('nd-cal')) return;
  window.addEventListener('pointermove', ndxMove);
  window.addEventListener('pointerup', ndxUp);
  window.addEventListener('pointercancel', ndxUp);
  window.addEventListener('selectstart', function (e) { if (NDX.drag) e.preventDefault(); });
  window.ndxSync = ndxSync;
  window.ndxSave = ndxSave;
  window.ndxIsHost = ndxIsHost;
})();
