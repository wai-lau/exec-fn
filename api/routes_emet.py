"""Owner-only /emet page + JSON routes wrapping Wai's "emet" knowledge-graph MCP.

A utilitarian test harness for the three MCP tools (recall / scope / ask), gated
behind the full session cookie (same tier as /security -- no guest access). Each
API route wraps one tool 1:1 and returns its dict verbatim, or
{"unreachable": True} when the home box / reverse tunnel is down (emet_client
swallows the failure so nothing here 500s)."""

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse

import emet_client
from pages import _render_page, _tmpl
from routers import protected


@protected.get("/emet", response_class=HTMLResponse)
async def emet_page():
    return _render_page("emet", _tmpl("emet.html"), full_height=True)


@protected.post("/api/emet/recall")
async def emet_recall(request: Request):
    body = await request.json()
    topic = (body.get("topic") or "").strip()
    return JSONResponse(await emet_client.call_tool("recall", {"topic": topic}))


@protected.post("/api/emet/scope")
async def emet_scope(request: Request):
    body = await request.json()
    node_id = (body.get("node_id") or "").strip()
    try:
        hops = int(body.get("hops", 1))
    except (TypeError, ValueError):
        hops = 1
    return JSONResponse(await emet_client.call_tool("scope", {"node_id": node_id, "hops": hops}))


@protected.post("/api/emet/ask")
async def emet_ask(request: Request):
    body = await request.json()
    question = (body.get("question") or "").strip()
    topic = (body.get("topic") or "").strip()
    args = {"question": question}
    if topic:
        args["topic"] = topic
    return JSONResponse(await emet_client.call_tool("ask", args))
