"""The three top-level APIRouters, shared by every route module.

Defined here (not in main.py) so route modules can decorate them without
importing main — main imports the route modules, which would otherwise cycle.
Sub-routers (nightfall/chat/mtg/tarot) are folded in at their auth tier."""
from fastapi import APIRouter, Depends

import app_paths  # noqa: F401  — FIRST: puts apps/*/api on sys.path (submodule apps)
from auth import require_auth, require_guest_auth
from routes_nightfall import game_router as nightfall_game
from routes_chat import router as chat_router
from mtg.routes import router as mtg_router
from tarot.routes import router as tarot_router
from noodle.routes import router as noodle_router
from noodle.routes import owner_router as noodle_owner_router
from noodle.routes import guest_router as noodle_guest_router
from noodle import pages as noodle_pages

public = APIRouter()
protected = APIRouter(dependencies=[Depends(require_auth)])
guest_protected = APIRouter(dependencies=[Depends(require_guest_auth)])

# nightfall gamesave API is guest-accessible (the game itself is guest-playable).
# Guest WRITE access to a shared store is only safe because the slots are scoped
# per caller (gamesave_store): the owner's save is permanent at the original
# paths, each guest gets its own set keyed to an nf_save cookie. Slot names are
# still allowlisted, and the guest path component is a sha256 digest, so neither
# can traverse the data dir.
guest_protected.include_router(nightfall_game)
protected.include_router(chat_router)
guest_protected.include_router(mtg_router)
guest_protected.include_router(tarot_router)
# Noodle is standalone and carries no auth of its own: its poll pages are open
# to anyone holding the unguessable link, and creating a poll is owner-only
# because THIS file mounts that router on `protected`. Noodle never imports auth.
public.include_router(noodle_router)
protected.include_router(noodle_owner_router)
guest_protected.include_router(noodle_guest_router)


def _noodle_nav(request):
    # the owner gets the owner's nav, anyone else the guest's (as /mtg does)
    from auth import SESSION_TOKEN
    from pages import _build_nav
    return _build_nav("noodle", guest=request.cookies.get("session") != SESSION_TOKEN)


def _noodle_owner(request):
    from auth import SESSION_TOKEN
    return request.cookies.get("session") == SESSION_TOKEN


noodle_pages.set_nav(_noodle_nav)
noodle_pages.set_owner(_noodle_owner)


# The vote page's Subresource-Integrity resolver (noodle pages.set_sri): the
# served bytes for a root-relative /x.js, resolved the SAME way the static mount
# and asset_version do (app_paths.web_dirs, parent web/ then each app's). noodle
# cannot import app_paths (its isolation test), so the root hands this in.
def _noodle_sri_bytes(url: str):
    rel = url.lstrip("/")
    if ".." in rel.split("/"):
        return None
    for d in app_paths.web_dirs():
        f = d / rel
        if f.is_file():
            return f.read_bytes()
    return None


noodle_pages.set_sri(_noodle_sri_bytes)
