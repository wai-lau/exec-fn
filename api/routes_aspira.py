"""/aspira -- a spiral tower-defence game (GUEST tier: public behind Turnstile).

Polygons travel an Archimedean spiral from the rim to a core at the centre;
towers built between the arms shoot them. Entirely client-side
(web/aspira-*.js); the server only serves the page, so there is no state, no
API and nothing to save beyond the browser's own best score.

GUEST tier since 2026-10-02 (`guest_protected`, owner: "aspira should be
public (behind cloudflare)"): also in `_GUEST_NEXT_ALLOWED`, the 401
handler's guest prefixes and `_GUEST_NAV_LINKS`. A nav entry (`SPR`, the
Nightfall Tower sprite traced to web/icons/tower.svg). The game's sound
samples stay owner-only (/data/), so a guest plays silent.
See ARCHITECTURE.md §22.
"""
from fastapi import Request
from fastapi.responses import HTMLResponse

from auth import SESSION_TOKEN
from routers import guest_protected
from pages import _render_page, _tmpl


@guest_protected.get("/aspira", response_class=HTMLResponse)
async def aspira_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    return _render_page("aspira", _tmpl("aspira.html"), full_height=True, guest=not is_full_auth)
