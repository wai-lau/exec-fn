import asyncio, os, re, json, secrets, hashlib
from pathlib import Path
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Cookie, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Security
from pydantic import BaseModel
from typing import Optional, List

import pipeline

API_KEY = os.environ["API_KEY"]
bearer = HTTPBearer(auto_error=False)
SESSION_TOKEN = hashlib.sha256(f"session:{API_KEY}".encode()).hexdigest()
DATA_DIR = Path("/app/data")
_TMPL = Path("/app/templates")

_GREEN_OVERLAY = """
<style>
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(0, 255, 65, 0.45); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0, 255, 65, 0.85); }
  * { scrollbar-width: thin; scrollbar-color: rgba(0,255,65,0.45) transparent; }
  .exec-nav {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
    height: 52px; display: flex; align-items: center; justify-content: center; gap: 32px;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(10px);
    border-top: 1px solid rgba(0,255,65,0.12);
  }
  .exec-nav a {
    color: rgba(0, 255, 65, 0.65);
    font-family: monospace;
    font-size: 0.85rem;
    text-decoration: none;
    border-bottom: 1px solid rgba(0, 255, 65, 0.3);
    transition: color 0.2s, border-bottom-color 0.2s;
  }
  .exec-nav a:hover { color: rgba(0, 255, 65, 1); border-bottom-color: rgba(0, 255, 65, 1); }
  .exec-nav a[style*="opacity:1"] { color: rgba(0,255,65,1); border-bottom-color: rgba(0,255,65,1); }
</style>
"""

_CONTENT_STYLE = """
<style>
  body { display: block; height: auto; min-height: 100vh; overflow-y: auto; }
  #content {
    position: relative;
    z-index: 2;
    width: min(720px, 90vw);
    margin: 64px auto 80px;
    font-family: monospace;
    color: rgba(0, 255, 65, 1);
  }
  #content h2 {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    opacity: 0.65;
    margin: 28px 0 8px;
    border-bottom: 1px solid rgba(0, 255, 65, 0.25);
    padding-bottom: 4px;
  }
  #content .item {
    font-size: 0.85rem;
    padding: 5px 0;
    border-bottom: 1px solid rgba(0, 255, 65, 0.12);
  }
  #content button {
    background: none;
    border: 1px solid rgba(0, 255, 65, 0.5);
    color: rgba(0, 255, 65, 0.85);
    font-family: monospace;
    font-size: 0.8rem;
    padding: 4px 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  #content button:hover { border-color: rgba(0, 255, 65, 1); color: rgba(0, 255, 65, 1); }
  #content button:disabled { opacity: 0.35; cursor: default; }
  #content .ts { font-size: 0.7rem; opacity: 0.5; margin-top: 16px; }
</style>
"""

_NAV_LINKS = ["exec", "plan", "看板", "vault", "媁"]
_NAV_HREFS = {"exec": "/exec", "plan": "/plan", "看板": "/rd", "vault": "/archive", "媁": "/nightfall"}


def _build_nav(active=None):
    links = []
    for label in _NAV_LINKS:
        href = _NAV_HREFS.get(label, f"/{label}")
        style = ' style="opacity:1;border-bottom-color:rgba(0,255,65,0.9);"' if label == active else ""
        links.append(f'<a href="{href}"{style}>{label}</a>')
    return '<div class="exec-nav">' + " &nbsp; ".join(links) + "</div>"


with open("/app/static/index.html") as f:
    _INDEX = f.read()

_NO_FORM = re.sub(r'<form class="login-box".*?</form>', '', _INDEX, flags=re.DOTALL)
_BARE = re.sub(r'<div class="bg-wide">.*?</div>', '', _NO_FORM, flags=re.DOTALL)
_BARE = re.sub(r'<div class="bg-tall">.*?</div>', '', _BARE, flags=re.DOTALL)
_BARE = re.sub(r'<a href="[^"]*" target="_blank">.*?</a>', '', _BARE, flags=re.DOTALL)


def _build_page(active=None, content=""):
    base = _BARE if active else _NO_FORM
    head_inject = _GREEN_OVERLAY + (_CONTENT_STYLE if content else "")
    return (base
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", content + _build_nav(active) + "</body>", 1))


# ── templates ─────────────────────────────────────────────────────────────────

_VAULT_HTML    = (_TMPL / "vault.html").read_text()
_KANBAN_HTML   = (_TMPL / "kanban.html").read_text()
_PLAN_HTML     = (_TMPL / "plan.html").read_text()
_EXEC_HTML     = (_TMPL / "exec.html").read_text()


# ── app ───────────────────────────────────────────────────────────────────────

app = FastAPI()


def require_auth(
    session: Optional[str] = Cookie(default=None),
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer),
):
    if session == SESSION_TOKEN:
        return
    if credentials and credentials.credentials == API_KEY:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


public = APIRouter()
protected = APIRouter(dependencies=[Depends(require_auth)])


# ── public ────────────────────────────────────────────────────────────────────

@public.get("/nightfall", response_class=HTMLResponse)
async def nightfall():
    html = Path("/app/nightfall/index.html").read_text()
    html = html.replace("<head>", '<head><base href="/nightfall-game/"><link rel="icon" href="/nightfall-game/hack.png">', 1)
    return HTMLResponse(html)


@public.post("/login")
async def login(request: Request):
    form = await request.form()
    key = form.get("key", "")
    if not secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid key")
    resp = RedirectResponse(url="/exec", status_code=303)
    resp.set_cookie("session", SESSION_TOKEN, httponly=True, samesite="lax", secure=False)
    return resp


# ── pages ─────────────────────────────────────────────────────────────────────

@protected.get("/exec", response_class=HTMLResponse)
async def exec_page():
    return (_BARE
        .replace("</head>", _GREEN_OVERLAY + "</head>", 1)
        .replace("</body>", _EXEC_HTML + _build_nav(None) + "</body>", 1))


@protected.get("/plan", response_class=HTMLResponse)
async def plan_page():
    return _build_page("plan", _PLAN_HTML)


@protected.get("/directives")
async def directives_page():
    return RedirectResponse(url="/exec", status_code=302)


@protected.get("/omens")
async def omens_page():
    return RedirectResponse(url="/exec", status_code=302)


@protected.get("/rd", response_class=HTMLResponse)
async def rd_page():
    head_inject = _GREEN_OVERLAY + "<style>body{display:block;height:100vh;overflow:hidden!important;}</style>"
    return (_BARE
        .replace("</head>", head_inject + "</head>", 1)
        .replace("</body>", _KANBAN_HTML + _build_nav("看板") + "</body>", 1))


@protected.get("/archive", response_class=HTMLResponse)
async def archive_page():
    return _build_page("vault", _VAULT_HTML)


# ── data file serving ─────────────────────────────────────────────────────────

@protected.get("/data/{filename:path}")
async def serve_data(filename: str):
    path = (DATA_DIR / filename).resolve()
    if not str(path).startswith(str(DATA_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))


# ── api ───────────────────────────────────────────────────────────────────────

@protected.post("/api/pull")
def api_pull():
    try:
        return {"file": Path(pipeline.pull_exec()).name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/morning")
def api_morning_get():
    from datetime import date
    p = DATA_DIR / "morning.json"
    if p.exists():
        data = json.loads(p.read_text())
        generated = data.get("generated_at", "")[:10]
        if generated == date.today().isoformat():
            return data
    try:
        return pipeline.build_morning()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/morning")
def api_morning():
    try:
        return pipeline.build_morning()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ChatBody(BaseModel):
    messages: List[dict] = []
    stage: str = "planning"


@protected.get("/api/chat")
def api_chat_get():
    return pipeline.get_chat()


@protected.delete("/api/chat")
def api_chat_clear():
    p = DATA_DIR / "chat.json"
    if p.exists():
        p.unlink()
    return {"ok": True}


@protected.post("/api/chat")
async def api_chat(body: ChatBody):
    import anthropic as _anthropic

    messages = body.messages
    stage = body.stage

    async def generate():
        client = _anthropic.AsyncAnthropic()
        system_prompt = pipeline._build_chat_system_prompt(stage)
        tools = pipeline._chat_tools()
        next_stage = stage
        full_text = ""
        final = None

        try:
            async with client.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                system=system_prompt,
                tools=tools,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    full_text += text
                    yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
                final = await stream.get_final_message()
        except Exception as e:
            yield f"data: {json.dumps({'type': 'text', 'delta': f'[error: {e}]'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'next_stage': stage})}\n\n"
            return

        assistant_content = []
        for block in final.content:
            if block.type == "text":
                assistant_content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                assistant_content.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})

        all_messages = messages + [{"role": "assistant", "content": assistant_content}]
        tool_result_contents = []

        for block in final.content:
            if block.type == "tool_use":
                result = await asyncio.to_thread(pipeline._handle_tool, block.name, block.input)
                if block.name == "finalize_and_push":
                    next_stage = "done"
                yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'result': result})}\n\n"
                tool_result_contents.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                })

        if tool_result_contents:
            all_messages.append({"role": "user", "content": tool_result_contents})
            cont_text = ""
            try:
                async with client.messages.stream(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=512,
                    system=pipeline._build_chat_system_prompt(next_stage),
                    tools=tools,
                    messages=all_messages,
                ) as stream2:
                    async for text in stream2.text_stream:
                        cont_text += text
                        yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
                    final2 = await stream2.get_final_message()
                if cont_text:
                    all_messages.append({"role": "assistant", "content": [{"type": "text", "text": cont_text}]})
            except Exception:
                pass

        pipeline._save_chat(all_messages, next_stage)
        yield f"data: {json.dumps({'type': 'done', 'next_stage': next_stage})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@protected.get("/api/archive")
def api_archive():
    return pipeline.list_archive()


_PNG_CACHE = DATA_DIR / "cache"


@protected.get("/api/archive/{filename}/page/{page_num}")
def archive_page_png(filename: str, page_num: int):
    from fastapi.responses import Response
    from rm_to_pdf import rasterize
    p = (DATA_DIR / filename).resolve()
    if not str(p).startswith(str(DATA_DIR.resolve())) or not p.exists():
        raise HTTPException(status_code=404, detail="not found")
    if filename.endswith(".png"):
        return Response(content=p.read_bytes(), media_type="image/png")
    if not filename.endswith(".rmdoc"):
        raise HTTPException(status_code=404, detail="not found")
    _PNG_CACHE.mkdir(exist_ok=True)
    cache_file = _PNG_CACHE / f"{filename}.page{page_num}.png"
    if cache_file.exists():
        return Response(content=cache_file.read_bytes(), media_type="image/png")
    png_bytes = rasterize(str(p), page_index=page_num)
    cache_file.write_bytes(png_bytes)
    return Response(content=png_bytes, media_type="image/png")


@protected.get("/api/cache")
def api_cache():
    """List pre-rendered PNGs in the cache folder, grouped by source doc, newest first."""
    cache_dir = _PNG_CACHE
    if not cache_dir.exists():
        return []
    from collections import defaultdict
    import re as _re
    groups = defaultdict(list)
    for f in sorted(cache_dir.glob("*.png"), reverse=True):
        m = _re.match(r'^(.+\.rmdoc)\.page(\d+)\.png$', f.name)
        if m:
            groups[m.group(1)].append((int(m.group(2)), f.name))
    result = []
    for doc, pages in sorted(groups.items(), reverse=True):
        pages.sort()
        result.append({
            "doc": doc,
            "label": doc.replace(".rmdoc", ""),
            "pages": [f"/data/cache/{name}" for _, name in pages],
        })
    return result


@protected.get("/api/rd")
def api_rd():
    p = DATA_DIR / "rd.json"
    return json.loads(p.read_text()) if p.exists() else {"columns": ["rd","hq","archives","exile"], "cards": []}


@protected.patch("/api/rd")
async def api_rd_patch(request: Request):
    body = await request.json()
    p = DATA_DIR / "rd.json"
    data = json.loads(p.read_text()) if p.exists() else {"columns": ["rd","hq","archives","exile"]}
    data["cards"] = body.get("cards", [])
    p.write_text(json.dumps(data, indent=2))
    return {"ok": True}


@protected.post("/api/rd/classify")
async def api_rd_classify(request: Request):
    body = await request.json()
    title = body.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    try:
        return pipeline.classify_card(title)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/context")
def api_context():
    p = DATA_DIR / "context.json"
    return json.loads(p.read_text()) if p.exists() else {"notes": []}


@protected.get("/api/delta")
def api_delta_get():
    d = pipeline._load_all_recent_deltas()
    if not d:
        raise HTTPException(status_code=404, detail="No delta yet")
    return d


@protected.post("/api/delta")
def api_delta_run():
    try:
        return pipeline.analyze_delta()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/directives")
def api_directives_get():
    p = DATA_DIR / "directives.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No directives yet")
    return json.loads(p.read_text())


@protected.get("/api/plan")
def api_plan_get():
    p = DATA_DIR / "plan.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No plan yet")
    return json.loads(p.read_text())


@protected.post("/api/push")
def api_push():
    try:
        return {"pdf": pipeline.push_pdf()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/assemble_plan")
def api_assemble_plan():
    try:
        p = DATA_DIR / "directives.json"
        d = json.loads(p.read_text()) if p.exists() else {}
        seek_ids = [c["id"] for c in d.get("seek", []) if isinstance(c, dict)]
        hack_ids = [c["id"] for c in d.get("hack", []) if isinstance(c, dict)]
        dive_ids = [c["id"] for c in d.get("dive", []) if isinstance(c, dict)]
        result = pipeline._handle_tool("assemble_plan", {
            "seek_ids": seek_ids, "hack_ids": hack_ids, "dive_ids": dive_ids,
        })
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/build_pdf")
def api_build_pdf():
    try:
        return pipeline._handle_tool("build_pdf", {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/omens")
def api_omens_get():
    p = DATA_DIR / "omens.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No omens yet")
    return json.loads(p.read_text())


@protected.post("/api/omens")
def api_omens_run():
    try:
        return pipeline.analyze_omens()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.include_router(public)
app.include_router(protected)
app.mount("/nightfall-game", StaticFiles(directory="/app/nightfall"), name="nightfall")
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
