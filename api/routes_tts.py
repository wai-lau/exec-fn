"""TTS page + WebSocket reverse-proxy to the home GPU server.

The TTS models (Kokoro/Chatterbox) run on a home box reached over an SSH
reverse tunnel bound to the Docker bridge gateway on the droplet. This serves
the /tts UI behind the normal session auth and proxies its WebSocket + the
voices list through to that upstream, so the browser only ever talks
same-origin -- cookie auth, which (unlike HTTP basic auth) rides the WS
handshake reliably on mobile."""

import asyncio
import json
import os

import httpx
import websockets
from fastapi import Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse

from auth import GUEST_SESSION_TOKEN, SESSION_TOKEN
from pages import _render_page, _tmpl
from routers import guest_protected, public
from tts_routing import merge_voices, pick_upstream

# Docker bridge gateway -> host loopback :8123 (the SSH tunnel to the home box).
_UPSTREAM = os.environ.get("TTS_UPSTREAM", "172.17.0.1:8123")
# Always-on droplet-local piper (glados). Separate from the home GPU tunnel.
_PIPER_UPSTREAM = os.environ.get("TTS_PIPER_UPSTREAM", "hosaka-piper:8123")


@guest_protected.get("/hosaka", response_class=HTMLResponse)
async def tts_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    return _render_page("hosaka", _tmpl("tts.html"), full_height=True, guest=not is_full_auth)


async def _get_voices(upstream: str):
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(f"http://{upstream}/v1/voices")
        return r.json()


@guest_protected.get("/api/hosaka/voices")
async def tts_voices():
    async def safe(upstream: str):
        try:
            return await _get_voices(upstream)
        except Exception:
            return []

    # Concurrent: a slow/down home box must not stall the page-load behind its
    # full timeout (the piper side is local and fast). Mirrors tts_health.
    piper_voices, home_voices = await asyncio.gather(safe(_PIPER_UPSTREAM), safe(_UPSTREAM))
    return JSONResponse(merge_voices(piper_voices, home_voices))


@guest_protected.get("/api/hosaka/health")
async def tts_health():
    """ok if EITHER upstream answers. Glados alone (home box down) is still ok;
    the UI greys out GPU voices but keeps glados live. A bound tunnel port is
    not liveness -- only an actual /v1/voices response counts."""

    async def live(upstream: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"http://{upstream}/v1/voices")
                r.raise_for_status()
                return True
        except Exception:
            return False

    home, piper = await asyncio.gather(live(_UPSTREAM), live(_PIPER_UPSTREAM))
    ok = home or piper
    return JSONResponse({"ok": ok, "home": home, "piper": piper}, status_code=200 if ok else 503)


async def _pump_to_client(ws, upstream):
    async for msg in upstream:
        if isinstance(msg, (bytes, bytearray)):
            await ws.send_bytes(msg)
        else:
            await ws.send_text(msg)


# Live presence: every open /hosaka tab holds a presence socket (separate from
# the audio /ws/hosaka, which only opens on Speak). The set is the source of
# truth for "connected users"; we re-broadcast the count on every join/leave.
_presence: set[WebSocket] = set()


async def _broadcast_presence():
    n = len(_presence)
    payload = json.dumps({"count": n})
    for c in list(_presence):
        try:
            await c.send_text(payload)
        except Exception:
            _presence.discard(c)


@public.websocket("/ws/hosaka/presence")
async def ws_presence(ws: WebSocket):
    # Same cookie gate as the audio socket (full owner OR guest session).
    if ws.cookies.get("session") != SESSION_TOKEN and ws.cookies.get("guest_session") != GUEST_SESSION_TOKEN:
        await ws.close(code=1008)
        return
    await ws.accept()
    _presence.add(ws)
    await _broadcast_presence()
    try:
        while True:
            m = await ws.receive()
            if m["type"] == "websocket.disconnect":
                break
    except Exception:
        pass
    finally:
        _presence.discard(ws)
        await _broadcast_presence()


async def _ws_connect(conns, pumps, ws, url):
    """Lazily open and cache one upstream WS per backend URL."""
    if url not in conns:
        up = await websockets.connect(f"ws://{url}/v1/audio/stream", max_size=None)
        conns[url] = up
        pumps.append(asyncio.create_task(_pump_to_client(ws, up)))
    return conns[url]


async def _ws_dispatch(ws, conns, pumps):
    """Forward client messages to the right upstream, routed per utterance."""
    while True:
        m = await ws.receive()
        if m["type"] == "websocket.disconnect":
            break
        if m.get("text") is None:
            continue  # the audio protocol is client->server JSON utterances only
        try:
            req = json.loads(m["text"])
        except Exception:
            await ws.send_text(json.dumps({"type": "error", "detail": "bad request json"}))
            continue
        url = pick_upstream(req, _UPSTREAM, _PIPER_UPSTREAM)
        try:
            up = await _ws_connect(conns, pumps, ws, url)
            await up.send(m["text"])
        except Exception:
            # A dead/stale cached upstream must fail only THIS utterance, not tear
            # down the whole session -- a mid-session home-box death would
            # otherwise also drop a live glados connection. Evict so the next
            # utterance reconnects; the stale pump ends when its upstream closes.
            conns.pop(url, None)
            await ws.send_text(json.dumps({"type": "error", "detail": "tts upstream unreachable"}))
            continue


@public.websocket("/ws/hosaka")
async def ws_tts(ws: WebSocket):
    if ws.cookies.get("session") != SESSION_TOKEN and ws.cookies.get("guest_session") != GUEST_SESSION_TOKEN:
        await ws.close(code=1008)
        return
    await ws.accept()
    conns: dict[str, object] = {}  # upstream url -> open websocket
    pumps: list = []  # upstream->client pump tasks
    try:
        await _ws_dispatch(ws, conns, pumps)
    except Exception:
        pass
    finally:
        for t in pumps:
            t.cancel()
        for up in conns.values():
            try:
                await up.close()
            except Exception:
                pass
        try:
            await ws.close()
        except Exception:
            pass
