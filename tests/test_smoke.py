"""Page smoke tests — every HTML route loads (or redirects) per its auth tier.

Catches the failures that take a page from 200 to 500: template syntax errors,
missing data files, broken route wiring, import-time crashes. Does NOT exercise
LLM calls or mutate data — pure GETs plus the two login endpoints.

Run (server is up locally):
    SMOKE_BASE_URL=http://localhost:8080 pytest tests/ -q
"""
import pytest

from conftest import API_KEY, TURNSTILE_SECRET, HTML_ACCEPT

# Public — no auth, must render.
PUBLIC_PAGES = ["/", "/recruiter", "/color", "/graph", "/nightfall", "/login", "/guest"]
# require_auth — no auth redirects to /login; admin Bearer renders.
PROTECTED_PAGES = ["/rd", "/hq", "/debug", "/emet"]
# require_guest_auth — no auth redirects to /guest; guest or admin Bearer renders.
GUEST_PAGES = ["/mtg", "/tarot", "/hosaka"]


def _is_page(r) -> bool:
    return r.status_code == 200 and len(r.text) > 100 and "<" in r.text


# ── public pages ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("path", PUBLIC_PAGES)
def test_public_page_loads(client, path):
    r = client.get(path, headers=HTML_ACCEPT)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    assert _is_page(r), f"{path} returned 200 but body looks empty/broken"


def test_guest_login_alias_redirects(client):
    r = client.get("/guest-login", headers=HTML_ACCEPT)
    assert r.status_code == 302
    assert r.headers["location"].startswith("/guest")


# ── protected pages (require_auth) ──────────────────────────────────────────────
@pytest.mark.parametrize("path", PROTECTED_PAGES)
def test_protected_redirects_without_auth(client, path):
    r = client.get(path, headers=HTML_ACCEPT)
    assert r.status_code == 302, f"{path} -> {r.status_code} (expected login redirect)"
    assert r.headers["location"].startswith("/login")


@pytest.mark.parametrize("path", PROTECTED_PAGES)
def test_protected_loads_with_admin(client, admin_headers, path):
    r = client.get(path, headers=admin_headers)
    assert r.status_code == 200, f"{path} -> {r.status_code} with admin Bearer"
    assert _is_page(r), f"{path} returned 200 but body looks empty/broken"


# ── guest pages (require_guest_auth) ────────────────────────────────────────────
@pytest.mark.parametrize("path", GUEST_PAGES)
def test_guest_redirects_without_auth(client, path):
    r = client.get(path, headers=HTML_ACCEPT)
    assert r.status_code == 302, f"{path} -> {r.status_code} (expected guest redirect)"
    assert r.headers["location"].startswith("/guest")


@pytest.mark.parametrize("path", GUEST_PAGES)
def test_guest_loads_with_guest_cookie(client, guest_cookie, path):
    r = client.get(path, headers=guest_cookie)
    assert r.status_code == 200, f"{path} -> {r.status_code} with guest cookie"
    assert _is_page(r)


@pytest.mark.parametrize("path", GUEST_PAGES)
def test_guest_loads_with_admin_bearer(client, admin_headers, path):
    # Admin auth also satisfies the guest gate.
    r = client.get(path, headers=admin_headers)
    assert r.status_code == 200, f"{path} -> {r.status_code} with admin Bearer"


# ── auth endpoints ──────────────────────────────────────────────────────────────
def test_login_post_good_key_sets_cookie(client):
    if not API_KEY:
        pytest.skip("API_KEY not available")
    r = client.post("/login", data={"key": API_KEY})
    assert r.status_code == 303
    assert "session=" in r.headers.get("set-cookie", "")


def test_login_post_bad_key_rejected(client):
    r = client.post("/login", data={"key": "wrong-key"})
    assert r.status_code == 401


def test_guest_post_valid_turnstile_sets_cookie(client):
    # Only the Cloudflare test secret (1x0000…) attests an arbitrary token; with a
    # real secret a passing token can't be minted offline, so skip there.
    if not (TURNSTILE_SECRET or "").startswith("1x0000000000000000000000000000000"):
        pytest.skip("not using the Cloudflare test secret; cannot mint a passing token")
    r = client.post("/guest", data={"cf-turnstile-response": "dummy"})
    assert r.status_code == 303
    assert "guest_session=" in r.headers.get("set-cookie", "")


def test_guest_post_no_token_rejected(client):
    # Empty/missing Turnstile token is a fast 401 (no siteverify call) under any secret.
    r = client.post("/guest", data={"cf-turnstile-response": ""})
    assert r.status_code == 401


# ── read-only JSON API (a couple, as a wiring check) ────────────────────────────
def test_public_json_api_loads(client):
    r = client.get("/api/color/usage")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")


def test_protected_json_api_requires_auth(client):
    # JSON Accept -> 401 (no html redirect).
    r = client.get("/api/debug/logs", headers={"Accept": "application/json"})
    assert r.status_code == 401


def test_protected_json_api_loads_with_admin(client, admin_headers):
    r = client.get("/api/debug/logs", headers={**admin_headers, "Accept": "application/json"})
    assert r.status_code == 200


# ── gpu-mode owner-only routes ──────────────────────────────────────────────────
def test_hosaka_mode_route_authed(client, admin_headers):
    r = client.get("/api/hosaka/mode", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["mode"] in {"homo", "emo", "idle", "gone"}


def test_hosaka_mode_route_requires_auth(client):
    # no cookie / no bearer -> 401 from require_auth
    r = client.get("/api/hosaka/mode")
    assert r.status_code == 401
