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
  .exec-nav { position: fixed; bottom: 32px; right: 32px; z-index: 10; display: flex; gap: 20px; }
  .exec-nav a {
    color: rgba(232, 157, 194, 0.85);
    font-family: monospace;
    font-size: 0.9rem;
    text-decoration: none;
    border-bottom: 1px solid rgba(232, 157, 194, 0.45);
    transition: color 0.2s, border-bottom-color 0.2s;
  }
  .exec-nav a:hover { color: rgba(232, 157, 194, 1); border-bottom-color: rgba(232, 157, 194, 1); }
</style>
"""

CONTENT_STYLE = """
<style>
  body { display: block; height: auto; min-height: 100vh; overflow-y: auto; }
  #content {
    position: relative;
    z-index: 2;
    width: min(720px, 90vw);
    margin: 72px auto 100px;
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
        <img src="/api/archive/${f.filename}/page/0" style="height:180px;width:auto;border:1px solid rgba(232,157,194,0.15);cursor:zoom-in;" onclick="openLightbox(this.src)" onerror="this.style.display='none'">
        <img src="/api/archive/${f.filename}/page/1" style="height:180px;width:auto;border:1px solid rgba(232,157,194,0.15);cursor:zoom-in;" onclick="openLightbox(this.src)" onerror="this.style.display='none'">
      </div>
    </div>
  `).join('');
}
load();
</script>
'''

_RD_CONTENT = '''
<div id="content">
  <div id="rd"><span style="opacity:0.4;font-size:0.8rem">loading...</span></div>
</div>
<script>
async function load() {
  const r = await fetch('/api/rd');
  const data = await r.json();
  document.getElementById('rd').innerHTML = (data.sections || []).map(s => `
    <h2>${s.title}</h2>
    ${s.items.map(i => `<div class="item">&middot; ${i}</div>`).join('')}
  `).join('');
}
load();
</script>
'''

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
async function regen(btn) {
  const feedback = document.getElementById('feedback').value.trim();
  btn.disabled = true; btn.textContent = 'generating...';
  await fetch('/api/omens', {method:'POST'});
  const r = await fetch('/api/directives', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({feedback})});
  btn.disabled = false; btn.textContent = 'regenerate';
  loadDirectives(); loadOmens();
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
loadDirectives(); loadOmens();
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
    return _build_page("r&d", _RD_CONTENT)


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
    return json.loads(p.read_text()) if p.exists() else {"sections": []}


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
