"""Smoke-test fixtures.

These run against the LIVE app (the running container on :8080), not an
imported FastAPI instance — a smoke test's job is to prove the deployed
artifact actually serves: real templates render, graphify-out + emet data are
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
    yield b
    b.close()
