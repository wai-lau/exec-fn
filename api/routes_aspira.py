"""/spire (THE SPIRE; was /aspira) -- a spiral tower-defence game (GUEST tier:
public behind Turnstile). /aspira 301s to /spire for anyone (no auth needed to
be redirected); the code, files and nav key keep the name `aspira`.

Polygons travel an Archimedean spiral from the rim to a core at the centre;
towers built between the arms shoot them. Entirely client-side
(web/aspira-*.js); the server only serves the page, so there is no state, no
API and nothing to save beyond the browser's own best score.

GUEST tier since 2026-10-02 (`guest_protected`, owner: "aspira should be
public (behind cloudflare)"): also in `_GUEST_NEXT_ALLOWED`, the 401
handler's guest prefixes and `_GUEST_NAV_LINKS`. A nav entry (`SPR`, the
Nightfall Tower sprite traced to web/icons/tower.svg).

The sound samples (Brood War) are served to the SAME guest tier from
/aspira-sfx/ (owner: "it's guest but still personal use"); they live only in
the gitignored api/data/aspira-sfx/, never in the public repo.
See ARCHITECTURE.md §22.
"""
import time
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

from auth import SESSION_TOKEN
from helpers import DATA_DIR
from routers import guest_protected, public
from pages import _render_page, _tmpl

SFX_DIR = (DATA_DIR / "aspira-sfx").resolve()
# the game's own files, for its VERSION stamp: web/ is mounted at /app/static in
# the container (a sibling of this file); the repo's web/ when run from a checkout
_HERE = Path(__file__).resolve().parent
_GAME_DIRS = [_HERE / "static", _HERE.parent / "web"]


def spire_version() -> str:
    """The game's version, shown top-left after BEST (owner): when its files
    last changed, "v1005.1432" (month day . hour minute) - so a phone showing an
    older stamp is running cached code. Never raises."""
    try:
        files = [f for d in _GAME_DIRS if d.is_dir() for f in d.glob("aspira*")]
        files.append(_HERE / "templates" / "aspira.html")
        newest = max((f.stat().st_mtime for f in files if f.is_file()), default=0)
        return time.strftime("v%m%d.%H%M", time.localtime(newest)) if newest else "v?"
    except OSError:
        return "v?"


@public.get("/aspira")
async def aspira_moved():
    return RedirectResponse("/spire", status_code=301)


@guest_protected.get("/spire", response_class=HTMLResponse)
async def aspira_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    html = _tmpl("aspira.html").replace("__SPIRE_VERSION__", spire_version())
    return _render_page("aspira", html, full_height=True, guest=not is_full_auth)


@guest_protected.get("/aspira-sfx/{filename:path}")
async def aspira_sfx(filename: str):
    path = (SFX_DIR / filename).resolve()
    # inside the sound folder only (is_relative_to, not a string prefix: a
    # sibling like aspira-sfx-x/ must not pass)
    if not path.is_relative_to(SFX_DIR) or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(path), headers={"Cache-Control": "private, max-age=86400"})
