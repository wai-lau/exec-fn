// ── breakdown groups (master spine + draggable sub-step blocks) ────────────────
const SUB_X = 26;        // px from group-left where sub-cards start: just right of
                         // the 24px master spine (2px gap), not overlapping it
const SUBGAP = 2;        // px gap between side-by-side overlapping sub-lanes
const DEFAULT_SUB = 15;  // fallback minutes for a step with no est_min

function workNodes(c) {
  const g = c.nudge && c.nudge.graph;
  if (!g || !g.nodes) return [];
  return g.nodes.filter(n => !n.is_event_start);
}
// A breakdown earns the spine treatment only with >=2 real steps; a single step
// stays an ordinary block.
function hasBreakdown(c) { return workNodes(c).length >= 2; }
function findNode(card, nid) {
  const g = card.nudge && card.nudge.graph;
  return g && g.nodes ? g.nodes.find(n => n.id === nid) : null;
}
// Plan order = back-scheduled deadline, then creation order. Default offsets tile
// the sub-cards sequentially from the master start by their own estimates.
function orderedSubs(c) {
  return workNodes(c).slice().sort((a, b) =>
    (a.deadline || '').localeCompare(b.deadline || '') ||
    (a.created_at || '').localeCompare(b.created_at || '') ||
    a.id.localeCompare(b.id));
}
function fmtClock(min) {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60), mm = m % 60;
  const ap = h < 12 ? 'am' : 'pm';
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2, '0')}${ap}`;
}

// Persist a single field on one card without clobbering the rest: refetch the
// authoritative rd.json, mutate, PATCH. Used for sub-step time/size/done.
async function patchCard(cid, mutate) {
  const rd = await (await fetch('/api/rd')).json();
  const cards = rd.cards || [];
  const card = cards.find(x => x.id === cid);
  if (!card) return;
  mutate(card);
  await fetch('/api/rd', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cards})});
}
// Lock every still-default sub-step to an explicit offset so editing one never
// shifts the others (a default start = the running sum of prior steps' estimates,
// so a resize would otherwise drag every later default step with it).
function freezeOffsets(c) {
  workNodes(c).forEach(nd => { if (nd.tl_offset == null && nd._off != null) nd.tl_offset = nd._off; });
}
// The master is the bounding box of its sub-steps: re-base so the earliest sub is
// the master start (offsets stay >= 0) and set the master duration to the span.
// Call after freezeOffsets so every sub already carries an explicit offset.
function snapMasterToSubs(c) {
  const subs = workNodes(c);
  if (!subs.length) return;
  const offOf = n => (n.tl_offset != null ? n.tl_offset : (n._off || 0));
  const durOf = n => (n._dur != null ? n._dur : Math.max(10, n.est_min || DEFAULT_SUB));
  const minOff = Math.min(...subs.map(offOf));
  const maxEnd = Math.max(...subs.map(n => offOf(n) + durOf(n)));
  if (minOff !== 0) {                       // a sub moved above the master start
    subs.forEach(n => { n.tl_offset = offOf(n) - minOff; });
    c.dir_start_min = (c.dir_start_min != null ? c.dir_start_min : TL_START) + minOff;
  }
  c.estimated_time = maxEnd - minOff;       // master duration = the sub span
}
// One write for the whole breakdown: persist the master start/duration plus every
// step's (now explicit) offset and the edited step's est_min / done.
function persistLayout(c, edited) {
  patchCard(c.id, card => {
    if (c.dir_start_min != null) card.dir_start_min = c.dir_start_min;
    if (c.estimated_time != null) card.estimated_time = c.estimated_time;
    workNodes(c).forEach(local => {
      const m = findNode(card, local.id);
      if (m && local.tl_offset != null) m.tl_offset = local.tl_offset;
    });
    if (edited) {
      const m = findNode(card, edited.id);
      if (m) {
        if (edited.est_min != null) m.est_min = edited.est_min;
        if (edited.done != null) m.done = edited.done;
      }
    }
  });
}

// Greedy lane packing so overlapping items share horizontal space. Writes
// _lane / _lanes onto each item (generic over blocks or sub-steps).
function assignLanes(items, getStart, getEnd) {
  const sorted = [...items].sort((a, b) => getStart(a) - getStart(b));
  const laneEnds = [];
  sorted.forEach(it => {
    let lane = laneEnds.findIndex(end => end <= getStart(it));
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = getEnd(it);
    it._lane = lane;
  });
  sorted.forEach(it => {
    const e = getEnd(it);
    let max = it._lane;
    sorted.forEach(o => {
      if (o !== it && getStart(o) < e && getEnd(o) > getStart(it)) max = Math.max(max, o._lane);
    });
    it._lanes = max + 1;
  });
}

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
function startTimelineDrag(c, track, opts, startClientX, startClientY, getX, getY) {
  const rect = track.getBoundingClientRect();
  const srcRect = opts.ghostSrc.getBoundingClientRect();
  const offsetX = startClientX - srcRect.left;
  const offsetY = startClientY - srcRect.top;
  const width = srcRect.width, height = srcRect.height;
  let moved = false, lastX = startClientX, lastY = startClientY, ghost = null, preview = null;
  const unEl = document.getElementById('pr-unschedule');
  document.body.classList.add('pr-dragging');

  function makeGhost() {
    ghost = opts.ghostSrc.cloneNode(true);
    ghost.style.position = 'fixed';
    ghost.style.margin = '0';
    ghost.style.left = (lastX - offsetX) + 'px';
    ghost.style.top = (lastY - offsetY) + 'px';
    ghost.style.width = width + 'px';
    ghost.style.height = height + 'px';
    ghost.style.right = 'auto';
    ghost.style.bottom = 'auto';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.opacity = '1';
    ghost.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
    document.body.appendChild(ghost);
    opts.liftEl.style.display = 'none';
  }
  function mkPreview(ctx) {
    const p = document.createElement('div');
    p.className = 'pr-drop-preview ' + ctx;
    p.dataset.ctx = ctx;
    p.textContent = c.title;
    const cs = cardStyle(c);            // card-colored placeholder, not Ono-Sendai green
    if (cs.bg) { p.style.cssText = cs.bg + cs.border; if (!cs.dark) p.style.color = 'rgba(0,0,0,0.85)'; }
    return p;
  }
  function clearPreview() {
    if (preview) { preview.remove(); preview = null; }
    if (unEl) unEl.classList.remove('drag-over');
  }
  function placePreview(x, y) {
    const tgt = dropTarget(x, y);
    if (unEl) unEl.classList.toggle('drag-over', tgt === 'unschedule');
    if (tgt === 'unschedule') { if (preview) { preview.remove(); preview = null; } return; }
    if (tgt && tgt !== isoToday()) {
      const list = document.getElementById('pr-list-' + tgt);
      if (!list) { if (preview) { preview.remove(); preview = null; } return; }
      if (!preview || preview.dataset.ctx !== 'day') {
        if (preview) preview.remove();
        const tmp = document.createElement('div');
        tmp.innerHTML = renderCard(c, tgt);
        preview = tmp.firstElementChild;
        preview.dataset.ctx = 'day';
        preview.classList.add('sortable-ghost');
        preview.style.pointerEvents = 'none';
      }
      const ref = [...list.querySelectorAll('.pr-card')].filter(el => el !== preview).find(el => {
        const r = el.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      if (ref) list.insertBefore(preview, ref); else list.appendChild(preview);
    } else {
      if (!preview || preview.dataset.ctx !== 'today') { if (preview) preview.remove(); preview = mkPreview('today'); track.appendChild(preview); }
      const rawMin = (y - rect.top - offsetY) / TL_PX + TL_START;
      const snapped = Math.max(TL_START, Math.min(TL_END - opts.spanMin, snapMin(rawMin)));
      preview.style.top = ((snapped - TL_START) * TL_PX + 3) + 'px';
      preview.style.height = Math.max(13, opts.spanMin * TL_PX - 6) + 'px';
    }
  }
  function onMove(ev) {
    lastX = getX(ev); lastY = getY(ev);
    if (!moved) { moved = true; makeGhost(); }
    if (ev.cancelable) ev.preventDefault();
    ghost.style.left = (lastX - offsetX) + 'px';
    ghost.style.top = (lastY - offsetY) + 'px';
    placePreview(lastX, lastY);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    document.body.classList.remove('pr-dragging');
    if (ghost) { ghost.remove(); ghost = null; }
    const tgt = dropTarget(lastX, lastY);
    let dayIndex = 0;
    if (preview && preview.dataset.ctx === 'day' && preview.parentElement) {
      dayIndex = [...preview.parentElement.querySelectorAll('.pr-card, .pr-drop-preview')].indexOf(preview);
    }
    clearPreview();
    opts.liftEl.style.display = '';
    if (!moved) { if (opts.onClick) opts.onClick(); return; }
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
    const rawMin = (lastY - rect.top - offsetY) / TL_PX + TL_START;
    const snapped = Math.max(TL_START, Math.min(TL_END - opts.spanMin, snapMin(rawMin)));
    opts.onTodayCommit(snapped);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, {passive: false});
  document.addEventListener('touchend', onUp);
}

// One sub-step block: drag to set its time (offset from the master start), resize
// to set its estimate, tap to toggle done.
function wireSub(c, nd, sub, rh, track, masterStart, groupStart) {
  attachResize(rh, (sy, gy) => startSubResize(c, nd, sub, track, sy, gy));

  function beginDrag(grabClientY, getY) {
    const rect = track.getBoundingClientRect();
    const sRect = sub.getBoundingClientRect();
    const offsetY = grabClientY - sRect.top;
    document.body.classList.add('pr-dragging');

    // Same feel as a kanban card drag: a semi-opaque copy follows the cursor
    // while the original stays in place as a faint placeholder at the snap slot.
    const ghost = sub.cloneNode(true);
    ghost.style.position = 'fixed';
    ghost.style.left = sRect.left + 'px';
    ghost.style.top = sRect.top + 'px';
    ghost.style.width = sRect.width + 'px';
    ghost.style.height = sRect.height + 'px';
    ghost.style.margin = '0';
    ghost.style.opacity = '0.92';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    document.body.appendChild(ghost);
    sub.style.opacity = '0.45';
    sub.style.zIndex = '999';

    function move(ev) {
      if (ev.cancelable) ev.preventDefault();
      const y = getY(ev);
      ghost.style.top = (y - offsetY) + 'px';
      const rawAbs = (y - rect.top - offsetY) / TL_PX + TL_START;
      const absStart = Math.max(TL_START, Math.min(TL_END - nd._dur, snapMin(rawAbs)));
      nd._off = absStart - masterStart;
      sub.style.top = ((masterStart + nd._off) - groupStart) * TL_PX + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up);
      document.body.classList.remove('pr-dragging');
      ghost.remove();
      nd.tl_offset = nd._off;
      freezeOffsets(c);
      snapMasterToSubs(c);
      redrawCards(track);
      persistLayout(c, null);
    }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, {passive: false}); document.addEventListener('touchend', up);
  }

  function toggleDone() {
    nd.done = !nd.done;
    freezeOffsets(c);
    redrawCards(track);
    persistLayout(c, {id: nd.id, done: nd.done});
  }

  // mouse: a >4px move starts a drag, otherwise the release toggles done
  sub.addEventListener('mousedown', e => {
    if (rh.contains(e.target)) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let engaged = false;
    function pre(ev) {
      if (!engaged && (Math.abs(ev.clientX - sx) > 4 || Math.abs(ev.clientY - sy) > 4)) {
        engaged = true;
        document.removeEventListener('mousemove', pre);
        document.removeEventListener('mouseup', preUp);
        beginDrag(ev.clientY, ev2 => ev2.clientY);
      }
    }
    function preUp() {
      document.removeEventListener('mousemove', pre);
      document.removeEventListener('mouseup', preUp);
      if (!engaged) toggleDone();
    }
    document.addEventListener('mousemove', pre);
    document.addEventListener('mouseup', preUp);
  });

  // touch: long-press drags, quick tap toggles done
  sub.addEventListener('touchstart', e => {
    if (rh.contains(e.target)) return;
    const t0 = e.touches[0], x = t0.clientX, y = t0.clientY;
    let timer = setTimeout(() => { timer = null; cleanup(); beginDrag(y, ev => ev.touches[0].clientY); }, 300);
    function cleanup() { sub.removeEventListener('touchmove', m); sub.removeEventListener('touchend', en); }
    function m(ev) { const t = ev.touches[0]; if (Math.abs(t.clientX - x) > 8 || Math.abs(t.clientY - y) > 8) { if (timer) { clearTimeout(timer); timer = null; } cleanup(); } }
    function en() { if (timer) { clearTimeout(timer); timer = null; cleanup(); toggleDone(); } }
    sub.addEventListener('touchmove', m, {passive: true});
    sub.addEventListener('touchend', en, {once: true});
  }, {passive: true});
}

function startSubResize(c, nd, sub, track, startClientY, getY) {
  const startDur = nd._dur;
  function move(ev) {
    if (ev.cancelable) ev.preventDefault();
    const delta = getY(ev) - startClientY;
    nd._dur = Math.max(SNAP, snapMin(startDur + delta / TL_PX));
    sub.style.height = Math.max(13, nd._dur * TL_PX - 3) + 'px';
  }
  function up() {
    document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up);
    nd.est_min = nd._dur;
    freezeOffsets(c);
    snapMasterToSubs(c);
    redrawCards(track);
    persistLayout(c, {id: nd.id, est_min: nd._dur});
  }
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, {passive: false}); document.addEventListener('touchend', up);
}

// A today card with a breakdown: thin vertical spine (master) + its sub-steps as
// their own blocks to the right. Sub starts are offsets from the master start, so
// moving the spine carries them all (saveStartTime only writes dir_start_min).
function createGroup(c, track) {
  const masterStart = c.dir_start_min != null ? c.dir_start_min : TL_START;
  const subs = orderedSubs(c);
  let acc = 0;
  subs.forEach(nd => {
    nd._dur = Math.max(10, nd.est_min || DEFAULT_SUB);
    nd._off = (nd.tl_offset != null) ? nd.tl_offset : acc;
    acc += nd._dur;
  });
  // The master snaps to the exact bounds of its sub-steps (grows AND shrinks) —
  // no longer floored at the card's own estimated_time.
  const minOff = Math.min(...subs.map(n => n._off));
  const maxEnd = Math.max(...subs.map(n => n._off + n._dur));
  const groupStart = masterStart + minOff;
  c._startMin = groupStart;
  c._durMin = maxEnd - minOff;

  const {bg, border, dark} = cardStyle(c);
  const titleC = bg ? (dark ? 'inherit' : 'rgba(0,0,0,0.85)') : 'hsl(var(--green-hsl) / 0.8)';
  const metaC  = bg ? (dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)') : 'hsl(var(--green-hsl) / 0.45)';

  const container = document.createElement('div');
  container.className = 'dir-group';
  container.dataset.id = c.id;
  container.style.top = ((groupStart - TL_START) * TL_PX + 3) + 'px';
  container.style.height = Math.max(20, c._durMin * TL_PX - 6) + 'px';

  const spine = document.createElement('div');
  spine.className = 'dir-spine' + (bg ? '' : ' plain');
  spine.style.cssText = `${bg}${border}`;
  const spineTitle = document.createElement('div');
  spineTitle.className = 'dir-spine-title';
  spineTitle.style.color = titleC;
  spineTitle.textContent = c.title;
  spine.appendChild(spineTitle);
  container.appendChild(spine);

  const groupOpts = {
    ghostSrc: container, liftEl: container, spanMin: c._durMin,
    onTodayCommit(snapped) {
      const delta = snapped - c._startMin;
      c.dir_start_min = masterStart + delta;
      redrawCards(track);
      saveStartTime(c.id, c.dir_start_min);
    },
    onClick() { openCardDialog(c.id, () => load(weekStart), 'prof'); },
  };
  attachBlockDrag(spine, null, (x, y, gx, gy) => startTimelineDrag(c, track, groupOpts, x, y, gx, gy));

  assignLanes(subs, n => n._off, n => n._off + n._dur);
  // earlier-starting sub-cards paint over later ones where they overlap
  const byStart = subs.slice().sort((a, b) => a._off - b._off);
  byStart.forEach((nd, i) => { nd._z = byStart.length - i; });
  subs.forEach(nd => {
    const sub = document.createElement('div');
    sub.className = 'dir-sub' + (nd.done ? ' done' : '') + (bg ? '' : ' plain');
    sub.dataset.nid = nd.id;
    sub.style.cssText = `${bg}${border}`;
    sub.style.zIndex = nd._z;
    sub.style.top = Math.max(0, (masterStart + nd._off - groupStart) * TL_PX) + 'px';
    sub.style.height = Math.max(13, nd._dur * TL_PX - 3) + 'px';
    const S = nd._lanes || 1, k = nd._lane || 0;
    sub.style.left = `calc(${SUB_X}px + (100% - ${SUB_X}px) * ${k} / ${S})`;
    sub.style.width = `calc((100% - ${SUB_X}px) / ${S} - ${SUBGAP}px)`;

    const lab = document.createElement('div');
    lab.className = 'dir-sub-title';
    lab.style.color = titleC;
    lab.textContent = nd.label;
    sub.appendChild(lab);
    if (nd._dur * TL_PX >= 28) {
      const meta = document.createElement('div');
      meta.className = 'dir-sub-meta';
      meta.style.color = metaC;
      meta.textContent = `${fmtClock(masterStart + nd._off)} · ${durLabel(nd._dur)}`;
      sub.appendChild(meta);
    }
    const rh = document.createElement('div');
    rh.className = 'dir-sub-resize';
    sub.appendChild(rh);

    wireSub(c, nd, sub, rh, track, masterStart, groupStart);
    container.appendChild(sub);
  });

  return container;
}

