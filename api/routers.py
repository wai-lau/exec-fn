"""The three top-level APIRouters, shared by every route module.

Defined here (not in main.py) so route modules can decorate them without
importing main — main imports the route modules, which would otherwise cycle.
Sub-routers (nightfall/chat/mtg/tarot) are folded in at their auth tier."""
from fastapi import APIRouter, Depends

from auth import require_auth, require_guest_auth
from routes_nightfall import protected_router as nightfall_protected
from routes_chat import router as chat_router
from mtg.routes import router as mtg_router
from tarot.routes import router as tarot_router

public = APIRouter()
protected = APIRouter(dependencies=[Depends(require_auth)])
guest_protected = APIRouter(dependencies=[Depends(require_guest_auth)])

protected.include_router(nightfall_protected)
protected.include_router(chat_router)
guest_protected.include_router(mtg_router)
guest_protected.include_router(tarot_router)
