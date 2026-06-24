"""Page composition: nav builder, index-shell variants, template loader.

Pure rendering primitives — no routes, no app. Route modules import these to
assemble HTML responses. Kept out of main.py so the entry point stays thin."""
import re
from pathlib import Path

_TMPL = Path("/app/templates")
_STATIC_INDEX = Path("/app/static/index.html")

_CHROME_LINK = '<link rel="stylesheet" href="/chrome.css?v=31">'
# Preload the two site woff2 subsets so they fetch in parallel with the
# stylesheet instead of after the @font-face is discovered. crossorigin is
# required for the preload to match the font fetch (fonts are always CORS).
_FONT_PRELOAD = (
    '<link rel="preload" href="/fonts/iosevka-500.woff2?v=1" as="font" '
    'type="font/woff2" crossorigin>'
    '<link rel="preload" href="/fonts/iosevka-700.woff2?v=1" as="font" '
    'type="font/woff2" crossorigin>'
)
# Open the DNS+TLS to the script CDN early on the pages that load from it
# (kanban/prophecies = sortable+marked; debug/mtg/tarot = marked), so the
# handshake overlaps page parse instead of blocking the script fetch.
_JSDELIVR_PRECONNECT = (
    '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>'
)
_JSDELIVR_PAGES = {"core", "prophecies", "debug", "mtg", "tarot"}
# Site favicon (matches web/index.html, used by login + the in-shell pages).
# Injected into the pages built from their own HTML (graph/emet) so they show
# the same icon. /recruiter keeps its own ✦; /nightfall keeps its game hack.png.
_FAVICON = '<link rel="icon" type="image/png" href="/favicon.png?v=2">'

# Site-wide standalone web-app meta. Running as a standalone home-screen web app
# is the one way iOS drops the keyboard accessory bar (the prev/next/Done
# assistant) above the soft keyboard -- it can't be removed from a Safari tab.
# Inert in a normal tab; kicks in once a page is added to the Home Screen and
# launched from that icon. Injected into the shared shell head by _index_pages
# (covers every derived page) and into graph/emet, which build their own HTML.
_APPLE_WEBAPP_META = (
    '<meta name="apple-mobile-web-app-capable" content="yes">'
    '<meta name="mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
)

_NAV_LINKS = ["core", "prophecies", "debug", "graph", "emet", "color", "nightfall", "mtg", "tarot", "hosaka", "recruiter"]
_NAV_HREFS = {"core": "/rd", "prophecies": "/prophecies", "debug": "/debug", "graph": "/graph", "emet": "/emet", "color": "/color", "nightfall": "/nightfall", "mtg": "/mtg", "tarot": "/tarot", "hosaka": "/hosaka", "recruiter": "/recruiter"}

_GUEST_NAV_LINKS = ["nightfall", "mtg", "tarot", "color", "recruiter"]

_NAV_ICONS = {
    "core":        '<img src="/seeker.png" alt="core" style="width:20px;height:20px;image-rendering:pixelated;">',
    "prophecies":  '<img src="/turbo.png" alt="prophecies" style="width:20px;height:20px;image-rendering:pixelated;">',
    "debug":       '<img src="/bug.png" alt="debug" style="width:20px;height:20px;image-rendering:pixelated;">',
    "graph":       '<img src="/laser-satellite.png" alt="graph" style="width:20px;height:20px;image-rendering:pixelated;">',
    "color":       '<img src="/data-doctor.png" alt="color" style="width:20px;height:20px;image-rendering:pixelated;">',
    "nightfall":   '<img src="/hack2.png" alt="nightfall" style="width:20px;height:20px;image-rendering:pixelated;">',
    "mtg":         '<img src="/wizard.png?v=2" alt="mtg" style="width:20px;height:20px;image-rendering:pixelated;">',
    "tarot":       '<img src="/watchman.png" alt="tarot" style="width:20px;height:20px;image-rendering:pixelated;">',
    "hosaka":      '<img src="/radar.png" alt="hosaka" style="width:20px;height:20px;image-rendering:pixelated;">',
    "emet":        '<img src="/golem-stone.png?v=3" alt="emet" style="width:20px;height:20px;image-rendering:pixelated;">',
    "recruiter":   '<img src="/data-file.png?v=3" alt="recruiter" style="width:20px;height:20px;image-rendering:pixelated;">',
}

_NAV_LABELS = {
    "core": "core", "prophecies": "HQ",
    "debug": "debug", "graph": "graph", "emet": "emet", "color": "color",
    "nightfall": "12AM", "mtg": "mtg", "tarot": "tarot", "hosaka": "hosaka", "recruiter": "cv",
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
        "var de=document.documentElement;"
        # Home-screen / installed standalone launch (iOS navigator.standalone,
        # cross-browser display-mode). Two-row nav with one empty cell of side
        # padding — see html.standalone in chrome.css. --per-row = ceil(n/2).
        "if(window.navigator.standalone===true||"
        "window.matchMedia('(display-mode: standalone)').matches){"
        "de.classList.add('standalone');"
        "var _nav=document.querySelector('.exec-nav');"
        "if(_nav)_nav.style.setProperty('--per-row',"
        "Math.ceil(_nav.querySelectorAll('a').length/2));}"
        "function _snh(){var n=document.querySelector('.exec-nav');"
        "if(n)de.style.setProperty('--nav-h',n.offsetHeight+'px');}"
        "_snh();window.addEventListener('resize',_snh);"
        # Nav height changes after first paint — icon images load, and the
        # standalone class reflows to two rows. A one-shot _snh() reads the
        # short single-row height; observe the nav so --nav-h tracks the real
        # height (else pages reserving var(--nav-h) hide content behind it).
        "window.addEventListener('load',_snh);"
        "if(window.ResizeObserver){var _nvo=document.querySelector('.exec-nav');"
        "if(_nvo)new ResizeObserver(_snh).observe(_nvo);}"
        # iOS home-screen standalone: a plain <a> tap is treated as leaving the
        # web app, so iOS slaps a Safari toolbar (back/reload/compass) on the
        # bottom for every page after the launch URL. Programmatic navigation
        # stays "in-app" and keeps the chrome hidden — intercept same-origin
        # link taps and drive them through location.href. Only when standalone
        # (navigator.standalone); normal tabs keep default anchor behaviour.
        "if(window.navigator.standalone===true){"
        "document.addEventListener('click',function(e){"
        "var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;"
        "if(a.target==='_blank'||a.hasAttribute('download'))return;"
        "var u;try{u=new URL(a.getAttribute('href'),location.href);}catch(_){return;}"
        "if(u.origin!==location.origin||u.protocol!=='https:'&&u.protocol!=='http:')return;"
        "e.preventDefault();location.href=u.href;});}"
        # iOS overlays the soft keyboard instead of resizing the layout, and the
        # keyboard-inset arithmetic is unreliable across versions. Detect the
        # keyboard by input focus (the one signal that always correlates) and
        # mirror the visible viewport geometry from visualViewport so the nav can
        # be hidden and the chat UI can fit the keyboard exactly.
        "var vv=window.visualViewport;"
        "function _vp(){if(!vv)return;"
        "de.style.setProperty('--vvh',vv.height+'px');"
        "de.style.setProperty('--vvt',vv.offsetTop+'px');"
        # keyboard inset = layout height - visible height. Deliberately NOT minus
        # offsetTop: the chat pages lock body scroll (offsetTop≈0 at rest), but iOS
        # emits a transient offsetTop mid-animation that would make --kb dip then
        # recover — the visible "bars bounce up and down" as the keyboard slides.
        "de.style.setProperty('--kb',Math.max(0,de.clientHeight-vv.height)+'px');}"
        "if(vv){vv.addEventListener('resize',_vp);vv.addEventListener('scroll',_vp);}"
        "_vp();"
        "var _ke=function(t){return !!t&&(t.isContentEditable||"
        "/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||''));};"
        "document.addEventListener('focusin',function(e){"
        "if(_ke(e.target))de.classList.add('kb-open');});"
        "document.addEventListener('focusout',function(){"
        "setTimeout(function(){if(!_ke(document.activeElement))"
        "de.classList.remove('kb-open');},0);});"
        "})();</script>"
    )
    # Exec chat = a floating draggable bubble, only on the planning routes
    # (core + prophecies/dirs) — not debug/graph/other. Never for guests.
    show_bubble = (not guest) and active in {"core", "prophecies"}
    bubble = ('<script src="/exec-bubble-drag.js?v=1"></script>'
              '<script src="/exec-todos.js?v=2"></script>'
              '<script src="/exec-bubble.js?v=39"></script>') if show_bubble else ''
    return nav + script + bubble


_index_cache: tuple[float, str, str] | None = None  # (mtime, no_form, bare)


def _index_pages() -> tuple[str, str]:
    """Return (no_form, bare) variants of /app/static/index.html, re-read on change."""
    global _index_cache
    mtime = _STATIC_INDEX.stat().st_mtime
    if _index_cache and _index_cache[0] == mtime:
        return _index_cache[1], _index_cache[2]
    raw = _STATIC_INDEX.read_text()
    # Site-wide standalone web-app meta -- injected into the shared shell head so
    # EVERY page derived from it (all _render_page views + landing/recruiter +
    # login/guest) carries it. graph/emet read their own HTML and inject it
    # separately. See _APPLE_WEBAPP_META.
    raw = raw.replace("</head>", _APPLE_WEBAPP_META + "</head>", 1)
    no_form = re.sub(r'<form class="login-box".*?</form>', '', raw, flags=re.DOTALL)
    bare = no_form
    for pat in (
        r'<div class="bg-wide">.*?</div>',
        r'<div class="bg-tall">.*?</div>',
        r'<a href="[^"]*" target="_blank">.*?</a>',
        r'<style id="login-styles">.*?</style>',
        r'<audio[^>]*>.*?</audio>',
        r'<div class="login-wrap">.*?</div>',
    ):
        bare = re.sub(pat, '', bare, flags=re.DOTALL)
    _index_cache = (mtime, no_form, bare)
    return no_form, bare


_FULL_HEIGHT_STYLE = "<style>body{display:block;height:100vh;overflow:hidden!important;}</style>"


def _render_page(active: str | None, content: str, full_height: bool = False, guest: bool = False) -> str:
    no_form, bare = _index_pages()
    base = bare if active else no_form
    preconnect = _JSDELIVR_PRECONNECT if active in _JSDELIVR_PAGES else ""
    head_inject = preconnect + _FONT_PRELOAD + _CHROME_LINK + (_FULL_HEIGHT_STYLE if full_height else "")
    nav = _build_nav(active, guest=guest)
    # cyberpunk ambient fx on every page (nightfall composes separately and is
    # excluded; landing + graph inject their own)
    fx = '<div class="cyber-bg"></div><div class="cyber-scan"></div>'
    return (base
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", fx + content + nav + "</body>", 1))


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
