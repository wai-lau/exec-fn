/* Shared card edit dialog — used by kanban, prophecies, directives */
(function () {
  // Inject modal HTML once
  const html = `
<style>
.cd-ov { display:none; position:fixed; inset:0; z-index:50; background:rgba(0,0,0,0.78); align-items:center; justify-content:center; }
.cd-ov.open { display:flex; }
.cd-box { background:#0a0a0a; border:1px solid rgba(0,255,65,0.25); padding:24px 28px; width:min(420px,92vw); font-family:'Iosevka Mayukai Monolite',monospace; max-height:90vh; overflow-y:auto; }
.cd-box-title { font-size:0.68rem; text-transform:uppercase; letter-spacing:0.15em; color:rgba(0,255,65,0.6); margin-bottom:16px; }
.cd-box label { display:block; font-size:0.6rem; color:rgba(0,255,65,0.45); margin:12px 0 3px; text-transform:uppercase; letter-spacing:0.1em; }
.cd-box input,.cd-box select,.cd-box textarea { width:100%; background:rgba(255,255,255,0.03); border:1px solid rgba(0,255,65,0.2); color:rgba(0,255,65,0.9); font-family:'Iosevka Mayukai Monolite',monospace; font-size:16px; padding:5px 8px; box-sizing:border-box; resize:vertical; }
.cd-box select option { background:#111; }
.cd-box textarea { min-height:56px; }
.cd-actions { display:flex; gap:8px; margin-top:18px; justify-content:space-between; align-items:center; }
.cd-btn { background:none; border:1px solid rgba(0,255,65,0.4); color:rgba(0,255,65,0.8); font-family:'Iosevka Mayukai Monolite',monospace; font-size:0.78rem; padding:4px 12px; cursor:pointer; transition:all 0.2s; }
.cd-btn:hover { border-color:rgba(0,255,65,1); color:rgba(0,255,65,1); }
</style>
<div class="cd-ov" id="cd-modal" onclick="if(event.target===this)cdClose()">
  <div class="cd-box">
    <div class="cd-box-title">edit card</div>
    <label>title</label><input id="cd-title" type="text">
    <label>category</label>
    <select id="cd-cat"><option>Interfacing</option><option>Hobby</option><option>Social</option><option>Self</option><option>Book</option></select>
    <label>size</label>
    <select id="cd-size">
      <option value="chore">chore &mdash; under 1 hour</option>
      <option value="task">task &mdash; under 4 hours</option>
      <option value="book">book &mdash; ongoing read</option>
      <option value="project">project &mdash; under 2 days</option>
      <option value="titan">titan &mdash; needs breaking down</option>
    </select>
    <label>date &mdash; <span style="opacity:0.55;font-size:0.7em;text-transform:none">monday 6pm &nbsp;|&nbsp; apr 26 &nbsp;|&nbsp; 4/26</span></label>
    <input id="cd-due" type="text" placeholder="optional" onblur="cdFillSB()">
    <label>start before &mdash; <span style="opacity:0.55;font-size:0.7em;text-transform:none">auto-filled from due date</span></label>
    <input id="cd-sb" type="text" placeholder="optional">
    <label>estimated time (minutes)</label><input id="cd-et" type="number" min="1" placeholder="auto from size">
    <label>recurrence</label>
    <select id="cd-recur">
      <option value="">— none —</option><option value="week">weekly</option><option value="bi-week">bi-weekly</option>
      <option value="month">monthly</option><option value="holiday">holiday (annual)</option><option value="birthday">birthday (annual)</option>
    </select>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:12px">
      <input id="cd-reminder" type="checkbox" style="width:auto;accent-color:rgba(0,255,65,0.8)">
      <span>reminder only &mdash; <span style="opacity:0.55;font-size:0.85em">no action needed</span></span>
    </label>
    <label>notes</label><textarea id="cd-notes"></textarea>
    <div class="cd-actions">
      <div style="display:flex;gap:8px">
        <button class="cd-btn" style="border-color:rgba(255,100,100,0.4);color:rgba(255,120,120,0.7)" onclick="cdExile()">exile</button>
        <button class="cd-btn" style="border-color:rgba(0,255,65,0.5);color:rgba(0,255,65,0.85)" onclick="cdDone()">done</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="cd-btn" onclick="cdClose()">cancel</button>
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
    if (q !== null || !raw.trim()) return {due:q, start_before:null};
    try {
      const r = await fetch('/api/parse_date',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw.trim(),size,estimated_minutes:et||null})});
      const d = await r.json();
      return {due:d.iso||null, start_before:d.start_before||null};
    } catch(_) { return {due:null, start_before:null}; }
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
    document.getElementById('cd-title').value = c.title||'';
    document.getElementById('cd-cat').value = c.category||'Self';
    document.getElementById('cd-size').value = c.size||'task';
    document.getElementById('cd-due').value = c.due_date ? _fmt(c.due_date) : '';
    document.getElementById('cd-sb').value = c.start_before ? _fmt(c.start_before) : '';
    document.getElementById('cd-et').value = c.estimated_time != null ? c.estimated_time : '';
    document.getElementById('cd-recur').value = c.recur_type||'';
    document.getElementById('cd-reminder').checked = !!c.is_reminder;
    document.getElementById('cd-notes').value = c.notes||'';
    document.getElementById('cd-modal').classList.add('open');
    document.getElementById('cd-title').focus();
  };

  window.cdClose = function() {
    document.getElementById('cd-modal').classList.remove('open');
    _cdId = null;
  };

  window.cdSave = async function() {
    const c = _cdCards.find(x => x.id === _cdId);
    if (!c) return;
    c.title = document.getElementById('cd-title').value.trim() || c.title;
    c.category = document.getElementById('cd-cat').value;
    c.size = document.getElementById('cd-size').value;
    const etRaw = document.getElementById('cd-et').value;
    c.estimated_time = etRaw !== '' ? parseInt(etRaw,10) : (c.estimated_time??null);
    const dueRaw = document.getElementById('cd-due').value;
    const sbRaw = document.getElementById('cd-sb').value;
    const res = await _resolve(dueRaw, c.size, c.estimated_time);
    c.due_date = res.due;
    c.start_before = sbRaw.trim() ? (await _resolve(sbRaw)).due : (res.start_before??c.start_before??null);
    c.notes = document.getElementById('cd-notes').value.trim();
    c.recur_type = document.getElementById('cd-recur').value||null;
    c.is_reminder = document.getElementById('cd-reminder').checked;
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

  window.cdExile = async function() {
    const c = _cdCards.find(x => x.id === _cdId);
    if (!c) return;
    c.column = 'exile';
    await _patch();
    cdClose();
    _cdCallback('exile');
  };

  window.cdFillSB = async function() {
    const dueRaw = document.getElementById('cd-due').value.trim();
    if (!dueRaw) return;
    const res = await _resolve(dueRaw, document.getElementById('cd-size').value, parseInt(document.getElementById('cd-et').value)||null);
    if (res.start_before) document.getElementById('cd-sb').value = _fmt(res.start_before);
  };
})();
