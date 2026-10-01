"""/aspira -- a spiral tower-defence game (owner-only, unlinked).

Polygons travel an Archimedean spiral from the rim to a core at the centre;
towers built between the arms shoot them. Entirely client-side
(web/aspira-*.js); the server only serves the page, so there is no state, no
API and nothing to save beyond the browser's own best score.

OWNER tier (`protected`), carried by the bottom nav, but deliberately NOT a nav
entry: there is no `aspira` key in pages.py's nav tables, so the nav renders
with nothing marked active. See ARCHITECTURE.md §22.
"""
from fastapi.responses import HTMLResponse

from routers import protected
from pages import _render_page, _tmpl


@protected.get("/aspira", response_class=HTMLResponse)
async def aspira_page():
    return _render_page("aspira", _tmpl("aspira.html"))
