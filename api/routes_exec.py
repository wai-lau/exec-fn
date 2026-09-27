"""Routes the Claude Code sidecar calls to run Exec's card tools.

Both on the `public` router with the check done in-handler, because the caller
(claude-box/exec-tools.mjs, on the droplet host) has no session cookie. The
credential is the sidecar's shared secret (CC_SIDECAR_TOKEN), deliberately NOT
the admin API_KEY: the agent driving these tools also has Bash, so anything the
sidecar holds must be assumed readable by it -- and this token reaches nothing
but the card tools the agent can already call. An unset token refuses every
call rather than matching "". See docs/plan-exec-cc-merge.md."""

import hmac
import os

from fastapi import Request
from fastapi.responses import JSONResponse

from chat import _chat_tools
from exec_tools import run_tool
from monitor_sse import push_to_monitor
from routers import public

_TOKEN = os.environ.get("CC_SIDECAR_TOKEN", "")


def _authed(request: Request) -> bool:
    return bool(_TOKEN) and hmac.compare_digest(request.headers.get("x-cc-token", ""), _TOKEN)


@public.get("/api/exec/tools")
async def exec_tool_schemas(request: Request):
    """The tool schemas, from the one definition the chat path uses too."""
    if not _authed(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return {"tools": _chat_tools()}


@public.post("/api/exec/tool/{name}")
async def exec_tool_call(name: str, request: Request):
    if not _authed(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        input_ = await request.json()
    except Exception:
        return JSONResponse({"error": "bad json"}, status_code=400)
    if not isinstance(input_, dict):
        return JSONResponse({"error": "input must be an object"}, status_code=400)
    result, board_changed = await run_tool(name, input_)
    # The panel lives ON /rd + /hq: push now so the board moves while the
    # reply is still being written.
    if board_changed:
        await push_to_monitor({"cards_changed": True})
    return {"result": result}
