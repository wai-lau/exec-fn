// Re-render every card element in place (no refetch) from current card state,
// then re-pack lanes. Called after a today drag/resize/done so positions reflow.
function redrawCards(track) {
  track.querySelectorAll('.dir-block, .dir-group').forEach(e => e.remove());
  scheduleCards.forEach(c => track.appendChild(hasBreakdown(c) ? createGroup(c, track) : createBlock(c, track)));
  computeColumns(scheduleCards);
  applyColumnLayout(scheduleCards, track);
}

function buildSchedule(cards) {
  const wrap = document.getElementById('pr-tl-wrap');
  if (!wrap) return;
  if (_nowInterval) { clearInterval(_nowInterval); _nowInterval = null; }
  if (_nowRaf) { cancelAnimationFrame(_nowRaf); _nowRaf = null; }

  scheduleCards = cards;
  cards.forEach(c => { c._startMin = c.dir_start_min != null ? c.dir_start_min : TL_START; });

  const tlWrap = document.createElement('div');
  tlWrap.style.cssText = 'display:flex;';

  const labels = document.createElement('div');
  labels.className = 'dir-tl-labels';
  labels.style.height = TL_H + 'px';

  const track = document.createElement('div');
  track.className = 'dir-tl-track';
  track.style.height = TL_H + 'px';

  const nowMin = nowMinutes();

  for (let h = 5; h <= 28; h++) {
    const y = (h * 60 - TL_START) * TL_PX;
    const hline = document.createElement('div');
    hline.className = 'tl-hour-line';
    hline.style.top = y + 'px';
    track.appendChild(hline);
    if (h < 28) {
      const lbl = document.createElement('div');
      lbl.className = 'dir-tl-label';
      lbl.style.top = y + 'px';
      lbl.textContent = String(h % 24).padStart(2, '0');
      labels.appendChild(lbl);
      const hline2 = document.createElement('div');
      hline2.className = 'tl-half-line';
      hline2.style.top = (y + 30 * TL_PX) + 'px';
      track.appendChild(hline2);
    }
  }

  [
    {label: 'lunch', start: 12*60, end: 13*60},
    {label: 'dinner', start: 18*60+30, end: 20*60},
  ].forEach(({label, start, end}) => {
    const el = document.createElement('div');
    el.className = 'tl-meal';
    el.style.top = ((start - TL_START) * TL_PX + 3) + 'px';
    el.style.height = ((end - start) * TL_PX - 6) + 'px';
    el.innerHTML = `<span class="tl-meal-label">[ ${label} ]</span>`;
    track.appendChild(el);
  });

  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'tl-empty';
    empty.textContent = 'nothing scheduled today';
    track.appendChild(empty);
  }
  cards.forEach(c => track.appendChild(hasBreakdown(c) ? createGroup(c, track) : createBlock(c, track)));
  computeColumns(cards);
  applyColumnLayout(cards, track);
  currentTrack = track;

  setupNowIndicator(wrap, track);

  tlWrap.appendChild(labels);
  tlWrap.appendChild(track);
  wrap.innerHTML = '';
  wrap.appendChild(tlWrap);

  // drop target: drag a card from another day onto today's timeline
  Sortable.create(wrap, {
    group: { name: 'prophecies', put: true, pull: false },
    draggable: '.__nodrag__',
    onAdd(evt) {
      const cardId = evt.item.dataset.id;
      evt.item.remove();
      queueUpdate(cardId, isoToday(), false);
      setTimeout(() => load(weekStart), 700);
    },
  });

  // autoscroll to 2 hours before now
  if (nowMin >= TL_START && nowMin <= TL_END) {
    wrap.scrollTop = Math.max(0, (nowMin - TL_START) * TL_PX - 120 * TL_PX);
  }
}

// Current-time indicator + past "hider" overlay. Cover + now-line live on the
// column (not the scrolling track) so they bleed to the screen top/side, under
// the date; the clock rides inside the track. Sets the module-level now timers.
function setupNowIndicator(wrap, track) {
  const col = wrap.parentElement;
  col.querySelectorAll('.tl-past, .tl-now-line').forEach(e => e.remove());
  const pastOverlay = document.createElement('div');
  pastOverlay.className = 'tl-past';
  pastOverlay.style.display = 'none';
  col.appendChild(pastOverlay);
  const nowLine = document.createElement('div');
  nowLine.className = 'tl-now-line';
  nowLine.style.display = 'none';
  col.appendChild(nowLine);
  const nowClock = document.createElement('div');
  nowClock.className = 'tl-now-clock';
  nowClock.style.display = 'none';
  track.appendChild(nowClock);

  // the track scrolls inside the wrap; project the now-minute into the column's
  // coordinate space so the cover/line follow the scroll while spanning the
  // full column width (and the cover reaches the screen top, under the date).
  function positionNow() {
    const m = nowMinutes();
    if (m < TL_START || m > TL_END) {
      nowLine.style.display = 'none';
      nowClock.style.display = 'none';
      pastOverlay.style.display = 'none';
      return;
    }
    const headerH = wrap.offsetTop;               // header sits above the wrap
    const viewBot = headerH + wrap.clientHeight;  // timeline viewport bottom
    const nowY = (m - TL_START) * TL_PX;
    const screenY = headerH + nowY - wrap.scrollTop;
    // now-line: only while within the timeline viewport
    const lineVis = screenY >= headerH && screenY <= viewBot;
    nowLine.style.display = lineVis ? '' : 'none';
    nowLine.style.top = screenY + 'px';
    // cover: screen top down to the now-line; full viewport when now is below
    // the fold, hidden when the whole viewport is still in the future
    let coverH = 0;
    if (screenY >= viewBot) coverH = viewBot;
    else if (screenY > headerH) coverH = screenY;
    pastOverlay.style.display = coverH > 0 ? '' : 'none';
    pastOverlay.style.height = coverH + 'px';
    // clock rides inside the track (scrolls naturally, clipped by the wrap)
    nowClock.style.display = '';
    nowClock.style.top = (nowY - 16) + 'px';
  }
  positionNow();
  _nowInterval = setInterval(positionNow, 60000);
  (function tick() {
    const n = new Date();
    const h  = String(n.getHours()).padStart(2,'0');
    const mi = String(n.getMinutes()).padStart(2,'0');
    const s  = String(n.getSeconds()).padStart(2,'0');
    const cs = String(Math.floor(n.getMilliseconds()/10)).padStart(2,'0');
    nowClock.textContent = `${h} : ${mi} : ${s} : ${cs}`;
    positionNow();
    _nowRaf = requestAnimationFrame(tick);
  })();
}

async function saveStartTime(cardId, startMin) {
  const rd = await (await fetch('/api/rd')).json();
  const allCards = rd.cards || [];
  const card = allCards.find(x => x.id === cardId);
  if (!card) return;
  card.dir_start_min = startMin;
  await fetch('/api/rd', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({cards: allCards})});
}

async function saveEstimatedTime(cardId, mins) {
  setStatus('saving...');
  try {
    const rd = await (await fetch('/api/rd')).json();
    const allCards = rd.cards || [];
    const card = allCards.find(c => c.id === cardId);
    if (card) {
      card.estimated_time = mins;
      await fetch('/api/rd', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({cards: allCards})});
    }
    setStatus('saved');
    setTimeout(() => setStatus(''), 1200);
  } catch(e) { setStatus('save error: ' + e.message); }
}

function dayCellHtml(day, today) {
  const isToday = day === today;
  const dow = new Date(day + 'T12:00:00').getDay();
  const isWeekend = dow === 0 || dow === 6;
  const dayLabel = fmtDay(day).split(',')[0];
  const dateLabel = fmtDay(day).replace(/^[^,]+, /, '');
  const hdr = `<div class="pr-col-hdr${isToday?' today-hdr':''}">
      <div class="pr-day-name">${dayLabel} <span class="pr-date">${dateLabel}</span></div>
    </div>`;
  // today renders as a timeline instead of a card list
  if (isToday) {
    return `<div class="pr-col today-col" data-day="${day}">${hdr}
      <div class="pr-tl-wrap" id="pr-tl-wrap"><span style="opacity:0.3;padding:12px;font-size:0.75rem">loading…</span></div>
    </div>`;
  }
  const cards = weekData.days[day] || [];
  return `<div class="pr-col${isWeekend?' weekend':''}" data-day="${day}">${hdr}
    <div class="pr-list" id="pr-list-${day}">${cards.map(c=>renderCard(c,day)).join('')}</div>
  </div>`;
}

function buildBoard() {
  if (!weekData) return;
  const today = isoToday();

  // Always include today even when viewing a different week
  if (!weekData.days[today]) weekData.days[today] = [];
  const days = Object.keys(weekData.days).sort();

  // three columns: today (timeline) | next 3 days | last 3 days — full week
  const groups = [days.slice(0, 1), days.slice(1, 4), days.slice(4, 7)];
  let html = '';
  groups.forEach((groupDays, gi) => {
    const small = gi >= 1;
    html += `<div class="pr-colgroup${small?' small':''}">`;
    html += groupDays.map(day => dayCellHtml(day, today)).join('');
    html += `</div>`;
  });

  document.getElementById('pr-board').innerHTML = html;
  initSortable(days);
  document.querySelectorAll('.pr-card').forEach(el => {
    el.addEventListener('click', () => { if (!_prDragging) openCardDialog(el.dataset.id, () => load(weekStart), 'prof'); });
  });
  // build the today timeline (drop target + blocks)
  const todayCards = (weekData.days[today] || []).filter(c => !c.is_reminder && !c.is_book);
  buildSchedule(todayCards);
}

function initSortable(days) {
  const unscheduleEl = document.getElementById('pr-unschedule');

  Sortable.create(unscheduleEl, {
    group: { name: 'prophecies', put: true, pull: false },
    animation: 120,
    ghostClass: 'sortable-ghost',
    onAdd(evt) {
      const cardId = evt.item.dataset.id;
      evt.item.remove();
      queueUpdate(cardId, null, false);
      setTimeout(() => load(weekStart), 700);
    },
  });

  days.forEach(day => {
    const el = document.getElementById('pr-list-' + day);
    if (!el) return;
    Sortable.create(el, {
      group: 'prophecies',
      animation: 120,
      ghostClass: 'sortable-ghost',
      delay: 300,
      delayOnTouchOnly: true,
      onStart() {
        _prDragging = true;
        document.body.classList.add('pr-dragging');
      },
      onEnd(evt) {
        _prDragging = false;
        document.body.classList.remove('pr-dragging');
        const cardId = evt.item.dataset.id;
        const cardDue = evt.item.dataset.due;
        const toDay = evt.to.id.replace('pr-list-', '');

        if (evt.to === unscheduleEl) return;

        if (cardDue && toDay > cardDue) {
          showToast(`Warning: scheduling after due date (${cardDue})`);
        }
        evt.to.querySelectorAll('.pr-card').forEach((el, i) => {
          if (el.dataset.id === cardId) queueUpdate(el.dataset.id, toDay, i);
          else queueUpdate(el.dataset.id, undefined, i);
        });
        if (evt.from !== evt.to) {
          evt.from.querySelectorAll('.pr-card').forEach((el, i) => {
            queueUpdate(el.dataset.id, undefined, i);
          });
        }
      },
    });
  });

  unscheduleEl.addEventListener('dragover', () => unscheduleEl.classList.add('drag-over'));
  unscheduleEl.addEventListener('dragleave', () => unscheduleEl.classList.remove('drag-over'));
}

function queueUpdate(cardId, scheduledDay, order) {
  const idx = pendingUpdates.findIndex(u => u.id === cardId);
  const upd = {id: cardId};
  if (scheduledDay !== undefined) upd.scheduled_day = scheduledDay || null;
  if (order !== undefined) upd.order = order;
  if (idx >= 0) pendingUpdates[idx] = {...pendingUpdates[idx], ...upd};
  else pendingUpdates.push(upd);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushUpdates, 600);
}

async function flushUpdates() {
  if (!pendingUpdates.length) return;
  const updates = [...pendingUpdates];
  pendingUpdates = [];
  setStatus('saving...');
  try {
    await fetch('/api/prophecies', {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({updates}),
    });
    setStatus('saved');
    setTimeout(() => setStatus(''), 1500);
  } catch(e) {
    setStatus('save error: ' + e.message);
  }
}

function setStatus(msg) {
  document.getElementById('pr-status').textContent = msg;
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('pr-toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

function consult_oracle() {
  const unsched = weekData.unscheduled || [];
  if (!unsched.length) return;

  const today = isoToday();
  // Stay within backend window (today..today+6); skip today itself.
  const targetDays = Array.from({length: 6}, (_, i) => addDays(today, i + 1));

  // count already-scheduled cards per target day
  const counts = {};
  for (const day of targetDays) {
    counts[day] = (weekData.days[day] || []).length;
  }

  for (const card of unsched) {
    const day = targetDays.reduce((a, b) => counts[a] <= counts[b] ? a : b);
    counts[day]++;
    // Place locally so buildBoard renders it this paint — never leave a
    // card stranded in the (unrendered) unscheduled bucket.
    card.scheduled_day = day;
    (weekData.days[day] = weekData.days[day] || []).push(card);
    queueUpdate(card.id, day, false);
  }
  weekData.unscheduled = [];
}

async function load(start) {
  document.getElementById('pr-board').innerHTML = '<span class="pr-loading">loading...</span>';
  const url = start ? `/api/prophecies?start=${start}` : '/api/prophecies';
  const r = await fetch(url);
  weekData = await r.json();
  weekStart = weekData.week_start;
  if (!start) consult_oracle();
  buildBoard();
}

// exec bubble changed cards -> reload live
window.addEventListener('exec:cards-changed', () => load(weekStart));
load(null);
