// Link-bubble for non-planning pages: the same draggable, position-persistent
// #exec-bubble as the R&D/HQ chat bubble, but a tap NAVIGATES to the
// planning chat instead of toggling a panel. Shares the exec-bpos position with
// the real bubble and reuses execMakeDraggable (exec-bubble-drag.js). A <div>
// (not <a>) so a drag-release can't fire a stray native/intercepted click; the
// tap goes through onTap -> location.href, which stays in-app under standalone.
(function () {
  var el = document.getElementById('exec-bubble');
  if (!el || typeof execMakeDraggable !== 'function') return;
  var HREF = '/hq?exec=open';

  function navH() {
    return parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue('--nav-h')) || 56;
  }

  // Snap back to the default corner if the saved spot is off-screen (viewport
  // shrank, or a stale position) — mirrors exec-bubble.js clampBubbleToViewport.
  function clamp() {
    var nh = navH();
    var r = el.getBoundingClientRect();
    var maxY = window.innerHeight - el.offsetHeight - nh;
    var off = r.right < 0 || r.left > window.innerWidth
      || r.top > window.innerHeight || r.bottom < 0
      || r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.top > maxY;
    if (off) {
      el.style.left = el.style.top = '';
      el.style.right = '14px';
      el.style.bottom = (nh + 10) + 'px';
    }
  }

  // execMakeDraggable applies the default corner, so restore the saved position
  // AFTER it.
  execMakeDraggable(el, function () { location.href = HREF; });
  try {
    var s = JSON.parse(localStorage.getItem('exec-bpos') || 'null');
    if (s && s.left && s.top) {
      el.style.right = el.style.bottom = '';
      el.style.left = s.left;
      el.style.top = s.top;
    }
  } catch (_) { /* default corner */ }
  requestAnimationFrame(clamp);
  window.addEventListener('resize', clamp);
})();
