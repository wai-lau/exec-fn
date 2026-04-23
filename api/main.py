import asyncio
import os
import re
import json
import secrets
import hashlib
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
_TMPL = Path("/app/templates")

_GREEN_OVERLAY = """
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

_CONTENT_STYLE = """
<style>
  body { display: block; height: auto; min-height: 100vh; overflow-y: auto; }
  #content {
    position: relative;
    z-index: 2;
    width: min(720px, 90vw);
    margin: 64px auto 80px;
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

_NAV_LINKS = ["exec", "plan", "看板", "vault", "媁"]
_NAV_HREFS = {"exec": "/exec", "plan": "/plan", "看板": "/rd", "vault": "/archive", "媁": "/nightfall"}


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


def _build_page(active=None, content=""):
    base = _BARE if active else _NO_FORM
    head_inject = _GREEN_OVERLAY + (_CONTENT_STYLE if content else "")
    return (base
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", content + _build_nav(active) + "</body>", 1))


# ── templates ─────────────────────────────────────────────────────────────────

_VAULT_HTML    = (_TMPL / "vault.html").read_text()
_KANBAN_HTML   = (_TMPL / "kanban.html").read_text()
_PLAN_HTML     = (_TMPL / "plan.html").read_text()
_EXEC_HTML     = (_TMPL / "exec.html").read_text()


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

# Deferred React loader + IDB save sync. __SCRIPTS__ replaced at serve time with JSON array.
_NIGHTFALL_SAVE_SCRIPT = """
<script>
(async function () {
  var STORE = 'nightfall-save';
  var SLOTS = ['save1', 'save2', 'save3'];

  function openDB() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('nightfall', 1);
      req.onupgradeneeded = function (e) { e.target.result.createObjectStore(STORE); };
      req.onsuccess = function (e) { res(e.target.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function dbGet(db, key) {
    return new Promise(function (res) {
      try {
        var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        r.onsuccess = function () { res(r.result != null ? r.result : null); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function dbSet(db, key, val) {
    return new Promise(function (res) {
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = res; tx.onerror = res;
      } catch (e) { res(); }
    });
  }
  function loadScript(src) {
    return new Promise(function (res) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = res;
      document.head.appendChild(s);
    });
  }

  // Intercept IDB writes → upload to server on every save
  var _origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (val, key) {
    if (this.name === STORE && typeof key === 'string') {
      fetch('/api/gamesave/' + key, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: val })
      }).catch(function () {});
    }
    return _origPut.apply(this, arguments);
  };

  // Upload existing slots on page load (catches saves from previous sessions)
  (async function () {
    try {
      var udb = await openDB();
      for (var ui = 0; ui < SLOTS.length; ui++) {
        var uslot = SLOTS[ui];
        var uval = await dbGet(udb, uslot);
        if (!uval) continue;
        fetch('/api/gamesave/' + uslot, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ save: uval })
        }).catch(function () {});
      }
      udb.close();
    } catch (e) {}
  })();

  // Non-destructive restore: server → empty IDB slots only
  try {
    var resp = await fetch('/api/gamesave', { credentials: 'include' });
    if (resp.ok) {
      var server = await resp.json();
      var db = await openDB();
      for (var i = 0; i < SLOTS.length; i++) {
        var slot = SLOTS[i];
        if (!server[slot]) continue;
        var local = await dbGet(db, slot);
        var isEmpty = true;
        if (local) {
          try { isEmpty = !JSON.parse(local).completedTutorial; } catch (e) {}
        }
        if (isEmpty) await dbSet(db, slot, server[slot]);
      }
      db.close();
    }
  } catch (e) {}

  // Load React app (deferred until restore is done)
  var SCRIPTS = __SCRIPTS__;
  for (var j = 0; j < SCRIPTS.length; j++) await loadScript(SCRIPTS[j]);
})();
</script>
"""

# Injected into <head> — must run before game scripts to monkey-patch AudioContext
_NIGHTFALL_HEAD = """
<script>
(function () {
  // Monkey-patch AudioContext so we can resume all instances on first touch
  // and after returning from background (iOS suspends on backgrounding).
  var _AC = window.AudioContext || window.webkitAudioContext;
  if (!_AC) return;
  window._waiOrigAC = _AC;
  window._waiAudioContexts = [];
  function PatchedAC() {
    var ctx = new _AC();
    window._waiAudioContexts.push(ctx);
    return ctx;
  }
  PatchedAC.prototype = _AC.prototype;
  window.AudioContext = window.webkitAudioContext = PatchedAC;

  function unlockAll() {
    window._waiAudioContexts.forEach(function(ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(function(){});
    });
  }
  document.addEventListener('touchstart', unlockAll, {once: true, passive: true});
  document.addEventListener('touchend',   unlockAll, {once: true, passive: true});
  document.addEventListener('click',      unlockAll, {once: true});
})();
</script>
"""

# Injected before </body> — fullscreen button + JS layout
_NIGHTFALL_BODY = """
<style>
#wai-fs-btn {
  position: fixed; top: 12px; right: 12px; z-index: 99999;
  background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
  color: rgba(255,255,255,0.8); font-size: 17px; width: 36px; height: 36px;
  border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
body.wai-fs { overflow: hidden; }
</style>
<button id="wai-fs-btn" onclick="waiFsToggle()" title="Fullscreen">⛶</button>
<script>
// Prevent pinch-zoom and double-tap zoom
(function() {
  var vp = document.querySelector('meta[name=viewport]');
  if (vp) vp.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no');
  var _lastTap = 0;
  document.addEventListener('touchend', function(e) {
    var now = Date.now();
    if (now - _lastTap < 300) e.preventDefault();
    _lastTap = now;
  }, { passive: false });
  document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
})();

// Re-unlock AudioContext when app is foregrounded (iOS suspends on background)
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    var AC = window._waiOrigAC || window.AudioContext || window.webkitAudioContext;
    if (window._waiAudioContexts) {
      window._waiAudioContexts.forEach(function(ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(function(){});
      });
    }
  }
});

var _waiFs = false;

// The game sizes everything via --v-pct (100vh-based) and --h-pct (100vw-based)
// on .container. Viewport units ignore CSS transforms, so we must override them
// to use swapped axes when rotating portrait→landscape.
var _FS_PORTRAIT_VARS = [
  '--h-pct:calc((100vh - env(safe-area-inset-top,2em)*2)/100)',
  '--v-pct:calc((100vw - env(safe-area-inset-left,2em)*2)/100*1.5)'
].join(';');

var _isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

function _applyFsLayout() {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  if (_isMobile && vh > vw) {
    // Portrait mobile: rotate body so landscape content fills the screen.
    document.documentElement.style.cssText = 'width:100vw;height:100vh;overflow:hidden;';
    document.body.style.cssText = 'margin:0;position:absolute;width:' + vh + 'px;height:' + vw + 'px;transform-origin:0 0;transform:rotate(90deg) translate(0,-' + vw + 'px);overflow:hidden;background:#222;';
    var s = document.getElementById('wai-fs-vars');
    if (!s) { s = document.createElement('style'); s.id = 'wai-fs-vars'; document.head.appendChild(s); }
    s.textContent = '.container{' + _FS_PORTRAIT_VARS + '!important}';
  } else {
    document.documentElement.style.cssText = 'overflow:hidden;';
    document.body.style.cssText = 'margin:0;width:100%;height:100%;overflow:hidden;';
    var root = document.getElementById('root');
    if (root) root.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998;';
    // Remove the 10px --pct cap so the game scales up to fill the viewport.
    var s = document.getElementById('wai-fs-vars');
    if (!s) { s = document.createElement('style'); s.id = 'wai-fs-vars'; document.head.appendChild(s); }
    s.textContent = '.container{--pct:var(--pct-raw)!important}';
  }
}

function _clearFsLayout() {
  document.documentElement.style.cssText = '';
  document.body.style.cssText = '';
  var root = document.getElementById('root');
  if (root) root.style.cssText = '';
  var s = document.getElementById('wai-fs-vars');
  if (s) s.remove();
}

function waiFsToggle() {
  _waiFs = !_waiFs;
  document.body.classList.toggle('wai-fs', _waiFs);
  document.getElementById('wai-fs-btn').textContent = _waiFs ? '✕' : '⛶';
  if (_waiFs) {
    try { var el = document.documentElement;
      if (el.requestFullscreen)            el.requestFullscreen().catch(function(){});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch(e) {}
    try {
      if (screen.orientation && screen.orientation.lock)
        screen.orientation.lock('landscape').catch(function(){});
    } catch(e) {}
    _applyFsLayout();
  } else {
    try {
      if (document.exitFullscreen)            document.exitFullscreen().catch(function(){});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch(e) {}
    _clearFsLayout();
  }
}

window.addEventListener('resize', function() { if (_waiFs) _applyFsLayout(); });
</script>
"""

@public.get("/nightfall", response_class=HTMLResponse)
async def nightfall():
    html = Path("/app/nightfall/index.html").read_text()
    # Extract chunk script tags so we can defer them until after IDB restore
    chunk_srcs = re.findall(r'<script src="(\./static/js/[^"]+\.js)"></script>', html)
    for src in chunk_srcs:
        html = html.replace(f'<script src="{src}"></script>', '', 1)
    abs_srcs = [s.replace('./', '/nightfall-game/', 1) for s in chunk_srcs]
    save_script = _NIGHTFALL_SAVE_SCRIPT.replace('__SCRIPTS__', json.dumps(abs_srcs))
    html = html.replace("<head>", '<head><base href="/nightfall-game/"><link rel="icon" href="/nightfall-game/hack.png">' + _NIGHTFALL_HEAD, 1)
    html = html.replace("</body>", _NIGHTFALL_BODY + save_script + "</body>", 1)
    return HTMLResponse(html)


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
    return (_BARE
        .replace("</head>", _GREEN_OVERLAY + "</head>", 1)
        .replace("</body>", _EXEC_HTML + _build_nav(None) + "</body>", 1))


@protected.get("/plan", response_class=HTMLResponse)
async def plan_page():
    return _build_page("plan", _PLAN_HTML)


@protected.get("/directives")
async def directives_page():
    return RedirectResponse(url="/exec", status_code=302)


@protected.get("/omens")
async def omens_page():
    return RedirectResponse(url="/exec", status_code=302)


@protected.get("/rd", response_class=HTMLResponse)
async def rd_page():
    head_inject = _GREEN_OVERLAY + "<style>body{display:block;height:100vh;overflow:hidden!important;}</style>"
    return (_BARE
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", _KANBAN_HTML + _build_nav("看板") + "</body>", 1))


@protected.get("/archive", response_class=HTMLResponse)
async def archive_page():
    return _build_page("vault", _VAULT_HTML)


# ── data file serving ─────────────────────────────────────────────────────────

@protected.get("/data/{filename:path}")
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


async def _stream_tool_followup(client, all_messages: list, tools: list, system: str):
    """Stream the follow-up assistant turn after tool results. Yields SSE lines, returns final text."""
    cont_text = ""
    try:
        async with client.messages.stream(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=system,
            tools=tools,
            messages=all_messages,
        ) as stream2:
            async for text in stream2.text_stream:
                cont_text += text
                yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
            await stream2.get_final_message()
    except Exception:
        pass
    if cont_text:
        all_messages.append({"role": "assistant", "content": [{"type": "text", "text": cont_text}]})


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
                model="claude-haiku-4-5-20251001",
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

        assistant_content = [
            {"type": "text", "text": b.text} if b.type == "text"
            else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
            for b in final.content if b.type in ("text", "tool_use")
        ]
        all_messages = messages + [{"role": "assistant", "content": assistant_content}]
        tool_result_contents = []

        for block in final.content:
            if block.type != "tool_use":
                continue
            result = await asyncio.to_thread(pipeline._handle_tool, block.name, block.input)
            if block.name == "finalize_and_push":
                next_stage = "done"
            yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'result': result})}\n\n"
            tool_result_contents.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})

        if tool_result_contents:
            all_messages.append({"role": "user", "content": tool_result_contents})
            async for chunk in _stream_tool_followup(client, all_messages, tools, pipeline._build_chat_system_prompt(next_stage)):
                yield chunk

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


_PNG_CACHE = DATA_DIR / "cache"


@protected.get("/api/archive/{filename}/page/{page_num}")
def archive_page_png(filename: str, page_num: int):
    from fastapi.responses import Response
    from rm_to_pdf import rasterize
    p = (DATA_DIR / filename).resolve()
    if not str(p).startswith(str(DATA_DIR.resolve())) or not p.exists():
        raise HTTPException(status_code=404, detail="not found")
    if filename.endswith(".png"):
        return Response(content=p.read_bytes(), media_type="image/png")
    if not filename.endswith(".rmdoc"):
        raise HTTPException(status_code=404, detail="not found")
    _PNG_CACHE.mkdir(exist_ok=True)
    cache_file = _PNG_CACHE / f"{filename}.page{page_num}.png"
    if cache_file.exists():
        return Response(content=cache_file.read_bytes(), media_type="image/png")
    png_bytes = rasterize(str(p), page_index=page_num)
    cache_file.write_bytes(png_bytes)
    return Response(content=png_bytes, media_type="image/png")


@protected.get("/api/cache")
def api_cache():
    """List pre-rendered PNGs in the cache folder, grouped by source doc, newest first."""
    cache_dir = _PNG_CACHE
    if not cache_dir.exists():
        return []
    from collections import defaultdict
    import re as _re
    groups = defaultdict(list)
    for f in sorted(cache_dir.glob("*.png"), reverse=True):
        m = _re.match(r'^(.+\.rmdoc)\.page(\d+)\.png$', f.name)
        if m:
            groups[m.group(1)].append((int(m.group(2)), f.name))
    result = []
    for doc, pages in sorted(groups.items(), reverse=True):
        pages.sort()
        result.append({
            "doc": doc,
            "label": doc.replace(".rmdoc", ""),
            "pages": [f"/data/cache/{name}" for _, name in pages],
        })
    return result


@protected.get("/api/rd")
def api_rd():
    p = DATA_DIR / "rd.json"
    return json.loads(p.read_text()) if p.exists() else {"columns": ["rd","hq","archives","exile"], "cards": []}


@protected.patch("/api/rd")
async def api_rd_patch(request: Request):
    body = await request.json()
    p = DATA_DIR / "rd.json"
    data = json.loads(p.read_text()) if p.exists() else {"columns": ["rd","hq","archives","exile"]}
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
    d = pipeline._load_all_recent_deltas()
    if not d:
        raise HTTPException(status_code=404, detail="No delta yet")
    return d


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


@protected.get("/api/plan")
def api_plan_get():
    p = DATA_DIR / "plan.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No plan yet")
    return json.loads(p.read_text())


@protected.post("/api/push")
def api_push():
    try:
        return {"pdf": pipeline.push_pdf()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/assemble_plan")
def api_assemble_plan():
    try:
        p = DATA_DIR / "directives.json"
        d = json.loads(p.read_text()) if p.exists() else {}
        seek_ids = [c["id"] for c in d.get("seek", []) if isinstance(c, dict)]
        hack_ids = [c["id"] for c in d.get("hack", []) if isinstance(c, dict)]
        dive_ids = [c["id"] for c in d.get("dive", []) if isinstance(c, dict)]
        result = pipeline._handle_tool("assemble_plan", {
            "seek_ids": seek_ids, "hack_ids": hack_ids, "dive_ids": dive_ids,
        })
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/build_pdf")
def api_build_pdf():
    try:
        return pipeline._handle_tool("build_pdf", {})
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


_VALID_SAVE_SLOTS = {"save1", "save2", "save3"}


@protected.get("/api/gamesave")
def api_gamesave_all():
    result = {}
    for slot in ["save1", "save2", "save3"]:
        p = DATA_DIR / f"gamesave_{slot}.json"
        result[slot] = p.read_text() if p.exists() else None
    return result


@protected.get("/api/gamesave/{slot}")
def api_gamesave_get(slot: str):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    p = DATA_DIR / f"gamesave_{slot}.json"
    return {"save": p.read_text() if p.exists() else None}


@protected.post("/api/gamesave/{slot}")
async def api_gamesave_post(slot: str, request: Request):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    body = await request.json()
    save_str = body.get("save")
    if not isinstance(save_str, str):
        raise HTTPException(status_code=400, detail="save must be a string")
    try:
        json.loads(save_str)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="save is not valid JSON")
    (DATA_DIR / f"gamesave_{slot}.json").write_text(save_str)
    return {"ok": True}


@protected.delete("/api/gamesave/{slot}")
def api_gamesave_delete(slot: str):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    p = DATA_DIR / f"gamesave_{slot}.json"
    if p.exists():
        p.unlink()
    return {"ok": True}


app.include_router(public)
app.include_router(protected)
app.mount("/nightfall-game", StaticFiles(directory="/app/nightfall"), name="nightfall")
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
