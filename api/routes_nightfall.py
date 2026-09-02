import hmac
import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response

from auth import API_KEY, SESSION_TOKEN
from gamesave_store import (
    GUEST_COOKIE,
    VALID_SLOTS,
    guest_id_or_new,
    is_valid_slot,
    slot_path,
    sweep_stale_guest_saves,
)
from helpers import DATA_DIR

_NF_DIR = Path("/app/nightfall")

_SW_UNREGISTER = "<script>if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(sw){sw.unregister();});});}</script>"

# Guest-accessible: /nightfall is a guest-playable game, so its save-slot API
# sits on the guest tier too, matching the page's own guest_protected auth.
# Slots are scoped PER CALLER (gamesave_store) -- the owner keeps the original
# paths, each guest gets its own file set. They were global files until
# 2026-09-01; see gamesave_store's module docstring for what that cost.
# Mounted in routers.py.
game_router = APIRouter()


def build_nightfall_html() -> str:
    # All /app/nightfall reads happen HERE (per request), never at import. The dir
    # is a bind-mounted nested repo; if it stales (a `git stash` that churns the
    # untracked tree, a host dir replace) an import-time read would FileNotFoundError
    # and crash the whole app on --reload -> 502 across every route. Reading lazily
    # contains a staled mount to /nightfall alone; the rest of the site stays up and
    # /nightfall self-heals once the mount is healthy again (no restart needed).
    nf_head = _SW_UNREGISTER + "<script>" + (_NF_DIR / "wai-head.js").read_text() + "</script>"
    nf_body = (_NF_DIR / "wai-body.html").read_text()
    nf_save_tpl = (_NF_DIR / "wai-save-sync.js").read_text()
    html = (_NF_DIR / "index.html").read_text()
    chunk_srcs = re.findall(r'<script src="(\./static/js/[^"]+\.js)"></script>', html)
    for src in chunk_srcs:
        html = html.replace(f'<script src="{src}"></script>', '', 1)
    abs_srcs = [
        s.replace('./', '/nightfall-game/', 1)
        + f'?v={int((_NF_DIR / s[2:]).stat().st_mtime)}'
        for s in chunk_srcs
    ]
    save_script = "<script>" + nf_save_tpl.replace('__SCRIPTS__', json.dumps(abs_srcs)) + "</script>"
    css_v = int((_NF_DIR / "static" / "css" / "bundle.css").stat().st_mtime)
    html = html.replace('./static/css/bundle.css', f'./static/css/bundle.css?v={css_v}', 1)
    # Standalone web-app meta (inlined to keep the game module isolated -- mirrors
    # pages._APPLE_WEBAPP_META): lets iOS run it without the Safari keyboard bar
    # once added to the Home Screen. Inert in a normal tab.
    _webapp_meta = (
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    )
    html = html.replace("<head>", '<head><base href="/nightfall-game/"><link rel="icon" href="/nightfall-game/hack.png">' + _webapp_meta + nf_head, 1)
    html = html.replace("</body>", nf_body + save_script + "</body>", 1)
    return html


def save_identity(request: Request) -> tuple[str | None, bool]:
    """Who is asking, for save-scoping purposes.

    Returns (guest_id, minted): `None` means the OWNER (full session cookie or
    the bearer key, both of which require_guest_auth already accepted), and the
    owner reads/writes the original unscoped paths. Anyone else is a guest and
    gets their own file set; `minted` is True when they arrived without a valid
    nf_save cookie, meaning the route must stamp one on its response.

    Bearer callers (scripts, the smoke suite) count as owner -- require_auth and
    require_guest_auth both accept API_KEY, so a bearer request is the owner by
    every other route's reckoning and must not be handed a guest bucket.
    """
    session = request.cookies.get("session") or ""
    if hmac.compare_digest(session, SESSION_TOKEN):
        return None, False
    cred = request.headers.get("authorization", "")
    if cred.startswith("Bearer ") and hmac.compare_digest(cred[7:], API_KEY):
        return None, False
    return guest_id_or_new(request.cookies.get(GUEST_COOKIE))


def set_guest_cookie(response: Response, guest_id: str) -> None:
    """Stamp the guest's save id. Long-lived on purpose: this is not an auth
    credential (the Turnstile-derived `guest_session` is), it is the only handle
    a guest has on their own save, so losing it on browser restart would read as
    "the game wiped my progress". 400 days is the browser-enforced ceiling.
    """
    response.set_cookie(
        GUEST_COOKIE, guest_id,
        max_age=400 * 86400, httponly=True, samesite="lax", secure=True,
    )


def _read_slot(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None  # missing, or raced with a delete -- both read as "no save"


# A save is a few KB of JSON (the owner's biggest is ~3.5KB). Guests are writers
# to the owner's disk now, so cap the body well above any real save but far
# below anything worth storing. Checked on the ENCODED length -- that is what
# actually lands on disk.
_MAX_SAVE_BYTES = 64 * 1024

# Housekeeping cadence for stale guest saves. The sync client POSTs on every
# in-game save (a dozen in a second is normal), so this must be a cheap counter,
# never a per-request scan.
_SWEEP_EVERY = 200
_writes_since_sweep = 0


def _maybe_sweep() -> None:
    global _writes_since_sweep
    _writes_since_sweep += 1
    if _writes_since_sweep >= _SWEEP_EVERY:
        _writes_since_sweep = 0
        sweep_stale_guest_saves(DATA_DIR)


@game_router.get("/api/gamesave")
def api_gamesave_all(request: Request, response: Response):
    gid, minted = save_identity(request)
    if minted:
        set_guest_cookie(response, gid)
    return {slot: _read_slot(slot_path(DATA_DIR, slot, gid)) for slot in VALID_SLOTS}


@game_router.get("/api/gamesave/{slot}")
def api_gamesave_get(slot: str, request: Request, response: Response):
    if not is_valid_slot(slot):
        raise HTTPException(status_code=400, detail="invalid slot")
    gid, minted = save_identity(request)
    if minted:
        set_guest_cookie(response, gid)
    return {"save": _read_slot(slot_path(DATA_DIR, slot, gid))}


@game_router.post("/api/gamesave/{slot}")
async def api_gamesave_post(slot: str, request: Request, response: Response):
    if not is_valid_slot(slot):
        raise HTTPException(status_code=400, detail="invalid slot")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="malformed request body")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="malformed request body")
    save_str = body.get("save")
    if not isinstance(save_str, str):
        raise HTTPException(status_code=400, detail="save must be a string")
    if len(save_str.encode()) > _MAX_SAVE_BYTES:
        raise HTTPException(status_code=413, detail="save too large")
    try:
        json.loads(save_str)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="save is not valid JSON")
    gid, minted = save_identity(request)
    if minted:
        set_guest_cookie(response, gid)
    # Atomic replace (tmp + rename), like helpers._save_rd -- a truncated write
    # (kill, force-recreate, full disk) must never destroy the prior save.
    p = slot_path(DATA_DIR, slot, gid)
    p.parent.mkdir(parents=True, exist_ok=True)  # first write by any guest
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(save_str)
    tmp.replace(p)
    _maybe_sweep()
    return {"ok": True}


@game_router.delete("/api/gamesave/{slot}")
def api_gamesave_delete(slot: str, request: Request, response: Response):
    if not is_valid_slot(slot):
        raise HTTPException(status_code=400, detail="invalid slot")
    gid, minted = save_identity(request)
    if minted:
        set_guest_cookie(response, gid)
    p = slot_path(DATA_DIR, slot, gid)
    if p.exists():
        p.unlink()
    return {"ok": True}
