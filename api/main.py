"""FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.

Routes live in routes_views.py (HTML) + routes_api.py (JSON); rendering in
pages.py; the routers themselves in routers.py. Importing the route modules
registers their decorators on those shared routers before include_router."""
import asyncio
from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse

from nudge_loop import _run_nudge_loop
from routers import public, protected, guest_protected
import routes_views  # noqa: F401  — registers HTML routes on the shared routers
import routes_api    # noqa: F401  — registers JSON routes on the shared routers


@asynccontextmanager
async def _lifespan(app: FastAPI):
    nudge_task = asyncio.create_task(_run_nudge_loop())
    yield
    nudge_task.cancel()


app = FastAPI(lifespan=_lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def _no_cache_static(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.endswith((".js", ".css", ".html")) and not path.startswith("/nightfall-game/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(401)
async def unauthorized_handler(request: Request, exc: HTTPException):
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        path = request.url.path
        if path.startswith("/mtg") or path.startswith("/tarot"):
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
