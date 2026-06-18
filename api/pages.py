"""Page composition: nav builder, index-shell variants, template loader.

Pure rendering primitives — no routes, no app. Route modules import these to
assemble HTML responses. Kept out of main.py so the entry point stays thin."""
import re
from pathlib import Path

_TMPL = Path("/app/templates")
_STATIC_INDEX = Path("/app/static/index.html")

_CHROME_LINK = '<link rel="stylesheet" href="/chrome.css?v=26">'

_NAV_LINKS = ["core", "prophecies", "debug", "graph", "emet", "color", "nightfall", "mtg", "tarot"]
_NAV_HREFS = {"core": "/rd", "prophecies": "/prophecies", "debug": "/debug", "graph": "/graph", "emet": "/emet", "color": "/color", "nightfall": "/nightfall", "mtg": "/mtg", "tarot": "/tarot"}

_GUEST_NAV_LINKS = ["nightfall", "mtg", "tarot", "color"]

_NAV_ICONS = {
    "core":        '<img src="/seeker.png" alt="core" style="width:20px;height:20px;image-rendering:pixelated;">',
    "prophecies":  '<img src="/sentinel.png" alt="prophecies" style="width:20px;height:20px;image-rendering:pixelated;">',
    "debug":       '<img src="/bug.png" alt="debug" style="width:20px;height:20px;image-rendering:pixelated;">',
    "graph":       '<img src="/laser-satellite.png" alt="graph" style="width:20px;height:20px;image-rendering:pixelated;">',
    "color":       '<img src="/data-doctor.png" alt="color" style="width:20px;height:20px;image-rendering:pixelated;">',
    "nightfall":   '<img src="/hack2.png" alt="nightfall" style="width:20px;height:20px;image-rendering:pixelated;">',
    "mtg":         '<img src="/wizard.png?v=2" alt="mtg" style="width:20px;height:20px;image-rendering:pixelated;">',
    "tarot":       '<img src="/watchman.png" alt="tarot" style="width:20px;height:20px;image-rendering:pixelated;">',
    "emet":        '<img src="/golem-stone.png?v=2" alt="emet" style="width:20px;height:20px;image-rendering:pixelated;">',
}

_NAV_LABELS = {
    "core": "core", "prophecies": "dirs",
    "debug": "debug", "graph": "graph", "emet": "אמת", "color": "color",
    "nightfall": "12AM", "mtg": "mtg", "tarot": "tarot",
}


_EXEC_NAV_BTN = (
    '<a id="exec-nav-btn" role="button" tabindex="0">'
    '<span class="exec-icon-wrap">'
    '<img src="/guru-pink.png" alt="exec" style="width:20px;height:20px;image-rendering:pixelated;">'
    '<span id="exec-badge"></span>'
    '</span>'
    '<span class="nav-label">exec</span>'
    '</a>'
)


def _build_nav(active=None, guest=False):
    links = []
    # Exec is the leftmost nav entry for the logged-in admin (never guests) — a
    # button that toggles the chat panel rather than navigating.
    if not guest:
        links.append(_EXEC_NAV_BTN)
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
        "function _snh(){var n=document.querySelector('.exec-nav');"
        "if(n)de.style.setProperty('--nav-h',n.offsetHeight+'px');}"
        "_snh();window.addEventListener('resize',_snh);"
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
    # Exec chat panel: loaded on every logged-in page (never guests), driven by
    # the #exec-nav-btn in the nav above.
    exec_chat = '<script src="/exec-bubble.js?v=31"></script>' if not guest else ''
    return nav + script + exec_chat


_index_cache: tuple[float, str, str] | None = None  # (mtime, no_form, bare)


def _index_pages() -> tuple[str, str]:
    """Return (no_form, bare) variants of /app/static/index.html, re-read on change."""
    global _index_cache
    mtime = _STATIC_INDEX.stat().st_mtime
    if _index_cache and _index_cache[0] == mtime:
        return _index_cache[1], _index_cache[2]
    raw = _STATIC_INDEX.read_text()
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
    head_inject = _CHROME_LINK + (_FULL_HEIGHT_STYLE if full_height else "")
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
