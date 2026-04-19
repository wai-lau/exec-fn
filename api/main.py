import asyncio, os, re, json, secrets, hashlib
from pathlib import Path
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Cookie, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Security
from pydantic import BaseModel
from typing import Optional, List

import pipeline

API_KEY = os.environ["API_KEY"]
bearer = HTTPBearer(auto_error=False)
SESSION_TOKEN = hashlib.sha256(f"session:{API_KEY}".encode()).hexdigest()
DATA_DIR = Path("/app/data")

GREEN_OVERLAY = """
<style>
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(0, 255, 65, 0.45); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0, 255, 65, 0.85); }
  * { scrollbar-width: thin; scrollbar-color: rgba(0,255,65,0.45) transparent; }
  .exec-nav {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
    height: 52px; display: flex; align-items: center; justify-content: center; gap: 32px;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(10px);
    border-top: 1px solid rgba(0,255,65,0.12);
  }
  .exec-nav a {
    color: rgba(0, 255, 65, 0.65);
    font-family: monospace;
    font-size: 0.85rem;
    text-decoration: none;
    border-bottom: 1px solid rgba(0, 255, 65, 0.3);
    transition: color 0.2s, border-bottom-color 0.2s;
  }
  .exec-nav a:hover { color: rgba(0, 255, 65, 1); border-bottom-color: rgba(0, 255, 65, 1); }
  .exec-nav a[style*="opacity:1"] { color: rgba(0,255,65,1); border-bottom-color: rgba(0,255,65,1); }
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
    color: rgba(0, 255, 65, 1);
  }
  #content h2 {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    opacity: 0.65;
    margin: 28px 0 8px;
    border-bottom: 1px solid rgba(0, 255, 65, 0.25);
    padding-bottom: 4px;
  }
  #content .item {
    font-size: 0.85rem;
    padding: 5px 0;
    border-bottom: 1px solid rgba(0, 255, 65, 0.12);
  }
  #content button {
    background: none;
    border: 1px solid rgba(0, 255, 65, 0.5);
    color: rgba(0, 255, 65, 0.85);
    font-family: monospace;
    font-size: 0.8rem;
    padding: 4px 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  #content button:hover { border-color: rgba(0, 255, 65, 1); color: rgba(0, 255, 65, 1); }
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
        style = ' style="opacity:1;border-bottom-color:rgba(0,255,65,0.9);"' if label == active else ""
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
    '<a href="/exec" style="color:rgba(0,255,65,0.85);font-family:monospace;font-size:0.9rem;'
    'text-decoration:none;border-bottom:1px solid rgba(0,255,65,0.45);transition:color 0.2s;" '
    "onmouseover=\"this.style.color='rgba(0,255,65,1)'\" "
    "onmouseout=\"this.style.color='rgba(0,255,65,0.85)'\">← exec</a></div>"
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
        ${Array.from({length: f.pages}, (_, i) => `<img src="/api/archive/${f.filename}/page/${i}" style="height:180px;width:auto;border:1px solid rgba(0,255,65,0.15);cursor:zoom-in;" onclick="openLightbox(this.src)">`).join('')}
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
  border-bottom: 1px solid rgba(0,255,65,0.12);
}
.rd-board {
  position: fixed; top: 52px; bottom: 52px; left: 0; right: 0;
  display: flex; gap: 1px; overflow: hidden;
  background: rgba(0,255,65,0.06);
}
.col { flex: 1; display: flex; flex-direction: column; min-width: 0; background: rgba(0,0,0,0.25); }
.col.ashes-collapsed { flex: 0 0 38px; cursor: pointer; overflow: hidden; }
.col.ashes-collapsed .col-list { pointer-events: none; overflow: hidden; }
.col-hdr {
  flex-shrink: 0; padding: 14px 16px 10px;
  font-family: monospace; font-size: 0.62rem; text-transform: uppercase;
  letter-spacing: 0.18em; color: rgba(0,255,65,0.55);
  border-bottom: 1px solid rgba(0,255,65,0.1);
  display: flex; align-items: center; gap: 6px;
}
.col-hdr-label { flex: 1; }
.done-toggle { background:none; border:none; color:rgba(0,255,65,0.4); cursor:pointer; font-size:0.7rem; padding:0; line-height:1; }
.done-toggle:hover { color:rgba(0,255,65,0.9); }
.col-list { flex: 1; overflow-y: auto; padding: 10px 10px 20px; }
.card {
  border-radius: 4px; padding: 9px 11px; margin-bottom: 7px;
  cursor: grab; user-select: none; font-family: monospace;
  border: 1px solid transparent;
  transition: filter 0.15s;
}
.card:hover { filter: brightness(1.08); }
.card:active { cursor: grabbing; }
.card.plain { background: rgba(0,255,65,0.05); border-color: rgba(0,255,65,0.15); }
.card.plain:hover { background: rgba(0,255,65,0.09); }
.card-title { font-size: 0.8rem; margin-bottom: 2px; }
.card-desc { font-size: 0.7rem; margin-top: 3px; opacity: 0.72;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.card-foot { display: flex; justify-content: space-between; align-items: baseline; margin-top: 5px; }
.card-badge { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; }
.card-due { font-size: 0.62rem; }
.sortable-ghost { opacity: 0.2; }
.rd-btn {
  background: none; border: 1px solid rgba(0,255,65,0.4);
  color: rgba(0,255,65,0.8); font-family: monospace; font-size: 0.78rem;
  padding: 4px 12px; cursor: pointer; transition: all 0.2s;
}
.rd-btn:hover { border-color: rgba(0,255,65,1); color: rgba(0,255,65,1); }
.rd-btn:disabled { opacity: 0.4; cursor: default; }
.modal-overlay {
  display: none; position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.75); align-items: center; justify-content: center;
}
.modal-overlay.open { display: flex; }
.modal {
  background: #0a0a0a; border: 1px solid rgba(0,255,65,0.25);
  padding: 24px 28px; width: min(420px,92vw); font-family: monospace;
}
.modal-title { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.15em; color: rgba(0,255,65,0.6); margin-bottom: 16px; }
.modal label { display: block; font-size: 0.6rem; color: rgba(0,255,65,0.45); margin: 12px 0 3px; text-transform: uppercase; letter-spacing: 0.1em; }
.modal input, .modal select, .modal textarea {
  width: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(0,255,65,0.2);
  color: rgba(0,255,65,0.9); font-family: monospace; font-size: 0.82rem;
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
      <option value="ideas">ideas</option>
      <option value="selected">selected</option>
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
      <option>Interfacing</option><option>Hobby</option><option>Social</option><option>Learning</option>
    </select>
    <label>size</label>
    <select id="e-size">
      <option value="chore">chore &mdash; under 1 hour</option>
      <option value="task">task &mdash; under 4 hours</option>
      <option value="book">book &mdash; ongoing read</option>
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
const COLS = ['ideas','selected','ashes'];
let cards = [];
let editId = null;
let dragging = false;
let ashesCollapsed = true;

const CAT_HUE = {Learning:210, Social:275, Interfacing:50, Hobby:0};

function isDarkCard(c) {
  return c.size === 'chore' || c.size === 'task' || c.size === 'book';
}

function cardStyle(c) {
  const h = CAT_HUE[c.category];
  if (h === undefined) return {bg:'', border:'', dark:false};
  const size = c.size;
  const col = `hsl(${h},75%,68%)`;
  const borderMid = `hsl(${h},65%,60%)`;
  const borderBright = `hsl(${h},90%,78%)`;
  if (size === 'chore') {
    return {bg:`background:#0d0d0d;color:${col};`, border:'border-color:transparent;', dark:true};
  } else if (size === 'task') {
    return {bg:`background:#0d0d0d;color:${col};`, border:`border-color:${borderMid};`, dark:true};
  } else if (size === 'book') {
    return {bg:`background:hsl(0,0%,10%);color:${col};`, border:`border-color:${borderMid};`, dark:true};
  } else if (size === 'project') {
    return {bg:`background:hsl(${h},50%,54%);`, border:'border-color:transparent;', dark:false};
  } else {
    return {bg:`background:hsl(${h},55%,62%);`, border:`border-color:${borderBright};`, dark:false};
  }
}

function parseMonthDay(input) {
  if (!input || !input.trim()) return null;
  const s = input.trim().toLowerCase();
  const mnths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const now = new Date();
  let month = -1, day = 0;
  let m = s.match(/^(\\d{1,2})[\\/-](\\d{1,2})$/);
  if (m) { month = parseInt(m[1]) - 1; day = parseInt(m[2]); }
  if (month < 0) {
    m = s.match(/^([a-z]+)\\s+(\\d{1,2})$/);
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
  const {bg, border, dark} = cardStyle(c);
  const hasStyle = !!bg;
  const titleC = !hasStyle ? 'rgba(0,255,65,0.9)' : dark ? 'inherit' : 'rgba(0,0,0,0.85)';
  const tc     = !hasStyle ? 'rgba(0,255,65,0.45)' : dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.55)';
  const urgent = isUrgent(c.due_date);
  return `<div class="card${hasStyle ? '' : ' plain'}" data-id="${c.id}" style="${bg}${border}">
    <div class="card-title" style="color:${titleC}">${c.title}</div>
    ${c.description ? `<div class="card-desc" style="color:${tc}">${c.description}</div>` : ''}
    <div class="card-foot">
      <div class="card-badge" style="color:${tc}">${[c.category, c.size].filter(Boolean).join(' · ')}</div>
      ${c.due_date ? `<div class="card-due" style="color:${urgent ? (dark?'rgba(255,140,80,0.9)':'rgba(180,60,0,0.9)') : tc}">${fmtDate(c.due_date)}</div>` : ''}
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

function toggleAshes(e) {
  if (e) e.stopPropagation();
  ashesCollapsed = !ashesCollapsed;
  buildBoard();
}

function buildBoard() {
  document.getElementById('board').innerHTML = COLS.map(col => {
    const count = cards.filter(c=>c.column===col).length;
    const isAshes = col === 'ashes';
    const collapsed = isAshes && ashesCollapsed;
    const hdr = isAshes
      ? `<span class="col-hdr-label">${collapsed ? '▶' : col} <span style="opacity:0.35">(${count})</span></span>
         ${!collapsed ? `<button class="done-toggle" onclick="toggleAshes(event)">▼</button>` : ''}`
      : `<span class="col-hdr-label">${col} <span style="opacity:0.35">(${count})</span></span>`;
    const colCards = collapsed ? '' : cards.filter(c=>c.column===col).sort((a,b)=>a.order-b.order).map(renderCard).join('');
    return `<div class="col${collapsed?' ashes-collapsed':''}"${collapsed?' onclick="toggleAshes()"':''}>
      <div class="col-hdr">${hdr}</div>
      <div class="col-list" id="col-${col}">${colCards}</div>
    </div>`;
  }).join('');
  COLS.forEach(col => {
    const el = document.getElementById('col-'+col);
    if (!el) return;
    Sortable.create(el, {
      group:'kanban', animation:120, ghostClass:'sortable-ghost',
      onStart: () => { dragging = true; },
      onEnd: () => { setTimeout(() => { dragging = false; }, 50); save(); }
    });
  });
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
  let category = 'Learning', size = 'task', description = '';
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
  document.getElementById('e-cat').value = c.category || 'Learning';
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
  const parts = text.split(/\\s+(?=\\d+\\.\\s)/);
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
  <h1 style="margin:0 0 24px;font-size:1.1rem;letter-spacing:0.15em;text-transform:uppercase">Directives from AI-sama</h1>
  <div style="display:flex;justify-content:flex-end;margin-bottom:24px;">
    <button id="push-btn" onclick="doPush(this)">push &rarr;</button>
  </div>
  <div id="dir-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:8px;">
    <span style="opacity:0.4;font-size:0.8rem;grid-column:1/-1">loading...</span>
  </div>
  <div style="margin-top:40px;">
    <h2 style="margin:0 0 12px">omens</h2>
    <div id="omens"><span style="opacity:0.4;font-size:0.8rem">loading...</span></div>
    <div class="ts" id="omens-ts"></div>
  </div>
  <div style="margin-top:40px;">
    <h2 style="margin:0 0 12px">encouragement</h2>
    <div id="encouragement" style="font-size:0.85rem;line-height:1.8;opacity:0.85;white-space:pre-wrap"><span style="opacity:0.4;font-size:0.8rem">loading...</span></div>
  </div>
</div>
<script>
const COL_HDR = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.15em;opacity:0.65;margin:0 0 8px;border-bottom:1px solid rgba(0,255,65,0.25);padding-bottom:4px;';
async function loadDirectives() {
  const r = await fetch('/api/rd');
  const el = document.getElementById('dir-grid');
  if (!r.ok) { el.innerHTML = '<p style="opacity:0.4;font-size:0.8rem;grid-column:1/-1">no r&d data</p>'; return; }
  const data = await r.json();
  const cards = (data.cards || []).filter(c => c.column === 'selected');
  const easy = cards.filter(c => c.size === 'chore' || c.size === 'task');
  const medium = cards.filter(c => c.size === 'book' || c.size === 'project');
  const hard = cards.find(c => c.size === 'titan');
  const steps = c => (c.description||'').split('.').map(s=>s.trim()).filter(Boolean);
  el.innerHTML = `
    <div>
      <div style="${COL_HDR}">easy</div>
      ${easy.length ? easy.map(c=>`<div class="item">&middot; ${c.title}</div>`).join('') : '<span style="opacity:0.4;font-size:0.8rem">none</span>'}
    </div>
    <div>
      <div style="${COL_HDR}">medium</div>
      ${medium.length ? medium.map(c=>`<div class="item"><div style="margin-bottom:3px;">${c.title}</div>${steps(c).map(s=>`<div style="padding:1px 0 1px 18px;font-size:0.77rem;opacity:0.82;">&middot; ${s}</div>`).join('')}</div>`).join('') : '<span style="opacity:0.4;font-size:0.8rem">none</span>'}
    </div>
    <div>
      <div style="${COL_HDR}">hard</div>
      ${hard ? `<div class="item"><div style="margin-bottom:3px;">${hard.title}</div>${steps(hard).map(s=>`<div style="padding:1px 0 1px 18px;font-size:0.77rem;opacity:0.82;">&middot; ${s}</div>`).join('')}</div>` : '<span style="opacity:0.4;font-size:0.8rem">none</span>'}
    </div>
  `;
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
  const r = await fetch('/api/directives');
  const el = document.getElementById('encouragement');
  if (!r.ok) { el.innerHTML = '<span style="opacity:0.4;font-size:0.8rem">none yet — plan your day at /exec</span>'; return; }
  const d = await r.json();
  el.textContent = d.encouraging_message || '';
}
async function doPush(btn) {
  btn.disabled = true; btn.textContent = 'pushing...';
  const r = await fetch('/api/push', {method:'POST'});
  btn.disabled = false; btn.textContent = 'push \u2192';
  if (!r.ok) { const err = await r.json().catch(()=>({detail:'error'})); alert(err.detail); }
  else { btn.textContent = 'pushed \u2713'; setTimeout(()=>{btn.textContent='push \u2192';},3000); }
}
loadDirectives(); loadOmens(); loadEncouragement();
</script>
'''

_EXEC_CONTENT = '''
<style>
body { display:block !important; height:100vh; overflow:hidden !important; flex-direction:unset !important; align-items:unset !important; justify-content:unset !important; gap:unset !important; }
#terminal {
  position:fixed; top:0; left:0; right:0; bottom:104px;
  overflow-y:auto; padding:36px 44px;
  font-family:monospace; font-size:0.88rem; line-height:1.72;
  color:rgba(0,255,65,0.9);
}
.msg { margin-bottom:20px; max-width:680px; white-space:pre-wrap; word-break:break-word; }
.msg.assistant { color:rgba(0,255,65,0.92); }
.msg.user { color:rgba(0,255,65,0.42); padding-left:14px; border-left:2px solid rgba(0,255,65,0.16); }
.msg.sys { color:rgba(0,255,65,0.26); font-size:0.72rem; font-style:italic; }
#blinkcursor { display:inline-block; width:8px; height:1em; background:rgba(0,255,65,0.9); vertical-align:text-bottom; animation:blink 1s step-end infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
#input-bar {
  position:fixed; bottom:52px; left:0; right:0;
  padding:10px 44px; background:rgba(0,0,0,0.94);
  border-top:1px solid rgba(0,255,65,0.12);
  display:flex; gap:14px; align-items:center;
}
#msg-input {
  flex:1; background:none; border:none; border-bottom:1px solid rgba(0,255,65,0.25);
  color:rgba(0,255,65,0.9); font-family:monospace; font-size:0.9rem;
  padding:4px 2px; outline:none;
}
#msg-input::placeholder { color:rgba(0,255,65,0.18); }
#msg-input:focus { border-bottom-color:rgba(0,255,65,0.6); }
.exec-send {
  background:none; border:1px solid rgba(0,255,65,0.25); color:rgba(0,255,65,0.55);
  font-family:monospace; font-size:0.8rem; padding:4px 14px; cursor:pointer; transition:all 0.2s;
}
.exec-send:hover { border-color:rgba(0,255,65,0.85); color:rgba(0,255,65,1); }
.exec-send:disabled { opacity:0.2; cursor:default; }
.exec-clear {
  background:none; border:none; color:rgba(0,255,65,0.18); font-family:monospace;
  font-size:0.78rem; cursor:pointer; padding:2px 4px; transition:color 0.2s;
}
.exec-clear:hover { color:rgba(0,255,65,0.5); }
</style>

<div id="terminal"></div>
<div id="input-bar">
  <button class="exec-clear" id="clear-btn" onclick="clearChat()" title="new session">&circlearrowleft;</button>
  <input id="msg-input" type="text" placeholder="type a message..." autofocus>
  <button class="exec-send" id="send-btn" onclick="sendMsg()">&rarr;</button>
</div>

<script>
let stage = 'planning';
let messages = [];
let streaming = false;

const terminal = document.getElementById('terminal');

function renderText(raw) {
  const esc = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>');
}

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'assistant') div.innerHTML = renderText(text);
  else div.textContent = text;
  terminal.appendChild(div);
  div.scrollIntoView({behavior:'smooth', block:'end'});
  return div;
}

function addStreamDiv() {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const span = document.createElement('span');
  span.id = 'stream-span';
  const cur = document.createElement('span');
  cur.id = 'blinkcursor';
  div.appendChild(span);
  div.appendChild(cur);
  terminal.appendChild(div);
  return {div, span, cur};
}

async function sendMsg() {
  if (streaming) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg('user', text);
  messages.push({role:'user', content:text});
  await streamResponse();
}

async function streamResponse() {
  streaming = true;
  document.getElementById('send-btn').disabled = true;

  const {div, span, cur} = addStreamDiv();
  let fullText = '';

  try {
    const r = await fetch('/api/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages, stage}),
    });

    if (!r.ok) throw new Error(await r.text());

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream:true});
      const lines = buf.split('\\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'text') {
          fullText += data.delta;
          span.innerHTML = renderText(fullText);
          div.scrollIntoView({behavior:'smooth', block:'end'});
        } else if (data.type === 'tool_call') {
          const note = addMsg('sys', `[ ${data.name}: ${JSON.stringify(data.result)} ]`);
          note.scrollIntoView({behavior:'smooth', block:'end'});
        } else if (data.type === 'done') {
          stage = data.next_stage;
          if (stage === 'done') {
            document.getElementById('msg-input').disabled = true;
            document.getElementById('send-btn').disabled = true;
          }
        }
      }
    }

    cur.remove();
    if (fullText) messages.push({role:'assistant', content:fullText});
  } catch(e) {
    cur.remove();
    div.textContent = '[error: ' + e.message + ']';
    div.style.color = 'rgba(255,100,100,0.75)';
  }

  streaming = false;
  if (stage !== 'done') {
    document.getElementById('send-btn').disabled = false;
    document.getElementById('msg-input').focus();
  }
}

async function clearChat() {
  if (streaming) return;
  await fetch('/api/chat', {method:'DELETE'});
  messages = [];
  stage = 'planning';
  terminal.innerHTML = '';
  document.getElementById('msg-input').disabled = false;
  document.getElementById('send-btn').disabled = false;
  await init();
}

let spinnerTimer = null;
let spinnerDelay = null;

function startSpinner(msg) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  spinnerDelay = setTimeout(() => {
    const div = document.createElement('div');
    div.id = 'spinner';
    div.className = 'msg sys';
    div.style.cssText = 'color:rgba(0,255,65,0.6);font-size:0.82rem;';
    div.textContent = frames[0] + '  ' + msg;
    terminal.appendChild(div);
    spinnerTimer = setInterval(() => { div.textContent = frames[i++ % frames.length] + '  ' + msg; }, 80);
  }, 200);
}

function stopSpinner() {
  clearTimeout(spinnerDelay); spinnerDelay = null;
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
  const el = document.getElementById('spinner');
  if (el) el.remove();
}

function restoreMsg(m) {
  if (m.role === 'user') {
    if (typeof m.content === 'string') {
      addMsg('user', m.content);
    } else if (Array.isArray(m.content)) {
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('');
      if (text) addMsg('user', text);
    }
  } else if (m.role === 'assistant') {
    if (typeof m.content === 'string') {
      addMsg('assistant', m.content);
    } else if (Array.isArray(m.content)) {
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\\n').trim();
      if (text) addMsg('assistant', text);
      for (const b of m.content) {
        if (b.type === 'tool_use') addMsg('sys', `[ ${b.name}: ${JSON.stringify(b.result ?? b.input)} ]`);
      }
    }
  }
}

async function init() {
  // Always run morning pipeline first — it clears chat.json if it's a new day
  startSpinner('running morning pipeline...');
  let morningMsg = null;
  try {
    const mr = await fetch('/api/morning');
    stopSpinner();
    if (mr.ok) {
      morningMsg = (await mr.json()).opening_message || null;
    } else {
      const err = await mr.json().catch(() => ({}));
      addMsg('sys', '[morning pipeline failed: ' + (err.detail || mr.status) + ']');
    }
  } catch(e) {
    stopSpinner();
    addMsg('sys', '[error: ' + e.message + ']');
  }

  // Load chat — may be empty if morning just cleared it
  const r = await fetch('/api/chat');
  const chat = await r.json();
  if (chat.messages && chat.messages.length > 0) {
    messages = chat.messages;
    stage = chat.stage || 'planning';
    for (const m of messages) restoreMsg(m);
    if (stage === 'done') {
      document.getElementById('msg-input').disabled = true;
      document.getElementById('send-btn').disabled = true;
    }
    return;
  }

  if (morningMsg) addMsg('assistant', morningMsg);
}

document.getElementById('msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});

init();
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
    head_inject = GREEN_OVERLAY
    return (_BARE
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", _EXEC_CONTENT + _build_nav(None) + "</body>", 1))


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


@protected.get("/api/morning")
def api_morning_get():
    from datetime import date
    p = DATA_DIR / "morning.json"
    if p.exists():
        data = json.loads(p.read_text())
        generated = data.get("generated_at", "")[:10]
        if generated == date.today().isoformat():
            return data
    try:
        return pipeline.build_morning()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/morning")
def api_morning():
    try:
        return pipeline.build_morning()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ChatBody(BaseModel):
    messages: List[dict] = []
    stage: str = "planning"


@protected.get("/api/chat")
def api_chat_get():
    return pipeline.get_chat()


@protected.delete("/api/chat")
def api_chat_clear():
    p = DATA_DIR / "chat.json"
    if p.exists():
        p.unlink()
    return {"ok": True}


@protected.post("/api/chat")
async def api_chat(body: ChatBody):
    import anthropic as _anthropic

    messages = body.messages
    stage = body.stage

    async def generate():
        client = _anthropic.AsyncAnthropic()
        system_prompt = pipeline._build_chat_system_prompt(stage)
        tools = pipeline._chat_tools()
        next_stage = stage
        full_text = ""
        final = None

        try:
            async with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=system_prompt,
                tools=tools,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    full_text += text
                    yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
                final = await stream.get_final_message()
        except Exception as e:
            yield f"data: {json.dumps({'type': 'text', 'delta': f'[error: {e}]'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'next_stage': stage})}\n\n"
            return

        # Build assistant message content
        assistant_content = []
        for block in final.content:
            if block.type == "text":
                assistant_content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                assistant_content.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})

        all_messages = messages + [{"role": "assistant", "content": assistant_content}]
        tool_result_contents = []

        for block in final.content:
            if block.type == "tool_use":
                result = await asyncio.to_thread(pipeline._handle_tool, block.name, block.input)
                if block.name == "set_directives":
                    next_stage = "push"
                elif block.name == "request_push":
                    next_stage = "done"
                yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'result': result})}\n\n"
                tool_result_contents.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                })

        if tool_result_contents:
            all_messages.append({"role": "user", "content": tool_result_contents})
            # Continuation call so Claude responds to the tool result with text
            cont_text = ""
            try:
                async with client.messages.stream(
                    model="claude-sonnet-4-6",
                    max_tokens=512,
                    system=pipeline._build_chat_system_prompt(next_stage),
                    tools=tools,
                    messages=all_messages,
                ) as stream2:
                    async for text in stream2.text_stream:
                        cont_text += text
                        yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
                    final2 = await stream2.get_final_message()
                if cont_text:
                    all_messages.append({"role": "assistant", "content": [{"type": "text", "text": cont_text}]})
            except Exception:
                pass

        pipeline._save_chat(all_messages, next_stage)
        yield f"data: {json.dumps({'type': 'done', 'next_stage': next_stage})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
    return json.loads(p.read_text()) if p.exists() else {"columns": ["ideas","selected","ashes"], "cards": []}


@protected.patch("/api/rd")
async def api_rd_patch(request: Request):
    body = await request.json()
    p = DATA_DIR / "rd.json"
    data = json.loads(p.read_text()) if p.exists() else {"columns": ["ideas","selected","ashes"]}
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
