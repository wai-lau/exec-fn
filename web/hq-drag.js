// ── shared timeline drag/resize machinery (same global scope as hq-groups.js) ──
// Pointer wiring (attachBlockDrag/attachResize) + the floating-ghost drag used by
// plain blocks, group spines, and the event block. Split out of hq-groups.js to
// stay under the 500-line cap; loaded right after hq-core.js, before hq-groups.js.
// Shared pointer wiring: mouse drags immediately; touch needs a 300ms long-press
// (so the timeline can still scroll). `skipEl` (e.g. a resize handle) is ignored.
function attachBlockDrag(el, skipEl, launch) {
  el.addEventListener('mousedown', e => {
    if (skipEl && skipEl.contains(e.target)) return;
    e.preventDefault();
    launch(e.clientX, e.clientY, ev => ev.clientX, ev => ev.clientY);
  });
  el.addEventListener('touchstart', e => {
    if (skipEl && skipEl.contains(e.target)) return;
    const t0 = e.touches[0], x = t0.clientX, y = t0.clientY;
    let timer = setTimeout(() => { timer = null; cleanup(); launch(x, y, ev => ev.touches[0].clientX, ev => ev.touches[0].clientY); }, 300);
    function cleanup() { el.removeEventListener('touchmove', m); el.removeEventListener('touchend', en); }
    function m(ev) { const t = ev.touches[0]; if (Math.abs(t.clientX - x) > 8 || Math.abs(t.clientY - y) > 8) { clearTimeout(timer); timer = null; cleanup(); } }
    function en() { if (timer) { clearTimeout(timer); timer = null; } cleanup(); }
    el.addEventListener('touchmove', m, {passive: true});
    el.addEventListener('touchend', en, {once: true});
  }, {passive: true});
}

function attachResize(handle, start) {
  handle.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); start(e.clientY, ev => ev.clientY); });
  handle.addEventListener('touchstart', e => {
    e.stopPropagation();
    const t0 = e.touches[0].clientY;
    let timer = setTimeout(() => { timer = null; cleanup(); start(t0, ev => ev.touches[0].clientY); }, 300);
    function cleanup() { handle.removeEventListener('touchmove', m); handle.removeEventListener('touchend', en); }
    function m() { if (timer) { clearTimeout(timer); timer = null; cleanup(); } }
    function en() { if (timer) { clearTimeout(timer); timer = null; } cleanup(); }
    handle.addEventListener('touchmove', m, {passive: true});
    handle.addEventListener('touchend', en, {once: true});
  }, {passive: true});
}

// Floating-ghost drag shared by plain blocks and group spines. Drop on another
// day / unschedule -> reschedule the card; drop within today -> opts.onTodayCommit
// with the snapped start-minute of the dragged element's top.
function tdMakeGhost(ds) {
  const g = ds.opts.ghostSrc.cloneNode(true);
  g.style.position = 'fixed';
  g.style.margin = '0';
  g.style.left = (ds.lastX - ds.offsetX) + 'px';
  g.style.top = (ds.lastY - ds.offsetY) + 'px';
  g.style.width = ds.width + 'px';
  g.style.height = ds.height + 'px';
  g.style.right = 'auto';
  g.style.bottom = 'auto';
  g.style.pointerEvents = 'none';
  g.style.zIndex = '9999';
  g.style.opacity = '1';
  g.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
  document.body.appendChild(g);
  ds.ghost = g;
  ds.opts.liftEl.style.display = 'none';
}

function tdMkPreview(ds, ctx) {
  const p = document.createElement('div');
  p.className = 'hq-drop-preview ' + ctx;
  p.dataset.ctx = ctx;
  p.textContent = ds.c.title;
  const cs = cardStyle(ds.c);          // card-colored placeholder, not Ono-Sendai green
  if (cs.bg) { p.style.cssText = cs.bg + cs.border; if (!cs.dark) p.style.color = 'rgba(0,0,0,0.85)'; }
  return p;
}

function tdClearPreview(ds) {
  if (ds.preview) { ds.preview.remove(); ds.preview = null; }
  if (ds.unEl) ds.unEl.classList.remove('drag-over');
}

function tdPlacePreview(ds, x, y) {
  const {c, track, rect, offsetY, unEl, opts} = ds;
  const tgt = dropTarget(x, y);
  if (unEl) unEl.classList.toggle('drag-over', tgt === 'unschedule');
  if (tgt === 'unschedule') { if (ds.preview) { ds.preview.remove(); ds.preview = null; } return; }
  if (tgt && tgt !== isoToday()) {
    const list = document.getElementById('hq-list-' + tgt);
    if (!list) { if (ds.preview) { ds.preview.remove(); ds.preview = null; } return; }
    if (!ds.preview || ds.preview.dataset.ctx !== 'day') {
      if (ds.preview) ds.preview.remove();
      const tmp = document.createElement('div');
      tmp.innerHTML = renderCard(c, tgt);
      ds.preview = tmp.firstElementChild;
      ds.preview.dataset.ctx = 'day';
      ds.preview.classList.add('sortable-ghost');
      ds.preview.style.pointerEvents = 'none';
    }
    const pv = ds.preview;
    const ref = [...list.querySelectorAll('.hq-card')].filter(el => el !== pv).find(el => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (ref) list.insertBefore(pv, ref); else list.appendChild(pv);
  } else {
    if (!ds.preview || ds.preview.dataset.ctx !== 'today') { if (ds.preview) ds.preview.remove(); ds.preview = tdMkPreview(ds, 'today'); track.appendChild(ds.preview); }
    const rawMin = (y - rect.top - offsetY) / TL_PX + TL_START;
    const snapped = Math.max(TL_START, Math.min(TL_END - opts.spanMin, snapMin(rawMin)));
    ds.preview.style.top = ((snapped - TL_START) * TL_PX + 3) + 'px';
    ds.preview.style.height = Math.max(13, opts.spanMin * TL_PX - 6) + 'px';
  }
}

function tdFinish(ds) {
  const {c, rect, offsetY, opts} = ds;
  if (ds.ghost) { ds.ghost.remove(); ds.ghost = null; }
  const tgt = dropTarget(ds.lastX, ds.lastY);
  let dayIndex = 0;
  if (ds.preview && ds.preview.dataset.ctx === 'day' && ds.preview.parentElement) {
    dayIndex = [...ds.preview.parentElement.querySelectorAll('.hq-card, .hq-drop-preview')].indexOf(ds.preview);
  }
  tdClearPreview(ds);
  opts.liftEl.style.display = '';
  if (!ds.moved) { if (opts.onClick) opts.onClick(); return; }
  if (tgt === 'unschedule') {
    opts.liftEl.style.display = 'none';
    queueUpdate(c.id, null, false);
    setTimeout(() => load(weekStart), 700);
    return;
  }
  if (tgt && tgt !== isoToday()) {
    opts.liftEl.style.display = 'none';
    queueUpdate(c.id, tgt, dayIndex);
    setTimeout(() => load(weekStart), 700);
    return;
  }
  const rawMin = (ds.lastY - rect.top - offsetY) / TL_PX + TL_START;
  const snapped = Math.max(TL_START, Math.min(TL_END - opts.spanMin, snapMin(rawMin)));
  opts.onTodayCommit(snapped);
}

function startTimelineDrag(c, track, opts, startClientX, startClientY, getX, getY) {
  const srcRect = opts.ghostSrc.getBoundingClientRect();
  const ds = {
    c, track, opts,
    rect: track.getBoundingClientRect(),
    offsetX: startClientX - srcRect.left,
    offsetY: startClientY - srcRect.top,
    width: srcRect.width, height: srcRect.height,
    moved: false, lastX: startClientX, lastY: startClientY,
    ghost: null, preview: null,
    unEl: document.getElementById('hq-unschedule'),
  };
  document.body.classList.add('hq-dragging');
  function onMove(ev) {
    ds.lastX = getX(ev); ds.lastY = getY(ev);
    if (!ds.moved) { ds.moved = true; tdMakeGhost(ds); }
    if (ev.cancelable) ev.preventDefault();
    ds.ghost.style.left = (ds.lastX - ds.offsetX) + 'px';
    ds.ghost.style.top = (ds.lastY - ds.offsetY) + 'px';
    tdPlacePreview(ds, ds.lastX, ds.lastY);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    document.body.classList.remove('hq-dragging');
    tdFinish(ds);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, {passive: false});
  document.addEventListener('touchend', onUp);
}
