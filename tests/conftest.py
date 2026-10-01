"""Smoke-test fixtures.

These run against the LIVE app (the running container on :8080), not an
imported FastAPI instance — a smoke test's job is to prove the deployed
artifact actually serves: real templates render, graphify-out data is
present, routes are wired. Override the target with SMOKE_BASE_URL.

Admin auth uses the Bearer-token path (`Authorization: Bearer <API_KEY>`), which
both require_auth and require_guest_auth accept. The guest tier is no longer a
shared bearer key — it's a Cloudflare Turnstile challenge — so guest tests mint
the guest_session cookie directly (sha256("guest:<TURNSTILE_SECRET>")) rather
than solving a live challenge. The cookie login sets a Secure cookie, which
httpx won't replay over plain-HTTP localhost, so these set it as a raw header.
"""
import hashlib
import os
from pathlib import Path

import httpx
import pytest

BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://localhost:8080")
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def _key(name: str) -> str | None:
    """Env var first; fall back to the repo .env (same host, same secrets)."""
    if os.environ.get(name):
        return os.environ[name]
    if _ENV_FILE.exists():
        for line in _ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


API_KEY = _key("API_KEY")

# ── rate-limit exemption: tests from this box must never fail on a limiter ───
# The server skips its per-IP rate limiters (tarot/mtg chat, noodle drafts and
# ask) for requests carrying x-ratelimit-exempt: sha256("ratelimit-exempt:" +
# API_KEY) — see auth.RATE_EXEMPT_TOKEN. Every httpx client the suite makes
# sends it (patched below); browser contexts add it only for requests to the
# app's own origin (browser fixture), never to CDNs or other hosts.
RL_EXEMPT = {"x-ratelimit-exempt": hashlib.sha256(f"ratelimit-exempt:{API_KEY}".encode()).hexdigest()} if API_KEY else {}
_httpx_init = httpx.Client.__init__


def _httpx_init_exempt(self, *a, **kw):
    kw["headers"] = {**RL_EXEMPT, **dict(kw.get("headers") or {})}
    _httpx_init(self, *a, **kw)


httpx.Client.__init__ = _httpx_init_exempt
TURNSTILE_SECRET = _key("TURNSTILE_SECRET")


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "browser: WebKit (playwright) tests — heavier than the HTTP smoke "
        "suite; excluded from the fast pre-commit gate via `-m 'not browser'`.")


@pytest.fixture(scope="session")
def base_url() -> str:
    """Probe the live app once; skip the whole suite if it isn't reachable."""
    try:
        httpx.get(f"{BASE_URL}/login", timeout=5.0)
    except httpx.HTTPError as e:
        pytest.skip(f"app not reachable at {BASE_URL}: {e}")
    return BASE_URL


@pytest.fixture
def client(base_url: str):
    # follow_redirects=False so a 401->/login redirect is asserted as the 302
    # it is, not silently followed to the 200 login page.
    with httpx.Client(base_url=base_url, follow_redirects=False, timeout=15.0) as c:
        yield c


@pytest.fixture
def admin_headers() -> dict:
    if not API_KEY:
        pytest.skip("API_KEY not set (env or .env) — cannot auth as admin")
    return {"Authorization": f"Bearer {API_KEY}", "Accept": "text/html"}


@pytest.fixture
def guest_cookie() -> dict:
    """Guest tier via the guest_session cookie a real Turnstile solve would set.

    The cookie value is sha256("guest:<TURNSTILE_SECRET>") — recomputed here so
    tests don't have to solve a live challenge. Secure cookie → raw header.
    """
    if not TURNSTILE_SECRET:
        pytest.skip("TURNSTILE_SECRET not set (env or .env) — cannot mint guest cookie")
    token = hashlib.sha256(f"guest:{TURNSTILE_SECRET}".encode()).hexdigest()
    return {"Cookie": f"guest_session={token}", "Accept": "text/html"}


@pytest.fixture
def admin_cookie() -> dict:
    """Full-auth via the SESSION COOKIE (what a real logged-in browser sends).

    Some pages branch their guest/non-guest rendering on the cookie, not the
    Bearer header (e.g. /UI, /tarot decide the nav + Exec bubble from it), so
    cookie auth is the faithful tier for wiring tests. The cookie is normally
    Secure (httpx won't replay it over plain HTTP), so set it as a raw header.
    """
    if not API_KEY:
        pytest.skip("API_KEY not set (env or .env) — cannot auth as admin")
    token = hashlib.sha256(f"session:{API_KEY}".encode()).hexdigest()
    return {"Cookie": f"session={token}", "Accept": "text/html"}


# A browser GET sends this; it's what flips the 401 handler from JSON to a
# login redirect, so the no-auth page tests must send it.
HTML_ACCEPT = {"Accept": "text/html"}


# ── shared WebKit browser (playwright) ───────────────────────────────────────
# ONE sync_playwright + one WebKit launch for the whole session, shared by every
# `browser`-marked file. Each file used to define its own session-scoped
# sync_playwright().start(); with two such files collected together the second
# start() raised "Playwright Sync API inside the asyncio loop" (the first
# instance's loop is still live), so a full `pytest tests/` run errored every
# tarot test. Hoisting the fixtures here means a single start per session — no
# duplicate, no collision — and a single browser launch (faster).
@pytest.fixture(scope="session")
def _playwright():
    pw_api = pytest.importorskip("playwright.sync_api")
    pw = pw_api.sync_playwright().start()
    yield pw
    pw.stop()


@pytest.fixture(scope="session")
def browser(_playwright):
    from playwright.sync_api import Error as PWError

    try:
        b = _playwright.webkit.launch()
    except PWError as e:
        pytest.skip(f"WebKit not installed (run: .venv/bin/playwright install webkit): {e}")
    yield _ExemptBrowser(b, BASE_URL)
    b.close()


class _ExemptBrowser:
    """The real Browser, except every new_context() adds the rate-limit
    exemption header to requests for the app's own origin only."""

    def __init__(self, b, base_url):
        self._b, self._origin = b, base_url.rstrip("/")

    def __getattr__(self, name):
        return getattr(self._b, name)

    def new_context(self, *a, **kw):
        ctx = self._b.new_context(*a, **kw)
        if RL_EXEMPT:
            ctx.route(self._origin + "/**",
                      lambda route: route.continue_(headers={**route.request.headers, **RL_EXEMPT}))
        return ctx


# ── a live Noodle poll for the smoke + browser tests ─────────────────────────
# ONE reusable poll titled __smoke__, created on first need and found again
# after that, so repeated runs don't pile test polls into the owner's list.
NOODLE_SMOKE_TITLE = "__smoke__"


@pytest.fixture(scope="session")
def noodle_slug(base_url):
    """A FRESH poll for this test session, deleted after it. It used to be one
    shared "__smoke__" poll found by title, and every run inherited the last
    run's state -- who hosted it, what was offered -- so tests failed or passed
    by the order they last ran in."""
    if not API_KEY:
        pytest.skip("API_KEY not set (env or .env) -- cannot create a noodle poll")
    auth = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=base_url, timeout=15.0) as c:
        r = c.post("/api/noodle-polls", headers=auth, json={"title": NOODLE_SMOKE_TITLE})
        r.raise_for_status()
        slug = r.json()["slug"]
    yield slug
    with httpx.Client(base_url=base_url, timeout=15.0) as c:
        c.delete(f"/api/noodle-polls/{slug}", headers=auth)
