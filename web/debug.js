let profileNotes = [];

function renderProfile() {
  const el = document.getElementById('dbg-profile');
  if (!profileNotes.length) { el.innerHTML = '<div class="dbg-empty">no notes</div>'; return; }
  el.innerHTML = '';
  [...profileNotes].reverse().forEach((n, revIdx) => {
    const idx = profileNotes.length - 1 - revIdx;
    const row = document.createElement('div');
    row.className = 'dbg-note';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'dbg-note-date';
    dateSpan.textContent = n.date || '';
    const textSpan = document.createElement('span');
    textSpan.className = 'dbg-note-text';
    textSpan.textContent = n.note;
    const xBtn = document.createElement('button');
    xBtn.className = 'dbg-note-x';
    xBtn.textContent = '×';
    xBtn.title = 'edit';
    xBtn.onclick = () => enterEditMode(row, idx);
    row.append(dateSpan, textSpan, xBtn);
    el.appendChild(row);
  });
}

function enterEditMode(row, idx) {
  const n = profileNotes[idx];
  row.innerHTML = '';
  const dateSpan = document.createElement('span');
  dateSpan.className = 'dbg-note-date';
  dateSpan.textContent = n.date || '';
  const textarea = document.createElement('textarea');
  textarea.className = 'dbg-note-edit';
  textarea.value = n.note;
  textarea.rows = Math.max(2, Math.ceil(n.note.length / 72));
  const actions = document.createElement('div');
  actions.className = 'dbg-note-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'dbg-note-save';
  saveBtn.textContent = '✓';
  saveBtn.title = 'save';
  saveBtn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) return;
    profileNotes[idx] = { ...n, note: text };
    await patchProfile();
    renderProfile();
  };
  const delBtn = document.createElement('button');
  delBtn.className = 'dbg-note-del';
  delBtn.textContent = '×';
  delBtn.title = 'delete';
  delBtn.onclick = async () => {
    profileNotes.splice(idx, 1);
    await patchProfile();
    renderProfile();
  };
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Escape') renderProfile();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveBtn.click(); }
  });
  actions.append(saveBtn, delBtn);
  row.append(dateSpan, textarea, actions);
  textarea.focus();
  textarea.select();
}

async function patchProfile() {
  await fetch('/api/context', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: profileNotes }),
  });
}

async function loadDebug() {
  const [ctxRes, logRes, mtgRes, veRes, mbRes, tarotRes] = await Promise.all([
    fetch('/api/context'),
    fetch('/api/debug/logs'),
    fetch('/api/mtg/log'),
    fetch('/data/moltbook_needs_human.json'),
    fetch('/api/moltbook/heartbeat-log'),
    fetch('/api/tarot/readings'),
  ]);

  // Vain-empress
  const veEl = document.getElementById('dbg-ve');
  if (veRes.ok) {
    const items = await veRes.json();
    if (!items.length) { veEl.innerHTML = '<div class="dbg-empty">no items</div>'; }
    else {
      veEl.innerHTML = items.slice().reverse().map((item) => {
        const ts = item.timestamp ? new Date(item.timestamp).toLocaleString('en-US', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        const typeClass = 'dbg-ve-type-' + (item.type || 'question').replace(/_/g, '-');
        return `<div class="dbg-ve-entry" onclick="this.classList.toggle('open')">
          <div class="dbg-ve-top">
            <span class="dbg-ve-type ${typeClass}">${item.type || ''}</span>
            <span class="dbg-ve-summary">${item.summary || ''}</span>
            <span class="dbg-ve-ts">${ts}</span>
          </div>
          ${item.detail ? `<div class="dbg-ve-detail">${item.detail}</div>` : ''}
        </div>`;
      }).join('');
    }
  } else { veEl.innerHTML = '<div class="dbg-empty">unavailable</div>'; }

  // Moltbook heartbeat
  const mbEl = document.getElementById('dbg-moltbook');
  if (mbRes.ok) {
    const mb = await mbRes.json();
    const lines = (mb.content || '').trim();
    mbEl.innerHTML = lines ? marked.parse(lines) : '<div class="dbg-empty">no heartbeat entries</div>';
  } else { mbEl.innerHTML = '<div class="dbg-empty">unavailable</div>'; }

  // Profile
  if (ctxRes.ok) {
    const ctx = await ctxRes.json();
    profileNotes = ctx.notes || [];
    renderProfile();
  }

  // Logs
  if (logRes.ok) {
    const data = await logRes.json();
    const files = data.files || [];
    document.getElementById('dbg-logs').innerHTML = files.map((f, i) => {
      const entries = f.entries || [];
      const isToday = false;  // activity logs pre-minimized
      return `<div class="dbg-log-file">
        <div class="dbg-log-hdr" onclick="toggleLog(${i})">
          <span class="dbg-log-toggle" id="tog-${i}">${isToday ? '▼' : '▶'}</span>
          <span>${f.name}</span>
          <span style="opacity:0.35">(${entries.length})</span>
        </div>
        <div class="dbg-log-entries${isToday ? ' open' : ''}" id="log-${i}">
          ${entries.length ? entries.slice().reverse().map(e => {
            const ts = e.ts ? new Date(e.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '';
            const meta = e.action === 'moved' ? `${e.from_col||'?'}→${e.to_col||'?'}` : (e.column || e.day || '');
            return `<div class="dbg-entry">
              <span class="dbg-entry-ts">${ts}</span>
              <span class="dbg-entry-action">${e.action||''}</span>
              <span class="dbg-entry-title">${e.title||''}</span>
              <span class="dbg-entry-meta">${meta}</span>
            </div>`;
          }).join('') : '<div class="dbg-empty">empty</div>'}
        </div>
      </div>`;
    }).join('') || '<div class="dbg-empty">no logs</div>';
  }

  // MTG log
  if (mtgRes.ok) {
    const data = await mtgRes.json();
    const sessions = (data.sessions || []);
    const el = document.getElementById('dbg-mtg');
    if (!sessions.length) { el.innerHTML = '<div class="dbg-empty">no mtg sessions</div>'; }
    else {
      el.innerHTML = sessions.map((s, si) => {
        const started = s.started_at ? new Date(s.started_at).toLocaleString('en-US', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : s.id;
        const exchanges = (s.exchanges || []);
        const open = false;  // mtg logs pre-minimized
        return `<div class="dbg-log-file">
          <div class="dbg-log-hdr" onclick="toggleLog('mtg-${si}')">
            <span class="dbg-log-toggle" id="tog-mtg-${si}">${open ? '▼' : '▶'}</span>
            <span>${started}</span>
            <span style="opacity:0.35">(${exchanges.length})</span>
          </div>
          <div class="dbg-log-entries${open ? ' open' : ''}" id="log-mtg-${si}">
            ${exchanges.length ? exchanges.map(e => `<div class="dbg-mtg-entry">
              <div class="dbg-mtg-ts">${e.ts ? new Date(e.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : ''}</div>
              <div class="dbg-mtg-user">${e.user || ''}</div>
              <div class="dbg-mtg-assistant">${e.assistant || ''}</div>
            </div>`).join('') : '<div class="dbg-empty">empty</div>'}
          </div>
        </div>`;
      }).join('');
    }
  }

  // Tarot readings
  const tEl = document.getElementById('dbg-tarot');
  if (tarotRes.ok) {
    const data = await tarotRes.json();
    const readings = (data.readings || []);
    if (!readings.length) { tEl.innerHTML = '<div class="dbg-empty">no readings</div>'; }
    else {
      tEl.innerHTML = readings.slice().reverse().map((r, ri) => {
        const when = r.saved_at ? new Date(r.saved_at).toLocaleString('en-US', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        const sigName = r.significator && r.significator.name ? r.significator.name : null;
        const cards = (r.spread && r.spread.cards) || [];
        const cardsHtml = cards.map(c =>
          `<span class="dbg-tarot-card"><span class="pos">${esc(c.position_label || c.position || '')}:</span> ${esc(c.name || c.card_id || '')}${c.reversed ? ' <span class="rev">(rev)</span>' : ''}</span>`
        ).join('');
        const msgs = (r.messages || []).map(m => {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          const s = content.trim();
          if (m.role === 'user' && s.startsWith('[') && s.endsWith(']')) {
            return `<div class="dbg-tarot-msg dbg-tarot-event">${esc(s)}</div>`;
          }
          const cls = m.role === 'assistant' ? 'dbg-tarot-asst' : 'dbg-tarot-user';
          return `<div class="dbg-tarot-msg ${cls}">${esc(content)}</div>`;
        }).join('');
        const open = false;  // tarot readings pre-minimized
        const spreadType = (r.spread && r.spread.type) || 'no spread';
        return `<div class="dbg-log-file">
          <div class="dbg-log-hdr" onclick="toggleLog('tarot-${ri}')">
            <span class="dbg-log-toggle" id="tog-tarot-${ri}">${open ? '▼' : '▶'}</span>
            <span>${when}</span>
            <span style="opacity:0.35">${esc(spreadType)}${sigName ? ' · sig ' + esc(sigName) : ''} (${(r.messages||[]).length})</span>
          </div>
          <div class="dbg-log-entries${open ? ' open' : ''}" id="log-tarot-${ri}">
            ${sigName ? `<div class="dbg-tarot-sig">Significator: ${esc(sigName)}</div>` : ''}
            ${cardsHtml ? `<div class="dbg-tarot-cards">${cardsHtml}</div>` : ''}
            ${msgs || '<div class="dbg-empty">no messages</div>'}
          </div>
        </div>`;
      }).join('');
    }
  } else { tEl.innerHTML = '<div class="dbg-empty">unavailable</div>'; }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// eslint-disable-next-line no-unused-vars
function toggleLog(i) {
  const el = document.getElementById('log-'+i);
  const tog = document.getElementById('tog-'+i);
  el.classList.toggle('open');
  tog.textContent = el.classList.contains('open') ? '▼' : '▶';
}


loadDebug();
