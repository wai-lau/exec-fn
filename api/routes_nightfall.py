import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from helpers import DATA_DIR

_NF_DIR = Path("/app/nightfall")

_SW_UNREGISTER = "<script>if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(sw){sw.unregister();});});}</script>"
_NIGHTFALL_HEAD = _SW_UNREGISTER + "<script>" + (_NF_DIR / "wai-head.js").read_text() + "</script>"
_NIGHTFALL_BODY = (_NF_DIR / "wai-body.html").read_text()
_NIGHTFALL_SAVE_SCRIPT_TPL = (_NF_DIR / "wai-save-sync.js").read_text()

_VALID_SAVE_SLOTS = {"save1", "save2", "save3"}

protected_router = APIRouter()


def build_nightfall_html() -> str:
    html = (_NF_DIR / "index.html").read_text()
    chunk_srcs = re.findall(r'<script src="(\./static/js/[^"]+\.js)"></script>', html)
    for src in chunk_srcs:
        html = html.replace(f'<script src="{src}"></script>', '', 1)
    abs_srcs = [
        s.replace('./', '/nightfall-game/', 1)
        + f'?v={int((_NF_DIR / s[2:]).stat().st_mtime)}'
        for s in chunk_srcs
    ]
    save_script = "<script>" + _NIGHTFALL_SAVE_SCRIPT_TPL.replace('__SCRIPTS__', json.dumps(abs_srcs)) + "</script>"
    css_v = int((_NF_DIR / "static" / "css" / "bundle.css").stat().st_mtime)
    html = html.replace('./static/css/bundle.css', f'./static/css/bundle.css?v={css_v}', 1)
    # Standalone web-app meta (inlined to keep the game module isolated -- mirrors
    # pages._APPLE_WEBAPP_META): lets iOS run it without the Safari keyboard bar
    # once added to the Home Screen. Inert in a normal tab.
    _webapp_meta = (
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    )
    html = html.replace("<head>", '<head><base href="/nightfall-game/"><link rel="icon" href="/nightfall-game/hack.png">' + _webapp_meta + _NIGHTFALL_HEAD, 1)
    html = html.replace("</body>", _NIGHTFALL_BODY + save_script + "</body>", 1)
    return html


@protected_router.get("/api/gamesave")
def api_gamesave_all():
    result = {}
    for slot in ["save1", "save2", "save3"]:
        p = DATA_DIR / f"gamesave_{slot}.json"
        result[slot] = p.read_text() if p.exists() else None
    return result


@protected_router.get("/api/gamesave/{slot}")
def api_gamesave_get(slot: str):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    p = DATA_DIR / f"gamesave_{slot}.json"
    return {"save": p.read_text() if p.exists() else None}


@protected_router.post("/api/gamesave/{slot}")
async def api_gamesave_post(slot: str, request: Request):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    body = await request.json()
    save_str = body.get("save")
    if not isinstance(save_str, str):
        raise HTTPException(status_code=400, detail="save must be a string")
    try:
        json.loads(save_str)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="save is not valid JSON")
    (DATA_DIR / f"gamesave_{slot}.json").write_text(save_str)
    return {"ok": True}


@protected_router.delete("/api/gamesave/{slot}")
def api_gamesave_delete(slot: str):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    p = DATA_DIR / f"gamesave_{slot}.json"
    if p.exists():
        p.unlink()
    return {"ok": True}
