/* Shared card edit dialog — used by kanban, prophecies, directives */
(function () {
  // Inject modal HTML once
  const html = `
<style>
.cd-ov { display:none; position:fixed; inset:0; z-index:50; background:hsl(var(--scrim-hsl) / 0.45); align-items:center; justify-content:center; }
.cd-ov.open { display:flex; }
.cd-box { background:hsl(var(--surface-hsl)); border:1px solid hsl(var(--green-hsl) / 0.12); border-radius:10px; padding:24px 28px; width:min(420px,92vw); font-family:'Iosevka Mayukai Monolite',monospace; font-weight:500; max-height:90vh; overflow-y:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb, currentColor 45%, transparent) transparent; }
.cd-box::-webkit-scrollbar { width:8px; }
.cd-box::-webkit-scrollbar-track { background:transparent; }
.cd-box::-webkit-scrollbar-thumb { background:color-mix(in srgb, currentColor 45%, transparent); border-radius:2px; }
.cd-box input[type=checkbox] { accent-color:currentColor; }
.cd-box label { display:block; font-size:0.6rem; color:hsl(var(--green-hsl) / 0.45); margin:12px 0 3px; text-transform:uppercase; letter-spacing:0.1em; }
.cd-box input,.cd-box select,.cd-box textarea { width:100%; background:rgba(255,255,255,0.03); border:1px solid hsl(var(--green-hsl) / 0.12); color:hsl(var(--green-hsl) / 1); font-family:'Iosevka Mayukai Monolite',monospace; font-weight:500; font-size:16px; padding:5px 8px; box-sizing:border-box; resize:vertical; }
.cd-box select option { background:#111; }
.cd-box textarea { min-height:56px; }
.cd-actions { display:flex; gap:8px; margin-top:18px; justify-content:space-between; align-items:center; }
.cd-btn { background:none; border:1px solid hsl(var(--green-hsl) / 0.45); color:hsl(var(--green-hsl) / 0.8); font-family:'Iosevka Mayukai Monolite',monospace; font-weight:500; font-size:0.78rem; padding:4px 12px; cursor:pointer; transition:all 0.2s; }
.cd-btn:hover { border-color:hsl(var(--green-hsl) / 1); color:hsl(var(--green-hsl) / 1); }
.cd-btn-exile { border-color:hsl(var(--orange-glow-hsl) / 0.6) !important; color:hsl(var(--orange-glow-hsl) / 0.8) !important; }
.cd-btn-exile:hover { border-color:hsl(var(--orange-glow-hsl) / 1) !important; color:hsl(var(--orange-glow-hsl) / 1) !important; }
.cd-btn-late { border-color:rgba(255,176,0,0.55) !important; color:rgba(255,190,40,0.85) !important; }
.cd-btn-late:hover { border-color:rgba(255,176,0,0.95) !important; color:rgba(255,200,70,1) !important; }
.cd-dark label { color:inherit !important; opacity:0.55; }
.cd-dark input,.cd-dark select,.cd-dark textarea { color:inherit !important; background:rgba(255,255,255,0.04) !important; border-color:rgba(255,255,255,0.12) !important; }
.cd-dark .cd-btn { border-color:rgba(255,255,255,0.25) !important; color:inherit !important; opacity:0.8; }
.cd-dark .cd-btn:hover { opacity:1; }
.cd-bright label { color:rgba(0,0,0,0.5) !important; }
.cd-bright input,.cd-bright select,.cd-bright textarea { color:rgba(0,0,0,0.85) !important; background:rgba(0,0,0,0.08) !important; border-color:rgba(0,0,0,0.18) !important; }
.cd-bright select option { background:#eee; color:#111; }
.cd-bright .cd-btn { border-color:rgba(0,0,0,0.3) !important; color:rgba(0,0,0,0.65) !important; }
.cd-bright .cd-btn:hover { border-color:rgba(0,0,0,0.7) !important; color:rgba(0,0,0,0.9) !important; }
</style>
<div class="cd-ov" id="cd-modal" onclick="if(event.target===this)cdSave()">
  <div class="cd-box">
    <label>title</label><input id="cd-title" type="text">
    <label>date</label>
    <input id="cd-due" type="text" placeholder="optional">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;margin-top:12px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
        <input id="cd-reminder" type="checkbox" style="width:auto">
        <span>reminder only</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
        <input id="cd-event" type="checkbox" style="width:auto">
        <span>event</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
        <input id="cd-book" type="checkbox" style="width:auto">
        <span>book</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
        <input id="cd-recurring" type="checkbox" style="width:auto">
        <span>recurring</span>
      </label>
    </div>
    <label id="cd-pin-row" style="display:none;align-items:center;gap:8px;cursor:pointer;margin-top:6px;margin-left:20px">
      <input id="cd-pin-reminder" type="checkbox" style="width:auto">
      <span>pin &mdash; <span style="opacity:0.55;font-size:0.85em">always show in bar</span></span>
    </label>
    <div id="cd-pages-wrap" style="display:none;margin-left:20px">
      <label id="cd-pages-label">pages</label>
      <div id="cd-pages-inputs" style="display:flex;align-items:center;gap:8px">
        <input id="cd-current-page" type="number" placeholder="current" min="0" style="flex:1">
        <span style="opacity:0.4;flex-shrink:0">/</span>
        <input id="cd-total-pages" type="number" placeholder="total" min="1" style="flex:1">
      </div>
    </div>
    <div id="cd-recur-wrap" style="display:none;margin-left:20px">
      <label>frequency</label>
      <select id="cd-recur">
        <option value="week">weekly</option><option value="bi-week">bi-weekly</option>
        <option value="month">monthly</option><option value="holiday">holiday (annual)</option><option value="birthday">birthday (annual)</option>
      </select>
    </div>
    <label id="cd-size-label">importance</label>
    <select id="cd-size">
      <option value="wisp">wisp &mdash; trivial</option>
      <option value="idea">idea &mdash; ordinary</option>
      <option value="plan">plan &mdash; significant</option>
      <option value="mission">mission &mdash; critical</option>
    </select>
    <label>category</label>
    <select id="cd-cat"><option>Interfacing</option><option>Hobby</option><option>Social</option><option>Self</option></select>
    <label id="cd-graph-label" style="display:none;justify-content:space-between;align-items:baseline">
      <span>breakdown</span>
      <span style="display:flex;gap:6px;align-items:baseline;letter-spacing:0;text-transform:none">
        <input id="cd-prep" type="number" min="0" placeholder="prep" title="prep / lead-up minutes" style="width:48px;font-size:0.65rem;padding:1px 4px;text-align:right">
        <span style="opacity:0.4;font-size:0.65rem">+</span>
        <input id="cd-dur" type="number" min="0" placeholder="work" title="core work minutes" style="width:48px;font-size:0.65rem;padding:1px 4px;text-align:right">
        <span style="opacity:0.5;font-size:0.65rem">m</span>
        <button type="button" id="cd-recalc" class="cd-btn" style="font-size:0.6rem;padding:1px 7px" onclick="cdRecalc()">recalculate</button>
      </span>
    </label>
    <div id="cd-graph" style="display:none"></div>
    <label>notes</label><textarea id="cd-notes"></textarea>
    <div class="cd-actions">
      <div style="display:flex;gap:8px">
        <button class="cd-btn cd-btn-exile" onclick="cdExile()">exile</button>
        <button class="cd-btn" style="border-color:hsl(var(--green-hsl) / 0.45);color:hsl(var(--green-hsl) / 0.8)" onclick="cdDone()">done</button>
        <button class="cd-btn cd-btn-late" onclick="cdLate()" title="done, but late — logged for recalibration">late</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="cd-btn" onclick="cdChat()">chat</button>
        <button class="cd-btn" onclick="cdSave()">save</button>
      </div>
    </div>
  </div>
</div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  let _cdId = null;
  let _cdCards = null;
  let _cdCallback = null;
  let _cdSource = 'core';

  function _togglePages(show) {
    document.getElementById('cd-pages-wrap').style.display = show ? 'block' : 'none';
  }
  // book checkbox: page inputs appear under it (importance stays visible)
  document.getElementById('cd-book').addEventListener('change', function() {
    _togglePages(this.checked);
  });
  // reminder: show pin row + hide importance (reminders aren't sized)
  document.getElementById('cd-reminder').addEventListener('change', function() {
    document.getElementById('cd-pin-row').style.display = this.checked ? 'flex' : 'none';
    const d = this.checked ? 'none' : 'block';
    document.getElementById('cd-size-label').style.display = d;
    document.getElementById('cd-size').style.display = d;
  });
  // recurring: frequency dropdown appears under it
  document.getElementById('cd-recurring').addEventListener('change', function() {
    document.getElementById('cd-recur-wrap').style.display = this.checked ? 'block' : 'none';
  });

  // Enter saves + closes (except in the notes textarea, where it's a newline).
  document.getElementById('cd-modal').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' &&
        e.target.tagName !== 'BUTTON' && !e.target.isContentEditable) {
      e.preventDefault();
      window.cdSave();
    }
  });

  function _parseMD(input) {
    if (!input || !input.trim()) return null;
    const s = input.trim().toLowerCase();
    const mnths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const wdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const now = new Date();
    let timeStr = '', dateStr = s;
    const tm = s.match(/\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (tm) {
      let h = parseInt(tm[1]), min = tm[2] ? parseInt(tm[2]) : 0;
      if (tm[3].toLowerCase()==='pm' && h<12) h+=12;
      if (tm[3].toLowerCase()==='am' && h===12) h=0;
      timeStr = `T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      dateStr = s.slice(0, s.length - tm[0].length).trim();
    }
    let yr = now.getFullYear(), month = -1, day = 0, useDate = null;
    const wi = wdays.findIndex(d => dateStr.startsWith(d));
    if (wi >= 0) {
      let diff = wi - now.getDay(); if (diff<=0) diff+=7;
      useDate = new Date(now); useDate.setDate(now.getDate()+diff); useDate.setHours(0,0,0,0);
      month = useDate.getMonth(); day = useDate.getDate(); yr = useDate.getFullYear();
    }
    if (month<0) { const m = dateStr.match(/^(\d{1,2})[\/-](\d{1,2})$/); if (m) { month=parseInt(m[1])-1; day=parseInt(m[2]); } }
    if (month<0) { const m = dateStr.match(/^([a-z]+)\s+(\d{1,2})$/); if (m) { const i=mnths.findIndex(x=>m[1].startsWith(x)); if (i>=0) { month=i; day=parseInt(m[2]); } } }
    if (month<0||!day) return null;
    if (!useDate && new Date(yr,month,day)<=now) yr++;
    const iso = `${yr}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return timeStr ? iso+timeStr : iso;
  }

  function _fmt(iso) {
    if (!iso) return '';
    const hasT = iso.includes('T');
    const d = hasT ? new Date(iso) : new Date(iso+'T12:00:00');
    let s = d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    if (hasT) s += ' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase();
    return s;
  }

  async function _resolve(raw, size, et) {
    const q = _parseMD(raw);
    if (q !== null || !raw.trim()) return {due:q};
    try {
      const r = await fetch('/api/parse_date',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw.trim(),size,estimated_minutes:et||null})});
      const d = await r.json();
      return {due:d.iso||null};
    } catch(_) { return {due:null}; }
  }

  async function _patch() {
    await fetch(`/api/rd?source=${_cdSource}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cards:_cdCards})});
  }

  window.openCardDialog = async function(id, callback, source) {
    _cdCallback = callback || (() => {});
    _cdSource = source || 'core';
    const data = await (await fetch('/api/rd')).json();
    _cdCards = data.cards || [];
    const c = _cdCards.find(x => x.id === id);
    if (!c) return;
    _cdId = id;
    const box = document.querySelector('.cd-box');
    if (typeof cardStyle === 'function') {
      // solidBg = opaque dialog tint — wisp/idea tints pre-blended over the
      // modal surface in chrome.css (--card-*-solid, via color-mix)
      const {bg, border, dark, solidBg} = cardStyle(c);
      const colVal = (bg.match(/;color:[^;]+/) || [''])[0].slice(1);
      const bcVal = border.includes('transparent') ? '' : border;
      box.style.cssText = [solidBg ? 'background:' + solidBg : '', colVal, bcVal].filter(Boolean).join(';');
      box.classList.toggle('cd-dark',   dark && !!bg);
      box.classList.toggle('cd-bright', !dark && !!bg);
    }
    document.getElementById('cd-title').value = c.title||'';
    document.getElementById('cd-cat').value = c.category||'Self';
    document.getElementById('cd-size').value = c.size||'idea';
    document.getElementById('cd-due').value = c.due_date ? _fmt(c.due_date) : '';
    document.getElementById('cd-recur').value = c.recur_type||'week';
    document.getElementById('cd-recurring').checked = !!c.recur_type;
    document.getElementById('cd-recur-wrap').style.display = c.recur_type ? 'block' : 'none';
    document.getElementById('cd-reminder').checked = !!c.is_reminder;
    document.getElementById('cd-event').checked = !!c.is_event;
    document.getElementById('cd-book').checked = !!c.is_book;
    document.getElementById('cd-pin-reminder').checked = !!c.pinned_reminder;
    document.getElementById('cd-pin-row').style.display = c.is_reminder ? 'flex' : 'none';
    const hideSize = c.is_reminder ? 'none' : 'block';
    document.getElementById('cd-size-label').style.display = hideSize;
    document.getElementById('cd-size').style.display = hideSize;
    document.getElementById('cd-notes').value = c.notes||'';
    _togglePages(!!c.is_book);
    document.getElementById('cd-current-page').value = c.current_page ?? '';
    document.getElementById('cd-total-pages').value = c.total_pages ?? '';
    // prep + work split: estimated_time is the total, prep_time the lead-up slice.
    const _pt = c.prep_time || 0, _et = c.estimated_time || 0;
    document.getElementById('cd-prep').value = _pt || '';
    document.getElementById('cd-dur').value = _et ? Math.max(0, _et - _pt) : '';
    // Open first so the graph can measure layout (autoscroll to the active step).
    document.getElementById('cd-modal').classList.add('open');
    const hasGraph = !!(c.nudge && c.nudge.graph && c.nudge.graph.nodes && c.nudge.graph.nodes.length);
    document.getElementById('cd-graph-label').style.display = hasGraph ? 'flex' : 'none';
    document.getElementById('cd-graph').style.display = hasGraph ? 'block' : 'none';
    if (hasGraph && typeof renderCardGraph === 'function') {
      renderCardGraph(document.getElementById('cd-graph'), c, function () {});
    } else {
      document.getElementById('cd-graph').innerHTML = '';
    }
    document.getElementById('cd-title').focus();
  };

  window.cdClose = function() {
    document.getElementById('cd-modal').classList.remove('open');
    const box = document.querySelector('.cd-box');
    box.style.cssText = '';
    box.classList.remove('cd-dark', 'cd-bright');
    _cdId = null;
  };

  // Read every dialog field onto the card and persist it. Shared by cdSave
  // (which then closes) and cdChat (which keeps the dialog open).
  async function _collectAndPatch() {
    const c = _cdCards.find(x => x.id === _cdId);
    if (!c) return null;
    c.title = document.getElementById('cd-title').value.trim() || c.title;
    c.category = document.getElementById('cd-cat').value;
    const isReminder = document.getElementById('cd-reminder').checked;
    c.size = isReminder ? null : document.getElementById('cd-size').value;
    // Time = prep (lead-up) + work; estimated_time is their sum (the schedule block).
    const prep = parseInt(document.getElementById('cd-prep').value) || 0;
    const work = parseInt(document.getElementById('cd-dur').value) || 0;
    if (isReminder) {
      c.prep_time = null;
    } else {
      c.prep_time = prep;
      if (prep + work > 0) c.estimated_time = prep + work;
    }
    const dueRaw = document.getElementById('cd-due').value;
    const res = await _resolve(dueRaw, c.size, c.estimated_time);
    c.due_date = res.due;
    c.notes = document.getElementById('cd-notes').value.trim();
    c.recur_type = document.getElementById('cd-recurring').checked
      ? document.getElementById('cd-recur').value : null;
    c.is_reminder = document.getElementById('cd-reminder').checked;
    c.is_event = document.getElementById('cd-event').checked;
    c.is_book = document.getElementById('cd-book').checked;
    c.pinned_reminder = c.is_reminder ? document.getElementById('cd-pin-reminder').checked : false;
    if (c.is_book) {
      const cp = parseInt(document.getElementById('cd-current-page').value);
      const tp = parseInt(document.getElementById('cd-total-pages').value);
      c.current_page = isNaN(cp) ? null : cp;
      c.total_pages  = isNaN(tp) ? null : tp;
    }
    await _patch();
    return c;
  }

  window.cdSave = async function() {
    const c = await _collectAndPatch();
    if (!c) return;
    cdClose();
    _cdCallback('save');
  };

  window.cdDone = async function() {
    const c = _cdCards.find(x => x.id === _cdId);
    if (!c) return;
    c.column = 'archives';
    await _patch();
    cdClose();
    _cdCallback('done');
  };

  // Done, but late — archive and flag for future recalibration of estimates/lead times.
  window.cdLate = async function() {
    const c = _cdCards.find(x => x.id === _cdId);
    if (!c) return;
    c.column = 'archives';
    c.completed_late = true;
    await _patch();
    cdClose();
    _cdCallback('late');
  };

  window.cdRecalc = async function() {
    const c = _cdCards.find(x => x.id === _cdId);
    if (!c) return;
    const btn = document.getElementById('cd-recalc');
    const prev = btn.textContent; btn.textContent = '...'; btn.disabled = true;
    try {
      const notes = document.getElementById('cd-notes').value.trim();
      const prep = parseInt(document.getElementById('cd-prep').value) || 0;
      const duration = parseInt(document.getElementById('cd-dur').value) || 0;
      // Persist the edited split on the card so the rebuilt graph targets it.
      c.prep_time = prep;
      if (prep + duration > 0) c.estimated_time = prep + duration;
      const r = await fetch('/api/rd/' + encodeURIComponent(_cdId) + '/recalc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, prep, duration }),
      });
      const d = await r.json();
      if (d && d.nudge) {
        c.nudge = d.nudge; c.notes = notes;
        const has = !!(c.nudge.graph && c.nudge.graph.nodes && c.nudge.graph.nodes.length);
        document.getElementById('cd-graph-label').style.display = has ? 'flex' : 'none';
        document.getElementById('cd-graph').style.display = has ? 'block' : 'none';
        if (has) renderCardGraph(document.getElementById('cd-graph'), c, function () {});
      }
    } catch (_) { /* ignore */ }
    btn.textContent = prev; btn.disabled = false;
  };

  window.cdChat = async function() {
    const c = await _collectAndPatch();
    if (!c) return;
    _cdCallback('save');
    if (typeof window.openExecChat === 'function') {
      window.openExecChat('Let\'s work on "' + (c.title || '') + '".');
    }
  };

  window.cdExile = async function() {
    const c = _cdCards.find(x => x.id === _cdId);
    if (!c) return;
    c.column = 'exile';
    await _patch();
    cdClose();
    _cdCallback('exile');
  };

})();
