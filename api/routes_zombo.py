"""/zombo -- the zombo.com Flash intro (1999), reproduced rather than embedded.

A SECRET page: no nav entry, no landing spoke, no link from anywhere in the
site; it is reached by typing the URL, which is the whole joke. Unlisted is NOT
a tier, though, so it sits on `guest_protected` (Turnstile) like the rest of the
semi-public set and is asserted in tests/test_smoke.py's GUEST_PAGES -- a page
nobody links to is exactly the one that would rot into being wide open unnoticed.

Its own module rather than another entry in routes_views because it shares
nothing with the planning pages, and because routes_views hit the 500-line cap
the moment it was added there. See ARCHITECTURE.md §19.
"""
from fastapi.responses import HTMLResponse

from routers import guest_protected
from pages import _tmpl, _index_pages, _CHROME_LINK

_ZOMBO_LINK = '<link rel="stylesheet" href="/zombo.css?v=3">'
_ZOMBO_SCRIPTS = (
    '<script src="/zombo.js?v=3"></script>'
    '<script src="/zombo-flash.js?v=3"></script>'
)

# Ruffle's WASM is ~1MB and the .swf comes from a third host, so both DNS/TLS
# handshakes are started while the page's own CSS is still parsing.
_ZOMBO_PRECONNECT = (
    '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>'
    '<link rel="preconnect" href="https://welcometozombo.com" crossorigin>'
)

@guest_protected.get("/zombo", response_class=HTMLResponse)
async def zombo_page():
    """The intro, rebuilt: nine coloured letters, seven multiplied circles, and
    a bed + voiceover synthesised in the browser. Nothing is embedded.

    Built off the BARE shell like /recruiter rather than through _render_page,
    because the bottom nav and the CRT stack over a white 1999 Flash intro would
    defeat the only thing the page is.
    """
    _, bare = _index_pages()
    page = bare.replace("<title>wai-lau.net</title>", "<title>ZOMBO</title>", 1)
    page = page.replace("</head>", _ZOMBO_PRECONNECT + _CHROME_LINK + _ZOMBO_LINK + "</head>", 1)
    return page.replace("</body>", _tmpl("zombo.html") + _ZOMBO_SCRIPTS + "</body>", 1)
