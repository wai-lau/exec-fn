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
from fastapi import WebSocket
from fastapi.responses import HTMLResponse, JSONResponse

from auth import SESSION_TOKEN
from pages import _render_page, _tmpl
from routers import protected, public

# Docker bridge gateway -> host loopback :8123 (the SSH tunnel to the home box).
_UPSTREAM = os.environ.get("TTS_UPSTREAM", "172.17.0.1:8123")


@protected.get("/hosaka", response_class=HTMLResponse)
async def tts_page():
    return _render_page("hosaka", _tmpl("tts.html"), full_height=True)


@protected.get("/api/hosaka/voices")
async def tts_voices():
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"http://{_UPSTREAM}/v1/voices")
            return JSONResponse(r.json())
    except Exception:
        return JSONResponse([])


@protected.get("/api/hosaka/health")
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


@public.websocket("/ws/hosaka")
async def ws_tts(ws: WebSocket):
    # Same session cookie as the rest of the app; the browser sends it on the
    # same-origin WS handshake. Reject before accepting if missing/wrong.
    if ws.cookies.get("session") != SESSION_TOKEN:
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
