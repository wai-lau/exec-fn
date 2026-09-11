"""Owner-only /cc page + routes fronting the sandboxed Claude Code sidecar.

OWNER-ONLY IS LOAD-BEARING, and more so than on any other route here. The
sidecar hands whoever reaches it a shell with Write and Bash inside
/srv/cc-sandbox, and it spends the subscription's per-account rate budget. It
sits on `protected` (full session cookie) and must never move to
`guest_protected` -- there is no per-caller scoping that would make a guest tier
safe, the way gamesave_store made /nightfall's slots safe.

Sidecar transport, sandboxing and the one-time login live in
/exec-fn/claude-box/README.md."""

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

import cc_client
from pages import _render_page, _tmpl
from routers import protected

# The sidecar reads the whole body into memory before parsing; clamp here too so
# an oversized request is a clean 4xx from us rather than a truncated stream from
# it. Images ride in the same body, which is why the ceiling is megabytes: the
# page downscales a paste to ~1568px first (Claude downsamples above that
# anyway), so a phone photo arrives ~200KB and these are guards, not the norm.
_MAX_PROMPT = 32_000
_MAX_IMAGES = 4
_MAX_IMAGE_B64 = 5 * 1024 * 1024


@protected.get("/cc", response_class=HTMLResponse)
async def cc_page():
    return _render_page("cc", _tmpl("cc.html"))


@protected.get("/api/cc/health")
async def cc_health():
    return JSONResponse(await cc_client.health())


@protected.get("/api/cc/limits")
async def cc_limits():
    """Subscription usage windows for the status bar. Owner-only like the rest
    of /cc — it reports how much of Wai's own plan is spent."""
    return JSONResponse(await cc_client.limits())


@protected.get("/api/cc/history")
async def cc_history():
    """The ongoing conversation. /cc is ONE continuing thread — the session id
    lives on the sidecar, not the page, so a reload resumes rather than starting
    over (it used to start over every single load)."""
    return JSONResponse(await cc_client.history())


@protected.post("/api/cc/new")
async def cc_new():
    return JSONResponse(await cc_client.new_conversation())


@protected.post("/api/cc/query")
async def cc_query(request: Request):
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    images = body.get("images") or []
    if not isinstance(images, list):
        images = []
    # An image with no words is a legitimate message ("what is this?"), so the
    # emptiness check is on BOTH, not on the text alone.
    if not prompt and not images:
        return JSONResponse({"error": "prompt or image required"}, status_code=400)
    if len(prompt) > _MAX_PROMPT:
        return JSONResponse({"error": "prompt too long"}, status_code=413)
    if len(images) > _MAX_IMAGES:
        return JSONResponse({"error": f"at most {_MAX_IMAGES} images"}, status_code=413)
    if any(len((im or {}).get("data") or "") > _MAX_IMAGE_B64 for im in images):
        return JSONResponse({"error": "image too large"}, status_code=413)
    return StreamingResponse(
        cc_client.stream_query(prompt, images),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # nginx buffers proxied responses by default, which would hold the
            # whole agent run and deliver it at the end -- the stream is the
            # entire point of the page.
            "X-Accel-Buffering": "no",
        },
    )
