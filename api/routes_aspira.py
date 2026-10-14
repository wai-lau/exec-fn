"""/spire (THE SPIRE; was /aspira) -- a spiral tower-defence game (GUEST tier:
public behind Turnstile). /aspira 301s to /spire for anyone (no auth needed to
be redirected); the code, files and nav key keep the name `aspira`.

Polygons travel an Archimedean spiral from the rim to a core at the centre;
towers built between the arms shoot them. Entirely client-side
(web/aspira-*.js); the server only serves the page, so there is no state, no
API but THE ASCENDANTS (the shared board of winners, spire_board.py) and nothing
else to save beyond the browser's own best score.

GUEST tier since 2026-10-02 (`guest_protected`, owner: "aspira should be
public (behind cloudflare)"): also in `_GUEST_NEXT_ALLOWED`, the 401
handler's guest prefixes and `_GUEST_NAV_LINKS`. A nav entry (`SPR`, the
Nightfall Tower sprite traced to web/icons/tower.svg).

The sound samples (Brood War) are served to the SAME guest tier from
/aspira-sfx/ (owner: "it's guest but still personal use"); they live only in
the gitignored api/data/aspira-sfx/, never in the public repo.
See ARCHITECTURE.md §22.
"""
import hmac
import time
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

import spire_board
import spire_perflog
from auth import SESSION_TOKEN, rate_exempt
from helpers import DATA_DIR
from routers import guest_protected, protected, public
from pages import _render_page, _tmpl

SFX_DIR = (DATA_DIR / "aspira-sfx").resolve()
# the game's own files, for its VERSION stamp: web/ is mounted at /app/static in
# the container (a sibling of this file); the repo's web/ when run from a checkout
_HERE = Path(__file__).resolve().parent
_GAME_DIRS = [_HERE / "static", _HERE.parent / "web"]


def spire_version() -> str:
    """The game's version, shown top-left after BEST: major.minor.tiny, kept by
    hand in web/aspira-version.txt (owner, 2026-10-14: "change the version to be
    a number like major.minor.tiny") - the changelog card (aspira-changelog.js)
    names its days by it. Never raises."""
    for d in _GAME_DIRS:
        try:
            v = (d / "aspira-version.txt").read_text().strip()
        except OSError:
            continue
        if v:
            return v
    return "?"


def spire_build() -> str:
    """When the game's files last changed, "1005.1432" (month day . hour minute):
    the slow logs carry it beside the version, so a phone on cached code still
    shows. Never raises."""
    try:
        files = [f for d in _GAME_DIRS if d.is_dir() for f in d.glob("aspira*")]
        files.append(_HERE / "templates" / "aspira.html")
        newest = max((f.stat().st_mtime for f in files if f.is_file()), default=0)
        return time.strftime("%m%d.%H%M", time.localtime(newest)) if newest else "?"
    except OSError:
        return "?"


@public.get("/aspira")
async def aspira_moved():
    return RedirectResponse("/spire", status_code=301)


@guest_protected.get("/spire", response_class=HTMLResponse)
async def aspira_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    html = _tmpl("aspira.html").replace("__SPIRE_VERSION__", spire_version()).replace("__SPIRE_BUILD__", spire_build()).replace("__SPIRE_OWNER__", "1" if is_full_auth else "")
    # no nav bar (owner): the game takes the whole screen; a favicon button
    # top-left goes home to the landing page instead
    # no CRT stack either (owner, 2026-10-09: "just get rid of the crt effects for this game")
    return _render_page("aspira", html, full_height=True, guest=not is_full_auth, show_nav=False, crt=False)


@guest_protected.get("/aspira-sfx/{filename:path}")
async def aspira_sfx(filename: str):
    path = (SFX_DIR / filename).resolve()
    # inside the sound folder only (is_relative_to, not a string prefix: a
    # sibling like aspira-sfx-x/ must not pass)
    if not path.is_relative_to(SFX_DIR) or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(path), headers={"Cache-Control": "private, max-age=86400"})


# ---------- THE ASCENDANTS: the shared board of winners (spire_board.py) ----------
# HONOUR SYSTEM (owner, 2026-10-11): a win cannot be proven, so the only guards are
# the entry's shape and this per-IP limit - ASC_MAX posts per ASC_WINDOW seconds
ASC_MAX, ASC_WINDOW = 6, 3600.0  # (6: losses past wave 10 post too, 2026-10-11)
_asc_posts: dict[str, list[float]] = {}


def _asc_rate_ok(ip: str) -> bool:
    now = time.monotonic()
    hits = [t for t in _asc_posts.get(ip, []) if t > now - ASC_WINDOW]
    if len(hits) >= ASC_MAX:
        _asc_posts[ip] = hits
        return False
    _asc_posts[ip] = hits + [now]
    if len(_asc_posts) > 5000:  # forget the idle
        for k in [k for k, v in _asc_posts.items() if not v or v[-1] <= now - ASC_WINDOW]:
            del _asc_posts[k]
    return True


def _client_ip(request: Request) -> str:
    # behind the single trusted nginx: X-Real-IP, else the LAST X-Forwarded-For hop (mtg/routes.py)
    xff = request.headers.get("x-forwarded-for", "")
    return request.headers.get("x-real-ip") or (xff.rsplit(",", 1)[-1].strip() if xff else "") or (request.client.host if request.client else "unknown")


def _is_owner(request: Request) -> bool:
    return hmac.compare_digest(request.cookies.get("session") or "", SESSION_TOKEN)


@guest_protected.get("/api/spire/ascendants")
async def spire_ascendants(request: Request):
    rows = spire_board.visible(DATA_DIR, spire_board.load(DATA_DIR), _is_owner(request))  # the owner's own games: hidden from guests
    return {"entries": spire_board.ranked(rows)[: spire_board.SHOW_MAX]}


@guest_protected.post("/api/spire/ascendants")
async def spire_ascend(request: Request):
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="bad json")
    entry = spire_board.clean_entry(body if isinstance(body, dict) else {})
    if entry is None:
        raise HTTPException(status_code=400, detail="three letters, the lives left and the team")
    if not rate_exempt(request) and not _asc_rate_ok(_client_ip(request)):
        raise HTTPException(status_code=429, detail="too many ascensions - try again later")
    owner = _is_owner(request)
    if owner:
        entry["owner"] = True  # shown to the owner only (spire_board.visible)
    rows = spire_board.visible(DATA_DIR, spire_board.add(DATA_DIR, entry), owner)
    return {"entries": spire_board.ranked(rows)[: spire_board.SHOW_MAX], "entry": entry}


# ---------- SLOW LOGS (spire_perflog.py): a session's frame and audio summary every 3 min of play ----------
PERF_MAX, PERF_WINDOW = 30, 3600.0  # a session sends one every 3 min: 30 an hour from one IP is plenty
_perf_posts: dict[str, list[float]] = {}


@guest_protected.post("/api/spire/perflog")
async def spire_perflog_post(request: Request):
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="bad json")
    ip, now = _client_ip(request), time.monotonic()
    hits = [t for t in _perf_posts.get(ip, []) if t > now - PERF_WINDOW]
    if len(hits) >= PERF_MAX and not rate_exempt(request):
        raise HTTPException(status_code=429, detail="slow down")
    _perf_posts[ip] = hits + [now]
    if not spire_perflog.save(body, request.headers.get("user-agent", "")):
        raise HTTPException(status_code=400, detail="not a small JSON object")
    return {"ok": True}


@protected.get("/api/spire/perflog")
async def spire_perflog_get(n: int = 50):
    return {"logs": spire_perflog.recent(max(1, min(n, 400)))}
