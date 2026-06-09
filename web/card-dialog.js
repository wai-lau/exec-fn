/* Shared card edit dialog — used by kanban, prophecies, directives */
(function () {
  // Inject modal HTML once
  const html = `
<style>
.cd-ov { display:none; position:fixed; inset:0; z-index:50; background:rgba(0,0,0,0.78); align-items:center; justify-content:center; }
.cd-ov.open { display:flex; }
.cd-box { background:#0a0a0a; border:1px solid rgba(0,255,65,0.25); border-radius:10px; padding:24px 28px; width:min(420px,92vw); font-family:'Iosevka Mayukai Monolite',monospace; font-weight:500; max-height:90vh; overflow-y:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb, currentColor 45%, transparent) transparent; }
.cd-box::-webkit-scrollbar { width:8px; }
.cd-box::-webkit-scrollbar-track { background:transparent; }
.cd-box::-webkit-scrollbar-thumb { background:color-mix(in srgb, currentColor 45%, transparent); border-radius:2px; }
.cd-box input[type=checkbox] { accent-color:currentColor; }
.cd-box label { display:block; font-size:0.6rem; color:rgba(0,255,65,0.45); margin:12px 0 3px; text-transform:uppercase; letter-spacing:0.1em; }
.cd-box input,.cd-box select,.cd-box textarea { width:100%; background:rgba(255,255,255,0.03); border:1px solid rgba(0,255,65,0.2); color:rgba(0,255,65,0.9); font-family:'Iosevka Mayukai Monolite',monospace; font-weight:500; font-size:16px; padding:5px 8px; box-sizing:border-box; resize:vertical; }
.cd-box select option { background:#111; }
.cd-box textarea { min-height:56px; }
.cd-actions { display:flex; gap:8px; margin-top:18px; justify-content:space-between; align-items:center; }
.cd-btn { background:none; border:1px solid rgba(0,255,65,0.4); color:rgba(0,255,65,0.8); font-family:'Iosevka Mayukai Monolite',monospace; font-weight:500; font-size:0.78rem; padding:4px 12px; cursor:pointer; transition:all 0.2s; }
.cd-btn:hover { border-color:rgba(0,255,65,1); color:rgba(0,255,65,1); }
.cd-btn-exile { border-color:rgba(255,100,100,0.5) !important; color:rgba(255,120,120,0.8) !important; }
.cd-btn-exile:hover { border-color:rgba(255,100,100,0.9) !important; color:rgba(255,130,130,1) !important; }
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
    <label>notes</label><textarea id="cd-notes"></textarea>
    <label id="cd-size-label">size</label>
    <select id="cd-size">
      <option value="chore">chore &mdash; under 1 hour</option>
      <option value="task">task &mdash; under 4 hours</option>
      <option value="book">book &mdash; ongoing read</option>
      <option value="project">project &mdash; under 2 days</option>
      <option value="titan">titan &mdash; needs breaking down</option>
    </select>
    <label id="cd-pages-label" style="display:none">pages</label>
    <div id="cd-pages-inputs" style="display:none;align-items:center;gap:8px">
      <input id="cd-current-page" type="number" placeholder="current" min="0" style="flex:1">
      <span style="opacity:0.4;flex-shrink:0">/</span>
      <input id="cd-total-pages" type="number" placeholder="total" min="1" style="flex:1">
    </div>
    <label>category</label>
    <select id="cd-cat"><option>Interfacing</option><option>Hobby</option><option>Social</option><option>Self</option></select>
    <label>recurrence</label>
    <select id="cd-recur">
      <option value="">— none —</option><option value="week">weekly</option><option value="bi-week">bi-weekly</option>
      <option value="month">monthly</option><option value="holiday">holiday (annual)</option><option value="birthday">birthday (annual)</option>
    </select>
    <div style="display:flex;align-items:center;gap:16px;margin-top:12px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="cd-reminder" type="checkbox" style="width:auto" onchange="document.getElementById('cd-pin-row').style.display=this.checked?'flex':'none';document.getElementById('cd-size-label').style.display=this.checked?'none':'block';document.getElementById('cd-size').style.display=this.checked?'none':'block'">
        <span>reminder only</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="cd-event" type="checkbox" style="width:auto">
        <span>event</span>
      </label>
    </div>
    <label id="cd-pin-row" style="display:none;align-items:center;gap:8px;cursor:pointer;margin-top:6px;margin-left:20px">
      <input id="cd-pin-reminder" type="checkbox" style="width:auto">
      <span>pin &mdash; <span style="opacity:0.55;font-size:0.85em">always show in bar</span></span>
    </label>
    <label id="cd-graph-label" style="display:none;justify-content:space-between;align-items:baseline">
      <span>breakdown</span><span id="cd-graph-total" style="letter-spacing:0;text-transform:none"></span>
    </label>
    <div id="cd-graph" style="display:none"></div>
    <div class="cd-actions">
      <div style="display:flex;gap:8px">
        <button class="cd-btn cd-btn-exile" onclick="cdExile()">exile</button>
        <button class="cd-btn" style="border-color:rgba(0,255,65,0.5);color:rgba(0,255,65,0.85)" onclick="cdDone()">done</button>
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
    document.getElementById('cd-pages-label').style.display = show ? 'block' : 'none';
    document.getElementById('cd-pages-inputs').style.display = show ? 'flex' : 'none';
  }
  document.getElementById('cd-size').addEventListener('change', function() { _togglePages(this.value === 'book'); });

  // Enter saves + closes (except in the notes textarea, where it's a newline).
  document.getElementById('cd-modal').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
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

  function _fmtDur(min) {
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + 'h' : '') + (m || !h ? m + 'm' : '');
  }

  function _graphTotal(c) {
    const nodes = c.nudge && c.nudge.graph && c.nudge.graph.nodes;
    if (!nodes || !nodes.length) return 0;
    return nodes.reduce((s, n) => s + (n.est_min || 0), 0);
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

  function _solidBg(bgStr) {
    const m = bgStr.match(/hsla\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?)%,(\d+(?:\.\d+)?)%,([\d.]+)\)/);
    if (!m) return bgStr;
    const h = +m[1], s = +m[2]/100, l = +m[3]/100, a = +m[4];
    const c = (1 - Math.abs(2*l - 1)) * s;
    const x = c * (1 - Math.abs((h/60) % 2 - 1));
    const m0 = l - c/2;
    let r,g,b;
    if      (h<60)  [r,g,b]=[c,x,0];
    else if (h<120) [r,g,b]=[x,c,0];
    else if (h<180) [r,g,b]=[0,c,x];
    else if (h<240) [r,g,b]=[0,x,c];
    else if (h<300) [r,g,b]=[x,0,c];
    else            [r,g,b]=[c,0,x];
    const base = 10;
    const R = Math.round(a*(r+m0)*255 + (1-a)*base);
    const G = Math.round(a*(g+m0)*255 + (1-a)*base);
    const B = Math.round(a*(b+m0)*255 + (1-a)*base);
    return bgStr.replace(/hsla\([^)]+\)/, `rgb(${R},${G},${B})`);
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
      const {bg, border, dark} = cardStyle(c);
      const bgVal = (bg.match(/background:[^;]+/) || [''])[0];
      const colVal = (bg.match(/;color:[^;]+/) || [''])[0].slice(1);
      const bcVal = border.includes('transparent') ? '' : border;
      box.style.cssText = [_solidBg(bgVal), colVal, bcVal].filter(Boolean).join(';');
      box.classList.toggle('cd-dark',   dark && !!bg);
      box.classList.toggle('cd-bright', !dark && !!bg);
    }
    document.getElementById('cd-title').value = c.title||'';
    document.getElementById('cd-cat').value = c.category||'Self';
    document.getElementById('cd-size').value = c.size||'task';
    document.getElementById('cd-due').value = c.due_date ? _fmt(c.due_date) : '';
    document.getElementById('cd-recur').value = c.recur_type||'';
    document.getElementById('cd-reminder').checked = !!c.is_reminder;
    document.getElementById('cd-event').checked = !!c.is_event;
    document.getElementById('cd-pin-reminder').checked = !!c.pinned_reminder;
    document.getElementById('cd-pin-row').style.display = c.is_reminder ? 'flex' : 'none';
    document.getElementById('cd-size-label').style.display = c.is_reminder ? 'none' : 'block';
    document.getElementById('cd-size').style.display = c.is_reminder ? 'none' : 'block';
    document.getElementById('cd-notes').value = c.notes||'';
    _togglePages(c.size === 'book');
    document.getElementById('cd-current-page').value = c.current_page ?? '';
    document.getElementById('cd-total-pages').value = c.total_pages ?? '';
    const hasGraph = !!(c.nudge && c.nudge.graph && c.nudge.graph.nodes && c.nudge.graph.nodes.length);
    document.getElementById('cd-graph-label').style.display = hasGraph ? 'flex' : 'none';
    document.getElementById('cd-graph').style.display = hasGraph ? 'block' : 'none';
    document.getElementById('cd-graph-total').textContent = hasGraph ? _fmtDur(_graphTotal(c)) : '';
    if (hasGraph && typeof renderCardGraph === 'function') {
      renderCardGraph(document.getElementById('cd-graph'), c, function () {
        document.getElementById('cd-graph-total').textContent = _fmtDur(_graphTotal(c));
      });
    } else {
      document.getElementById('cd-graph').innerHTML = '';
    }
    document.getElementById('cd-modal').classList.add('open');
    document.getElementById('cd-title').focus();
  };

  window.cdClose = function() {
    document.getElementById('cd-modal').classList.remove('open');
    const box = document.querySelector('.cd-box');
    box.style.cssText = '';
    box.classList.remove('cd-dark', 'cd-bright');
    _cdId = null;
  };

  window.cdSave = async function() {
    const c = _cdCards.find(x => x.id === _cdId);
    if (!c) return;
    c.title = document.getElementById('cd-title').value.trim() || c.title;
    c.category = document.getElementById('cd-cat').value;
    const isReminder = document.getElementById('cd-reminder').checked;
    c.size = isReminder ? null : document.getElementById('cd-size').value;
    // Total time is derived from the breakdown when there is one.
    const gTotal = _graphTotal(c);
    if (gTotal) c.estimated_time = gTotal;
    const dueRaw = document.getElementById('cd-due').value;
    const res = await _resolve(dueRaw, c.size, c.estimated_time);
    c.due_date = res.due;
    c.notes = document.getElementById('cd-notes').value.trim();
    c.recur_type = document.getElementById('cd-recur').value||null;
    c.is_reminder = document.getElementById('cd-reminder').checked;
    c.is_event = document.getElementById('cd-event').checked;
    c.pinned_reminder = c.is_reminder ? document.getElementById('cd-pin-reminder').checked : false;
    if (c.size === 'book') {
      const cp = parseInt(document.getElementById('cd-current-page').value);
      const tp = parseInt(document.getElementById('cd-total-pages').value);
      c.current_page = isNaN(cp) ? null : cp;
      c.total_pages  = isNaN(tp) ? null : tp;
    }
    await _patch();
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

  window.cdChat = function() {
    const c = _cdCards.find(x => x.id === _cdId);
    cdClose();
    if (c && typeof window.openExecChat === 'function') {
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
