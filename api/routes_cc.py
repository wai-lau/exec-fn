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

# The sidecar reads the whole body into memory before parsing and caps it at
# 64KB; clamp here too so an oversized prompt is a clean 400 from us rather than
# a truncated stream from it.
_MAX_PROMPT = 32_000


@protected.get("/cc", response_class=HTMLResponse)
async def cc_page():
    return _render_page("cc", _tmpl("cc.html"))


@protected.get("/api/cc/health")
async def cc_health():
    return JSONResponse(await cc_client.health())


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
    if not prompt:
        return JSONResponse({"error": "prompt required"}, status_code=400)
    if len(prompt) > _MAX_PROMPT:
        return JSONResponse({"error": "prompt too long"}, status_code=413)
    return StreamingResponse(
        cc_client.stream_query(prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # nginx buffers proxied responses by default, which would hold the
            # whole agent run and deliver it at the end -- the stream is the
            # entire point of the page.
            "X-Accel-Buffering": "no",
        },
    )
