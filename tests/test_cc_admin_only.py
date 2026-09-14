"""/cc is admin-only, and that must never quietly stop being true.

`tests/test_admin_only.py` already enumerates every `protected` route and checks
the tier generically. This file is deliberately narrower and louder: it is about
ONE surface, and it exists because /cc is no longer a tools-light chat page.
With Read/Write/Bash enabled it hands whoever reaches it a shell on the droplet
host as `cc-agent`, plus the account's subscription budget. There is no
per-caller scoping that would make a guest tier safe here the way
`gamesave_store` made /nightfall's slots safe — so the tier IS the security, and
a generic sweep that happens to cover /cc today is not the thing to rely on
tomorrow.

Routes are ENUMERATED from `routes_cc.py`, never hand-listed: a hand-written
list only covers what someone remembered, and the route added next month — the
one nobody thought about — is exactly the one that would be uncovered.

What is fired over HTTP and what is asserted structurally:
  - every GET is fired, anonymous and guest, and must be refused
  - POST /api/cc/query is fired with an EMPTY body, which is provably safe: the
    handler 400s when prompt and images are both empty, so even in the failure
    case under test (auth gone) no agent turn runs
  - POST /api/cc/new and /api/cc/resume are structural ONLY. Firing them in the
    failure case would archive and drop Wai's live conversation, or move the
    session pointer. A test must not be the thing that destroys the state it is
    protecting.
"""
import re
from pathlib import Path

import pytest

ROUTES_CC = Path(__file__).resolve().parents[1] / "api" / "routes_cc.py"

# @<tier>.<method>("<path>"...) — the tier is captured so a re-tiered route is
# caught structurally even before any request is made.
_DECORATOR = re.compile(
    r"^@(?P<tier>\w+)\.(?P<method>get|post|put|patch|delete)\(\s*[\"'](?P<path>/[^\"']*)[\"']",
    re.M,
)

# Fired with an empty JSON body: the handler rejects that before doing any work,
# so the request is safe even if auth is the thing that is broken.
_SAFE_EMPTY_POST = {"/api/cc/query"}

# Never fired: in the failure case these mutate real state.
_STRUCTURAL_ONLY = {"/api/cc/new", "/api/cc/resume"}


def _cc_routes():
    src = ROUTES_CC.read_text()
    found = [(m.group("tier"), m.group("method").upper(), m.group("path"))
             for m in _DECORATOR.finditer(src)]
    assert found, "no routes parsed out of routes_cc.py — the scan is broken"
    return found


CC_ROUTES = _cc_routes()
CC_GETS = [p for tier, m, p in CC_ROUTES if m == "GET"]


def _refused(resp) -> bool:
    """Refusal is 401/403, or the 401 handler's redirect to a login page."""
    if resp.status_code in (401, 403):
        return True
    if resp.status_code in (302, 303, 307):
        return "/login" in resp.headers.get("location", "")
    return False


# ── the scan must be sound, or every test below passes vacuously ─────────────
def test_scan_found_the_cc_routes():
    paths = {p for _, _, p in CC_ROUTES}
    for known in ("/cc", "/api/cc/query", "/api/cc/history", "/api/cc/health"):
        assert known in paths, f"{known} missing — the routes_cc.py scan is broken"
    assert len(CC_ROUTES) >= 8, f"only {len(CC_ROUTES)} /cc routes parsed — scan is broken"


def test_every_cc_route_is_declared_admin_only():
    """The structural half: nothing under /cc may sit on a weaker tier.

    `protected` is a SUFFIX of `guest_protected`, so this compares the captured
    tier EXACTLY rather than substring-matching — the same trap the enumerated
    tier guard and cmdscan.py exist for.
    """
    wrong = [(tier, m, p) for tier, m, p in CC_ROUTES if tier != "protected"]
    assert not wrong, (
        "every /cc route must be on the `protected` (admin-only) router; these are not: "
        + ", ".join(f"{m} {p} -> @{tier}" for tier, m, p in wrong)
    )


def test_every_cc_path_starts_at_cc():
    """A route declared in routes_cc.py that does not live under /cc would be
    admin-tiered by this file's contract while nothing here actually checks it."""
    for _, m, p in CC_ROUTES:
        assert p == "/cc" or p.startswith("/api/cc/"), f"unexpected path {m} {p}"


# ── and the observable half, against the live app ────────────────────────────
@pytest.mark.parametrize("path", CC_GETS)
def test_cc_get_is_refused_anonymously(client, path):
    assert _refused(client.get(path, timeout=15.0)), \
        f"GET {path} answered an ANONYMOUS caller — /cc must be admin-only"


@pytest.mark.parametrize("path", CC_GETS)
def test_cc_get_is_refused_for_a_guest(client, guest_cookie, path):
    assert _refused(client.get(path, headers=guest_cookie, timeout=15.0)), \
        f"GET {path} answered a GUEST — /cc must be admin-only, never guest_protected"


@pytest.mark.parametrize("path", sorted(_SAFE_EMPTY_POST))
def test_cc_query_post_is_refused_anonymously(client, path):
    r = client.post(path, json={}, timeout=15.0)
    assert _refused(r), (
        f"POST {path} was not refused anonymously (status {r.status_code}). "
        "This route runs an agent with Read/Write/Bash on the droplet host."
    )


@pytest.mark.parametrize("path", sorted(_SAFE_EMPTY_POST))
def test_cc_query_post_is_refused_for_a_guest(client, guest_cookie, path):
    r = client.post(path, json={}, headers=guest_cookie, timeout=15.0)
    assert _refused(r), f"POST {path} was not refused for a guest (status {r.status_code})"


def test_the_admin_can_still_reach_cc(client, admin_headers):
    """A route that refused EVERYONE would pass every check above while being
    broken, so the tier is only proven by the owner still getting in."""
    r = client.get("/cc", headers=admin_headers, timeout=15.0)
    assert r.status_code == 200, f"admin got {r.status_code} on /cc — the page is down"


def test_mutating_routes_are_covered_structurally():
    """Named explicitly so that dropping one from _STRUCTURAL_ONLY without
    adding it to the fired set is visible, rather than silently untested."""
    declared = {p for _, m, p in CC_ROUTES if m != "GET"}
    covered = _SAFE_EMPTY_POST | _STRUCTURAL_ONLY
    assert declared <= covered, (
        "a mutating /cc route is in neither the fired nor the structural set: "
        + ", ".join(sorted(declared - covered))
        + " — decide whether it is safe to fire, then add it to one of them"
    )


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__])
