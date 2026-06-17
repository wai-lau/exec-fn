"""HTML page routes + the read-only data GETs that back them.

Public landing/login/guest, the planning + utility pages, and the small
view-data endpoints (color usage, debug logs, tarot readings). Mutating JSON
routes live in routes_api.py."""
import re
import json
import glob
import html
import secrets
from pathlib import Path
from urllib.parse import quote

from fastapi import Request, HTTPException, status
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse

from routers import public, protected, guest_protected
from pages import (
    _render_page, _tmpl, _index_pages, _build_nav,
    _CHROME_LINK, _STATIC_INDEX,
    _GUEST_NAV_LINKS, _NAV_HREFS, _NAV_ICONS, _NAV_LABELS,
)
from helpers import DATA_DIR
from auth import SESSION_TOKEN, GUEST_SESSION_TOKEN, GUEST_KEY, API_KEY
from routes_nightfall import build_nightfall_html


# ── public: landing + auth ──────────────────────────────────────────────────

_GUEST_NEXT_ALLOWED = {"/mtg", "/tarot", "/nightfall"}


def _safe_next(value: str, default: str = "/mtg") -> str:
    """Restrict redirect targets to the known guest-accessible page set."""
    return value if value in _GUEST_NEXT_ALLOWED else default


def _safe_local_path(value: str, default: str = "/rd") -> str:
    """Same-origin redirect guard: accept only a leading-slash relative path,
    rejecting protocol-relative (`//`, `/\\`) targets that escape the origin.
    A bare `/` collapses to the default so an authed visitor can't loop back
    onto the login screen."""
    v = (value or "").strip()
    if not v.startswith("/") or v.startswith("//") or v.startswith("/\\") or v == "/":
        return default
    return v


_LANDING_LINK = '<link rel="stylesheet" href="/landing.css?v=5">'
_RECRUITER_LINK = '<link rel="stylesheet" href="/recruiter.css?v=8">'


def _landing_html() -> str:
    """Public landing page: non-admin sections only, as a centered vertical
    column of icons, with cyberpunk CRT/scan/neon animations."""
    _, bare = _index_pages()
    links = []
    for label in _GUEST_NAV_LINKS:
        href = _NAV_HREFS.get(label, f"/{label}")
        icon = _NAV_ICONS.get(label, label)
        # landing spells out "nightfall" in full; bottom nav shows "12AM"
        text = "nightfall" if label == "nightfall" else _NAV_LABELS.get(label, label.lower())
        links.append(f'<a href="{href}">{icon}<span class="nav-label">{text}</span></a>')
    nav = '<div class="exec-nav landing-nav">' + "".join(links) + "</div>"
    admin = '<a href="/login" class="landing-admin">admin</a>'
    fx = '<div class="cyber-bg"></div><div class="cyber-scan"></div>'
    page = bare.replace("</head>", _CHROME_LINK + _LANDING_LINK + "</head>", 1)
    return page.replace("</body>", fx + nav + admin + "</body>", 1)


@public.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """Public landing page (non-admin sections). Logged-in admins skip it
    and land on /rd."""
    if request.cookies.get("session") == SESSION_TOKEN:
        return RedirectResponse(url="/rd", status_code=302)
    return _landing_html()


@public.get("/recruiter", response_class=HTMLResponse)
async def recruiter_page():
    """Public, auth-free résumé page for recruiters. Clean layout on the site
    palette (chrome.css), no bottom nav / cyber fx — built from the bare shell
    like the landing page."""
    _, bare = _index_pages()
    page = bare.replace("<title>wai-lau.net</title>",
                        "<title>Wai Lau — Senior Software Engineer</title>", 1)
    page = page.replace("</head>", _CHROME_LINK + _RECRUITER_LINK + "</head>", 1)
    body = _tmpl("recruiter.html") + '<script src="/recruiter.js?v=3"></script>'
    return page.replace("</body>", body + "</body>", 1)


@public.get("/login")
async def login_page(request: Request, next: str = ""):
    """Admin login screen. Already-authed visitors skip it and land on their
    redirect target (`?next=`) or `/rd`; everyone else gets the form."""
    if request.cookies.get("session") == SESSION_TOKEN:
        return RedirectResponse(url=_safe_local_path(next, "/rd"), status_code=302)
    # chrome.css supplies the palette tokens (--pink-hsl). Injected at the TOP
    # of head so the page's own body/layout styles still win the cascade —
    # unlike _render_page, which injects at the bottom to override them.
    raw = _STATIC_INDEX.read_text()
    return HTMLResponse(raw.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">' + _CHROME_LINK, 1))


_GUEST_AUDIO_HTML = (
    '<audio id="bg-audio" src="/nightfall-game/audio/ped-intro.mp3" autoplay playsinline></audio>'
    '<script>(function(){var a=document.getElementById("bg-audio");if(!a)return;var p=a.play();'
    'if(p&&p.catch)p.catch(function(){var s=function(){a.play();'
    '["pointerdown","touchstart","keydown"].forEach(function(e){document.removeEventListener(e,s,true);});};'
    '["pointerdown","touchstart","keydown"].forEach(function(e){document.addEventListener(e,s,true);});});})();</script>'
)


@public.post("/login")
async def login(request: Request):
    form = await request.form()
    key = form.get("key", "")
    if not secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid key")
    resp = RedirectResponse(url=_safe_local_path(form.get("next", ""), "/rd"), status_code=303)
    resp.set_cookie("session", SESSION_TOKEN, httponly=True, samesite="lax", secure=True)
    return resp


@public.get("/guest", response_class=HTMLResponse)
async def guest_login_page(next: str = "/mtg"):
    next_safe = _safe_next(next)
    _, bare = _index_pages()
    page = bare.replace("</head>", _CHROME_LINK + "</head>", 1)
    body_insert = _tmpl("guest_login.html").replace("{next}", html.escape(next_safe, quote=True)) + _GUEST_AUDIO_HTML
    return page.replace("</body>", body_insert + "</body>", 1)


@public.post("/guest")
async def guest_login(request: Request):
    form = await request.form()
    key = form.get("key", "")
    next_path = _safe_next(form.get("next", "/mtg"))
    if not secrets.compare_digest(key, GUEST_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid key")
    resp = RedirectResponse(url=next_path, status_code=303)
    resp.set_cookie("guest_session", GUEST_SESSION_TOKEN, httponly=True, samesite="lax", secure=True)
    return resp


@public.get("/guest-login")
async def guest_login_alias(next: str = "/mtg"):
    """Bookmark-safe alias for the renamed /guest route."""
    return RedirectResponse(url=f"/guest?next={quote(_safe_next(next), safe='')}", status_code=302)


# ── pages ───────────────────────────────────────────────────────────────────


@protected.get("/prophecies", response_class=HTMLResponse)
async def prophecies_page():
    return _render_page("prophecies", _tmpl("prophecies.html"), full_height=True)


@protected.get("/debug", response_class=HTMLResponse)
async def debug_page():
    return _render_page("debug", _tmpl("debug.html"))


@public.get("/color", response_class=HTMLResponse)
async def color_page(request: Request):
    """Read-only palette moodboard — renders chrome.css :root tokens.
    Public: exposes only the palette, no data. Admin cookie gets the full
    nav; everyone else the guest nav."""
    guest = request.cookies.get("session") != SESSION_TOKEN
    return _render_page("color", _tmpl("color.html"), guest=guest)


@public.get("/api/color/usage")
async def color_usage():
    """var(--X) occurrence counts + actually-used alphas per -hsl token +
    per-(token, alpha) usage sites, across templates + web assets, for the
    /color moodboard. Definitions (`--x:`) don't match, so chrome.css only
    contributes its own genuine usages. Bare hsl(var(--X-hsl)) counts as
    alpha 1. Public: token names + derived site labels only."""
    paths = [
        *Path("/app/templates").glob("*.html"),
        *Path("/app/static").glob("*.html"),
        *Path("/app/static").glob("*.css"),
        *Path("/app/static").glob("*.js"),
        Path("/app/main.py"),
    ]

    def site_label(text: str, idx: int, fname: str) -> str:
        """Best-effort 'where is this used' label: the nearest enclosing CSS
        selector, else the file name."""
        ob = text.rfind("{", 0, idx)
        if ob != -1 and idx - ob < 600:
            cut = max(text.rfind("}", 0, ob), text.rfind(";", 0, ob), text.rfind(">", 0, ob))
            sel = " ".join(text[cut + 1:ob].split())
            # reject JS/template-literal contexts (e.g. `${...}` grabs a bare $)
            if sel and len(sel) <= 50 and not any(c in sel for c in "()=`\"'$"):
                return sel
        return fname

    counts: dict[str, int] = {}
    alpha_tally: dict[str, dict[float, int]] = {}
    # token -> alpha-string -> {site label: count}
    sites: dict[str, dict[str, dict[str, int]]] = {}
    for p in paths:
        try:
            text = p.read_text()
        except OSError:
            continue
        if p.name == "chrome.css":
            # drop the :root definition block — its usage-hint comments
            # would inflate counts
            text = re.sub(r":root\s*\{[^}]*\}", "", text)
        for name in re.findall(r"var\(--([\w-]+)", text):
            counts[name] = counts.get(name, 0) + 1
        for m in re.finditer(r"var\(--([\w-]+-hsl)\)(?:\s*/\s*([\d.]+))?", text):
            name = m.group(1)
            a = float(m.group(2)) if m.group(2) else 1.0
            tally = alpha_tally.setdefault(name, {})
            tally[a] = tally.get(a, 0) + 1
            key = f"{a:g}"
            label = site_label(text, m.start(), p.name)
            bucket = sites.setdefault(name, {}).setdefault(key, {})
            bucket[label] = bucket.get(label, 0) + 1
    # per-token: sorted alpha steps + a parallel list of their usage counts
    alphas = {k: sorted(v) for k, v in alpha_tally.items()}
    alpha_counts = {k: [alpha_tally[k][a] for a in steps] for k, steps in alphas.items()}
    return {"counts": counts, "alphas": alphas, "alpha_counts": alpha_counts, "sites": sites}


# /graph overlay assets live in web/ (graph-overlay.css/js) — not inline here.
# CSS = vertical-left nav + vis-network config-panel theme; JS = enable the live
# physics configurator. Injected at serve time so they survive graph.html rebuilds.
_GRAPH_OVERLAY_CSS = '<link rel="stylesheet" href="/graph-overlay.css?v=35">'
_GRAPH_OVERLAY_JS = '<script src="/graph-overlay.js?v=32"></script>'
# graphify's graph.html has no viewport meta — without it mobile renders at
# desktop width and scales everything down (tiny buttons/text).
_VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1">'


@protected.get("/graph", response_class=HTMLResponse)
async def graph_page():
    # Self-contained graphify viz from the ./graphify-out volume (regenerated by
    # /graphify). Inject chrome.css + the overlay css/js (nav restyle + live
    # physics panel) + the nav. All injected here so they survive rebuilds.
    p = Path("/app/graphify-out/graph.html")
    if not p.exists():
        return HTMLResponse(
            "<pre>graph.html not found. Run /graphify to build it.</pre>",
            status_code=404,
        )
    _fx = '<div class="cyber-bg"></div><div class="cyber-scan"></div>'
    page = p.read_text()
    # Disable vis-network's improvedLayout — the graph is too large for it to
    # position (it warns + costs perf). Patched here so it survives /graphify.
    page = page.replace(
        "{ nodes: nodesDS, edges: edgesDS }, {",
        "{ nodes: nodesDS, edges: edgesDS }, {\n  layout: { improvedLayout: false },",
        1,
    )
    page = page.replace("</head>", _VIEWPORT_META + _CHROME_LINK + _GRAPH_OVERLAY_CSS + "</head>", 1)
    page = page.replace("</body>", _fx + _build_nav("graph") + _GRAPH_OVERLAY_JS + "</body>", 1)
    return HTMLResponse(page)


@protected.get("/rd", response_class=HTMLResponse)
async def rd_page():
    return _render_page("core", _tmpl("kanban.html"), full_height=True)


@guest_protected.get("/mtg", response_class=HTMLResponse)
async def mtg_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    return _render_page("mtg", _tmpl("mtg.html"), guest=not is_full_auth)


@guest_protected.get("/tarot", response_class=HTMLResponse)
async def tarot_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    return _render_page("tarot", _tmpl("tarot.html"), guest=not is_full_auth)


@public.get("/nightfall", response_class=HTMLResponse)
async def nightfall_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    page = build_nightfall_html()
    _nf_style = "<style>body,.App{background:#000!important;background-color:#000!important}html,body{height:100%!important;overflow:hidden!important}#root{height:calc(100% - var(--nav-h,0px))!important}.container{--v-pct:calc((100vh - var(--nav-h,0px) - env(safe-area-inset-top,2em)*2)/100*1.5)!important}</style>"
    page = page.replace("</head>", _CHROME_LINK + _nf_style + "</head>", 1)
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
    page = page.replace("</body>", _build_nav("nightfall", guest=not is_full_auth) + _nf_script + "</body>", 1)
    return HTMLResponse(page)


# ── read-only view data ─────────────────────────────────────────────────────


@protected.get("/api/moltbook/heartbeat-log")
def api_moltbook_heartbeat_log():
    log_path = DATA_DIR / "moltbook-heartbeat.log"
    content = log_path.read_text() if log_path.exists() else ""
    return {"content": content}


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


@protected.get("/api/tarot/readings")
def api_tarot_readings():
    p = DATA_DIR / "tarot_readings.json"
    if not p.exists():
        return {"readings": []}
    try:
        readings = json.loads(p.read_text())
        if not isinstance(readings, list):
            readings = []
    except json.JSONDecodeError:
        readings = []
    return {"readings": readings}


# ── data file serving ───────────────────────────────────────────────────────


@protected.get("/data/{filename:path}")
async def serve_data(filename: str):
    path = (DATA_DIR / filename).resolve()
    if not str(path).startswith(str(DATA_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))
