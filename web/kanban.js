/* global cardStyle, chipStyle, bookBarColors */
const COLS = ['rd','hq','archives','exile'];
let cards = [];
let dragging = false;
let barSortable = null;
let archivesCollapsed = true;
let exileCollapsed = true;

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso + 'T12:00:00');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  if (iso.includes('T')) {
    const hh = String(d.getHours()).padStart(2,'0');
    const min = String(d.getMinutes()).padStart(2,'0');
    return `${mm}/${dd} ${hh}:${min}`;
  }
  return `${mm}/${dd}`;
}

function isUrgent(iso) {
  return iso && (new Date(iso) - new Date()) / 86400000 <= 3;
}

function isOverdue(iso) {
  if (!iso) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(iso.slice(0,10)) < today;
}

function isDueSoon(iso) {
  if (!iso) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = (new Date(iso.slice(0,10)) - today) / 86400000;
  return days >= 0 && days <= 5;
}

// rd float window: due within 2 weeks (includes overdue)
function isDueWithin2wk(iso) {
  if (!iso) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = (new Date(iso.slice(0,10)) - today) / 86400000;
  return days <= 14;
}

function renderCard(c) {
  const {bg, border, dark} = cardStyle(c);
  const hasStyle = !!bg;
  const bright = hasStyle && !dark;
  const titleC = !hasStyle ? 'hsl(var(--green-hsl) / 1)' : dark ? 'inherit' : 'rgba(0,0,0,0.92)';
  const tc     = !hasStyle ? 'hsl(var(--green-hsl) / 0.45)' : dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.8)';
  const displayDate = c.due_date;
  const urgent = isUrgent(displayDate);
  const overdue = c.column === 'rd' && isOverdue(displayDate);
  const dueSoon = !overdue && isDueSoon(displayDate);
  const dateLabel = displayDate ? fmtDate(c.due_date) : '';
  const RECUR_LABEL = {week:'↺wk', 'bi-week':'↺2wk', month:'↺mo', holiday:'↺yr', birthday:'↺bday'};
  const recurBadge = c.recur_type ? `<span style="opacity:0.55;margin-left:4px">${RECUR_LABEL[c.recur_type]||'↺'}</span>` : '';
  const reminderBadge = c.is_reminder ? `<span style="opacity:0.4;font-size:0.55rem;margin-left:4px">[reminder]</span>` : '';
  const dateC = overdue ? 'hsl(var(--orange-glow-hsl) / 1)' : dueSoon ? (bright ? 'rgba(0,90,0,0.95)' : 'hsl(var(--green-hsl) / 1)') : bright ? (urgent ? 'rgba(0,0,0,1)' : 'rgba(30,30,30,0.75)') : (urgent && dark ? 'hsl(var(--green-hsl) / 1)' : tc);
  return `<div class="card${hasStyle ? '' : ' plain'}" data-id="${c.id}" data-title="${(c.title||'').replace(/"/g,'&quot;')}" data-notes="${(c.notes||'').replace(/"/g,'&quot;')}" style="${bg}${border}">
    <div class="card-title" style="color:${titleC};${bright ? 'font-weight:700;' : ''}">${c.title}${reminderBadge}</div>
    ${(c.notes||c.description) ? `<div class="card-desc" style="color:${tc}">${c.notes||c.description}</div>` : ''}
    <div class="card-foot">
      <div class="card-badge" style="color:${tc}">${recurBadge}</div>
      ${displayDate ? `<div class="card-due" style="color:${dateC}">${dateLabel}</div>` : ''}
    </div>
  </div>`;
}

async function save() {
  COLS.forEach(col => {
    document.querySelectorAll(`#col-${col} .card`).forEach((el, i) => {
      const c = cards.find(x => x.id === el.dataset.id);
      if (c) { c.column = col; c.order = i; }
    });
  });
  await fetch('/api/rd', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({cards})});
}

// eslint-disable-next-line no-unused-vars
function toggleArchives(e) { if (e) e.stopPropagation(); archivesCollapsed = !archivesCollapsed; buildBoard(); }
// eslint-disable-next-line no-unused-vars
function toggleExile(e) { if (e) e.stopPropagation(); exileCollapsed = !exileCollapsed; buildBoard(); }

const COL_LABELS = {rd: 'r&d', hq: 'hq', archives: 'archives', exile: 'exile'};

function renderCol(col) {
  const count = cards.filter(c=>c.column===col).length;
  const isArchives = col === 'archives', isExile = col === 'exile';
  const collapsed = (isArchives && archivesCollapsed) || (isExile && exileCollapsed);
  const toggle = isArchives ? 'toggleArchives' : (isExile ? 'toggleExile' : null);
  const label = COL_LABELS[col] || col;
  const hdr = toggle
    ? `<span class="col-hdr-label">${collapsed ? '▶' : label} <span style="opacity:0.35">(${count})</span></span>
       ${!collapsed ? `<button class="done-toggle" onclick="${toggle}(event)">▼</button>` : ''}`
    : col === 'rd'
      ? `<span class="col-hdr-label">${label} <span style="opacity:0.35">(${count})</span></span><input id="rd-search" type="text" placeholder="...search" autocomplete="off" spellcheck="false">`
      : `<span class="col-hdr-label">${label} <span style="opacity:0.35">(${count})</span></span>`;
  const hideFromMain = col === 'rd' || col === 'hq';
  const floatSoon = col === 'rd' || col === 'hq';
  const colCards = collapsed ? '' : cards.filter(c=>c.column===col && !(hideFromMain && (c.is_reminder || c.is_book))).sort((a,b)=>{
    if (col === 'rd') {
      // due within 2 weeks floats to top, sorted by due date (overrides manual order)
      const da = isDueWithin2wk(a.due_date), db = isDueWithin2wk(b.due_date);
      if (da !== db) return da ? -1 : 1;
      if (da && db) return a.due_date.localeCompare(b.due_date);
    } else if (floatSoon) {
      const sa = isDueSoon(a.due_date) ? 0 : 1, sb = isDueSoon(b.due_date) ? 0 : 1;
      if (sa !== sb) return sa - sb;
    }
    return a.order - b.order;
  }).map(renderCard).join('');
  return `<div class="col${collapsed?' col-collapsed':''}"${collapsed&&toggle?` onclick="${toggle}()"`:''}>
    <div class="col-hdr">${hdr}</div>
    <div class="col-list" id="col-${col}">${colCards}</div>
  </div>`;
}


function _remChipHtml(c) {
  const date = c.due_date ? ` <span style="opacity:0.45;font-size:0.9em">${c.due_date.slice(5)}</span>` : '';
  const {color, bg, border} = chipStyle(c);
  const title = c.title;
  return `<div class="rem-item" data-id="${c.id}" style="color:${color};background:${bg};border:1px solid ${border}">${title}${date}</div>`;
}

function _syncRemH() {
  const bar = document.getElementById('reminders-bar');
  if (bar) document.documentElement.style.setProperty('--rem-bar-h', bar.offsetHeight + 'px');
}

function buildReminders() {
  const all = cards.filter(c => c.is_reminder && c.column !== 'archives' && c.column !== 'exile')
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 30);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const visible = all.filter(c => c.pinned_reminder || !c.due_date || c.due_date.slice(0, 10) <= cutoffIso);
  const overflow = all.filter(c => !c.pinned_reminder && c.due_date && c.due_date.slice(0, 10) > cutoffIso);
  if (!all.length) { document.body.classList.remove('has-reminders'); }
  else { document.body.classList.add('has-reminders'); }
  const bar = document.getElementById('reminders-bar');
  bar.innerHTML = visible.map(_remChipHtml).join('');
  bar.querySelectorAll('.rem-item').forEach(el => {
    el.addEventListener('click', () => { if (!dragging) openCardDialog(el.dataset.id, () => { load(); }, 'core'); });
  });
  if (overflow.length) {
    const first = bar.firstElementChild;
    if (first) {
      first.style.position = 'relative';
      first.style.overflow = 'visible';
      const btn = document.createElement('button');
      btn.className = 'rem-overflow-btn';
      btn.textContent = `+${overflow.length}`;
      btn.onclick = (e) => { e.stopPropagation(); showRemOverflow(); };
      first.appendChild(btn);
    }
  }
  _syncRemH();
}

function showRemOverflow() {
  const all = cards.filter(c => c.is_reminder && c.column !== 'archives' && c.column !== 'exile')
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 30);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const overflow = all.filter(c => c.due_date && c.due_date.slice(0, 10) > cutoffIso);
  const modal = document.getElementById('rem-overflow-modal');
  document.getElementById('rem-overflow-list').innerHTML = overflow.map(c => {
    const color = chipStyle(c).color;
    return `<div class="rem-ov-row" data-id="${c.id}" style="color:${color}">${c.title}<span style="opacity:0.45;margin-left:8px;font-size:0.85em">${c.due_date.slice(5)}</span></div>`;
  }).join('');
  modal.style.display = 'flex';
  modal.querySelectorAll('.rem-ov-row').forEach(el => {
    el.addEventListener('click', () => {
      modal.style.display = 'none';
      openCardDialog(el.dataset.id, () => { load(); }, 'core');
    });
  });
}

function _syncBooksH() {
  const bar = document.getElementById('books-bar');
  if (bar) document.documentElement.style.setProperty('--books-bar-h', bar.offsetHeight + 'px');
}

// books with real progress (current_page>0 and total_pages>0) show on the bar;
// books with undefined/0 pages live only in the +N overflow.
function bookPartition() {
  const all = cards.filter(c => c.is_book && c.column !== 'archives' && c.column !== 'exile');
  const active = all.filter(c => c.current_page > 0 && c.total_pages > 0);
  const noProgress = all.filter(c => !(c.current_page > 0 && c.total_pages > 0));
  const MAX_VISIBLE = 8;
  return { visible: active.slice(0, MAX_VISIBLE), overflow: [...active.slice(MAX_VISIBLE), ...noProgress] };
}

function buildBooks() {
  const { visible, overflow } = bookPartition();
  const bar = document.getElementById('books-bar');
  if (!visible.length && !overflow.length) { document.body.classList.remove('has-books'); bar.innerHTML = ''; _syncBooksH(); return; }
  document.body.classList.add('has-books');
  bar.innerHTML = visible.map(c => {
    const pct = Math.min(100, Math.round(c.current_page / c.total_pages * 100));
    // color the chip by category, exactly like the reminder chips (_remChipHtml)
    const {color, bg, border} = chipStyle(c);
    const bk = bookBarColors(c);
    const bar_html = `<div class="book-item-bar" style="background:${bk.track}"><div class="book-item-fill" style="width:${pct}%;background:${bk.fill}"></div></div>`;
    return `<div class="book-item" data-id="${c.id}" style="color:${color};background:${bg};border:1px solid ${border}"><div class="book-item-title">${c.title}</div>${bar_html}</div>`;
  }).join('');
  bar.querySelectorAll('.book-item').forEach(el => {
    el.addEventListener('click', () => { if (!dragging) openCardDialog(el.dataset.id, () => load(), 'core'); });
  });
  if (overflow.length) {
    // +N on the topmost chip (top-right); if nothing is visible, host it on an empty chip
    let host = bar.firstElementChild;
    if (!host) {
      host = document.createElement('div');
      host.className = 'book-item';
      host.style.minHeight = '28px';
      bar.appendChild(host);
    }
    host.style.position = 'relative';
    host.style.overflow = 'visible';
    const btn = document.createElement('button');
    btn.className = 'book-overflow-btn';
    btn.textContent = `+${overflow.length}`;
    btn.onclick = (e) => { e.stopPropagation(); showBookOverflow(); };
    host.appendChild(btn);
  }
  _syncBooksH();
}

function showBookOverflow() {
  const modal = document.getElementById('book-overflow-modal');
  const list = document.getElementById('book-overflow-list');
  list.innerHTML = bookPartition().overflow.map(c =>
    `<div class="book-ov-row" data-id="${c.id}">${c.title}</div>`
  ).join('');
  list.querySelectorAll('.book-ov-row').forEach(el => {
    el.addEventListener('click', () => {
      modal.style.display = 'none';
      openCardDialog(el.dataset.id, () => load(), 'core');
    });
  });
  modal.style.display = 'flex';
}

function buildBoard() {
  buildReminders();
  buildBooks();
  // preserve per-column scroll across innerHTML rebuild
  const scrollPos = {};
  COLS.forEach(col => { const el = document.getElementById('col-'+col); if (el) scrollPos[col] = el.scrollTop; });
  const mainCol = col => renderCol(col).replace('<div class="col', '<div style="flex:4" class="col');
  const groupExpanded = !archivesCollapsed || !exileCollapsed;
  document.getElementById('board').innerHTML =
    ['rd','hq'].map(mainCol).join('') +
    `<div class="col-group" style="flex:${groupExpanded ? 4 : 1}">${['archives','exile'].map(renderCol).join('')}</div>`;
  COLS.forEach(col => { const el = document.getElementById('col-'+col); if (el && scrollPos[col] != null) el.scrollTop = scrollPos[col]; });
  COLS.forEach(col => {
    const el = document.getElementById('col-'+col);
    if (!el) return;
    Sortable.create(el, {
      group:'kanban', animation:120, ghostClass:'sortable-ghost',
      delay: 300, delayOnTouchOnly: true,
      onStart: () => { dragging = true; document.getElementById('board').classList.add('drag-active'); document.body.classList.add('dragging-card'); },
      onEnd: () => { document.getElementById('board').classList.remove('drag-active'); document.body.classList.remove('dragging-card'); setTimeout(() => { dragging = false; }, 50); save(); }
    });
  });
  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => { if (!dragging) openCardDialog(el.dataset.id, () => { load(); }, 'core'); });
  });
  initBarSortable();
  const srch = document.getElementById('rd-search');
  if (srch) srch.addEventListener('input', function() {
    const q = this.value.trim().toLowerCase();
    document.querySelectorAll('#col-rd .card, #col-hq .card, #col-archives .card, #col-exile .card').forEach(el => {
      const title = (el.dataset.title || '').toLowerCase();
      const notes = (el.dataset.notes || '').toLowerCase();
      el.classList.toggle('search-hide', !!q && !title.includes(q) && !notes.includes(q));
    });
  });
}

function initBarSortable() {
  const bar = document.getElementById('reminders-bar');
  if (!bar) return;
  if (barSortable) { barSortable.destroy(); barSortable = null; }
  barSortable = Sortable.create(bar, {
    group: { name: 'kanban', put: true, pull: true },
    animation: 120,
    ghostClass: 'sortable-ghost',
    delay: 300, delayOnTouchOnly: true,
    onAdd: async (evt) => {
      const id = evt.item.dataset.id;
      evt.item.remove();
      const c = cards.find(x => x.id === id);
      if (c) {
        c.is_reminder = true;
        await save();
        buildBoard();
      }
    },
    onRemove: (evt) => {
      const id = evt.item.dataset.id;
      evt.item.remove();
      const c = cards.find(x => x.id === id);
      if (c) {
        c.is_reminder = false;
        setTimeout(() => { save(); buildBoard(); }, 80);
      }
    }
  });
}

async function load() {
  const data = await (await fetch('/api/rd')).json();
  cards = data.cards || [];
  buildBoard();
}

window.addEventListener('resize', _syncRemH);
window.addEventListener('resize', _syncBooksH);
// exec bubble changed cards -> reload live
window.addEventListener('exec:cards-changed', () => load());

load();
