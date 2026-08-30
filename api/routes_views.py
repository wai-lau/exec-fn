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
    _CHROME_LINK, _FONT_PRELOAD, _STATIC_INDEX, _APPLE_WEBAPP_META, _CRT_FX,
    _NAV_HREFS, _NAV_ICONS, _NAV_LABELS,
)
from helpers import DATA_DIR
from auth import SESSION_TOKEN, GUEST_SESSION_TOKEN, TURNSTILE_SITE_KEY, API_KEY, verify_turnstile
from routes_nightfall import build_nightfall_html
from security import render_security, load_security_data


# ── public: landing + auth ──────────────────────────────────────────────────

_GUEST_NEXT_ALLOWED = {"/mtg", "/tarot", "/nightfall", "/hosaka", "/graph", "/UI", "/security", "/printer"}


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


_LANDING_LINK = '<link rel="stylesheet" href="/landing.css?v=13">'

# Landing nav icons ordered by icon hue: recruiter 36° (Sentinel orange "file"
# tile) -> hosaka 50° (amber radar) -> graph 171° (teal) -> nightfall 194°
# (cyan) -> printer 206° (blue bitman tile) -> ui 226° (blue) -> mtg 261°
# (purple) -> tarot 351° (pink).
_LANDING_HUE_ORDER = ["recruiter", "hosaka", "graph", "nightfall", "printer", "ui", "mtg", "tarot"]

# Gibson-register one-liners shown to the right of each landing link — clipped,
# noir, second-person where it lands. One per _LANDING_HUE_ORDER section.
_LANDING_BLURBS = {
    "hosaka": "Feed the Hosaka your words. It answers in a voice that was never yours.",
    "printer": "A machine on a home LAN, extruding. Watch the layers stack, touch nothing.",
    "graph": "The whole machine as constellation. Every node a live nerve.",
    "nightfall": "Flash games died, but this one lives. Night falls on the net.",
    "ui": "The console's own spectrum, stripped to raw hue and signal.",
    "mtg": "A wizard wired to the stack. It rules, and it never sleeps.",
    "tarot": "Seventy-eight gates, a green terminal, the reader is waiting for you to begin.",
    "recruiter": "Wai's credentials for the headhunters.",
}

# Reference-desk descriptions under each Gibson line — neutral, cataloguing
# register, the plain factual counterpart to the noir blurb.
_LANDING_DESCS = {
    "hosaka": "A text-to-speech studio: type text, pick a synthetic voice, and stream the spoken audio.",
    "printer": "A live read-only view of a 3D printer: camera feed and current job state. Viewers cannot control it.",
    "graph": "An interactive map of this site's codebase: files and functions as nodes, their references as edges.",
    "nightfall": "A browser-based infiltration game: breach networked nodes, manage detection, and clear each site.",
    "ui": "A read-only reference of the site's UI design system: colour palette and structural scale tokens with their usage.",
    "mtg": "A rules assistant for Magic: The Gathering, answering interaction and timing questions from the comprehensive rules.",
    "tarot": "An interactive three-card tarot reading: choose a significator, deal the spread, and interpret each position.",
    "recruiter": "A résumé page for recruiters: background, skills, and a downloadable PDF.",
}
_RECRUITER_LINK = '<link rel="stylesheet" href="/recruiter.css?v=21">'

# preload the two Latin-subset woff2 weights so they download in parallel with
# the CSS instead of after it (font fetch is otherwise gated on CSS parse). Both
# ~60KB; crossorigin required for the preload to match the @font-face fetch.
_RECRUITER_FONT_PRELOAD = (
    '<link rel="preload" href="/fonts/iosevka-cv-500.woff2?v=1" as="font" type="font/woff2" crossorigin>'
    '<link rel="preload" href="/fonts/iosevka-cv-700.woff2?v=1" as="font" type="font/woff2" crossorigin>'
)

# ✦ favicon for /recruiter — an inline SVG data URI (green), replacing the
# site's default favicon.png on this page only.
_RECRUITER_FAVICON = (
    '<link rel="icon" href="data:image/svg+xml,'
    "%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E"
    "%3Ctext%20x='8'%20y='13'%20font-size='15'%20text-anchor='middle'%20fill='%2322a559'%3E"
    '%E2%9C%A6%3C/text%3E%3C/svg%3E">'
)


def _landing_html() -> str:
    """Public landing page: non-admin sections only, as a centered vertical
    column of icons, with cyberpunk CRT/scan/neon animations."""
    _, bare = _index_pages()
    links = []
    for label in _LANDING_HUE_ORDER:
        href = _NAV_HREFS.get(label, f"/{label}")
        icon = _NAV_ICONS.get(label, label)
        # landing spells out "nightfall" in full; bottom nav shows "12AM"
        text = "nightfall" if label == "nightfall" else _NAV_LABELS.get(label, label.lower())
        blurb = _LANDING_BLURBS.get(label, "")
        desc = _LANDING_DESCS.get(label, "")
        links.append(
            f'<a href="{href}">'
            f'<span class="landing-link">{icon}<span class="nav-label">{text}</span></span>'
            f'<span class="landing-copy">'
            f'<span class="landing-blurb">{blurb}</span>'
            f'<span class="landing-sub">{desc}</span>'
            f'</span>'
            f'</a>'
        )
    nav = '<div class="exec-nav landing-nav">' + "".join(links) + "</div>"
    admin = '<a href="/login" class="landing-admin">admin</a>'
    page = bare.replace("</head>", _FONT_PRELOAD + _CHROME_LINK + _LANDING_LINK + "</head>", 1)
    return page.replace("</body>", _CRT_FX + nav + admin + "</body>", 1)


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
    page = page.replace('<link rel="icon" type="image/png" href="favicon.png?v=3">',
                        _RECRUITER_FAVICON, 1)
    page = page.replace("</head>",
                        _RECRUITER_FONT_PRELOAD + _CHROME_LINK + _RECRUITER_LINK + "</head>", 1)
    body = _tmpl("recruiter.html") + '<script src="/recruiter.js?v=17"></script>'
    return page.replace("</body>", body + "</body>", 1)


@public.get("/login")
async def login_page(request: Request, next: str = ""):
    """Admin login screen. Already-authed visitors skip it and land on their
    redirect target (`?next=`) or `/rd`; everyone else gets the form."""
    if request.cookies.get("session") == SESSION_TOKEN:
        return RedirectResponse(url=_safe_local_path(next, "/rd"), status_code=302)
    # chrome.css (top of head, so its tokens still lose the cascade to the page's
    # own styles) + _APPLE_WEBAPP_META (manifest link, same as every other page)
    # injected directly -- this route reads the raw static file (needs the real
    # login form, which _index_pages() strips), so it can't reuse that helper.
    raw = _STATIC_INDEX.read_text().replace('<meta charset="UTF-8">', '<meta charset="UTF-8">' + _CHROME_LINK, 1)
    return HTMLResponse(raw.replace("</head>", _APPLE_WEBAPP_META + "</head>", 1))


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
    page = bare.replace("</head>", _FONT_PRELOAD + _CHROME_LINK + "</head>", 1)
    body_insert = _tmpl("guest_login.html").replace("{next}", html.escape(next_safe, quote=True)).replace("{site_key}", html.escape(TURNSTILE_SITE_KEY, quote=True))
    return page.replace("</body>", body_insert + "</body>", 1)


@public.post("/guest")
async def guest_login(request: Request):
    form = await request.form()
    token = form.get("cf-turnstile-response", "")
    next_path = _safe_next(form.get("next", "/mtg"))
    if not await verify_turnstile(token, request.headers.get("cf-connecting-ip")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Turnstile verification failed")
    resp = RedirectResponse(url=next_path, status_code=303)
    resp.set_cookie("guest_session", GUEST_SESSION_TOKEN, httponly=True, samesite="lax", secure=True)
    return resp


@public.get("/guest-login")
async def guest_login_alias(next: str = "/mtg"):
    """Bookmark-safe alias for the renamed /guest route."""
    return RedirectResponse(url=f"/guest?next={quote(_safe_next(next), safe='')}", status_code=302)


# ── pages ───────────────────────────────────────────────────────────────────


@protected.get("/hq", response_class=HTMLResponse)
async def hq_page():
    return _render_page("hq", _tmpl("hq.html"), full_height=True)


@protected.get("/debug", response_class=HTMLResponse)
async def debug_page():
    return _render_page("debug", _tmpl("debug.html"))


@guest_protected.get("/UI", response_class=HTMLResponse)
async def ui_page(request: Request):
    """Read-only palette + scale moodboard — renders chrome.css :root tokens.
    Guest-gated (Turnstile): exposes only the palette, no data. Admin cookie
    gets the full nav; everyone else the guest nav. (Route case-sensitive: `/UI`.)"""
    guest = request.cookies.get("session") != SESSION_TOKEN
    return _render_page("ui", _tmpl("ui.html"), guest=guest)


@public.get("/api/ui/usage")
async def ui_usage():
    """var(--X) occurrence counts + actually-used alphas per -hsl token +
    usage sites (per-(token, alpha) for -hsl colours; per-token under a flat
    "*" bucket for scale tokens), across templates + web assets, for the
    /UI moodboard. Definitions (`--x:`) don't match, so chrome.css only
    contributes its own genuine usages. Bare hsl(var(--X-hsl)) counts as
    alpha 1. Public: token names + derived site labels only."""
    paths = [
        *Path("/app/templates").glob("*.html"),
        *Path("/app/static").glob("*.html"),
        *Path("/app/static").glob("*.css"),
        *Path("/app/static").glob("*.js"),
        # all api modules — several ship inline CSS (security.py alone ~56 tokens)
        # that would otherwise misflag used tokens (e.g. --fs-2xl) as "unused" on
        # /UI. The count regex wants a literal `var(` so this file's own escaped
        # `var\(` regex source never self-matches.
        *Path("/app").glob("*.py"),
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
        for m in re.finditer(r"var\(--([\w-]+)", text):
            name = m.group(1)
            counts[name] = counts.get(name, 0) + 1
            # non-hsl (scale) tokens: record usage sites under a flat "*" bucket
            # so /UI can list WHERE each scale token is used, like the colour
            # tables. -hsl tokens get their alpha-keyed sites in the loop below.
            if not name.endswith("-hsl"):
                label = site_label(text, m.start(), p.name)
                bucket = sites.setdefault(name, {}).setdefault("*", {})
                bucket[label] = bucket.get(label, 0) + 1
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


@protected.get("/rd", response_class=HTMLResponse)
async def rd_page():
    return _render_page("rd", _tmpl("rd.html"), full_height=True)


@guest_protected.get("/security", response_class=HTMLResponse)
async def security_page(request: Request):
    # Guest-gated (Turnstile). Rendered from data/security.json, refreshed out-of-band
    # by the host cron (scripts/security/refresh.py, reads /var/log as root); carries
    # NO owner-identifying data. Non-owners get the guest nav.
    guest = request.cookies.get("session") != SESSION_TOKEN
    return _render_page("security", render_security(load_security_data()), guest=guest)


@guest_protected.get("/mtg", response_class=HTMLResponse)
async def mtg_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    return _render_page("mtg", _tmpl("mtg.html"), guest=not is_full_auth)


@guest_protected.get("/tarot", response_class=HTMLResponse)
async def tarot_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    return _render_page("tarot", _tmpl("tarot.html"), guest=not is_full_auth)


@guest_protected.get("/nightfall", response_class=HTMLResponse)
async def nightfall_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    page = build_nightfall_html()
    _nf_style = "<style>body,.App{background:#000!important;background-color:#000!important}html,body{height:100%!important;overflow:hidden!important}#root{height:calc(100% - var(--nav-h,0px))!important}.container{--v-pct:calc((100vh - var(--nav-h,0px) - env(safe-area-inset-top,2em)*2)/100*1.5)!important}</style>"
    page = page.replace("</head>", _CHROME_LINK + _nf_style + "</head>", 1)
    _nf_script = (
        "<script>"
        # Prevent Escape from exiting native fullscreen — game handles Escape itself
        "document.addEventListener('keydown',function(e){if(e.key==='Escape'&&_waiFs)e.preventDefault();},true);"
        # Sync _waiFs state if fullscreen exits via browser UI (not Escape)
        "document.addEventListener('fullscreenchange',function(){"
        "if(!document.fullscreenElement&&_waiFs){_waiFs=false;document.body.classList.remove('wai-fs');"
        "var btn=document.getElementById('wai-fs-btn');if(btn)btn.textContent='⛶';_clearFsLayout();}});"
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

    def entries(p: Path) -> list:
        # A truncated/corrupted log (interrupted write, non-atomic writer) must
        # not 500 the whole viewer -- skip that one file, like api_tarot_readings.
        try:
            return json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            return []

    files = [{"name": "today", "entries": entries(_log_path) if _log_path.exists() else []}]
    # archived logs, newest first
    for path in sorted(glob.glob(str(DATA_DIR / "activity_log_[0-9]*.json")), reverse=True):
        files.append({"name": Path(path).stem.replace("activity_log_", ""), "entries": entries(Path(path))})
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


@protected.get("/api/mtg/log")
def api_mtg_log():
    """Every MTG session transcript, for the owner-only /debug viewer.

    Owner-only (`protected`, NOT the guest mtg_router): the store is shared
    across auth tiers and holds Wai's own /mtg chats, and it returns ALL
    sessions with no per-caller scoping — a guest must never read it. Mirrors
    /api/tarot/readings. Route intentionally lives here, not in mtg/routes.py."""
    sessions_dir = DATA_DIR / "mtg_sessions"
    if not sessions_dir.exists():
        return {"sessions": []}
    sessions = []
    for path in sorted(sessions_dir.glob("*.json"), reverse=True):
        try:
            sessions.append(json.loads(path.read_text()))
        except Exception:
            pass
    return {"sessions": sessions}


# ── data file serving ───────────────────────────────────────────────────────


@protected.get("/data/{filename:path}")
async def serve_data(filename: str):
    path = (DATA_DIR / filename).resolve()
    if not str(path).startswith(str(DATA_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))
