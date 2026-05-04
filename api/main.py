import re
import json
import copy
import time
import glob
import asyncio
import secrets
from pathlib import Path
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse, StreamingResponse

from pipeline import build_morning
from gcal import gcal_start_auth, gcal_complete_auth
from chat import classify_card, parse_date_natural
from chat_tools import _handle_tool
from helpers import get_rd_log, DATA_DIR, _load_json, _append_rd_log_batch, _next_recurrence, _now_et
from routes_nightfall import protected_router as nightfall_protected, build_nightfall_html
from routes_chat import router as chat_router
from mtg.routes import router as mtg_router
from monitor import generate_encouragement, _recent_entries, _is_commentable
from chat import append_monitor_comment
from auth import (
    SESSION_TOKEN, GUEST_SESSION_TOKEN, GUEST_KEY,
    require_auth, require_guest_auth, API_KEY,
)

# ── monitor state ─────────────────────────────────────────────────────────────

_monitor_task: asyncio.Task | None = None
_monitor_last_comment_ts: float = 0.0
_monitor_subscribers: list[asyncio.Queue] = []

_SIGNIFICANT_TO_COLS = {"archives", "exile"}


def _entry_is_significant(e: dict) -> bool:
    if e.get("is_reminder"):
        return False
    action = e.get("action", "")
    if action == "moved" and e.get("to_col") in _SIGNIFICANT_TO_COLS:
        return True
    if action == "updated" and e.get("size") == "book":
        return True
    return False


def _schedule_monitor() -> None:
    """Trailing debounce: each call resets the 60s timer."""
    global _monitor_task
    if _monitor_task and not _monitor_task.done():
        _monitor_task.cancel()
    _monitor_task = asyncio.create_task(_run_monitor())


async def _run_monitor(delay: float = 60.0) -> None:
    global _monitor_last_comment_ts
    try:
        await asyncio.sleep(delay)
    except asyncio.CancelledError:
        return
    try:
        if not any(_is_commentable(e) for e in _recent_entries(_monitor_last_comment_ts)):
            return
        for q in list(_monitor_subscribers):
            await q.put({"thinking": True})
        comment = await generate_encouragement(_monitor_last_comment_ts)
        for q in list(_monitor_subscribers):
            await q.put({"thinking": False})
        if not comment:
            return
        _monitor_last_comment_ts = time.time()
        append_monitor_comment(comment)
        for q in list(_monitor_subscribers):
            await q.put({"comment": comment})
    except Exception as e:
        print(f"[monitor] error: {e}")
        for q in list(_monitor_subscribers):
            await q.put({"thinking": False})


_TMPL = Path("/app/templates")

_CHROME_LINK = '<link rel="stylesheet" href="/chrome.css">'

_NAV_CSS = _CHROME_LINK
_PAGE_CHROME = _CHROME_LINK
_CONTENT_STYLE = ""

_NAV_LINKS = ["core", "prophecies", "directives", "debug", "nightfall", "mtg"]
_NAV_HREFS = {"core": "/rd", "prophecies": "/prophecies", "directives": "/directives", "debug": "/debug", "nightfall": "/nightfall", "mtg": "/mtg"}


_GUEST_NAV_LINKS = ["nightfall", "mtg"]


_NAV_ICONS = {
    "core":        '<img src="/seeker.png" alt="core" style="width:20px;height:20px;image-rendering:pixelated;">',
    "prophecies":  '<img src="/fiddle.png" alt="prophecies" style="width:20px;height:20px;image-rendering:pixelated;">',
    "directives":  '<img src="/turbo.png" alt="directives" style="width:20px;height:20px;image-rendering:pixelated;">',
    "debug":       '<img src="/bug.png" alt="debug" style="width:20px;height:20px;image-rendering:pixelated;">',
    "nightfall":   '<img src="/hack2.png" alt="nightfall" style="width:20px;height:20px;image-rendering:pixelated;">',
    "mtg":         '<img src="/wizard.png" alt="mtg" style="width:20px;height:20px;image-rendering:pixelated;">',
}

_NAV_LABELS = {
    "core": "core", "prophecies": "profs",
    "directives": "dirs", "debug": "debug", "nightfall": "night", "mtg": "mtg",
}

def _build_nav(active=None, guest=False):
    links = []
    for label in (_GUEST_NAV_LINKS if guest else _NAV_LINKS):
        href = _NAV_HREFS.get(label, f"/{label}")
        cls = ' class="active"' if label == active else ""
        icon = _NAV_ICONS.get(label, label)
        text = _NAV_LABELS.get(label, label.lower())
        links.append(f'<a href="{href}"{cls}>{icon}<span class="nav-label">{text}</span></a>')
    nav = '<div class="exec-nav">' + "".join(links) + "</div>"
    script = (
        "<script>(function(){"
        "function _snh(){var n=document.querySelector('.exec-nav');"
        "if(n)document.documentElement.style.setProperty('--nav-h',n.offsetHeight+'px');}"
        "_snh();window.addEventListener('resize',_snh);"
        "})();</script>"
    )
    bubble = '' if guest else '<script src="/exec-bubble.js"></script>'
    return nav + script + bubble


_INDEX = Path("/app/static/index.html").read_text()

_NO_FORM = re.sub(r'<form class="login-box".*?</form>', '', _INDEX, flags=re.DOTALL)
_BARE = re.sub(r'<div class="bg-wide">.*?</div>', '', _NO_FORM, flags=re.DOTALL)
_BARE = re.sub(r'<div class="bg-tall">.*?</div>', '', _BARE, flags=re.DOTALL)
_BARE = re.sub(r'<a href="[^"]*" target="_blank">.*?</a>', '', _BARE, flags=re.DOTALL)
_BARE = re.sub(r'<style id="login-styles">.*?</style>', '', _BARE, flags=re.DOTALL)
_BARE = re.sub(r'<audio[^>]*>.*?</audio>', '', _BARE, flags=re.DOTALL)
_BARE = re.sub(r'<div class="login-wrap">.*?</div>', '', _BARE, flags=re.DOTALL)

_GUEST_LOGIN_HTML = """
<style>
body { display:flex; align-items:center; justify-content:center; height:100vh; }
.login-box {
  position:relative; z-index:2;
  background:transparent;
  padding:0; display:flex; flex-direction:column; align-items:center;
}
.login-box input[type=text] {
  background:transparent; border:none;
  border-bottom:1px solid rgba(255,255,255,0.4);
  color:#fff; font-family:'Iosevka Mayukai Monolite',monospace; font-size:0.95rem;
  padding:4px 2px; outline:none; width:160px; text-align:center;
}
.login-box input[type=text]:focus { border-bottom-color:#fff; }
.login-box input[type=text]::placeholder { color:rgba(255,255,255,0.35); }
</style>
<div style="display:flex;flex-direction:column;align-items:center;gap:24px">
  <img src="/nightfall-game/static/media/ped-logo.f0469b0a.png" style="width:160px;opacity:0.9">
  <form class="login-box" method="post" action="/guest-login">
    <input type="hidden" name="next" value="{next}">
    <input type="text" name="key" autofocus autocomplete="current-password" placeholder="access-key" enterkeyhint="go">
    <button type="submit" style="display:none"></button>
  </form>
</div>
"""


def _build_page(active=None, content=""):
    base = _BARE if active else _NO_FORM
    head_inject = _PAGE_CHROME + (_CONTENT_STYLE if content else "")
    return (base
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", content + _build_nav(active) + "</body>", 1))


# ── templates ─────────────────────────────────────────────────────────────────

_tmpl_cache: dict[str, tuple[float, str]] = {}


def _tmpl(name: str) -> str:
    path = _TMPL / name
    mtime = path.stat().st_mtime
    cached = _tmpl_cache.get(name)
    if cached and cached[0] == mtime:
        return cached[1]
    text = path.read_text()
    _tmpl_cache[name] = (mtime, text)
    return text


# ── app ───────────────────────────────────────────────────────────────────────

app = FastAPI()
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.exception_handler(401)
async def unauthorized_handler(request: Request, exc: HTTPException):
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        path = request.url.path
        if path.startswith("/mtg"):
            return RedirectResponse(f"/guest-login?next={path}", status_code=302)
        return RedirectResponse("/", status_code=302)
    return JSONResponse({"detail": "Unauthorized"}, status_code=401)


public = APIRouter()
protected = APIRouter(dependencies=[Depends(require_auth)])
guest_protected = APIRouter(dependencies=[Depends(require_guest_auth)])
protected.include_router(nightfall_protected)
protected.include_router(chat_router)
guest_protected.include_router(mtg_router)


# ── public ────────────────────────────────────────────────────────────────────

@public.post("/login")
async def login(request: Request):
    form = await request.form()
    key = form.get("key", "")
    if not secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid key")
    resp = RedirectResponse(url="/rd", status_code=303)
    resp.set_cookie("session", SESSION_TOKEN, httponly=True, samesite="lax", secure=False)
    return resp


@public.get("/guest-login", response_class=HTMLResponse)
async def guest_login_page(next: str = "/mtg"):
    html = _BARE.replace("</head>", _PAGE_CHROME + "</head>", 1)
    html = html.replace("</body>", _GUEST_LOGIN_HTML.replace("{next}", next) + '<audio src="/nightfall-game/audio/ped-intro.mp3" autoplay></audio>' + "</body>", 1)
    return html


@public.post("/guest-login")
async def guest_login(request: Request):
    form = await request.form()
    key = form.get("key", "")
    next_path = form.get("next", "/mtg")
    if not secrets.compare_digest(key, GUEST_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid key")
    resp = RedirectResponse(url=next_path, status_code=303)
    resp.set_cookie("guest_session", GUEST_SESSION_TOKEN, httponly=True, samesite="lax", secure=False)
    return resp


# ── pages ─────────────────────────────────────────────────────────────────────


@protected.get("/plan", response_class=HTMLResponse)
async def plan_page():
    return _build_page("plan", _tmpl("plan.html"))


@protected.get("/prophecies", response_class=HTMLResponse)
async def prophecies_page():
    head_inject = _PAGE_CHROME + "<style>body{display:block;height:100vh;overflow:hidden!important;}</style>"
    return (_BARE
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", _tmpl("prophecies.html") + _build_nav("prophecies") + "</body>", 1))


@protected.get("/directives", response_class=HTMLResponse)
async def directives_page():
    head_inject = _PAGE_CHROME + "<style>body{display:block;height:100vh;overflow:hidden!important;}</style>"
    return (_BARE
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", _tmpl("directives.html") + _build_nav("directives") + "</body>", 1))


@protected.get("/debug", response_class=HTMLResponse)
async def debug_page():
    return _build_page("debug", _tmpl("debug.html"))


@protected.get("/api/debug/logs")
def api_debug_logs():
    from helpers import _RD_LOG as _log_path
    files = []
    # today's log first
    today_entries = json.loads(_log_path.read_text()) if _log_path.exists() else []
    files.append({"name": "today", "entries": today_entries})
    # archived logs, newest first
    archived = sorted(glob.glob(str(DATA_DIR / "activity_log_????.json")), reverse=True)
    for path in archived:
        name = Path(path).stem.replace("activity_log_", "")
        entries = json.loads(Path(path).read_text())
        files.append({"name": name, "entries": entries})
    return {"files": files}




@protected.get("/rd", response_class=HTMLResponse)
async def rd_page():
    head_inject = _PAGE_CHROME + "<style>body{display:block;height:100vh;overflow:hidden!important;}</style>"
    return (_BARE
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", _tmpl("kanban.html") + _build_nav("core") + "</body>", 1))


@guest_protected.get("/mtg", response_class=HTMLResponse)
async def mtg_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    return (_BARE
        .replace("</head>", _PAGE_CHROME + "</head>", 1)
        .replace("</body>", _tmpl("mtg.html") + _build_nav("mtg", guest=not is_full_auth) + "</body>", 1))


@public.get("/nightfall", response_class=HTMLResponse)
async def nightfall_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    html = build_nightfall_html()
    _nf_style = "<style>body,.App{background:#000!important;background-color:#000!important}html,body{height:100%!important;overflow:hidden!important}#root{height:calc(100% - var(--nav-h,0px))!important}.container{--v-pct:calc((100vh - var(--nav-h,0px) - env(safe-area-inset-top,2em)*2)/100*1.5)!important}</style>"
    html = html.replace("</head>", _NAV_CSS + _nf_style + "</head>", 1)
    _nf_script = (
        "<script>"
        # Prevent Escape from exiting native fullscreen — game handles Escape itself
        "document.addEventListener('keydown',function(e){"
        "if(e.key==='Escape'&&_waiFs)e.preventDefault();"
        "},true);"
        # Sync _waiFs state if fullscreen exits via browser UI (not Escape)
        "document.addEventListener('fullscreenchange',function(){"
        "if(!document.fullscreenElement&&_waiFs){"
        "_waiFs=false;"
        "document.body.classList.remove('wai-fs');"
        "var btn=document.getElementById('wai-fs-btn');"
        "if(btn)btn.textContent='⛶';"
        "_clearFsLayout();"
        "}"
        "});"
        "</script>"
    )
    html = html.replace("</body>", _build_nav("nightfall", guest=not is_full_auth) + _nf_script + "</body>", 1)
    return HTMLResponse(html)


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

@protected.post("/api/morning")
def api_morning():
    try:
        return build_morning()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/rd")
def api_rd():
    return _load_json("rd", {"columns": ["rd","hq","archives","exile"], "cards": []})



def _log_entries_for_patch(new_cards, old_cards, source):
    entries = []
    for c in new_cards:
        old = old_cards.get(c.get("id"))
        if old is None:
            entries.append({"action": "created", "title": c.get("title", c.get("id")), "source": source, "column": c.get("column"), "is_reminder": c.get("is_reminder", False)})
        elif old.get("column") != c.get("column"):
            entries.append({"action": "moved", "title": c.get("title", c.get("id")), "source": source, "from_col": old["column"], "to_col": c["column"], "is_reminder": c.get("is_reminder", False)})
        elif (old.get("notes") != c.get("notes") or old.get("title") != c.get("title")
              or old.get("current_page") != c.get("current_page")):
            entry = {"action": "updated", "title": c.get("title", c.get("id")), "source": source, "size": c.get("size", "")}
            if c.get("size") == "book" and c.get("current_page") is not None:
                entry["current_page"] = c.get("current_page")
                entry["total_pages"] = c.get("total_pages")
            entries.append(entry)
    new_ids = {c["id"] for c in new_cards}
    for cid, old in old_cards.items():
        if cid not in new_ids:
            entries.append({"action": "deleted", "title": old.get("title", cid), "source": source})
    return entries


@protected.patch("/api/rd")
async def api_rd_patch(request: Request, source: str = "core"):
    body = await request.json()
    p = DATA_DIR / "rd.json"
    data = _load_json("rd", {"columns": ["rd","hq","archives","exile"]})
    old_cards = {c["id"]: c for c in data.get("cards", [])}
    new_cards = body.get("cards", [])

    # Apply side-effects that mutate new_cards in place (scheduled_day logic)
    for c in new_cards:
        old = old_cards.get(c.get("id"))
        if old and old.get("column") != c.get("column"):
            if old.get("column") == "hq" and c.get("column") != "hq":
                c["scheduled_day"] = None
            elif c.get("column") == "hq" and old.get("column") != "hq":
                c["scheduled_day"] = _now_et().strftime("%Y-%m-%d")

    log_entries = _log_entries_for_patch(new_cards, old_cards, source)

    # Recurring revival
    revived = []
    existing_titles_dates = {(c.get("title","").lower(), (c.get("due_date") or "")[:10]) for c in new_cards}
    for c in new_cards:
        old = old_cards.get(c.get("id"))
        if (old and old.get("column") != "archives" and c.get("column") == "archives"
                and c.get("recur_type")):
            next_due = _next_recurrence(c.get("due_date") or "", c["recur_type"])
            key = (c.get("title","").lower(), (next_due or "")[:10])
            if next_due and key not in existing_titles_dates:
                clone = copy.deepcopy(c)
                clone["id"] = f"card-{int(time.time() * 1000) + len(revived)}"
                clone["column"] = "rd"
                clone["due_date"] = next_due
                clone["scheduled_day"] = None
                clone["order"] = min((x.get("order", 0) for x in new_cards if x.get("column") == "rd"), default=0) - 1
                revived.append(clone)
                log_entries.append({"action": "revived", "title": c.get("title", c["id"]), "source": source, "next_due": next_due})

    data["cards"] = new_cards + revived
    p.write_text(json.dumps(data, indent=2))
    _append_rd_log_batch(log_entries)
    if any(_entry_is_significant(e) for e in log_entries):
        _schedule_monitor()
    return {"ok": True}


@protected.get("/api/rd/log")
def api_rd_log():
    return get_rd_log(limit=20)


@protected.get("/api/monitor/stream")
async def monitor_stream():
    q: asyncio.Queue = asyncio.Queue()
    _monitor_subscribers.append(q)

    async def gen():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(msg if isinstance(msg, dict) else {'comment': msg})}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            try:
                _monitor_subscribers.remove(q)
            except ValueError:
                pass

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@protected.post("/api/monitor/flush")
async def monitor_flush():
    """Fire monitor immediately if significant activity exists since last comment."""
    global _monitor_task, _monitor_batch_start
    from datetime import datetime, timezone as _tz
    cutoff = datetime.fromtimestamp(_monitor_last_comment_ts or 0, tz=_tz.utc)
    from helpers import _ACTIVITY_LOG
    log = json.loads(_ACTIVITY_LOG.read_text()) if _ACTIVITY_LOG.exists() else []
    has_new = False
    for e in log:
        try:
            ts = datetime.fromisoformat(e.get("ts", ""))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=_tz.utc)
            if ts >= cutoff and _entry_is_significant(e):
                has_new = True
                break
        except Exception:
            pass
    if not has_new:
        return {"ok": True, "fired": False}
    if _monitor_task and not _monitor_task.done():
        _monitor_task.cancel()
    else:
        _monitor_batch_start = _monitor_last_comment_ts or 0.0
    _monitor_task = asyncio.create_task(_run_monitor(delay=0))
    return {"ok": True, "fired": True}


@protected.get("/api/prophecies")
def api_prophecies_get(start: str = ""):
    from prophecies import get_week_data
    return get_week_data(start or None)


@protected.patch("/api/prophecies")
async def api_prophecies_patch(request: Request):
    body = await request.json()
    from prophecies import bulk_update_scheduled_days
    return bulk_update_scheduled_days(body.get("updates", []))


@protected.get("/api/prophecies/log")
def api_prophecies_log():
    from prophecies import get_prophecies_log
    return get_prophecies_log(limit=100)


@protected.post("/api/rd/classify")
async def api_rd_classify(request: Request):
    body = await request.json()
    title = body.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    try:
        return classify_card(title)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/profile")
def api_profile():
    return _load_json("profile", {"notes": []})


@protected.get("/api/context")
def api_context():
    return _load_json("profile", {"notes": []})


@protected.patch("/api/context")
async def api_context_patch(request: Request):
    body = await request.json()
    data = _load_json("profile", {"notes": []})
    data["notes"] = body.get("notes", data.get("notes", []))
    (DATA_DIR / "profile.json").write_text(json.dumps(data, indent=2))
    return {"ok": True}


@protected.get("/api/directives")
def api_directives_get():
    p = DATA_DIR / "directives.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No directives yet")
    return _load_json("directives")


@protected.get("/api/plan")
def api_plan_get():
    p = DATA_DIR / "plan.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No plan yet")
    return _load_json("plan")


@protected.post("/api/assemble_plan")
def api_assemble_plan():
    try:
        d = _load_json("directives", {})
        seek_ids = [c["id"] for c in d.get("seek", []) if isinstance(c, dict)]
        hack_ids = [c["id"] for c in d.get("hack", []) if isinstance(c, dict)]
        dive_ids = [c["id"] for c in d.get("dive", []) if isinstance(c, dict)]
        return _handle_tool("assemble_plan", {
            "seek_ids": seek_ids, "hack_ids": hack_ids, "dive_ids": dive_ids,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/gcal/auth")
def api_gcal_auth():
    try:
        auth_url = gcal_start_auth()
        return RedirectResponse(auth_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/gcal/import_cards")
def api_gcal_import_cards():
    try:
        from gcal import import_gcal_cards
        return import_gcal_cards()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@public.get("/api/gcal/callback")
def api_gcal_callback(code: str = "", state: str = "", error: str = ""):
    if error:
        return HTMLResponse(f"<pre>GCal auth error: {error}</pre>", status_code=400)
    try:
        gcal_complete_auth(code, state)
        return HTMLResponse("<pre>Google Calendar connected. You can close this tab.</pre>")
    except Exception as e:
        return HTMLResponse(f"<pre>Auth failed: {e}</pre>", status_code=500)


@protected.post("/api/parse_date")
async def api_parse_date(request: Request):
    data = await request.json()
    text = (data.get("text") or "").strip()
    if not text:
        return {"iso": None}
    size = data.get("size")
    estimated_minutes = data.get("estimated_minutes")
    iso = parse_date_natural(text, size=size, estimated_minutes=estimated_minutes)
    return {"iso": iso}


app.include_router(public)
app.include_router(protected)
app.include_router(guest_protected)
app.mount("/nightfall-game", StaticFiles(directory="/app/nightfall"), name="nightfall")
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
