"""noodle's routes, on two plain routers with NO auth of their own.

`router` is mounted on the site's `public` tier (a poll, by its link),
`guest_router` on the Turnstile-gated guest tier (starting a poll) and
`owner_router` on the `protected` (admin-only) tier (the poll list) -- by
routers.py, the composition root. That is
how only the owner creates polls without noodle importing the app's auth.
"""
import asyncio
import hashlib
import hmac
import json
import os
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from noodle import ask, config, drafts, e2e, host, pages, rekey, store, votes

router = APIRouter()
guest_router = APIRouter()   # mounted on the site's Turnstile-gated guest tier
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


# Same exemption token as auth.RATE_EXEMPT_TOKEN, derived here because noodle
# imports no other app module (test_noodle_isolation). Never exempt when
# API_KEY is unset: the hash of an empty key would be public knowledge.
_KEY = os.environ.get("API_KEY", "")
_RL_EXEMPT = hashlib.sha256(f"ratelimit-exempt:{_KEY}".encode()).hexdigest() if _KEY else None


def _rate_exempt(request: Request) -> bool:
    got = request.headers.get("x-ratelimit-exempt", "")
    return bool(_RL_EXEMPT and got) and hmac.compare_digest(got, _RL_EXEMPT)


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
async def noodle_vote_page(slug: str, t: str | None = None):
    # a DRAFT: no poll yet, but the owner's token for this slug (drafts.py),
    # which also says whether it will be end-to-end
    kind = None if store.exists(slug) else drafts.kind(slug, t)
    if kind:
        draft = {"slug": slug, "title": drafts.UNTITLED}
        if kind == "e2e":
            draft["e2e"] = 1
        return HTMLResponse(pages.vote_page(draft, draft=t), headers=_PRIVATE_PAGE)
    return HTMLResponse(pages.vote_page(_poll_or_404(slug)), headers=_PRIVATE_PAGE)


@router.get("/noodle/{slug}/results")
async def noodle_results_page(slug: str):
    # Results live on the vote page now (the calendar's dots + the roster);
    # links shared before that still land somewhere.
    _poll_or_404(slug)
    return RedirectResponse(f"/noodle/{slug}", status_code=301)


@router.get("/api/noodle/{slug}")
async def noodle_poll(slug: str):
    poll = _poll_or_404(slug)
    view = e2e.public(poll) if poll.get("e2e") else pages.public_poll(poll)
    return JSONResponse(view, headers=_NO_STORE)


@router.post("/api/noodle/{slug}/vote")
async def noodle_vote(slug: str, request: Request):
    body = await _json_body(request, config.BODY_MAX_VOTE)
    await asyncio.to_thread(drafts.ensure, slug, body)   # a draft's first commit writes it
    try:
        if await asyncio.to_thread(e2e.is_e2e, slug):
            return {"ok": True, **await asyncio.to_thread(e2e.vote, slug, body)}
        rec = await asyncio.to_thread(votes.submit, slug, body)
    except votes.VoteError as e:
        return JSONResponse({"error": e.msg}, status_code=e.status)
    return {"ok": True, "name": rec["name"], "slots": rec["slots"]}


async def _signed(plain, sealed, slug: str, request: Request):
    """One signed action, on whichever path the poll is: plain (the server
    reads it) or end-to-end (e2e.py -- it cannot)."""
    body = await _json_body(request, config.BODY_MAX_VOTE)
    if plain is host.settings:
        # a draft's first commit writes it -- a plain one; an end-to-end poll is
        # created by its host's first VOTE, which always comes first
        await asyncio.to_thread(drafts.ensure, slug, body, False)
    try:
        fn = sealed if await asyncio.to_thread(e2e.is_e2e, slug) else plain
        return await asyncio.to_thread(fn, slug, body)
    except votes.VoteError as e:
        return JSONResponse({"error": e.msg}, status_code=e.status)


@router.post("/api/noodle/{slug}/settings")
async def noodle_settings(slug: str, request: Request):
    """Host only (the first to save it claims a plain poll): split, crop, title, note."""
    return await _signed(host.settings, e2e.head, slug, request)


@router.post("/api/noodle/{slug}/remove")
async def noodle_remove(slug: str, request: Request):
    """Host only: remove a guest and their vote."""
    return await _signed(host.remove, e2e.remove, slug, request)


@router.post("/api/noodle/{slug}/rekey")
async def noodle_rekey(slug: str, request: Request):
    """Any voter: change their passphrase (the old key signs the new one)."""
    return await _signed(rekey.rekey, e2e.rekey, slug, request)


@router.post("/api/noodle/{slug}/ask")
async def noodle_ask(slug: str, request: Request):
    body = await _json_body(request, config.BODY_MAX_ASK)
    try:
        return await asyncio.to_thread(ask.ask, slug, body, _client_ip(request), _rate_exempt(request))
    except ask.AskError as e:
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        return JSONResponse({"error": e.msg, "retry_after": e.retry_after},
                            status_code=e.status, headers=headers)


@guest_router.get("/noodle", response_class=HTMLResponse)
async def noodle_admin_page(request: Request):
    """GUEST tier (behind Cloudflare Turnstile): any guest may start a poll. The list of polls on it is owner-only
    (GET /api/noodle-polls, below) -- a guest's page simply never shows it."""
    return HTMLResponse(pages.admin_page(request), headers=_NO_STORE)


@guest_router.post("/api/noodle-polls/new")
async def noodle_new(request: Request):
    """GUEST tier: a DRAFT poll -- a fresh slug and its token, NOTHING stored; the
    host's first commit creates it (drafts.py). Rate-limited per IP, since
    every draft is a poll someone may create."""
    try:
        if _rate_exempt(request):
            d = await asyncio.to_thread(drafts.new)
        else:
            d = await asyncio.to_thread(drafts.new_for, _client_ip(request))
    except drafts.TooFast as e:
        return JSONResponse({"detail": str(e)}, status_code=429)
    return {"slug": d["slug"], "url": f"/noodle/{d['slug']}?t={d['token']}"}


# ── owner only (mounted on the protected tier by routers.py) ───────────────


@owner_router.get("/api/noodle-polls")
async def noodle_list():
    # ids + times only: the links are the keys and the server keeps none
    # (store.py). The owner's browser puts titles on the ones it has opened.
    return {"polls": await asyncio.to_thread(store.all_polls)}


@owner_router.post("/api/noodle-polls")
async def noodle_create(request: Request):
    body = await _json_body(request, config.BODY_MAX_CREATE)
    # a title and nothing else: the dates are the host's to set
    title = " ".join(str(body.get("title", "")).split())
    if not title or len(title) > config.TITLE_MAX:
        raise HTTPException(400, f"title must be 1-{config.TITLE_MAX} characters")
    now = datetime.now().isoformat(timespec="seconds")
    poll = await asyncio.to_thread(store.create, title, now)
    return {"slug": poll["slug"], "url": f"/noodle/{poll['slug']}"}


@owner_router.delete("/api/noodle-polls/{ref}")
async def noodle_delete(ref: str):
    """Delete a poll and every vote in it, by its link's slug or its file id
    (the list knows ids only). The owner page asks first."""
    try:
        fn = store.delete if store.valid_slug(ref) else store.delete_id
        gone = await asyncio.to_thread(fn, ref)
    except KeyError:
        gone = False
    if not gone:
        raise HTTPException(404, "no such poll")
    return {"ok": True}
