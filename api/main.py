"""FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.

Routes live in routes_views.py (HTML) + routes_api.py (JSON); rendering in
pages.py; the routers themselves in routers.py. Importing the route modules
registers their decorators on those shared routers before include_router."""
import asyncio
import inspect
import mimetypes
from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
import starlette.middleware.gzip as _gzip
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.datastructures import MutableHeaders

from nudge_loop import _run_nudge_loop
from discord_bot import _run_discord_bot
from routers import public, protected, guest_protected
import routes_views  # noqa: F401  — registers HTML routes on the shared routers
import routes_api    # noqa: F401  — registers JSON routes on the shared routers
import routes_tts    # noqa: F401  — registers the /tts page + WS reverse-proxy
import routes_emet   # noqa: F401  — registers /emet + the emet MCP JSON routes
import routes_printer  # noqa: F401  — registers /printer + the ELEGOO printer reverse proxy

# StaticFiles guesses MIME via mimetypes, which doesn't know woff2 -> it served
# them as application/octet-stream. Register the real types so the preload
# `type=font/woff2` matches and the gzip exclusion below can recognize them.
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
# Web App Manifest -- iOS reads `scope`/`display` from it to keep home-screen
# launches chrome-less across in-scope navigation (legacy apple meta alone shows
# the Safari toolbar on every page load). Needs the real MIME or Safari ignores it.
mimetypes.add_type("application/manifest+json", ".webmanifest")
# .m4a (AAC) -- mimetypes maps it to audio/mpeg or octet-stream depending on the
# platform db; Safari/iOS refuse to play an <audio> served as octet-stream. Pin
# audio/mp4 so the /tarot ambient track plays everywhere.
mimetypes.add_type("audio/mp4", ".m4a")

# Starlette's GZipMiddleware only skips text/event-stream. Also skip already-
# compressed payloads -- re-gzipping a woff2/png/jpg/mp3 burns CPU and adds
# TTFB (a 2.3MB mp3) for ~zero size gain. SVG/TTF/WAV stay compressible.
# Older starlette reads this module global at response.start and matches by
# PREFIX ("font/woff" covers woff2, "video/" covers every video type); newer
# starlette matches an EXACT media type or a "type/*" wildcard and takes the
# list as a constructor kwarg (passed below) -- so both spellings are listed.
_gzip.DEFAULT_EXCLUDED_CONTENT_TYPES = (
    "text/event-stream",
    "font/woff", "font/woff2",
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
    "image/vnd.microsoft.icon", "image/x-icon",
    "audio/mpeg", "audio/mp4", "audio/ogg", "audio/aac",
    "video/", "video/*",
    "application/zip", "application/gzip",
    # /printer/video MJPEG relay: gzip would buffer frames inside zlib and
    # stall the live camera; the type is a stream, never a document.
    "multipart/x-mixed-replace",
)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    nudge_task = asyncio.create_task(_run_nudge_loop())
    # Discord bridge — DMs nudges/monitor comments to Wai's phone and answers
    # DMs back. No-op unless DISCORD_BOT_TOKEN + DISCORD_USER_ID are set.
    discord_task = asyncio.create_task(_run_discord_bot())
    yield
    nudge_task.cancel()
    discord_task.cancel()


app = FastAPI(lifespan=_lifespan)
# Newer starlette takes the exclusion list as a constructor kwarg whose default
# was bound at import time -- the module reassignment above is invisible to it
# (and /printer/video's MJPEG frames would be gzipped). Pass the list
# explicitly wherever the signature accepts it; older starlette (no kwarg)
# keeps reading the patched module global.
_gzip_kwargs = {"minimum_size": 1000}
if "exclude_content_types" in inspect.signature(GZipMiddleware.__init__).parameters:
    _gzip_kwargs["exclude_content_types"] = _gzip.DEFAULT_EXCLUDED_CONTENT_TYPES
app.add_middleware(GZipMiddleware, **_gzip_kwargs)


_STATIC_SUFFIXES = (".css", ".js", ".woff2", ".woff", ".ttf", ".otf",
                    ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".mp3")


class CacheControlMiddleware:
    # Static assets are content-versioned via ?v= query params (the codebase
    # bumps the query on every edit), so cache them hard and let the bumped
    # query bust them — this kills the per-asset revalidation round-trip on
    # every navigation across the multi-page app. HTML shells embed live data,
    # so they stay no-cache. Unversioned static gets a 1-day safety TTL.
    # Nightfall serves its own bundle and manages its own caching.
    #
    # Pure ASGI (not BaseHTTPMiddleware): we only stamp a header on the
    # response.start message, never buffer the body via call_next. The old
    # BaseHTTPMiddleware form raised `RuntimeError: No response returned.`
    # (anyio.EndOfStream) every time a client dropped a long-lived SSE stream
    # (/api/monitor/stream, /api/hosaka/mode/stream) — hundreds of noise
    # tracebacks. Header-only ASGI has no call_next, so a disconnect can't
    # re-raise, and it never interferes with stream flushing.
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        query = scope.get("query_string", b"")

        async def send_wrapper(message):
            # /printer/* is an auth-gated reverse proxy whose upstream file
            # names look like public static assets (hashed .js/.css/.ttf) --
            # it sets its own private, no-cache (printer_proxy.CACHE_CONTROL).
            if (message["type"] == "http.response.start"
                    and not path.startswith(("/nightfall-game/", "/printer/"))):
                headers = MutableHeaders(raw=message["headers"])
                ctype = headers.get("content-type", "")
                if ctype.startswith("text/html"):
                    headers["Cache-Control"] = "no-cache"
                elif path.endswith(_STATIC_SUFFIXES):
                    headers["Cache-Control"] = (
                        "public, max-age=31536000, immutable" if query
                        else "public, max-age=86400"
                    )
            await send(message)

        await self.app(scope, receive, send_wrapper)


# Registered after GZip so it stays the outermost http middleware (matches the
# old decorator order): it stamps the final response headers last.
app.add_middleware(CacheControlMiddleware)


@app.exception_handler(401)
async def unauthorized_handler(request: Request, exc: HTTPException):
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        path = request.url.path
        if path.startswith(("/mtg", "/tarot", "/hosaka", "/graph", "/UI", "/security", "/nightfall")):
            return RedirectResponse(f"/guest?next={path}", status_code=302)
        if request.method == "GET" and path not in ("/", "/login", "/guest"):
            full = path + ("?" + request.url.query if request.url.query else "")
            return RedirectResponse(f"/login?next={quote(full, safe='')}", status_code=302)
        return RedirectResponse("/login", status_code=302)
    return JSONResponse({"detail": "Unauthorized"}, status_code=401)


app.include_router(public)
app.include_router(protected)
app.include_router(guest_protected)
app.mount("/nightfall-game", StaticFiles(directory="/app/nightfall"), name="nightfall")
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
