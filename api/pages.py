"""Page composition: nav builder, index-shell variants, template loader.

Pure rendering primitives — no routes, no app. Route modules import these to
assemble HTML responses. Kept out of main.py so the entry point stays thin."""
import re
from pathlib import Path

_TMPL = Path("/app/templates")
_STATIC_INDEX = Path("/app/static/index.html")

_CHROME_LINK = '<link rel="stylesheet" href="/chrome.css?v=77">'
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
# (rd/hq = sortable+marked; debug/mtg/tarot = marked), so the
# handshake overlaps page parse instead of blocking the script fetch.
_JSDELIVR_PRECONNECT = (
    '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>'
)
_JSDELIVR_PAGES = {"rd", "hq", "mtg", "tarot", "cc"}
# Site favicon (matches web/index.html, used by login + the in-shell pages).
# Injected into the pages built from their own HTML (graph) so they show
# the same icon. /recruiter keeps its own ✦; /nightfall keeps its game hack.png.
_FAVICON = '<link rel="icon" type="image/png" href="/favicon.png?v=7">'

# CRT ambient stack markup — the four fixed fx layers (see .cyber-* in
# chrome.css). Shared by every page builder (_render_page, landing, graph) so the
# layer set stays in one place. nightfall composes separately and never gets it.
# ORDER MATTERS (same z, DOM order = paint order), bottom→top: cyber-bg (green
# phosphor overlay) → cyber-lines (hard-light black, re-blacks the rows the green
# tinted) → cyber-blur (backdrop-filter glass, blurs that static composite) →
# cyber-crt (backdrop-filter brightness/contrast punch on that same static
# composite — the CRT phosphor pop) → cyber-scan (the ONE animated layer, sweep
# beam, plain alpha, painted ABOVE the glass). The glass reinstated 2026-08-31
# (removed 2026-08-30): keeping the sweep ABOVE it means the blur's backdrop is
# 100% static, so the compositor blurs once and caches it instead of re-blurring
# every frame — the sweep-under-glass was the whole reason the old pane cost
# 233ms/frame. cyber-crt sits UNDER the sweep for the same reason (static backdrop
# = cached brightness/contrast pass, idle readback cost 0). See chrome.css.
_CRT_FX = (
    '<div class="cyber-bg"></div><div class="cyber-lines"></div>'
    '<div class="cyber-blur"></div><div class="cyber-crt"></div>'
    '<div class="cyber-scan"></div>'
    '<script src="/crt-zoom.js?v=2"></script>'
)

# Site-wide standalone web-app meta. Running as a standalone home-screen web app
# is the one way iOS drops the keyboard accessory bar (the prev/next/Done
# assistant) above the soft keyboard -- it can't be removed from a Safari tab.
# Inert in a normal tab; kicks in once a page is added to the Home Screen and
# launched from that icon. Injected into the shared shell head by _index_pages
# (covers every derived page) and into graph, which builds its own HTML.
_APPLE_WEBAPP_META = (
    '<meta name="apple-mobile-web-app-capable" content="yes">'
    '<meta name="mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    # The manifest's scope/display is what keeps an iOS home-screen launch
    # chrome-less across in-app navigation (read at add-to-home-screen time).
    '<link rel="manifest" href="/manifest.webmanifest?v=1">'
)

_NAV_LINKS = ["cc", "rd", "hq", "debug", "security", "graph", "ui", "nightfall", "mtg", "tarot", "hosaka", "printer", "recruiter"]
_NAV_HREFS = {"rd": "/rd", "hq": "/hq", "debug": "/debug", "security": "/security", "graph": "/graph", "cc": "/cc", "ui": "/UI", "nightfall": "/nightfall", "mtg": "/mtg", "tarot": "/tarot", "hosaka": "/hosaka", "printer": "/printer", "recruiter": "/recruiter"}

_GUEST_NAV_LINKS = ["security", "graph", "nightfall", "mtg", "tarot", "hosaka", "printer", "ui", "recruiter"]

def _nav_icon(name: str, alt: str) -> str:
    """One nav icon, as the outline SVG in web/icons/ rather than the 27x27 PNG
    it was drawn from.

    The PNGs were pixel art on a flat coloured tile, and at the 20px this nav
    renders they were mush -- the tile read, the art did not. The SVG is that
    same art's black linework, traced (scripts/trace-icons.py) and filled with
    the tile's own colour, so an <img> is enough and nothing here styles it.
    It stays PIXEL ART: one source pixel is one viewBox unit and the file
    carries `shape-rendering="crispEdges"`, which is what keeps the grid hard
    at a size 20/27 does not divide into. No `image-rendering:pixelated` --
    that is the raster knob and does nothing to an SVG."""
    return f'<img src="/icons/{name}.svg?v=11" alt="{alt}" style="width:20px;height:20px;">'


_NAV_ICONS = {
    "rd":          _nav_icon("fiddle", "rd"),
    "hq":          _nav_icon("turbo", "hq"),
    "debug":       _nav_icon("bug", "debug"),
    "security":    _nav_icon("sentinel", "security"),
    "graph":       _nav_icon("laser-satellite", "graph"),
    "ui":          _nav_icon("data-doctor", "UI"),
    "nightfall":   _nav_icon("hack2", "nightfall"),
    "mtg":         _nav_icon("wizard", "mtg"),
    "tarot":       _nav_icon("watchman", "tarot"),
    "hosaka":      _nav_icon("radar", "hosaka"),
    "printer":     _nav_icon("printer", "printer"),
    "recruiter":   _nav_icon("data-file", "recruiter"),
    "cc":          _nav_icon("seeker", "cc"),
}

# Fixed 3-char codes, with ONE glyph: /cc is the star the page already wears on
# its composer's voice toggle, which is the mark Claude Code itself signs with.
# A non-ASCII label cannot be drawn by the pixel nav font (04b25 is ASCII-only,
# so it would fall back to whatever the OS offers, at whatever size that is), so
# any label with a character outside ASCII is marked `glyph` below and re-fonted
# to --font-mono in chrome.css. Detected, not listed: a second glyph label added
# here is drawn correctly without anyone remembering this rule.
_NAV_LABELS = {
    "rd": "R&D", "hq": "HQ",
    "debug": "DBG", "security": "BOT", "graph": "GPH", "cc": "✦", "ui": "UIX",
    "nightfall": "12AM", "mtg": "MTG", "tarot": "TRT", "hosaka": "HSK", "printer": "3DP", "recruiter": "CV",
}


def _build_nav(active=None, guest=False):
    links = []
    for label in (_GUEST_NAV_LINKS if guest else _NAV_LINKS):
        href = _NAV_HREFS.get(label, f"/{label}")
        cls = ' class="active"' if label == active else ""
        icon = _NAV_ICONS.get(label, label)
        text = _NAV_LABELS.get(label, label.lower())
        lab_cls = "nav-label" if text.isascii() else "nav-label glyph"
        links.append(f'<a href="{href}"{cls}>{icon}<span class="{lab_cls}">{text}</span></a>')
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
        "if(_nav){"
        # No browser chrome in standalone -> no reload button. Add a nav one
        # (firewall icon, last slot) that hard-reloads the current page. Appended
        # before the --per-row count so the two-row reflow includes it. No href,
        # so the same-origin link interceptor below ignores it.
        "var _rf=document.createElement('a');_rf.id='nav-refresh';"
        "_rf.style.cursor='pointer';"
        "_rf.innerHTML='<img src=\"/icons/firewall.svg?v=11\" alt=\"refresh\" "
        "style=\"width:20px;height:20px;\">"
        "<span class=\"nav-label\">F5</span>';"
        "_rf.addEventListener('click',function(e){e.preventDefault();"
        "location.reload();});_nav.appendChild(_rf);"
        "_nav.style.setProperty('--per-row',"
        "Math.ceil(_nav.querySelectorAll('a').length/2));}}"
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
        # Keyboard handling. Safari tabs OVERLAY the soft keyboard (layout stays
        # full, visualViewport shrinks); iOS home-screen standalone RESIZES the
        # layout instead — so de.clientHeight shrinks too and the old
        # `clientHeight - vv.height` read 0, leaving --kb=0 and the nav on screen
        # above the keyboard (chat "pushed up"). Measure the keyboard against a
        # stable base = the tallest visible viewport seen while NO keyboard is up;
        # that delta is the keyboard height in BOTH models. Drive kb-open off the
        # same delta (not just focusin, which can miss / not fire on a
        # contenteditable) so the nav reliably hides when the keyboard is up.
        # kb-open is a SOFT-KEYBOARD state -- it must engage only on touch devices.
        # On a no-touch desktop there is no keyboard, so the geometry path never
        # fires to clear a focusin-added kb-open; it sticks while the composer is
        # focused and collapses --kb-anchor to 0 (chrome.css), sliding the chat
        # chrome under the still-visible nav. Gate both kb-open paths on touch.
        # maxTouchPoints===0 mirrors the page's no-touch detection.
        "var _touch=(navigator.maxTouchPoints||0)>0;"
        "var vv=window.visualViewport,_baseH=(vv&&vv.height)||window.innerHeight||0;"
        "function _vp(){if(!vv)return;"
        "de.style.setProperty('--vvh',vv.height+'px');"
        "de.style.setProperty('--vvt',vv.offsetTop+'px');"
        # Two distinct quantities — don't conflate them:
        #  --kb (how far a fixed bottom:0 element must rise to sit at the visible
        #    bottom = above the keyboard) = clientHeight - vv.height - vv.offsetTop.
        #    iOS standalone SCROLLS the doc + offsets the visual viewport when the
        #    keyboard opens, so offsetTop is large and MUST be subtracted — without
        #    it the input flies to the top. Measured on device: client=775 vvH=455
        #    vvT=320 -> lift 0 (layout bottom already meets the keyboard). Safari
        #    tabs keep vvT≈0, so this also stays correct there.
        #  kb-open (whether to HIDE the nav) = base delta. clientHeight-vv.height
        #    can read 0 when iOS resizes the layout, so detect against the tallest
        #    viewport seen while the keyboard was down.
        "if(!de.classList.contains('kb-open'))_baseH=Math.max(_baseH,vv.height);"
        "de.style.setProperty('--kb',Math.max(0,de.clientHeight-vv.height-vv.offsetTop)+'px');"
        "de.classList.toggle('kb-open',_touch&&(_baseH-vv.height)>80);}"
        "if(vv){vv.addEventListener('resize',_vp);vv.addEventListener('scroll',_vp);}"
        "_vp();"
        # focusin adds kb-open immediately (snappier than waiting for the vv resize
        # to land); _vp's geometry toggle is the authority that also clears it.
        "var _ke=function(t){return !!t&&(t.isContentEditable||"
        "/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||''));};"
        "document.addEventListener('focusin',function(e){"
        "if(_touch&&_ke(e.target))de.classList.add('kb-open');});"
        # Clear on blur for the no-keyboard case (desktop focus fires no vv resize,
        # so the geometry toggle never runs to undo the focusin add).
        "document.addEventListener('focusout',function(){"
        "setTimeout(function(){if(!_ke(document.activeElement))"
        "de.classList.remove('kb-open');},0);});"
        "})();</script>"
    )
    # Exec chat = a floating draggable bubble + panel, on the planning routes
    # (rd + hq). On every OTHER non-guest page the same bubble shows
    # as a plain link to the planning chat (/hq?exec=open) — same-origin
    # so the standalone link interceptor keeps it in-app. Never for guests.
    if guest:
        bubble = ''
    elif active in {"rd", "hq"}:
        # voice-input.js + exec-mic.js are the panel's hands-free input: the same
        # engine /cc runs, so the `$` prompt is the mic in both places.
        bubble = ('<script src="/hosaka-audio.js?v=7"></script>'
                  '<script src="/voice-util.js?v=2"></script>'
                  '<script src="/voice-narrator.js?v=2"></script>'
                  '<script src="/voice-ui.js?v=1"></script>'
                  '<script src="/exec-voice.js?v=7"></script>'
                  '<script src="/exec-bubble-drag.js?v=7"></script>'
                  '<script src="/exec-todos.js?v=7"></script>'
                  '<script src="/typewriter.js?v=8"></script>'
                  '<script src="/exec-choices.js?v=7"></script>'
                  '<script src="/voice-input.js?v=2"></script>'
                  '<script src="/exec-mic.js?v=2"></script>'
                  '<script src="/exec-bubble-assets.js?v=19"></script>'
                  '<script src="/chat-dom.js?v=1"></script>'
                  '<script src="/exec-bubble-msg.js?v=2"></script>'
                  '<script src="/exec-bubble-history.js?v=1"></script>'
                  '<script src="/exec-bubble.js?v=76"></script>')
    else:
        # Same #exec-bubble as the planning pages — same look (exec-bubble.css,
        # normally injected by exec-bubble.js, loaded directly here), same drag +
        # position persistence (exec-bubble-drag.js + the shared exec-bpos), but a
        # tap NAVIGATES to the planning chat instead of toggling a panel
        # (exec-link.js). A <div>, like the real bubble, so a drag never fires a
        # stray click.
        # Exec voice (nudges + monitor comments spoken on whatever page Wai is
        # on) loads on every non-planning protected page EXCEPT /tarot (its own
        # reader voice would clash) and /hosaka (the TTS page itself). The
        # link-bubble stays on those two — just without the voice scripts.
        want_voice = active not in {"tarot", "hosaka"}
        # /cc loads the voice stack in its OWN template: cc.js mounts the shared
        # toggle and reads execVoice at load time, and this injection lands
        # after the page's scripts. Injecting it here too re-evaluates
        # exec-voice.js and throws "duplicate variable". The listener below
        # still loads -- it runs after the template's copy and finds it.
        own_voice = active == "cc"
        voice_pre = (
            '<script src="/hosaka-audio.js?v=7"></script>'
            '<script src="/voice-util.js?v=2"></script>'
            '<script src="/voice-narrator.js?v=2"></script>'
            '<script src="/voice-ui.js?v=1"></script>'
            '<script src="/exec-voice.js?v=7"></script>'
        ) if (want_voice and not own_voice) else ''
        voice_listener = '<script src="/exec-voice-listener.js?v=2"></script>' if want_voice else ''
        bubble = ('<link rel="stylesheet" href="/exec-bubble.css?v=26">'
                  '<div id="exec-bubble" class="exec-under-fx" role="button" aria-label="Exec">'
                  '<img src="/guru-pink.png" alt="exec"></div>'
                  + voice_pre +
                  '<script src="/exec-bubble-drag.js?v=7"></script>'
                  '<script src="/exec-link.js?v=2"></script>'
                  + voice_listener)
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
    # login/guest) carries it. graph reads its own HTML and injects it
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
    # Non-full-height pages scroll at the document root, whose native scrollbar
    # is top-layer and paints over the fixed bottom nav's right edge. Confine the
    # scroll to a wrapper that stops at the nav top (.page-scroll in chrome.css)
    # so the pill spans only the content area. full_height pages manage their own
    # inner scrollers (body overflow:hidden) and don't get the wrapper.
    body = content if full_height else '<div class="page-scroll">' + content + "</div>"
    # cyberpunk ambient fx on every page (nightfall composes separately and is
    # excluded; landing + graph inject the same _CRT_FX)
    return (base
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", _CRT_FX + body + nav + "</body>", 1))


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
