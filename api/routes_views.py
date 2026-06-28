"""HTML page routes + the read-only data GETs that back them.

Public landing/login/guest, the planning + utility pages, and the small
view-data endpoints (color usage, debug logs, tarot readings). Mutating JSON
routes live in routes_api.py."""
import re
import json
import glob
import html
import hashlib
import secrets
from pathlib import Path
from urllib.parse import quote

from fastapi import Request, HTTPException, status
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse, Response

from routers import public, protected, guest_protected
from pages import (
    _render_page, _tmpl, _index_pages, _build_nav,
    _CHROME_LINK, _FONT_PRELOAD, _FAVICON, _STATIC_INDEX, _APPLE_WEBAPP_META,
    _NAV_HREFS, _NAV_ICONS, _NAV_LABELS,
)
from helpers import DATA_DIR
from auth import SESSION_TOKEN, GUEST_SESSION_TOKEN, TURNSTILE_SITE_KEY, API_KEY, verify_turnstile
from routes_nightfall import build_nightfall_html
from graph_scrub import (
    _redact_graph_nodes,
    _drop_graph_book_nodes,
    _drop_graph_moltbook_nodes,
    _drop_graph_vendor_nodes,
    _drop_graph_library_nodes,
    _merge_graph_communities,
    _fix_graph_stats,
    _size_graph_by_loc,
)


# ── public: landing + auth ──────────────────────────────────────────────────

_GUEST_NEXT_ALLOWED = {"/mtg", "/tarot", "/nightfall", "/hosaka"}


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


_LANDING_LINK = '<link rel="stylesheet" href="/landing.css?v=11">'

# Landing nav icons ordered by icon hue: recruiter 36° (Sentinel orange "file"
# tile) -> hosaka 50° (amber radar) -> graph 171° (teal) -> nightfall 194°
# (cyan) -> color 226° (blue) -> mtg 261° (purple) -> tarot 351° (pink).
_LANDING_HUE_ORDER = ["recruiter", "hosaka", "graph", "nightfall", "color", "mtg", "tarot"]

# Gibson-register one-liners shown to the right of each landing link — clipped,
# noir, second-person where it lands. One per _LANDING_HUE_ORDER section.
_LANDING_BLURBS = {
    "hosaka": "Feed the Hosaka your words. It answers in a voice that was never yours.",
    "graph": "The whole machine as constellation. Every node a live nerve.",
    "nightfall": "Flash games died, but this one lives. Night falls on the net.",
    "color": "The console's own spectrum, stripped to raw hue and signal.",
    "mtg": "A wizard wired to the stack. It rules, and it never sleeps.",
    "tarot": "Seventy-eight gates, a green terminal, the reader is waiting for you to begin.",
    "recruiter": "Wai's credentials for the headhunters.",
}

# Reference-desk descriptions under each Gibson line — neutral, cataloguing
# register, the plain factual counterpart to the noir blurb.
_LANDING_DESCS = {
    "hosaka": "A text-to-speech studio: type text, pick a synthetic voice, and stream the spoken audio.",
    "graph": "An interactive map of this site's codebase: files and functions as nodes, their references as edges.",
    "nightfall": "A browser-based infiltration game: breach networked nodes, manage detection, and clear each site.",
    "color": "A read-only reference of the site's color palette, listing each token with its usage and opacity.",
    "mtg": "A rules assistant for Magic: The Gathering, answering interaction and timing questions from the comprehensive rules.",
    "tarot": "An interactive three-card tarot reading: choose a significator, deal the spread, and interpret each position.",
    "recruiter": "A résumé page for recruiters: background, skills, and a downloadable PDF.",
}
_RECRUITER_LINK = '<link rel="stylesheet" href="/recruiter.css?v=19">'

# preload the two Latin-subset woff2 weights so they download in parallel with
# the CSS instead of after it (font fetch is otherwise gated on CSS parse). Both
# ~60KB; crossorigin required for the preload to match the @font-face fetch.
_RECRUITER_FONT_PRELOAD = (
    '<link rel="preload" href="/fonts/iosevka-cv-500.woff2?v=1" as="font" '
    'type="font/woff2" crossorigin>'
    '<link rel="preload" href="/fonts/iosevka-cv-700.woff2?v=1" as="font" '
    'type="font/woff2" crossorigin>'
)

# ✦ favicon for /recruiter — an inline SVG data URI (green), replacing the
# site's default favicon.png on this page only.
_RECRUITER_FAVICON = (
    '<link rel="icon" href="data:image/svg+xml,'
    "%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E"
    "%3Ctext%20x='8'%20y='13'%20font-size='15'%20text-anchor='middle'%20fill='%2322a559'%3E"
    '%E2%9C%A6%3C/text%3E%3C/svg%3E'
    '">'
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
    fx = '<div class="cyber-bg"></div><div class="cyber-scan"></div>'
    page = bare.replace("</head>", _FONT_PRELOAD + _CHROME_LINK + _LANDING_LINK + "</head>", 1)
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
    page = page.replace('<link rel="icon" type="image/png" href="favicon.png?v=3">',
                        _RECRUITER_FAVICON, 1)
    page = page.replace("</head>",
                        _RECRUITER_FONT_PRELOAD + _CHROME_LINK + _RECRUITER_LINK + "</head>", 1)
    body = _tmpl("recruiter.html") + '<script src="/recruiter.js?v=16"></script>'
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
_GRAPH_OVERLAY_JS = '<script src="/graph-overlay.js?v=38"></script>'
# graphify's graph.html has no viewport meta — without it mobile renders at
# desktop width and scales everything down (tiny buttons/text).
_VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1">'


@public.get("/graph", response_class=HTMLResponse)
async def graph_page(request: Request):
    # Self-contained graphify viz from the ./graphify-out volume (regenerated by
    # /graphify). Public: the graph is just codebase structure; sensitive node
    # summaries are scrubbed by _redact_graph_nodes. Inject chrome.css + the
    # overlay css/js (nav restyle + live physics panel) + the nav. All injected
    # here so they survive rebuilds. Non-admins get the guest nav (the full nav
    # links to login-gated pages); admins keep the full nav.
    p = Path("/app/graphify-out/graph.html")
    if not p.exists():
        return HTMLResponse(
            "<pre>graph.html not found. Run /graphify to build it.</pre>",
            status_code=404,
        )
    guest = request.cookies.get("session") != SESSION_TOKEN
    _fx = '<div class="cyber-bg"></div><div class="cyber-scan"></div>'
    page = p.read_text()
    # Serve vis-network from our own origin (immutable-cached, no third-party
    # RTT) and unify with /emet's 9.1.9 so both share one cached copy. Replace
    # the whole CDN tag (its SRI integrity hash is pinned to graphify's 9.1.6,
    # so a bare URL swap would fail the integrity check). Regex so it survives
    # graphify regenerating graph.html.
    page = re.sub(
        r'<script src="https://unpkg\.com/vis-network@.*?</script>',
        '<script src="/vendor/vis-network-9.1.9.min.js?v=1"></script>',
        page, count=1, flags=re.DOTALL,
    )
    page = _redact_graph_nodes(page)
    page = _drop_graph_book_nodes(page)
    page = _drop_graph_moltbook_nodes(page)
    page = _drop_graph_vendor_nodes(page)
    # Drop imported library/framework symbols (BaseModel, Request, ...) — not our
    # code, just clutter.
    page = _drop_graph_library_nodes(page)
    # Merge graphify's many fine-grained communities into <=12 dir-based groups
    # (after the drops) so each gets a distinct color — vis only has 10 palette
    # slots, so 56 communities collapse to indistinguishable color noise.
    page = _merge_graph_communities(page)
    # Size nodes by line count (from graph.json sibling) instead of degree.
    page = _size_graph_by_loc(page, p.with_name("graph.json"))
    # Header counts are baked pre-scrub; rewrite to the merged/dropped reality.
    page = _fix_graph_stats(page)
    # Disable vis-network's improvedLayout — the graph is too large for it to
    # position (it warns + costs perf). Patched here so it survives /graphify.
    page = page.replace(
        "{ nodes: nodesDS, edges: edgesDS }, {",
        "{ nodes: nodesDS, edges: edgesDS }, {\n  layout: { improvedLayout: false },",
        1,
    )
    page = page.replace("</head>", _VIEWPORT_META + _APPLE_WEBAPP_META + _FAVICON + _FONT_PRELOAD + _CHROME_LINK + _GRAPH_OVERLAY_CSS + "</head>", 1)
    page = page.replace("</body>", _fx + _build_nav("graph", guest=guest) + _GRAPH_OVERLAY_JS + "</body>", 1)
    # /graph has no extension so the no-cache middleware skips it, and the route
    # body changes whenever /graphify regenerates graph.html. Tag the rendered
    # bytes with a content-hash ETag + no-cache so the browser revalidates every
    # load: unchanged -> 304 (cheap), updated -> 200 fresh. Cache-busts on update.
    etag = '"%s"' % hashlib.md5(page.encode()).hexdigest()
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return HTMLResponse(page, headers=headers)


@protected.get("/emet", response_class=HTMLResponse)
async def emet_page(request: Request):
    # Same UI treatment as /graph: chrome palette + cyber-fx bg + bottom nav +
    # an emet-specific skin (web/emet.css: fullscreen graph + always-open
    # node-info bottom strip). The renderer (emet.html) is auth-gated and NOT
    # under the public /app/static mount; the graph DATA (emet-graph.json —
    # sensitive, gitignored)
    # is injected inline here as window.EMET_GRAPH so it stays behind login.
    # Content-hash ETag + no-cache so on-server edits cache-bust (the route path
    # has no extension, so the no-cache middleware skips it).
    page = _tmpl("emet.html")
    data = Path("/app/templates/emet-graph.json").read_text()
    # escape `<` so any "</script>" inside the data can't break out of the tag
    data = data.replace("<", "\\u003c")
    page = page.replace("<!--EMET_DATA-->",
                        "<script>window.EMET_GRAPH=" + data + ";</script>", 1)
    _fx = '<div class="cyber-bg"></div><div class="cyber-scan"></div>'
    _emet_css = '<link rel="stylesheet" href="/emet.css?v=12">'
    page = page.replace("</head>",
                        _VIEWPORT_META + _APPLE_WEBAPP_META + _FAVICON + _FONT_PRELOAD + _CHROME_LINK + _emet_css + "</head>", 1)
    page = page.replace("</body>", _fx + _build_nav("emet") + "</body>", 1)
    etag = '"%s"' % hashlib.md5(page.encode()).hexdigest()
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return HTMLResponse(page, headers=headers)


@protected.get("/rd", response_class=HTMLResponse)
async def rd_page():
    return _render_page("rd", _tmpl("rd.html"), full_height=True)


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
