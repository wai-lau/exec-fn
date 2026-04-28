import re
import json
import secrets
from pathlib import Path
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse

from pipeline import build_morning
from rm import pull_rmdocs, push_pdf, list_archive
from gcal import gcal_start_auth, gcal_complete_auth, fetch_omens
from delta import _load_all_recent_deltas, analyze_delta
from chat import classify_card, parse_date_natural
from chat_tools import _handle_tool
from helpers import get_rd_log, DATA_DIR, _load_json, _append_rd_log
from routes_nightfall import public_router as nightfall_public, protected_router as nightfall_protected
from routes_chat import router as chat_router
from mtg.routes import router as mtg_router
from auth import (
    SESSION_TOKEN, GUEST_SESSION_TOKEN, GUEST_KEY,
    require_auth, require_guest_auth, API_KEY,
)

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

_NAV_LINKS = ["exec", "plan", "看板", "vault", "媁", "mtg"]
_NAV_HREFS = {"exec": "/exec", "plan": "/plan", "看板": "/rd", "vault": "/archive", "媁": "/nightfall", "mtg": "/mtg"}


def _build_nav(active=None):
    links = []
    for label in _NAV_LINKS:
        href = _NAV_HREFS.get(label, f"/{label}")
        style = ' style="opacity:1;border-bottom-color:rgba(0,255,65,0.9);"' if label == active else ""
        links.append(f'<a href="{href}"{style}>{label}</a>')
    return '<div class="exec-nav">' + " &nbsp; ".join(links) + "</div>"


_INDEX = Path("/app/static/index.html").read_text()

_NO_FORM = re.sub(r'<form class="login-box".*?</form>', '', _INDEX, flags=re.DOTALL)
_BARE = re.sub(r'<div class="bg-wide">.*?</div>', '', _NO_FORM, flags=re.DOTALL)
_BARE = re.sub(r'<div class="bg-tall">.*?</div>', '', _BARE, flags=re.DOTALL)
_BARE = re.sub(r'<a href="[^"]*" target="_blank">.*?</a>', '', _BARE, flags=re.DOTALL)

_GUEST_LOGIN_HTML = """
<style>
body { display:flex; align-items:center; justify-content:center; height:100vh; }
.login-box {
  position:relative; z-index:2;
  background:rgba(0,0,0,0.55); backdrop-filter:blur(6px);
  border:1px solid rgba(0,255,65,0.15);
  padding:24px 28px; display:flex; flex-direction:column; gap:14px;
}
.login-box label { font-family:monospace; font-size:0.8rem; color:rgba(0,255,65,0.55); }
.login-box input[type=password] {
  background:transparent; border:none;
  border-bottom:1px solid rgba(0,255,65,0.3);
  color:rgba(0,255,65,0.9); font-family:monospace; font-size:0.95rem;
  padding:4px 2px; outline:none; width:200px;
}
.login-box input[type=password]:focus { border-bottom-color:rgba(0,255,65,0.8); }
.login-box button {
  background:none; border:1px solid rgba(0,255,65,0.4);
  color:rgba(0,255,65,0.85); font-family:monospace; font-size:0.85rem;
  padding:6px 16px; cursor:pointer; transition:all 0.2s; align-self:flex-start;
}
.login-box button:hover { border-color:rgba(0,255,65,1); color:rgba(0,255,65,1); }
</style>
<form class="login-box" method="post" action="/guest-login">
  <input type="hidden" name="next" value="{next}">
  <label>password</label>
  <input type="password" name="key" autofocus>
  <button type="submit">enter</button>
</form>
"""


def _build_page(active=None, content=""):
    base = _BARE if active else _NO_FORM
    head_inject = _GREEN_OVERLAY + (_CONTENT_STYLE if content else "")
    return (base
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", content + _build_nav(active) + "</body>", 1))


# ── templates ─────────────────────────────────────────────────────────────────

_VAULT_HTML  = (_TMPL / "vault.html").read_text()
_KANBAN_HTML = (_TMPL / "kanban.html").read_text()
_PLAN_HTML   = (_TMPL / "plan.html").read_text()
_EXEC_HTML   = (_TMPL / "exec.html").read_text()
_MTG_HTML    = (_TMPL / "mtg.html").read_text()


# ── app ───────────────────────────────────────────────────────────────────────

app = FastAPI()


@app.exception_handler(401)
async def unauthorized_handler(request: Request, exc: HTTPException):
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        next_path = request.url.path
        return RedirectResponse(f"/guest-login?next={next_path}", status_code=302)
    return JSONResponse({"detail": "Unauthorized"}, status_code=401)


public = APIRouter()
protected = APIRouter(dependencies=[Depends(require_auth)])
guest_protected = APIRouter(dependencies=[Depends(require_guest_auth)])


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


@public.get("/guest-login", response_class=HTMLResponse)
async def guest_login_page(next: str = "/mtg"):
    html = _BARE.replace("</head>", _GREEN_OVERLAY + "</head>", 1)
    html = html.replace("</body>", _GUEST_LOGIN_HTML.replace("{next}", next) + "</body>", 1)
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


@guest_protected.get("/mtg", response_class=HTMLResponse)
async def mtg_page():
    return (_BARE
        .replace("</head>", _GREEN_OVERLAY + "</head>", 1)
        .replace("</body>", _MTG_HTML + _build_nav("mtg") + "</body>", 1))


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
        return {"file": Path(pull_rmdocs()).name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@protected.post("/api/morning")
def api_morning():
    try:
        return build_morning()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/archive")
def api_archive():
    return list_archive()


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
    return _load_json("rd", {"columns": ["rd","hq","archives","exile"], "cards": []})


@protected.patch("/api/rd")
async def api_rd_patch(request: Request):
    body = await request.json()
    p = DATA_DIR / "rd.json"
    data = _load_json("rd", {"columns": ["rd","hq","archives","exile"]})
    old_cards = {c["id"]: c for c in data.get("cards", [])}
    new_cards = body.get("cards", [])
    for c in new_cards:
        cid = c.get("id")
        old = old_cards.get(cid)
        if old is None:
            _append_rd_log("created", c.get("title", cid), column=c.get("column"))
        elif old.get("column") != c.get("column"):
            _append_rd_log("moved", c.get("title", cid), from_col=old["column"], to_col=c["column"])
        elif old.get("notes") != c.get("notes") or old.get("title") != c.get("title"):
            _append_rd_log("updated", c.get("title", cid))
    new_ids = {c["id"] for c in new_cards}
    for cid, old in old_cards.items():
        if cid not in new_ids:
            _append_rd_log("deleted", old.get("title", cid))
    data["cards"] = new_cards
    p.write_text(json.dumps(data, indent=2))
    return {"ok": True}


@protected.get("/api/rd/log")
def api_rd_log():
    return get_rd_log(limit=20)


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


@protected.get("/api/delta")
def api_delta_get():
    d = _load_all_recent_deltas()
    if not d:
        raise HTTPException(status_code=404, detail="No delta yet")
    return d


@protected.post("/api/delta")
def api_delta_run():
    try:
        return analyze_delta()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@protected.post("/api/push")
def api_push():
    try:
        return {"pdf": push_pdf()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@protected.post("/api/build_pdf")
def api_build_pdf():
    try:
        return _handle_tool("build_pdf", {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/omens")
def api_omens_get():
    from datetime import datetime as _dt, timezone as _tz
    p = DATA_DIR / "omens.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No omens yet")
    data = _load_json("omens")
    now = _dt.now(_tz.utc)
    def _is_future(e: dict) -> bool:
        start = e.get("start", "")
        if not start:
            return True
        try:
            s = _dt.fromisoformat(start.replace("Z", "+00:00"))
            if s.tzinfo is None:
                s = s.replace(tzinfo=_tz.utc)
            return s >= now
        except Exception:
            return True
    data["events"] = [e for e in data.get("events", []) if _is_future(e)]
    return data


@protected.post("/api/omens")
def api_omens_run():
    try:
        return fetch_omens()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/gcal/auth")
def api_gcal_auth():
    try:
        auth_url = gcal_start_auth()
        return RedirectResponse(auth_url)
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
        return {"iso": None, "start_before": None}
    size = data.get("size")
    estimated_minutes = data.get("estimated_minutes")
    iso, start_before = parse_date_natural(text, size=size, estimated_minutes=estimated_minutes)
    return {"iso": iso, "start_before": start_before}


app.include_router(public)
app.include_router(protected)
app.include_router(guest_protected)
app.include_router(nightfall_public, dependencies=[Depends(require_guest_auth)])
app.include_router(nightfall_protected, dependencies=[Depends(require_guest_auth)])
app.include_router(chat_router, dependencies=[Depends(require_auth)])
app.include_router(mtg_router, dependencies=[Depends(require_guest_auth)])
app.mount("/nightfall-game", StaticFiles(directory="/app/nightfall"), name="nightfall")
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
