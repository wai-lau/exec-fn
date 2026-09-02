"""The three top-level APIRouters, shared by every route module.

Defined here (not in main.py) so route modules can decorate them without
importing main — main imports the route modules, which would otherwise cycle.
Sub-routers (nightfall/chat/mtg/tarot) are folded in at their auth tier."""
from fastapi import APIRouter, Depends

from auth import require_auth, require_guest_auth
from routes_nightfall import game_router as nightfall_game
from routes_chat import router as chat_router
from mtg.routes import router as mtg_router
from tarot.routes import router as tarot_router

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
