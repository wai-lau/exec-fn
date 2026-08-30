"""/printer page + reverse proxy for the ELEGOO Centauri Carbon.

The printer lives on Wai's home LAN (192.168.2.25). Its three ports are
reverse-tunnelled from the home box to the droplet docker bridge exactly like
the hosaka TTS / emet upstreams (printer-box/printer-tunnel.service):
  :80   SPA + files         -> 172.17.0.1:8126  (PRINTER_UPSTREAM)
  :3030 SDCP websocket      -> 172.17.0.1:8127  (PRINTER_WS_UPSTREAM)
  :3031 MJPEG camera stream -> 172.17.0.1:8128  (PRINTER_VIDEO_UPSTREAM)

TWO TIERS, split on what reaches the LAN:

  OWNER (`session` cookie / API_KEY bearer) -- the proxied vendor SPA and the
  SDCP control socket: moves axes, heats the nozzle, starts/stops prints.
  GUEST (Turnstile cookie) -- a READ-ONLY view: the camera, and the status the
  printer pushes on its own.

The read-only tier is enforced by which routes a guest can reach at all, not
by filtering payloads: `/printer/{path}` (the SPA + its file endpoints) and
`/ws/printer` (the only browser->printer channel) stay owner-only, so a guest
has no route that carries a byte of theirs onto the home LAN. What they do
reach -- the camera hub and the status listener -- are one-way readers the
SERVER opens: shared singletons that only ever GET / receive (printer_camera,
printer_status). The browser only ever talks same-origin, so the session
cookie carries auth on every sub-request incl. the WS handshake; the cookie is
NEVER forwarded to the printer (allowlisted headers, printer_proxy).
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

from auth import API_KEY, GUEST_SESSION_TOKEN, SESSION_TOKEN
from pages import _render_page, _tmpl
from printer_camera import CONTENT_TYPE as CAMERA_CONTENT_TYPE, GUEST_FRAME_INTERVAL, camera
from printer_status import public_status, status
from printer_proxy import (
    PREFIX, client_response_headers, not_modified, rewrite_html, rewrite_js,
    rewrite_kind, rewrite_ws_text, upstream_request_headers,
)
from routers import guest_protected, protected, public

_UPSTREAM = os.environ.get("PRINTER_UPSTREAM", "172.17.0.1:8126")
_WS_UPSTREAM = os.environ.get("PRINTER_WS_UPSTREAM", "172.17.0.1:8127")
_VIDEO_UPSTREAM = os.environ.get("PRINTER_VIDEO_UPSTREAM", "172.17.0.1:8128")

# The camera + status readers are shared singletons (one upstream each, however
# many viewers); they take their upstream from here rather than re-reading env.
camera.configure(_VIDEO_UPSTREAM)
status.configure(_WS_UPSTREAM)

# Health: a liveness probe, fail fast (the /api/hosaka/health rule).
_HEALTH_TIMEOUT = httpx.Timeout(3.0, connect=2.0)
# Proxy: connect fast-fails when the tunnel/printer is down; read is generous
# for the 800KB SPA bundle over the tunnel; write is unbounded because an
# upload body streams through at whatever the home uplink allows (nginx's own
# read timeout still bounds a truly stuck request).
_HTTP_TIMEOUT = httpx.Timeout(10.0, connect=4.0, read=60.0, write=None)
_PROXY_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]


def _is_owner(request: Request) -> bool:
    """Full-session cookie or the admin bearer -- the tier that may drive the
    machine. Everyone else who got past the guest gate is a read-only viewer."""
    if hmac.compare_digest(request.cookies.get("session") or "", SESSION_TOKEN):
        return True
    auth = request.headers.get("authorization", "")
    return auth.startswith("Bearer ") and hmac.compare_digest(auth[7:], API_KEY)


def _has_view_access(request: Request) -> bool:
    """The guest gate, checked by hand for the routes that can't take the
    router dependency (see printer_video)."""
    return _is_owner(request) or hmac.compare_digest(
        request.cookies.get("guest_session") or "", GUEST_SESSION_TOKEN)


@guest_protected.get("/printer", response_class=HTMLResponse)
async def printer_page(request: Request):
    """Owner: the proxied vendor SPA. Guest: camera + status, no controls --
    marked on the wrapper so printer.js never even mounts the SPA frame (the
    proxy route would 401 it anyway; this is the belt to that braces)."""
    html = _tmpl("printer.html")
    guest = not _is_owner(request)
    if guest:
        html = html.replace('<main class="printer">', '<main class="printer" data-readonly="1">', 1)
    return _render_page("printer", html, full_height=True, guest=guest)


@guest_protected.get("/api/printer/status")
async def printer_status_route():
    """Read-only machine state for the public view. The listener never sends a
    frame to the printer (printer_status), and the payload is a whitelist --
    no identifiers, nothing naming what is being printed."""
    return JSONResponse(public_status(await status.read()))


@guest_protected.get("/api/printer/health")
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


@public.get(f"{PREFIX}/video")
async def printer_video(request: Request):
    """Same-origin camera relay, owner AND guest. On the `public` router with
    the gate checked by hand: the routers are included public -> protected ->
    guest_protected, so a guest_protected route here would never be reached --
    the owner-only `/printer/{path}` catch-all would match /printer/video
    first. Declared before that catch-all for the same reason.

    Frames come from the shared hub (printer_camera): ONE upstream stream for
    every viewer, so a public page can't exhaust the printer's ~4 stream slots,
    and guests are throttled to a fraction of the full frame rate. No-cache +
    no nginx buffering, and main.py excludes the content type from gzip, so
    frames reach the <img> as they arrive."""
    if not _has_view_access(request):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    if not camera.can_admit():
        return JSONResponse({"ok": False, "detail": "too many viewers"}, status_code=503)
    interval = 0.0 if _is_owner(request) else GUEST_FRAME_INTERVAL
    return StreamingResponse(
        camera.frames(min_interval=interval),
        media_type=CAMERA_CONTENT_TYPE,
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
    kind = rewrite_kind(r.headers.get("content-type", ""))
    headers = client_response_headers(r.headers, kind)
    if r.status_code == 200 and not_modified(request.headers, headers.get("etag")):
        # Conditionals are answered HERE, never by the printer: a rewritten
        # body's ETag carries the rewrite-rules version, so a browser copy
        # patched by older rules misses and refetches (see REWRITE_VERSION).
        await r.aclose()
        await client.aclose()
        return Response(status_code=304, headers=headers)
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
