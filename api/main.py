import os, re, json, secrets, hashlib
from pathlib import Path
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Cookie, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Security
from pydantic import BaseModel
from typing import Optional

import pipeline

API_KEY = os.environ["API_KEY"]
bearer = HTTPBearer(auto_error=False)
SESSION_TOKEN = hashlib.sha256(f"session:{API_KEY}".encode()).hexdigest()
DATA_DIR = Path("/app/data")

GREEN_OVERLAY = """
<style>
  html { filter: hue-rotate(150deg); }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  /* inner elements: pink becomes green via hue-rotate */
  ::-webkit-scrollbar-thumb { background: rgba(232, 157, 194, 0.45); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(232, 157, 194, 0.85); }
  /* page scrollbar sits outside the filter stacking context — use actual green */
  html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb { background: rgba(80, 210, 120, 0.5) !important; border-radius: 3px; }
  html::-webkit-scrollbar-thumb:hover, body::-webkit-scrollbar-thumb:hover { background: rgba(80, 210, 120, 0.9) !important; }
  * { scrollbar-width: thin; scrollbar-color: rgba(232,157,194,0.45) transparent; }
  html, body { scrollbar-color: rgba(80, 210, 120, 0.5) transparent; }
  .exec-nav {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
    height: 52px; display: flex; align-items: center; justify-content: center; gap: 32px;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(10px);
    border-top: 1px solid rgba(232,157,194,0.12);
  }
  .exec-nav a {
    color: rgba(232, 157, 194, 0.65);
    font-family: monospace;
    font-size: 0.85rem;
    text-decoration: none;
    border-bottom: 1px solid rgba(232, 157, 194, 0.3);
    transition: color 0.2s, border-bottom-color 0.2s;
  }
  .exec-nav a:hover { color: rgba(232, 157, 194, 1); border-bottom-color: rgba(232, 157, 194, 1); }
  .exec-nav a[style*="opacity:1"] { color: rgba(232,157,194,1); border-bottom-color: rgba(232,157,194,1); }
</style>
"""

CONTENT_STYLE = """
<style>
  body { display: block; height: auto; min-height: 100vh; overflow-y: auto; }
  #content {
    position: relative;
    z-index: 2;
    width: min(720px, 90vw);
    margin: 72px auto 80px;
    font-family: monospace;
    color: rgba(232, 157, 194, 1);
  }
  #content h2 {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    opacity: 0.65;
    margin: 28px 0 8px;
    border-bottom: 1px solid rgba(232, 157, 194, 0.25);
    padding-bottom: 4px;
  }
  #content .item {
    font-size: 0.85rem;
    padding: 5px 0;
    border-bottom: 1px solid rgba(232, 157, 194, 0.12);
  }
  #content button {
    background: none;
    border: 1px solid rgba(232, 157, 194, 0.5);
    color: rgba(232, 157, 194, 0.85);
    font-family: monospace;
    font-size: 0.8rem;
    padding: 4px 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  #content button:hover { border-color: rgba(232, 157, 194, 1); color: rgba(232, 157, 194, 1); }
  #content button:disabled { opacity: 0.35; cursor: default; }
  #content .ts { font-size: 0.7rem; opacity: 0.5; margin-top: 16px; }
</style>
"""

_NAV_LINKS = ["directives", "delta", "r&d", "archive"]
_NAV_HREFS = {"r&d": "/rd"}


def _build_nav(active=None):
    links = []
    for label in _NAV_LINKS:
        href = _NAV_HREFS.get(label, f"/{label}")
        style = ' style="opacity:1;border-bottom-color:rgba(232,157,194,0.9);"' if label == active else ""
        links.append(f'<a href="{href}"{style}>{label}</a>')
    return '<div class="exec-nav">' + " &nbsp; ".join(links) + "</div>"


with open("/app/static/index.html") as f:
    _INDEX = f.read()

_NO_FORM = re.sub(r'<form class="login-box".*?</form>', '', _INDEX, flags=re.DOTALL)
_BARE = re.sub(r'<div class="bg-wide">.*?</div>', '', _NO_FORM, flags=re.DOTALL)
_BARE = re.sub(r'<div class="bg-tall">.*?</div>', '', _BARE, flags=re.DOTALL)
_BARE = re.sub(r'<a href="[^"]*" target="_blank">.*?</a>', '', _BARE, flags=re.DOTALL)

_BACK = (
    '<div style="position:fixed;top:32px;left:32px;z-index:10;">'
    '<a href="/exec" style="color:rgba(232,157,194,0.85);font-family:monospace;font-size:0.9rem;'
    'text-decoration:none;border-bottom:1px solid rgba(232,157,194,0.45);transition:color 0.2s;" '
    "onmouseover=\"this.style.color='rgba(232,157,194,1)'\" "
    "onmouseout=\"this.style.color='rgba(232,157,194,0.85)'\">← exec</a></div>"
)


def _build_page(active=None, content=""):
    base = _BARE if active else _NO_FORM
    back = _BACK if active else ""
    head_inject = GREEN_OVERLAY + (CONTENT_STYLE if content else "")
    return (base
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", content + back + _build_nav(active) + "</body>", 1))


# ── page content ──────────────────────────────────────────────────────────────

_ARCHIVE_CONTENT = '''
<div id="lightbox" onclick="this.style.display='none'" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999;cursor:zoom-out;display:flex;align-items:center;justify-content:center;display:none;">
  <img id="lb-img" style="max-height:95vh;max-width:95vw;object-fit:contain;">
</div>
<div id="content" style="width:min(1100px,95vw)">
  <div id="files"><span style="opacity:0.4;font-size:0.8rem">loading...</span></div>
</div>
<script>
function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lb-img').src = src;
  lb.style.display = 'flex';
}
async function load() {
  const r = await fetch('/api/archive');
  const files = await r.json();
  const el = document.getElementById('files');
  if (!files.length) { el.innerHTML = '<p style="opacity:0.4;font-size:0.8rem">no files yet</p>'; return; }
  el.innerHTML = files.map(f => `
    <div style="margin-bottom:28px;">
      <div style="font-size:0.65rem;opacity:0.4;margin-bottom:8px;letter-spacing:0.08em;">${f.label}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${Array.from({length: f.pages}, (_, i) => `<img src="/api/archive/${f.filename}/page/${i}" style="height:180px;width:auto;border:1px solid rgba(232,157,194,0.15);cursor:zoom-in;" onclick="openLightbox(this.src)">`).join('')}
      </div>
    </div>
  `).join('');
}
load();
</script>
'''

_RD_CONTENT = '''
<style>
body { overflow: hidden !important; }
.rd-topbar {
  position: fixed; top: 0; left: 0; right: 0; height: 52px; z-index: 20;
  display: flex; align-items: center; justify-content: flex-end;
  padding: 0 32px; gap: 12px;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(232,157,194,0.12);
}
.rd-board {
  position: fixed; top: 52px; bottom: 52px; left: 0; right: 0;
  display: flex; gap: 1px; overflow: hidden;
  background: rgba(232,157,194,0.06);
}
.col { flex: 1; display: flex; flex-direction: column; min-width: 0; background: rgba(0,0,0,0.25); }
.col-hdr {
  flex-shrink: 0; padding: 14px 16px 10px;
  font-family: monospace; font-size: 0.62rem; text-transform: uppercase;
  letter-spacing: 0.18em; color: rgba(232,157,194,0.55);
  border-bottom: 1px solid rgba(232,157,194,0.1);
}
.col-list { flex: 1; overflow-y: auto; padding: 10px 10px 20px; }
.card {
  border-radius: 4px; padding: 9px 11px; margin-bottom: 7px;
  cursor: grab; user-select: none; font-family: monospace;
  border: 1px solid transparent;
  transition: filter 0.15s;
}
.card:hover { filter: brightness(1.08); }
.card:active { cursor: grabbing; }
.card.plain { background: rgba(232,157,194,0.05); border-color: rgba(232,157,194,0.15); }
.card.plain:hover { background: rgba(232,157,194,0.09); }
.card-title { font-size: 0.8rem; margin-bottom: 2px; }
.card-desc { font-size: 0.7rem; margin-top: 3px; opacity: 0.72;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.card-foot { display: flex; justify-content: space-between; align-items: baseline; margin-top: 5px; }
.card-badge { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; }
.card-due { font-size: 0.62rem; }
.sortable-ghost { opacity: 0.2; }
.rd-btn {
  background: none; border: 1px solid rgba(232,157,194,0.4);
  color: rgba(232,157,194,0.8); font-family: monospace; font-size: 0.78rem;
  padding: 4px 12px; cursor: pointer; transition: all 0.2s;
}
.rd-btn:hover { border-color: rgba(232,157,194,1); color: rgba(232,157,194,1); }
.rd-btn:disabled { opacity: 0.4; cursor: default; }
.modal-overlay {
  display: none; position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.75); align-items: center; justify-content: center;
}
.modal-overlay.open { display: flex; }
.modal {
  background: #0a0a0a; border: 1px solid rgba(232,157,194,0.25);
  padding: 24px 28px; width: min(420px,92vw); font-family: monospace;
}
.modal-title { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.15em; color: rgba(232,157,194,0.6); margin-bottom: 16px; }
.modal label { display: block; font-size: 0.6rem; color: rgba(232,157,194,0.45); margin: 12px 0 3px; text-transform: uppercase; letter-spacing: 0.1em; }
.modal input, .modal select, .modal textarea {
  width: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(232,157,194,0.2);
  color: rgba(232,157,194,0.9); font-family: monospace; font-size: 0.82rem;
  padding: 5px 8px; box-sizing: border-box; resize: vertical;
}
.modal select option { background: #111; }
.modal textarea { min-height: 56px; }
.modal-actions { display: flex; gap: 10px; margin-top: 18px; justify-content: space-between; align-items: center; }
</style>

<div class="rd-topbar">
  <button class="rd-btn" id="add-btn" onclick="openAdd()">+ add card</button>
</div>

<div class="rd-board" id="board">
  <span style="padding:32px;font-family:monospace;font-size:0.8rem;opacity:0.4">loading...</span>
</div>

<!-- add modal -->
<div class="modal-overlay" id="add-modal" onclick="if(event.target===this)closeAdd()">
  <div class="modal">
    <div class="modal-title">add card</div>
    <label>title</label>
    <input id="a-title" type="text" placeholder="what needs doing">
    <label>due date &mdash; <span style="opacity:0.55;font-size:0.7em;text-transform:none">apr 26 &nbsp;|&nbsp; 4/26 &nbsp;|&nbsp; leave blank</span></label>
    <input id="a-due" type="text" placeholder="optional">
    <label>column</label>
    <select id="a-col">
      <option value="backlog">backlog</option>
      <option value="doing">doing</option>
    </select>
    <div class="modal-actions">
      <span></span>
      <div style="display:flex;gap:8px">
        <button class="rd-btn" onclick="closeAdd()">cancel</button>
        <button class="rd-btn" id="a-submit" onclick="addCard()">add</button>
      </div>
    </div>
  </div>
</div>

<!-- edit modal -->
<div class="modal-overlay" id="edit-modal" onclick="if(event.target===this)closeEdit()">
  <div class="modal">
    <div class="modal-title">edit card</div>
    <label>title</label>
    <input id="e-title" type="text">
    <label>description</label>
    <textarea id="e-desc"></textarea>
    <label>category</label>
    <select id="e-cat">
      <option>Interfacing</option><option>Hobby</option><option>Social</option><option>Self</option>
    </select>
    <label>size</label>
    <select id="e-size">
      <option value="probe">probe &mdash; under 1 hour</option>
      <option value="task">task &mdash; under 4 hours</option>
      <option value="project">project &mdash; under 2 days</option>
      <option value="titan">titan &mdash; needs breaking down</option>
    </select>
    <label>due date &mdash; <span style="opacity:0.55;font-size:0.7em;text-transform:none">apr 26 &nbsp;|&nbsp; 4/26 &nbsp;|&nbsp; leave blank</span></label>
    <input id="e-due" type="text" placeholder="optional">
    <label>notes</label>
    <textarea id="e-notes"></textarea>
    <div class="modal-actions">
      <button class="rd-btn" style="border-color:rgba(255,100,100,0.4);color:rgba(255,120,120,0.7)" onclick="deleteCard()">delete</button>
      <div style="display:flex;gap:8px">
        <button class="rd-btn" onclick="closeEdit()">cancel</button>
        <button class="rd-btn" onclick="saveEdit()">save</button>
      </div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"></script>
<script>
const COLS = ['backlog','doing','done'];
let cards = [];
let editId = null;
let dragging = false;

// hue-rotate(150deg) is on html — specify CSS hue = target_hue - 150
// Interfacing=yellow(60), Hobby=mauve(300), Social=pink(330), Self=blue(240)
const CAT_HUE = {Interfacing:270, Hobby:150, Social:180, Self:90};
const SIZE_SL  = {probe:[20,90], task:[38,82], project:[56,73], titan:[70,65]};

function cardStyle(c) {
  const h = CAT_HUE[c.category];
  if (h === undefined) return '';
  const [s, l] = SIZE_SL[c.size] || [30, 85];
  return `background:hsl(${h},${s}%,${l}%);color:rgba(0,0,0,0.8);`;
}

function parseMonthDay(input) {
  if (!input || !input.trim()) return null;
  const s = input.trim().toLowerCase();
  const mnths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const now = new Date();
  let month = -1, day = 0;
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (m) { month = parseInt(m[1]) - 1; day = parseInt(m[2]); }
  if (month < 0) {
    m = s.match(/^([a-z]+)\s+(\d{1,2})$/);
    if (m) { const i = mnths.findIndex(x => m[1].startsWith(x)); if (i >= 0) { month = i; day = parseInt(m[2]); } }
  }
  if (month < 0 || !day) return null;
  let yr = now.getFullYear();
  if (new Date(yr, month, day) <= now) yr++;
  return `${yr}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
}

function isUrgent(iso) {
  return iso && (new Date(iso) - new Date()) / 86400000 <= 3;
}

function renderCard(c) {
  const style = cardStyle(c);
  const dark = !!style;
  const tc = dark ? 'rgba(0,0,0,0.55)' : 'rgba(232,157,194,0.45)';
  const urgent = isUrgent(c.due_date);
  return `<div class="card${dark ? '' : ' plain'}" data-id="${c.id}" style="${style}">
    <div class="card-title" style="${dark ? 'color:rgba(0,0,0,0.85)' : 'color:rgba(232,157,194,0.9)'}">${c.title}</div>
    ${c.description ? `<div class="card-desc" style="color:${tc}">${c.description}</div>` : ''}
    <div class="card-foot">
      <div class="card-badge" style="color:${tc}">${[c.category, c.size].filter(Boolean).join(' · ')}</div>
      ${c.due_date ? `<div class="card-due" style="color:${urgent ? (dark?'rgba(180,60,0,0.9)':'rgba(255,130,80,0.9)') : tc}">${fmtDate(c.due_date)}</div>` : ''}
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

function buildBoard() {
  document.getElementById('board').innerHTML = COLS.map(col => `
    <div class="col">
      <div class="col-hdr">${col} <span style="opacity:0.35">(${cards.filter(c=>c.column===col).length})</span></div>
      <div class="col-list" id="col-${col}">
        ${cards.filter(c=>c.column===col).sort((a,b)=>a.order-b.order).map(renderCard).join('')}
      </div>
    </div>
  `).join('');
  COLS.forEach(col => Sortable.create(document.getElementById('col-'+col), {
    group:'kanban', animation:120, ghostClass:'sortable-ghost',
    onStart: () => { dragging = true; },
    onEnd: () => { setTimeout(() => { dragging = false; }, 50); save(); }
  }));
  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => { if (!dragging) openEdit(el.dataset.id); });
  });
}

async function load() {
  const data = await (await fetch('/api/rd')).json();
  cards = data.cards || [];
  buildBoard();
}

// add modal
function openAdd() { document.getElementById('add-modal').classList.add('open'); document.getElementById('a-title').focus(); }
function closeAdd() { document.getElementById('add-modal').classList.remove('open'); document.getElementById('a-title').value = ''; document.getElementById('a-due').value = ''; }

async function addCard() {
  const title = document.getElementById('a-title').value.trim();
  if (!title) return;
  const btn = document.getElementById('a-submit');
  btn.disabled = true; btn.textContent = 'classifying...';
  const due_date = parseMonthDay(document.getElementById('a-due').value);
  const col = document.getElementById('a-col').value;
  let category = 'Self', size = 'task', description = '';
  try {
    const r = await fetch('/api/rd/classify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title})});
    const cl = await r.json();
    category = cl.category || category; size = cl.size || size; description = cl.description || '';
  } catch(_) {}
  const id = 'card-' + Date.now();
  const maxOrder = Math.max(-1, ...cards.filter(c=>c.column===col).map(c=>c.order));
  cards.push({id, title, category, size, description, column: col, order: maxOrder + 1, due_date, notes: ''});
  await save();
  buildBoard();
  closeAdd();
  btn.disabled = false; btn.textContent = 'add';
}

document.getElementById('a-title').addEventListener('keydown', e => { if (e.key === 'Enter') addCard(); });

// edit modal
function openEdit(id) {
  const c = cards.find(x => x.id === id);
  if (!c) return;
  editId = id;
  document.getElementById('e-title').value = c.title || '';
  document.getElementById('e-desc').value = c.description || '';
  document.getElementById('e-cat').value = c.category || 'Self';
  document.getElementById('e-size').value = c.size || 'task';
  document.getElementById('e-due').value = c.due_date ? fmtDate(c.due_date) : '';
  document.getElementById('e-notes').value = c.notes || '';
  document.getElementById('edit-modal').classList.add('open');
  document.getElementById('e-title').focus();
}
function closeEdit() { document.getElementById('edit-modal').classList.remove('open'); editId = null; }

async function saveEdit() {
  const c = cards.find(x => x.id === editId);
  if (!c) return;
  c.title       = document.getElementById('e-title').value.trim() || c.title;
  c.description = document.getElementById('e-desc').value.trim();
  c.category    = document.getElementById('e-cat').value;
  c.size        = document.getElementById('e-size').value;
  c.due_date    = parseMonthDay(document.getElementById('e-due').value);
  c.notes       = document.getElementById('e-notes').value.trim();
  await save();
  buildBoard();
  closeEdit();
}

async function deleteCard() {
  if (!editId) return;
  cards = cards.filter(x => x.id !== editId);
  await save();
  buildBoard();
  closeEdit();
}

load();
</script>'''

_DELTA_CONTENT = '''
<div id="content">
  <div style="display:flex;justify-content:flex-end;margin-bottom:24px;">
    <button onclick="runDelta(this)">run delta</button>
  </div>
  <div id="delta"><span style="opacity:0.4;font-size:0.8rem">loading...</span></div>
</div>
<script>
function renderList(text) {
  if (!text) return '<span style="opacity:0.4">&mdash;</span>';
  const parts = text.split(/\s+(?=\d+\.\s)/);
  if (parts.length > 1) {
    const items = parts.map(p => `<li style="margin-bottom:6px">${p.replace(/^\d+\.\s*/, '')}</li>`).join('');
    return `<ol style="margin:0;padding-left:1.4em;line-height:1.6">${items}</ol>`;
  }
  return `<span style="line-height:1.7">${text}</span>`;
}
async function load() {
  const r = await fetch('/api/delta');
  const el = document.getElementById('delta');
  if (!r.ok) { el.innerHTML = '<p style="opacity:0.4;font-size:0.8rem">no delta yet</p>'; return; }
  const d = await r.json();
  el.innerHTML = `
    <h2>what wai wrote</h2>
    <div style="font-size:0.85rem">${renderList(d.wai_notes)}</div>
    <h2>adjustments for tomorrow</h2>
    <div style="font-size:0.85rem">${renderList(d.adjustments)}</div>
    <div class="ts">${d.analyzed_at || ''}</div>
  `;
}
async function runDelta(btn) {
  btn.disabled = true; btn.textContent = 'analyzing...';
  const r = await fetch('/api/delta', {method:'POST'});
  btn.disabled = false; btn.textContent = 'run delta';
  if (r.ok) load();
  else {
    const err = await r.json().catch(() => ({detail: 'unknown error'}));
    document.getElementById('delta').innerHTML = `<p style="color:rgba(255,100,100,0.8);font-size:0.8rem">${err.detail}</p>`;
  }
}
load();
</script>
'''

_DIRECTIVES_CONTENT = '''
<div id="content" style="width:min(1100px,95vw)">
  <h1 style="margin:0 0 24px;font-size:1.1rem;letter-spacing:0.15em;text-transform:uppercase">Directives</h1>
  <div style="display:flex;gap:10px;margin-bottom:24px;align-items:flex-start;">
    <textarea id="feedback" placeholder="feedback..." style="flex:1;background:none;border:1px solid rgba(232,157,194,0.4);color:rgba(232,157,194,1);font-family:monospace;font-size:0.8rem;padding:6px 10px;resize:vertical;min-height:48px;"></textarea>
    <div style="display:flex;flex-direction:column;gap:6px;">
      <button id="regen-btn" onclick="regen(this)">regenerate</button>
      <button id="push-btn" onclick="doPush(this)">push</button>
    </div>
  </div>
  <div id="dir-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:8px;">
    <span style="opacity:0.4;font-size:0.8rem;grid-column:1/-1">loading...</span>
  </div>
  <div class="ts" id="dir-ts"></div>
  <div style="margin-top:40px;display:flex;justify-content:space-between;align-items:center;">
    <h2 style="margin:0">omens</h2>
    <button onclick="refreshOmens(this)" style="font-size:0.75rem;padding:3px 10px;">refresh omens</button>
  </div>
  <div id="omens" style="margin-top:12px;"><span style="opacity:0.4;font-size:0.8rem">loading...</span></div>
  <div class="ts" id="omens-ts"></div>
  <div style="margin-top:40px;">
    <h2 style="margin:0 0 12px">encouragement</h2>
    <div id="encouragement" style="font-size:0.85rem;line-height:1.8;opacity:0.85;white-space:pre-wrap"><span style="opacity:0.4;font-size:0.8rem">loading...</span></div>
    <div class="ts" id="enc-ts"></div>
  </div>
</div>
<script>
const COL_HDR = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.15em;opacity:0.65;margin:0 0 8px;border-bottom:1px solid rgba(232,157,194,0.25);padding-bottom:4px;';
async function loadDirectives() {
  const r = await fetch('/api/directives');
  const el = document.getElementById('dir-grid');
  if (!r.ok) { el.innerHTML = '<p style="opacity:0.4;font-size:0.8rem;grid-column:1/-1">no directives yet — click regenerate</p>'; return; }
  const d = await r.json();
  const easy = d.easy || [];
  const medium = d.medium || [];
  const hard = d.hard || {};
  el.innerHTML = `
    <div>
      <div style="${COL_HDR}">easy</div>
      ${easy.map(t=>`<div style="padding:5px 0 5px 18px;font-size:0.77rem;opacity:0.82;">&middot; ${t}</div>`).join('')}
    </div>
    <div>
      <div style="${COL_HDR}">medium</div>
      ${medium.map(t=>`<div class="item"><div style="margin-bottom:3px;">${typeof t==='string'?t:t.title}</div>${(t.steps||[]).map(s=>`<div style="padding:1px 0 1px 18px;font-size:0.77rem;opacity:0.82;">&middot; ${s}</div>`).join('')}</div>`).join('')}
    </div>
    <div>
      <div style="${COL_HDR}">hard</div>
      ${hard.title?`<div class="item"><div style="margin-bottom:3px;">${hard.title}</div>${(hard.steps||[]).map(s=>`<div style="padding:1px 0 1px 18px;font-size:0.77rem;opacity:0.82;">&middot; ${s}</div>`).join('')}</div>`:'<p style="opacity:0.4;font-size:0.8rem">none</p>'}
    </div>
  `;
  document.getElementById('dir-ts').textContent = d.generated_at || '';
}
async function loadOmens() {
  const r = await fetch('/api/omens');
  const el = document.getElementById('omens');
  if (!r.ok) { el.innerHTML = '<p style="opacity:0.4;font-size:0.8rem">no omens yet</p>'; return; }
  const d = await r.json();
  const evts = d.events || [];
  el.innerHTML = evts.length
    ? evts.map(e=>`<div class="item">${e.title} &mdash; <span style="opacity:0.65;font-size:0.85em">${e.date}</span></div>`).join('')
    : '<p style="opacity:0.4;font-size:0.8rem">no omens</p>';
  document.getElementById('omens-ts').textContent = d.checked_at || '';
}
async function loadEncouragement() {
  const r = await fetch('/api/encouragement');
  const el = document.getElementById('encouragement');
  if (!r.ok) { el.innerHTML = '<span style="opacity:0.4;font-size:0.8rem">none yet — click regenerate</span>'; return; }
  const d = await r.json();
  el.textContent = d.message || '';
  document.getElementById('enc-ts').textContent = d.generated_at || '';
}
async function regen(btn) {
  const feedback = document.getElementById('feedback').value.trim();
  btn.disabled = true;
  btn.textContent = 'pulling & refreshing...';
  await Promise.all([
    fetch('/api/delta', {method:'POST'}).catch(()=>{}),
    fetch('/api/omens', {method:'POST'}).catch(()=>{}),
  ]);
  btn.textContent = 'generating...';
  const r = await fetch('/api/directives', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({feedback})});
  btn.textContent = 'encouraging...';
  await fetch('/api/encouragement', {method:'POST'}).catch(()=>{});
  btn.disabled = false; btn.textContent = 'regenerate';
  document.getElementById('feedback').value = '';
  loadDirectives(); loadOmens(); loadEncouragement();
  if (!r.ok) {
    const err = await r.json().catch(()=>({detail:'error'}));
    document.getElementById('dir-grid').innerHTML = `<p style="color:rgba(255,100,100,0.8);font-size:0.8rem;grid-column:1/-1">${err.detail}</p>`;
  }
}
async function doPush(btn) {
  btn.disabled = true; btn.textContent = 'pushing...';
  const r = await fetch('/api/push', {method:'POST'});
  btn.disabled = false; btn.textContent = 'push';
  if (!r.ok) { const err = await r.json().catch(()=>({detail:'error'})); alert(err.detail); }
}
async function refreshOmens(btn) {
  btn.disabled = true; btn.textContent = 'checking...';
  const r = await fetch('/api/omens', {method:'POST'});
  btn.disabled = false; btn.textContent = 'refresh omens';
  if (r.ok) loadOmens();
  else { const err = await r.json().catch(()=>({detail:'error'})); document.getElementById('omens').innerHTML = `<p style="color:rgba(255,100,100,0.8);font-size:0.8rem">${err.detail}</p>`; }
}
loadDirectives(); loadOmens(); loadEncouragement();
</script>
'''


# ── app ───────────────────────────────────────────────────────────────────────

app = FastAPI()


def require_auth(
    session: Optional[str] = Cookie(default=None),
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer),
):
    if session == SESSION_TOKEN:
        return
    if credentials and credentials.credentials == API_KEY:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


public = APIRouter()
protected = APIRouter(dependencies=[Depends(require_auth)])


# ── public ────────────────────────────────────────────────────────────────────

@public.post("/login")
async def login(request: Request):
    form = await request.form()
    key = form.get("key", "")
    if not secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid key")
    resp = RedirectResponse(url="/exec", status_code=303)
    resp.set_cookie("session", SESSION_TOKEN, httponly=True, samesite="lax", secure=False)
    return resp


# ── pages ─────────────────────────────────────────────────────────────────────

@protected.get("/exec", response_class=HTMLResponse)
async def exec_page():
    return _build_page()


@protected.get("/directives", response_class=HTMLResponse)
async def directives_page():
    return _build_page("directives", _DIRECTIVES_CONTENT)


@protected.get("/omens")
async def omens_page():
    return RedirectResponse(url="/directives", status_code=302)


@protected.get("/delta", response_class=HTMLResponse)
async def delta_page():
    return _build_page("delta", _DELTA_CONTENT)


@protected.get("/rd", response_class=HTMLResponse)
async def rd_page():
    base = _BARE
    head_inject = GREEN_OVERLAY + "<style>body{display:block;height:100vh;overflow:hidden!important;}</style>"
    return (base
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", _RD_CONTENT + _BACK + _build_nav("r&d") + "</body>", 1))


@protected.get("/archive", response_class=HTMLResponse)
async def archive_page():
    return _build_page("archive", _ARCHIVE_CONTENT)


# ── data file serving ─────────────────────────────────────────────────────────

@protected.get("/data/{filename}")
async def serve_data(filename: str):
    path = (DATA_DIR / filename).resolve()
    if not str(path).startswith(str(DATA_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))


# ── api ───────────────────────────────────────────────────────────────────────

@protected.post("/api/pull")
def api_pull():
    try:
        return {"file": Path(pipeline.pull_exec()).name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/morning")
def api_morning():
    try:
        return pipeline.build_morning()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/archive")
def api_archive():
    return pipeline.list_archive()


@protected.get("/api/archive/{filename}/page/{page_num}")
def archive_page_png(filename: str, page_num: int):
    from fastapi.responses import Response
    from rm_to_pdf import rasterize
    p = DATA_DIR / filename
    if not p.exists() or not filename.endswith(".rmdoc"):
        raise HTTPException(status_code=404, detail="not found")
    png_bytes = rasterize(str(p), page_index=page_num)
    return Response(content=png_bytes, media_type="image/png")


@protected.get("/api/rd")
def api_rd():
    p = DATA_DIR / "rd.json"
    return json.loads(p.read_text()) if p.exists() else {"columns": ["backlog","doing","done"], "cards": []}


@protected.patch("/api/rd")
async def api_rd_patch(request: Request):
    body = await request.json()
    p = DATA_DIR / "rd.json"
    data = json.loads(p.read_text()) if p.exists() else {"columns": ["backlog","doing","done"]}
    data["cards"] = body.get("cards", [])
    p.write_text(json.dumps(data, indent=2))
    return {"ok": True}


@protected.post("/api/rd/classify")
async def api_rd_classify(request: Request):
    body = await request.json()
    title = body.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    try:
        return pipeline.classify_card(title)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/context")
def api_context():
    p = DATA_DIR / "context.json"
    return json.loads(p.read_text()) if p.exists() else {"notes": []}


@protected.get("/api/encouragement")
def api_encouragement_get():
    p = DATA_DIR / "encouragement.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No encouragement yet")
    return json.loads(p.read_text())


@protected.post("/api/encouragement")
def api_encouragement_run():
    try:
        return pipeline.generate_encouragement()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/delta")
def api_delta_get():
    p = DATA_DIR / "delta.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No delta yet")
    return json.loads(p.read_text())


@protected.post("/api/delta")
def api_delta_run():
    try:
        return pipeline.analyze_delta()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/directives")
def api_directives_get():
    p = DATA_DIR / "directives.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No directives yet")
    return json.loads(p.read_text())


class DirectivesBody(BaseModel):
    feedback: str = ""


@protected.post("/api/directives")
def api_directives_run(body: DirectivesBody = DirectivesBody()):
    try:
        return pipeline.generate_directives(feedback=body.feedback)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/push")
def api_push():
    try:
        return {"pdf": pipeline.push_pdf()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/omens")
def api_omens_get():
    p = DATA_DIR / "omens.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No omens yet")
    return json.loads(p.read_text())


@protected.post("/api/omens")
def api_omens_run():
    try:
        return pipeline.analyze_omens()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.include_router(public)
app.include_router(protected)
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
