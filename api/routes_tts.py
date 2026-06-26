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

# Docker bridge gateway -> host loopback :8123 (the SSH tunnel to the home box).
_UPSTREAM = os.environ.get("TTS_UPSTREAM", "172.17.0.1:8123")


@guest_protected.get("/hosaka", response_class=HTMLResponse)
async def tts_page(request: Request):
    is_full_auth = request.cookies.get("session") == SESSION_TOKEN
    return _render_page("hosaka", _tmpl("tts.html"), full_height=True, guest=not is_full_auth)


@guest_protected.get("/api/hosaka/voices")
async def tts_voices():
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"http://{_UPSTREAM}/v1/voices")
            return JSONResponse(r.json())
    except Exception:
        return JSONResponse([])


@guest_protected.get("/api/hosaka/health")
async def tts_health():
    """Is the home-box TTS upstream reachable. The reverse-tunnel listener stays
    bound on the droplet even when the model server behind it is down (connect
    then RST -> 'Connection reset by peer'), so a bound port is NOT liveness --
    only an actual response is. Lets /hosaka show 'offline' before SPEAK."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"http://{_UPSTREAM}/v1/voices")
            r.raise_for_status()
            return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"ok": False, "detail": type(e).__name__}, status_code=503)


async def _pump_to_upstream(ws, upstream):
    while True:
        m = await ws.receive()
        if m["type"] == "websocket.disconnect":
            break
        if m.get("text") is not None:
            await upstream.send(m["text"])
        elif m.get("bytes") is not None:
            await upstream.send(m["bytes"])


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
    if (
        ws.cookies.get("session") != SESSION_TOKEN
        and ws.cookies.get("guest_session") != GUEST_SESSION_TOKEN
    ):
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


@public.websocket("/ws/hosaka")
async def ws_tts(ws: WebSocket):
    # Same session cookie as the rest of the app; the browser sends it on the
    # same-origin WS handshake. Accept the full owner session OR a guest session
    # (so guests on /tarot get the reader voice too). Reject anything else
    # before accepting.
    if (
        ws.cookies.get("session") != SESSION_TOKEN
        and ws.cookies.get("guest_session") != GUEST_SESSION_TOKEN
    ):
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        upstream = await websockets.connect(f"ws://{_UPSTREAM}/v1/audio/stream", max_size=None)
    except Exception:
        await ws.send_text(json.dumps({"type": "error", "detail": "tts upstream unreachable"}))
        await ws.close()
        return
    tasks = [
        asyncio.create_task(_pump_to_upstream(ws, upstream)),
        asyncio.create_task(_pump_to_client(ws, upstream)),
    ]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        await upstream.close()
        try:
            await ws.close()
        except Exception:
            pass
