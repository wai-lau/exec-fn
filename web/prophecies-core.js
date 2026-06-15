/* global cardStyle */
const RECUR_LABEL = {week:'↺wk', 'bi-week':'↺2wk', month:'↺mo', holiday:'↺yr', birthday:'↺bday'};

let weekStart = null;
let weekData = null;
let pendingUpdates = [];
let saveTimer = null;
let _prDragging = false;

// today-column timeline state
const TL_PX = 1;                 // 1px per minute
const TL_START = 4 * 60 + 30;    // 4:30am
const TL_END   = 28 * 60 + 30;   // 4:30am next day
const TL_H     = TL_END - TL_START; // 1440px
const SNAP     = 15;
let currentTrack = null;
let scheduleCards = [];
let _nowInterval = null;
let _nowRaf = null;
function snapMin(v) { return Math.round(v / SNAP) * SNAP; }
function nowMinutes() {
  const n = new Date();
  const m = n.getHours() * 60 + n.getMinutes();
  return m < TL_START ? m + 24 * 60 : m;
}
function durLabel(min) {
  return min >= 60 ? `${Math.floor(min/60)}h${min%60?min%60+'m':''}` : `${min}m`;
}

function isoToday() {
  const d = new Date();
  if (d.getHours() * 60 + d.getMinutes() < 4*60+30) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
}

function isOverdue(card, dayIso) {
  if (!card.due_date) return false;
  return dayIso > card.due_date.slice(0, 10);
}

// Day cards are not sized by duration — they grow to fit their content
// (title, meta, notes) so all the info is visible.
function renderCard(c, dayIso) {
  const {bg, border, dark} = cardStyle(c);
  const titleC = bg ? (dark ? 'inherit' : 'rgba(0,0,0,0.85)') : 'hsl(var(--green-hsl) / 0.8)';
  const metaC  = bg ? (dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.5)') : 'hsl(var(--green-hsl) / 0.45)';

  const over = (dayIso && isOverdue(c, dayIso)) ? '<span class="pr-overdue">!</span>' : '';
  const reminder = c.is_reminder ? '<span style="opacity:0.35;font-size:0.6rem"> [rem]</span>' : '';
  const recur = c.recur_type ? `<span style="opacity:0.45">${RECUR_LABEL[c.recur_type]||'↺'}</span>` : '';
  const dueC = (dayIso && isOverdue(c, dayIso)) ? 'hsl(var(--orange-glow-hsl) / 1)' : metaC;
  const due = c.due_date ? `<span class="pr-due" style="color:${dueC}">due ${c.due_date.slice(5).replace('T',' ')}</span>` : '';
  const metaHtml = (recur || due) ? `<div class="pr-card-meta" style="color:${metaC}">${recur}${due}</div>` : '';
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const notesHtml = c.notes ? `<div class="pr-card-notes" style="color:${metaC}">${esc(c.notes)}</div>` : '';
  return `<div class="pr-card${bg ? '' : ' plain'}" data-id="${c.id}" data-due="${c.due_date||''}" style="${bg}${border}">
    ${over}
    <div class="pr-card-title" style="color:${titleC}">${c.title}${reminder}</div>
    ${metaHtml}
    ${notesHtml}
  </div>`;
}

// drop-target hit-testing for dragging a timeline block out to another day
function dropTarget(x, y) {
  if (x == null || y == null) return null;
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.closest('#pr-unschedule')) return 'unschedule';
  const col = el.closest('[data-day]');
  return col ? col.dataset.day : null;
}

function createBlock(c, track) {
  const {bg, border, dark} = cardStyle(c);
  const durMin = Math.max(SNAP, snapMin(c.estimated_time || 90));
  c._durMin = durMin;
  const topPx = Math.max(0, (c._startMin - TL_START) * TL_PX);
  const heightPx = Math.max(15, durMin * TL_PX);
  const titleC = bg ? (dark ? 'inherit' : 'rgba(0,0,0,0.85)') : 'hsl(var(--green-hsl) / 0.8)';
  const metaC  = bg ? (dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.5)') : 'hsl(var(--green-hsl) / 0.45)';

  const block = document.createElement('div');
  block.className = 'dir-block' + (bg ? '' : ' plain');
  block.dataset.id = c.id;
  block.style.cssText = `${bg}${border}top:${topPx + 3}px;height:${Math.max(13, heightPx - 6)}px;`;

  const titleEl = document.createElement('div');
  titleEl.className = 'dir-block-title';
  titleEl.style.color = titleC;
  titleEl.textContent = c.title;

  const metaEl = document.createElement('div');
  metaEl.className = 'dir-block-meta';
  metaEl.style.color = metaC;
  metaEl.innerHTML = `<span class="dur-lbl" style="display:none">${durLabel(durMin)}</span>`;

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'dir-resize';

  if (durMin <= 30) {
    block.style.justifyContent = 'center';
    titleEl.style.marginBottom = '0';
    block.append(titleEl, resizeHandle);
  } else if (c.notes && heightPx >= 44) {
    const notesEl = document.createElement('div');
    notesEl.className = 'dir-block-notes';
    notesEl.style.color = metaC;
    notesEl.textContent = c.notes;
    block.append(titleEl, metaEl, notesEl, resizeHandle);
  } else {
    block.append(titleEl, metaEl, resizeHandle);
  }

  // Drag like the day<->day Sortable: a floating ghost follows the cursor and
  // the target list highlights. Drop on another day / unschedule -> reschedule;
  // drop within today -> set the block's time from the release position.
  function startDrag(startClientX, startClientY, getX, getY) {
    const rect = track.getBoundingClientRect();
    const bRect = block.getBoundingClientRect();
    const offsetX = startClientX - bRect.left;
    const offsetY = startClientY - bRect.top;
    const width = bRect.width, height = bRect.height;
    let moved = false;
    let lastX = startClientX, lastY = startClientY;
    let ghost = null;
    document.body.classList.add('pr-dragging');

    let preview = null;
    const unEl = document.getElementById('pr-unschedule');

    function makeGhost() {
      ghost = block.cloneNode(true);
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
      block.style.display = 'none';   // lifted into the ghost
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
    // Move the faint placeholder to where the card would land — a timeline slot
    // over today, an insertion point inside another day's list, like Sortable.
    function placePreview(x, y) {
      const tgt = dropTarget(x, y);
      if (unEl) unEl.classList.toggle('drag-over', tgt === 'unschedule');
      if (tgt === 'unschedule') { if (preview) { preview.remove(); preview = null; } return; }
      if (tgt && tgt !== isoToday()) {
        const list = document.getElementById('pr-list-' + tgt);
        if (!list) { if (preview) { preview.remove(); preview = null; } return; }
        if (!preview || preview.dataset.ctx !== 'day') {
          if (preview) preview.remove();
          // a real (faded) card so it matches the Sortable placeholder exactly
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
        const snapped = Math.max(TL_START, Math.min(TL_END - c._durMin, snapMin(rawMin)));
        preview.style.top = ((snapped - TL_START) * TL_PX + 3) + 'px';
        preview.style.height = Math.max(13, c._durMin * TL_PX - 6) + 'px';
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
      // capture the previewed insertion index before clearing it
      let dayIndex = 0;
      if (preview && preview.dataset.ctx === 'day' && preview.parentElement) {
        dayIndex = [...preview.parentElement.querySelectorAll('.pr-card, .pr-drop-preview')].indexOf(preview);
      }
      clearPreview();
      block.style.display = '';
      if (!moved) { openCardDialog(c.id, () => load(weekStart), 'prof'); return; }
      if (tgt === 'unschedule') {
        block.style.display = 'none';
        queueUpdate(c.id, null, false);
        setTimeout(() => load(weekStart), 700);
        return;
      }
      if (tgt && tgt !== isoToday()) {
        block.style.display = 'none';
        queueUpdate(c.id, tgt, dayIndex);
        setTimeout(() => load(weekStart), 700);
        return;
      }
      // dropped within today -> set the block's time from the release position
      const rawMin = (lastY - rect.top - offsetY) / TL_PX + TL_START;
      const snapped = Math.max(TL_START, Math.min(TL_END - c._durMin, snapMin(rawMin)));
      c._startMin = snapped;
      block.style.top = (snapped - TL_START) * TL_PX + 'px';
      scheduleCards.sort((a, b) => a._startMin - b._startMin);
      computeColumns(scheduleCards);
      applyColumnLayout(scheduleCards, currentTrack);
      saveStartTime(c.id, c._startMin);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, {passive: false});
    document.addEventListener('touchend', onUp);
  }

  block.addEventListener('mousedown', e => {
    if (resizeHandle.contains(e.target)) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY, ev => ev.clientX, ev => ev.clientY);
  });
  block.addEventListener('touchstart', e => {
    if (resizeHandle.contains(e.target)) return;
    const t0Y = e.touches[0].clientY, t0X = e.touches[0].clientX;
    let timer = setTimeout(() => { timer = null; cleanup(); startDrag(t0X, t0Y, ev => ev.touches[0].clientX, ev => ev.touches[0].clientY); }, 300);
    function cleanup() {
      block.removeEventListener('touchmove', onEarlyMove);
      block.removeEventListener('touchend', onEarlyEnd);
    }
    function onEarlyMove(ev) {
      if (!timer) return;
      const t = ev.touches[0];
      if (Math.abs(t.clientY - t0Y) > 8 || Math.abs(t.clientX - t0X) > 8) { clearTimeout(timer); timer = null; cleanup(); }
    }
    function onEarlyEnd() { if (timer) { clearTimeout(timer); timer = null; } cleanup(); }
    block.addEventListener('touchmove', onEarlyMove, {passive: true});
    block.addEventListener('touchend', onEarlyEnd, {once: true});
  }, {passive: true});

  function startResize(startClientY, getY) {
    const startDur = c._durMin;
    function onMove(ev) {
      const delta = getY(ev) - startClientY;
      const snapped = Math.max(SNAP, snapMin(startDur + delta / TL_PX));
      c._durMin = snapped;
      block.style.height = Math.max(13, snapped * TL_PX - 6) + 'px';
      metaEl.querySelector('.dur-lbl').textContent = durLabel(snapped);
    }
    async function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      c.estimated_time = c._durMin;
      await saveEstimatedTime(c.id, c._durMin);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, {passive: false});
    document.addEventListener('touchend', onUp);
  }

  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    startResize(e.clientY, ev => ev.clientY);
  });
  resizeHandle.addEventListener('touchstart', e => {
    e.stopPropagation();
    const t0Y = e.touches[0].clientY;
    let timer = setTimeout(() => { timer = null; cleanup(); startResize(t0Y, ev => ev.touches[0].clientY); }, 300);
    function cleanup() {
      resizeHandle.removeEventListener('touchmove', onEarlyMove);
      resizeHandle.removeEventListener('touchend', onEarlyEnd);
    }
    function onEarlyMove() { if (timer) { clearTimeout(timer); timer = null; cleanup(); } }
    function onEarlyEnd() { if (timer) { clearTimeout(timer); timer = null; } cleanup(); }
    resizeHandle.addEventListener('touchmove', onEarlyMove, {passive: true});
    resizeHandle.addEventListener('touchend', onEarlyEnd, {once: true});
  }, {passive: true});

  return block;
}

function computeColumns(cards) {
  const sorted = [...cards].sort((a, b) => a._startMin - b._startMin);
  const laneEnds = [];
  sorted.forEach(c => {
    let lane = laneEnds.findIndex(end => end <= c._startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = c._startMin + c._durMin;
    c._laneIdx = lane;
  });
  sorted.forEach(c => {
    const cEnd = c._startMin + c._durMin;
    let max = c._laneIdx;
    sorted.forEach(o => {
      if (o !== c && o._startMin < cEnd && o._startMin + o._durMin > c._startMin)
        max = Math.max(max, o._laneIdx);
    });
    c._totalLanes = max + 1;
  });
}

function applyColumnLayout(cards, track) {
  const GAP = 3;
  cards.forEach(c => {
    const el = track.querySelector(`[data-id="${c.id}"]`);
    if (!el) return;
    const n = c._totalLanes || 1;
    const idx = c._laneIdx || 0;
    if (n === 1) {
      el.style.left = GAP + 'px';
      el.style.right = GAP + 'px';
      el.style.width = '';
    } else {
      const pct = 100 / n;
      el.style.left = `calc(${idx * pct}% + ${GAP}px)`;
      el.style.width = `calc(${pct}% - ${GAP * 2}px)`;
      el.style.right = 'auto';
    }
  });
}

