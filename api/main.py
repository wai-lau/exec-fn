"""FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.

Routes live in routes_views.py (HTML) + routes_api.py (JSON); rendering in
pages.py; the routers themselves in routers.py. Importing the route modules
registers their decorators on those shared routers before include_router."""
import asyncio
import mimetypes
from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
import starlette.middleware.gzip as _gzip
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse

from nudge_loop import _run_nudge_loop
from discord_bot import _run_discord_bot
from routers import public, protected, guest_protected
import routes_views  # noqa: F401  — registers HTML routes on the shared routers
import routes_api    # noqa: F401  — registers JSON routes on the shared routers
import routes_tts    # noqa: F401  — registers the /tts page + WS reverse-proxy
import routes_emet   # noqa: F401  — registers /emet + the emet MCP JSON routes

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
# (GZipResponder extends IdentityResponder, which reads this module global at
# response.start, so overriding it here covers both the compress + identity
# paths.)
_gzip.DEFAULT_EXCLUDED_CONTENT_TYPES = (
    "text/event-stream",
    "font/woff",  # matches font/woff and font/woff2
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
    "image/vnd.microsoft.icon", "image/x-icon",
    "audio/mpeg", "audio/mp4", "audio/ogg", "audio/aac",
    "video/",
    "application/zip", "application/gzip",
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
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def _cache_control(request: Request, call_next):
    # Static assets are content-versioned via ?v= query params (the codebase
    # bumps the query on every edit), so cache them hard and let the bumped
    # query bust them — this kills the per-asset revalidation round-trip on
    # every navigation across the multi-page app. HTML shells embed live data,
    # so they stay no-cache. Unversioned static gets a 1-day safety TTL.
    # Nightfall serves its own bundle and manages its own caching.
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/nightfall-game/"):
        return response
    ctype = response.headers.get("content-type", "")
    if ctype.startswith("text/html"):
        response.headers["Cache-Control"] = "no-cache"
    elif path.endswith((".css", ".js", ".woff2", ".woff", ".ttf", ".otf",
                         ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".mp3")):
        response.headers["Cache-Control"] = (
            "public, max-age=31536000, immutable" if request.url.query
            else "public, max-age=86400"
        )
    return response


@app.exception_handler(401)
async def unauthorized_handler(request: Request, exc: HTTPException):
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        path = request.url.path
        if path.startswith("/mtg") or path.startswith("/tarot") or path.startswith("/hosaka"):
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
