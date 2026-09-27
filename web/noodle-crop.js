// Noodle crop: trim the endless calendar to a span of weeks, like cropping a
// picture -- a handle at the top and one at the bottom, dragged over the week
// rows, everything outside dimmed.
//
// The HOST's crop is the poll's: saved (signed) on the server, it is the first
// and last week ANYONE can pick. A guest crops too, but only their own view,
// kept in this browser and never wider than the host's. `uncrop` clears
// whichever one is yours. Ask Noodle can crop the same way (ndxApply).
//
// Gesture surface rules from /rd's calendar (rd.css): touch-action:none and
// user-select:none on the handles, pointermove/up on WINDOW, no
// setPointerCapture -- a rebuilt subtree otherwise eats the gesture.

var NDX = { editing: false, a: 0, b: 3, drag: null };

function ndx$(id) { return document.getElementById(id); }
function ndxKey() { return 'noodle.crop.' + NDV.slug; }

function ndxLoad() {
  try {
    var c = JSON.parse(localStorage.getItem(ndxKey()) || 'null');
    return c && typeof c.from === 'string' && typeof c.to === 'string' ? c : null;
  } catch (e) { return null; }
}

function ndxIsHost() {
  var pub = ndvReady() ? NDV.kdf.pub() : null, role = window.ndhRole ? window.ndhRole(pub) : 'guest';
  return role === 'host' || role === 'fresh';
}

// Set (or clear, with null) YOUR crop: the host's goes to the poll, signed --
// on a fresh poll that claims it -- and a guest's stays in this browser.
async function ndxApply(crop) {
  NDX.editing = false;
  if (ndxIsHost()) {
    if (!ndvReady()) { ndvStatus('enter your name first -- the host sets the crop for everyone.'); ndxSync(); return; }
    var res = await ndhSend('/settings', { kind: 'settings', halves: NDV.poll.halves,
      from: crop ? crop.from : null, to: crop ? crop.to : null });
    if (!res.ok) { ndvStatus(res.data.error || 'could not save the crop', 'err'); ndxSync(); return; }
    await ndvLoadPoll();
  } else {
    try {
      if (crop) localStorage.setItem(ndxKey(), JSON.stringify(crop));
      else localStorage.removeItem(ndxKey());
    } catch (e) { /* storage blocked: the crop lasts until reload */ }
    NDV.crop = crop;
  }
  ndvEnsureCal(true);
  ndxSync();
}

function ndxSync() {
  ndx$('nd-crop').textContent = NDX.editing ? 'done' : 'crop';
  var mine = ndxIsHost() ? NDV.poll && NDV.poll.crop : NDV.crop;
  ndx$('nd-uncrop').hidden = NDX.editing || !mine;
  ndx$('nd-crop').title = ndxIsHost() ? 'set the first and last week for everyone' : 'narrow your own view';
  ndx$('nd-crop-cancel').hidden = !NDX.editing;
  var wrap = ndx$('nd-cal');
  wrap.classList.toggle('cropping', NDX.editing);
  var box = wrap.querySelector('.nd-cropbox');
  if (!NDX.editing) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.className = 'nd-cropbox';
    box.innerHTML = '<div class="nd-crop-dim top"></div><div class="nd-crop-dim bot"></div>' +
      '<button type="button" class="nd-crop-h top" data-h="a" aria-label="first week">── first week ──</button>' +
      '<button type="button" class="nd-crop-h bot" data-h="b" aria-label="last week">── last week ──</button>';
    wrap.querySelector('.nd-grid').appendChild(box);
    box.addEventListener('pointerdown', ndxDown);
  }
  ndxPlace();
}

// Put the handles on the top edge of row a and the bottom edge of row b.
function ndxPlace() {
  var rows = NDV.cal.rows(), box = ndx$('nd-cal').querySelector('.nd-cropbox');
  if (!box || !rows.length) return;
  NDX.b = Math.min(NDX.b, rows.length - 1);
  var top = rows[NDX.a].offsetTop, bot = rows[NDX.b].offsetTop + rows[NDX.b].offsetHeight;
  box.querySelector('.nd-crop-h.top').style.top = top + 'px';
  box.querySelector('.nd-crop-h.bot').style.top = bot + 'px';
  box.querySelector('.nd-crop-dim.top').style.height = top + 'px';
  box.querySelector('.nd-crop-dim.bot').style.top = bot + 'px';
}

function ndxDown(e) {
  var h = e.target.closest('.nd-crop-h');
  if (!h) return;
  e.preventDefault();
  NDX.drag = h.dataset.h;
  // WebKit still starts a text selection off the MOUSE events a cancelled
  // pointerdown leaves behind, and drags it across the page with the handle
  document.body.classList.add('nd-dragging');
}

// The row boundary nearest the pointer; dragging the bottom handle near the
// end of what is loaded loads more (the calendar is endless).
function ndxMove(e) {
  if (!NDX.drag) return;
  var rows = NDV.cal.rows(), grid = ndx$('nd-cal').querySelector('.nd-grid');
  var y = e.clientY - grid.getBoundingClientRect().top, best = 0, gap = Infinity;
  // top handle: nearest row TOP; bottom handle: nearest row BOTTOM
  rows.forEach(function (r, i) {
    var edge = NDX.drag === 'a' ? r.offsetTop : r.offsetTop + r.offsetHeight;
    if (Math.abs(edge - y) < gap) { gap = Math.abs(edge - y); best = i; }
  });
  if (NDX.drag === 'a') NDX.a = Math.min(best, NDX.b); else NDX.b = Math.max(best, NDX.a);
  var sc = NDV.cal.scroller, r = sc.getBoundingClientRect();
  if (e.clientY > r.bottom - 30) { sc.scrollTop += 24; if (NDX.b >= rows.length - 2) NDV.cal.more(); }
  if (e.clientY < r.top + 60) sc.scrollTop -= 24;
  ndxPlace();
}

function ndxUp() {
  NDX.drag = null;
  document.body.classList.remove('nd-dragging');
}

function ndxToggle() {
  if (!NDX.editing) {
    NDX.editing = true;
    NDX.a = 0;
    NDX.b = Math.min(3, NDV.cal.rows().length - 1);
    ndxSync();
    return;
  }
  ndxApply({ from: NDV.cal.weekOf(NDX.a)[0], to: NDV.cal.weekOf(NDX.b)[6] });
}

(function () {
  if (!ndx$('nd-crop')) return;
  ndx$('nd-crop').addEventListener('click', ndxToggle);
  ndx$('nd-uncrop').addEventListener('click', function () { ndxApply(null); });
  ndx$('nd-crop-cancel').addEventListener('click', function () { NDX.editing = false; ndxSync(); });
  window.addEventListener('pointermove', ndxMove);
  window.addEventListener('selectstart', function (e) { if (NDX.drag) e.preventDefault(); });
  window.addEventListener('pointerup', ndxUp);
  window.addEventListener('pointercancel', ndxUp);
  window.ndxLoad = ndxLoad;
  window.ndxApply = ndxApply;
  window.ndxSync = ndxSync;
})();
