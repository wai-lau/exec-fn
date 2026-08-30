// Exec-bubble drag helper (extracted from exec-bubble.js to stay under the
// 500-line cap). Drag repositions the bubble + persists; a tap calls onTap().
function execMakeDraggable(el, onTap) {
  let sx, sy, il, it, dragged;

  function navH() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 56;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function applyDefault() {
    el.style.left = el.style.top = '';
    el.style.right = '14px';
    el.style.bottom = (navH() + 10) + 'px';
  }

  function onStart(x, y) {
    dragged = false;
    const r = el.getBoundingClientRect();
    sx = x; sy = y; il = r.left; it = r.top;
    el.style.right = el.style.bottom = '';
    el.style.left = il + 'px';
    el.style.top = it + 'px';
  }
  function onMove(x, y) {
    if (Math.abs(x - sx) > 5 || Math.abs(y - sy) > 5) dragged = true;
    if (!dragged) return;
    el.style.left = clamp(il + x - sx, 0, window.innerWidth - el.offsetWidth) + 'px';
    el.style.top  = clamp(it + y - sy, 0, window.innerHeight - el.offsetHeight - navH()) + 'px';
  }
  function onEnd() {
    if (!dragged) {
      onTap();
    } else {
      try { localStorage.setItem('exec-bpos', JSON.stringify({ left: el.style.left, top: el.style.top })); } catch (_) {}
    }
  }

  // html.exec-drag marks a live mouse drag: a page with an <iframe> (/printer)
  // sets pointer-events:none on it while the class is up, else the window
  // mousemove/mouseup below stop firing once the cursor crosses into the frame
  // and the bubble is left stranded mid-drag. Touch drags target the bubble
  // itself, so they need no such flag.
  el.addEventListener('mousedown', function (e) {
    e.preventDefault();
    onStart(e.clientX, e.clientY);
    document.documentElement.classList.add('exec-drag');
    function mu() {
      window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu);
      window.removeEventListener('blur', mu);
      document.documentElement.classList.remove('exec-drag');
      onEnd();
    }
    // A button released OUTSIDE the window never fires mouseup here: end the
    // drag on window blur, or on the first move back in with no button down.
    function mm(e) { if (e.buttons === 0) { mu(); return; } onMove(e.clientX, e.clientY); }
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    window.addEventListener('blur', mu);
  });
  el.addEventListener('touchstart', function (e) { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  el.addEventListener('touchmove',  function (e) { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  el.addEventListener('touchend',   function (e) { e.preventDefault(); onEnd(); }, { passive: false });

  applyDefault();
}
