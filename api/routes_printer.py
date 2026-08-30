"""Owner-only /printer page + reverse proxy for the ELEGOO Centauri Carbon.

The printer lives on Wai's home LAN (192.168.2.25). Its three ports are
reverse-tunnelled from the home box to the droplet docker bridge exactly like
the hosaka TTS / emet upstreams (printer-box/printer-tunnel.service):
  :80   SPA + files         -> 172.17.0.1:8126  (PRINTER_UPSTREAM)
  :3030 SDCP websocket      -> 172.17.0.1:8127  (PRINTER_WS_UPSTREAM)
  :3031 MJPEG camera stream -> 172.17.0.1:8128  (PRINTER_VIDEO_UPSTREAM)

Everything here is full-session only (`protected` router; the WS checks the
`session` cookie itself) -- no guest tier: the page can move axes, heat the
nozzle, and start/stop prints. The browser only ever talks same-origin, so the
session cookie carries auth on every sub-request incl. the WS handshake; the
cookie is NEVER forwarded to the printer (allowlisted headers, printer_proxy).
The tunnel port stays bound when the printer is off, so every upstream call
has a short connect timeout and degrades to 503 / a closed socket; the wrapper
page polls /api/printer/health and only mounts the SPA while it answers."""

import asyncio
import hmac
import os

import httpx
import websockets
from fastapi import Request, Response, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

from auth import SESSION_TOKEN
from pages import _render_page, _tmpl
from printer_proxy import (
    PREFIX, client_response_headers, rewrite_html, rewrite_js, rewrite_kind,
    rewrite_ws_text, upstream_request_headers,
)
from routers import protected, public

_UPSTREAM = os.environ.get("PRINTER_UPSTREAM", "172.17.0.1:8126")
_WS_UPSTREAM = os.environ.get("PRINTER_WS_UPSTREAM", "172.17.0.1:8127")
_VIDEO_UPSTREAM = os.environ.get("PRINTER_VIDEO_UPSTREAM", "172.17.0.1:8128")

# Health: a liveness probe, fail fast (the /api/hosaka/health rule).
_HEALTH_TIMEOUT = httpx.Timeout(3.0, connect=2.0)
# Proxy: connect fast-fails when the tunnel/printer is down; read is generous
# for the 800KB SPA bundle over the tunnel; write is unbounded because an
# upload body streams through at whatever the home uplink allows (nginx's own
# read timeout still bounds a truly stuck request).
_HTTP_TIMEOUT = httpx.Timeout(10.0, connect=4.0, read=60.0, write=None)
# Video: a live camera pushes many frames/s, so 30s of silence means the
# stream is dead -- the relay then reconnects (below) rather than ending.
_VIDEO_TIMEOUT = httpx.Timeout(10.0, connect=4.0, read=30.0)
_VIDEO_BACKOFF_MAX = 15.0
_PROXY_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]


@protected.get("/printer", response_class=HTMLResponse)
async def printer_page():
    return _render_page("printer", _tmpl("printer.html"), full_height=True)


@protected.get("/api/printer/health")
async def printer_health():
    """{ok} -- liveness = the SPA shell actually answers (a bound tunnel port
    with the printer off accepts-then-resets, which is NOT ok)."""
    try:
        async with httpx.AsyncClient(timeout=_HEALTH_TIMEOUT) as client:
            r = await client.get(f"http://{_UPSTREAM}/", headers={"accept-encoding": "identity"})
            ok = r.status_code < 500
    except httpx.HTTPError:
        ok = False
    return JSONResponse({"ok": ok}, status_code=200 if ok else 503)


async def _stream(client: httpx.AsyncClient, r: httpx.Response):
    """Relay an open upstream body, closing both when the browser goes away."""
    try:
        async for chunk in r.aiter_raw():
            yield chunk
    finally:
        await r.aclose()
        await client.aclose()


async def _open_video(client: httpx.AsyncClient) -> httpx.Response:
    return await client.send(client.build_request("GET", f"http://{_VIDEO_UPSTREAM}/video"), stream=True)


async def _video_frames(client: httpx.AsyncClient, r: httpx.Response):
    """Relay MJPEG parts; when the upstream stream ends or stalls (camera
    pause past the read timeout, a tunnel restart), reconnect with backoff and
    keep the SAME response open -- the SPA's <img> never re-requests a dead
    MJPEG stream, so ending the response would freeze the camera until the
    page is reloaded. The printer's part boundary is constant, so a fresh
    upstream stream splices straight into the open multipart body; a changed
    boundary ends the response instead. A browser disconnect cancels this
    generator wherever it is and the finally releases the upstream slot."""
    ctype = r.headers.get("content-type", "")
    backoff = 1.0
    try:
        while True:
            try:
                async for chunk in r.aiter_raw():
                    backoff = 1.0
                    yield chunk
            except httpx.HTTPError:
                pass
            await r.aclose()
            while True:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, _VIDEO_BACKOFF_MAX)
                try:
                    r = await _open_video(client)
                except httpx.HTTPError:
                    continue
                if r.status_code == 200 and r.headers.get("content-type", "") == ctype:
                    break
                await r.aclose()
                if r.status_code == 200:
                    return  # boundary changed: can't splice, let the browser re-request
    finally:
        await r.aclose()
        await client.aclose()


@protected.get(f"{PREFIX}/video")
async def printer_video():
    """Same-origin relay of the camera's multipart/x-mixed-replace stream.
    Declared BEFORE the catch-all so it wins the match. No-cache + no nginx
    buffering, and main.py excludes the content type from gzip, so frames
    reach the <img> as they arrive."""
    client = httpx.AsyncClient(timeout=_VIDEO_TIMEOUT)
    try:
        r = await _open_video(client)
    except httpx.HTTPError:
        await client.aclose()
        return JSONResponse({"ok": False, "detail": "printer offline"}, status_code=503)
    return StreamingResponse(
        _video_frames(client, r), status_code=r.status_code,
        media_type=r.headers.get("content-type", "multipart/x-mixed-replace"),
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@protected.api_route(PREFIX + "/{path:path}", methods=_PROXY_METHODS)
async def printer_proxy(path: str, request: Request):
    """Reverse proxy for the SPA shell, its hashed assets, i18n, and the
    file endpoints. HTML + JS bodies are rewritten (printer_proxy); everything
    else streams through untouched, in both directions (an upload body is
    never buffered here)."""
    url = f"http://{_UPSTREAM}/{path}"
    if request.url.query:
        url += "?" + request.url.query
    body = None
    if request.method not in ("GET", "HEAD"):
        # Stream the body through with its content-length; a client that sent
        # none (no browser does for a Blob/FormData upload) gets buffered so
        # the printer never sees chunked transfer-encoding.
        body = request.stream() if "content-length" in request.headers else await request.body()
    client = httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
    try:
        req = client.build_request(request.method, url, headers=upstream_request_headers(request.headers), content=body)
        r = await client.send(req, stream=True)
    except httpx.HTTPError:
        await client.aclose()
        return JSONResponse({"ok": False, "detail": "printer offline"}, status_code=503)
    headers = client_response_headers(r.headers)
    kind = rewrite_kind(r.headers.get("content-type", ""))
    if kind is None:
        return StreamingResponse(_stream(client, r), status_code=r.status_code, headers=headers)
    try:
        text = (await r.aread()).decode("utf-8", "replace")
    finally:
        await r.aclose()
        await client.aclose()
    text = rewrite_html(text) if kind == "html" else rewrite_js(text)
    return Response(text, status_code=r.status_code, headers=headers)


async def _pump_to_client(ws: WebSocket, up) -> None:
    async for msg in up:
        if isinstance(msg, (bytes, bytearray)):
            await ws.send_bytes(msg)
        else:
            await ws.send_text(rewrite_ws_text(msg))


async def _pump_to_upstream(ws: WebSocket, up) -> None:
    while True:
        m = await ws.receive()
        if m["type"] == "websocket.disconnect":
            return
        if m.get("text") is not None:
            await up.send(m["text"])
        elif m.get("bytes") is not None:
            await up.send(m["bytes"])


@public.websocket("/ws/printer")
async def ws_printer(ws: WebSocket):
    """SDCP control socket relay. Public route, but rejects (1008) unless the
    FULL session cookie matches -- no guest tier, this socket drives the
    machine. Accepts first, then dials the printer (like /ws/hosaka), so a
    browser that vanishes mid-handshake never strands an open upstream socket
    and a down printer surfaces as a clean 1011 close (the SPA retries).
    Printer->browser text frames pass through rewrite_ws_text so the camera
    URL lands on the same-origin MJPEG route."""
    if not hmac.compare_digest(ws.cookies.get("session") or "", SESSION_TOKEN):
        await ws.close(code=1008)
        return
    try:
        await ws.accept()
    except Exception:
        return  # browser already gone (tab closed mid-handshake): nothing to clean up
    up = None
    pumps: list = []
    try:
        up = await websockets.connect(f"ws://{_WS_UPSTREAM}/websocket", max_size=None, open_timeout=5)
        pumps = [asyncio.create_task(_pump_to_client(ws, up)), asyncio.create_task(_pump_to_upstream(ws, up))]
        await asyncio.wait(pumps, return_when=asyncio.FIRST_COMPLETED)
    except Exception:
        pass
    finally:
        for t in pumps:
            t.cancel()
        if up is not None:
            try:
                await up.close()
            except Exception:
                pass
        try:
            await ws.close(code=1011 if up is None else 1000)
        except Exception:
            pass
