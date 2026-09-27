"""Noodle's routes, on two plain routers with NO auth of their own.

`router` is mounted on the site's `public` tier and `owner_router` on its
`protected` (admin-only) tier -- by routers.py, the composition root. That is
how only the owner creates polls without Noodle importing the app's auth.
"""
import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from noodle import ask, config, pages, slots, store, votes

router = APIRouter()
owner_router = APIRouter()

_NO_STORE = {"Cache-Control": "no-store"}
_PRIVATE_PAGE = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex",
                 "Referrer-Policy": "no-referrer"}


async def _json_body(request: Request, cap: int) -> dict:
    """Read at most `cap` bytes. The declared length is checked first (cheap
    refusal), then the actual bytes -- a chunked body declares nothing."""
    declared = request.headers.get("content-length")
    if declared and (not declared.isdigit() or int(declared) > cap):
        raise HTTPException(413, "request too large")
    raw = b""
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > cap:
            raise HTTPException(413, "request too large")
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "body is not JSON") from None
    if not isinstance(data, dict):
        raise HTTPException(400, "body must be an object")
    return data


def _client_ip(request: Request) -> str:
    # Behind the one trusted nginx: X-Real-IP, else the LAST X-Forwarded-For hop.
    xff = request.headers.get("x-forwarded-for", "")
    return (request.headers.get("x-real-ip")
            or (xff.rsplit(",", 1)[-1].strip() if xff else "")
            or (request.client.host if request.client else "unknown"))


def _poll_or_404(slug: str) -> dict:
    try:
        return store.load(slug)
    except KeyError:
        raise HTTPException(404, "no such poll") from None


# ── public: anyone holding the link ─────────────────────────────────────────
@router.get("/noodle/{slug}", response_class=HTMLResponse)
async def noodle_vote_page(slug: str):
    return HTMLResponse(pages.vote_page(_poll_or_404(slug)), headers=_PRIVATE_PAGE)


@router.get("/noodle/{slug}/results")
async def noodle_results_page(slug: str):
    # Results live on the vote page now (the calendar's dots + the roster);
    # links shared before that still land somewhere.
    _poll_or_404(slug)
    return RedirectResponse(f"/noodle/{slug}", status_code=301)


@router.get("/api/noodle/{slug}")
async def noodle_poll(slug: str):
    return JSONResponse(pages.public_poll(_poll_or_404(slug)), headers=_NO_STORE)


@router.post("/api/noodle/{slug}/vote")
async def noodle_vote(slug: str, request: Request):
    body = await _json_body(request, config.BODY_MAX_VOTE)
    try:
        rec = await asyncio.to_thread(votes.submit, slug, body)
    except votes.VoteError as e:
        return JSONResponse({"error": e.msg}, status_code=e.status)
    return {"ok": True, "name": rec["name"], "slots": rec["slots"]}


@router.post("/api/noodle/{slug}/ask")
async def noodle_ask(slug: str, request: Request):
    body = await _json_body(request, config.BODY_MAX_ASK)
    try:
        return await asyncio.to_thread(ask.ask, slug, body, _client_ip(request))
    except ask.AskError as e:
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        return JSONResponse({"error": e.msg, "retry_after": e.retry_after},
                            status_code=e.status, headers=headers)


# ── owner only (mounted on the protected tier by routers.py) ───────────────
@owner_router.get("/noodle", response_class=HTMLResponse)
async def noodle_admin_page():
    return HTMLResponse(pages.admin_page(), headers=_NO_STORE)


@owner_router.get("/api/noodle-polls")
async def noodle_list():
    polls = await asyncio.to_thread(store.all_polls)
    return {"polls": [{"slug": p["slug"], "title": p["title"], "start": p["start"],
                       "end": p["end"], "voters": len(p["voters"])} for p in polls]}


@owner_router.post("/api/noodle-polls")
async def noodle_create(request: Request):
    body = await _json_body(request, config.BODY_MAX_CREATE)
    title = " ".join(str(body.get("title", "")).split())
    if not title or len(title) > config.TITLE_MAX:
        raise HTTPException(400, f"title must be 1-{config.TITLE_MAX} characters")
    try:
        slots.parse_window(str(body.get("start")), str(body.get("end")))
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    now = datetime.now().isoformat(timespec="seconds")
    poll = await asyncio.to_thread(store.create, title, body["start"], body["end"], now)
    return {"slug": poll["slug"], "url": f"/noodle/{poll['slug']}"}
