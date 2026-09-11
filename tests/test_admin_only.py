"""Every admin route is ADMIN ONLY — not public, not guest, and still admin-usable.

The route list is ENUMERATED from the decorators, never hand-written. A
hand-written list is a denylist: it covers what someone remembered on the day,
and a route added later is silently uncovered — which is the whole failure mode
this file exists to prevent. Scanning `@protected.<method>(...)` means a new
admin route is in the suite the moment it is written.

Why a source scan and not `import main`: these run in the pre-commit gate
against the live container, and the dev venv has no fastapi, so the app cannot
be imported host-side. The decorator IS the declaration of tier, so scanning it
tests the same fact.

Only modules the app actually LOADS are scanned — the file set is walked from
`main.py` down the import graph. A module that declares routes but that nothing
imports registers nothing: its decorators are dead text, and firing those paths
over HTTP would assert a tier against a 404. Deriving the set from the imports
keeps it honest in both directions — a route module joins the suite the moment
`main.py` imports it, and leaves the moment that import is dropped (which is how
`/emet` was unlinked 2026-09-10, its source deliberately kept in tree).

**GET routes are fired over HTTP; mutating ones deliberately are NOT.** This
suite runs on every commit against the LIVE production container. FastAPI
resolves dependencies before the handler, so an unauthenticated POST should stop
at 401 having done nothing — but the one scenario where it does NOT is exactly
the bug under test, and `POST /api/morning` would then run the morning pipeline
against real data. A test must not be the thing that fires it. Mutating routes
get the structural assertion instead (declared under `protected`, absent from
the other two tiers), which is what actually determines their tier.
"""
import os
import re
import sys

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from conftest import HTML_ACCEPT  # noqa: E402,F401

_API = os.path.join(os.path.dirname(__file__), "..", "api")

# `protected` is a SUFFIX of `guest_protected`, so an unanchored match reports
# every guest route as admin — the same substring trap cmdscan.py exists for.
# (?<![\w_]) keeps `guest_protected.` from matching as `protected.`.
_DECORATOR = re.compile(
    r"@(?<![\w_])(?P<tier>guest_protected|protected|public)"
    r"\.(?P<method>get|post|patch|delete|put|head)\(\s*[\"'](?P<path>[^\"']+)[\"']"
)
_INCLUDE = re.compile(r"(?<![\w_])(?P<tier>guest_protected|protected|public)\.include_router\((?P<name>\w+)\)")
_ALIAS = re.compile(r"from\s+(?P<mod>[\w.]+)\s+import\s+(?P<sym>\w+)(?:\s+as\s+(?P<alias>\w+))?")

# Path params, filled with values that cannot match anything real — a 404 still
# proves the auth gate ran first, which is all these assert.
_PARAMS = {
    "todo_id": "smoke-nonexistent",
    "card_id": "smoke-nonexistent",
    "filename": "smoke-nonexistent.json",
}

# These stream (SSE) and never close on their own. An unauthenticated request
# must be rejected BEFORE the stream opens, so a hang is itself the failure.
_STREAMING = {"/api/monitor/stream", "/api/hosaka/mode/stream"}


# Matches top-level AND indented imports — a route module pulled in inside a
# function (the deferred-import idiom this app uses for optional deps) still
# registers its routes when that function runs.
_IMPORT = re.compile(
    r"^[ \t]*(?:import\s+(?P<plain>[\w.]+)"
    r"|from\s+(?P<mod>[\w.]+)\s+import\s+(?P<names>[^\n#]+))",
    re.M,
)


def _module_source(mod: str):
    """Dotted api-relative module -> its source file, or None if not ours."""
    base = os.path.join(_API, *mod.split("."))
    for cand in (base + ".py", os.path.join(base, "__init__.py")):
        if os.path.isfile(cand):
            return cand
    return None


def _py_files():
    """The api sources reachable from main.py, walked down the import graph."""
    seen, queue = set(), ["main"]
    while queue:
        path = _module_source(queue.pop())
        if not path or path in seen:
            continue
        seen.add(path)
        for m in _IMPORT.finditer(_read(path)):
            if m.group("plain"):
                queue.append(m.group("plain"))
                continue
            base = m.group("mod")
            queue.append(base)
            # `from pkg import sub` may name a SUBMODULE, not only a symbol.
            for name in m.group("names").replace("(", " ").replace(")", " ").split(","):
                name = name.split(" as ")[0].strip().strip("\\").strip()
                if name and name != "*":
                    queue.append(f"{base}.{name}")
    return sorted(seen)


def _read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


def _scan_tiers():
    """{tier: {(METHOD, path)}} for direct decorators plus included routers."""
    tiers = {"protected": set(), "guest_protected": set(), "public": set()}
    sources = {p: _read(p) for p in _py_files()}

    for text in sources.values():
        for m in _DECORATOR.finditer(text):
            tiers[m.group("tier")].add((m.group("method").upper(), m.group("path")))

    # A router included onto a tier contributes its own routes to that tier.
    #
    # The alias must resolve to its MODULE, not just its symbol. Nearly every
    # route module names its router `router`, so resolving `chat_router` to the
    # bare symbol and then scanning every file swept mtg's, tarot's and
    # nightfall's routes in as admin — and mirrored, put admin's /api/chat into
    # the guest bucket. Scanning only the defining file is what makes the tier
    # attribution correct.
    routers_src = _read(os.path.join(_API, "routers.py"))
    origins = {}
    for m in _ALIAS.finditer(routers_src):
        origins[m.group("alias") or m.group("sym")] = (m.group("mod"), m.group("sym"))

    for m in _INCLUDE.finditer(routers_src):
        mod, symbol = origins.get(m.group("name"), (None, m.group("name")))
        if not mod:
            continue
        src = _read(os.path.join(_API, *mod.split("."))) or \
            _read(os.path.join(_API, *mod.split(".")) + ".py")
        sub = re.compile(
            rf"@{re.escape(symbol)}\.(?P<method>get|post|patch|delete|put|head)"
            rf"\(\s*[\"'](?P<path>[^\"']+)[\"']"
        )
        for r in sub.finditer(src):
            tiers[m.group("tier")].add((r.group("method").upper(), r.group("path")))
    return tiers


TIERS = _scan_tiers()
ADMIN = sorted(TIERS["protected"])
ADMIN_GET = [(m, p) for m, p in ADMIN if m == "GET"]
ADMIN_MUTATING = [(m, p) for m, p in ADMIN if m != "GET"]


def _concrete(path: str) -> str:
    """Substitute path params; '{filename:path}' carries a converter suffix."""
    def sub(match):
        name = match.group(1).split(":", 1)[0]
        return _PARAMS.get(name, "smoke-nonexistent")
    return re.sub(r"\{([^}]+)\}", sub, path)


def _rejected(resp) -> bool:
    """Rejection is 401/403, or the 401 handler's redirect to a LOGIN page."""
    if resp is _HELD_OPEN:
        return False   # the stream was accepted and held — the opposite of refused
    if resp.status_code in (401, 403):
        return True
    if resp.status_code in (302, 303, 307):
        return "/login" in resp.headers.get("location", "") or \
               "/guest" in resp.headers.get("location", "")
    return False


# An SSE route that ACCEPTS the caller holds the connection open and emits
# nothing until an event occurs, so the request times out instead of answering.
# That is the observable difference between accepted and refused on these
# routes: a refusal is an immediate 401, so a timeout means it was NOT refused.
# Modelled explicitly rather than papered over, because the two tiers read the
# same sentinel in opposite directions.
_HELD_OPEN = object()


def _get(client, path, headers):
    target = _concrete(path)
    if path in _STREAMING:
        try:
            with client.stream("GET", target, headers=headers, timeout=6.0) as r:
                return r
        except httpx.ReadTimeout:
            return _HELD_OPEN
    return client.get(target, headers=headers, timeout=15.0)


# ── the scan itself must be sound, or every test below passes vacuously ──────
def test_scan_found_the_admin_tier():
    assert len(ADMIN) >= 30, f"admin scan found only {len(ADMIN)} routes — scan is broken"
    assert len(ADMIN_GET) >= 15, f"only {len(ADMIN_GET)} admin GETs — scan is broken"
    for known in [("GET", "/cc"), ("GET", "/rd"), ("GET", "/hq"), ("GET", "/debug"),
                  ("POST", "/api/cc/query"), ("GET", "/api/rd")]:
        assert known in TIERS["protected"], f"{known} missing from admin scan"


def test_scan_did_not_swallow_the_guest_tier():
    """`protected` is a suffix of `guest_protected`; an unanchored regex reports
    every guest route as admin and the suite then 'passes' by testing nothing
    real. Known guest routes must land in the guest bucket, not the admin one."""
    for known in [("GET", "/mtg"), ("GET", "/tarot"), ("GET", "/hosaka")]:
        assert known in TIERS["guest_protected"], f"{known} not seen as guest"
        assert known not in TIERS["protected"], f"{known} misfiled as admin"


# ── no route may sit on two tiers at once ────────────────────────────────────
def test_no_admin_path_is_also_public_or_guest():
    """A duplicate registration on a lower tier leaks the route regardless of
    what the admin decorator says — whichever router mounts first wins."""
    for tier in ("public", "guest_protected"):
        overlap = TIERS["protected"] & TIERS[tier]
        assert not overlap, f"admin routes also declared on {tier}: {sorted(overlap)}"


# ── the live checks: anonymous and guest are refused, admin is not ───────────
@pytest.mark.parametrize("method,path", ADMIN_GET, ids=lambda v: str(v))
def test_admin_get_rejects_anonymous(client, method, path):
    assert _rejected(_get(client, path, dict(HTML_ACCEPT))), \
        f"{path} served an ANONYMOUS caller"


@pytest.mark.parametrize("method,path", ADMIN_GET, ids=lambda v: str(v))
def test_admin_get_rejects_guest(client, guest_cookie, method, path):
    assert _rejected(_get(client, path, guest_cookie)), \
        f"{path} served a GUEST — admin-only route reachable from the guest tier"


@pytest.mark.parametrize("method,path", ADMIN_GET, ids=lambda v: str(v))
def test_admin_get_accepts_admin(client, admin_cookie, method, path):
    """Without this, a route that rejected EVERYONE would pass the two tests
    above while being broken — 'not public, not guest' is only half the claim."""
    r = _get(client, path, admin_cookie)
    if r is _HELD_OPEN:
        return   # SSE accepted the admin and held the connection open
    assert r.status_code not in (401, 403), f"{path} refused the ADMIN cookie"
    if r.status_code in (302, 303, 307):
        loc = r.headers.get("location", "")
        assert "/login" not in loc and "/guest" not in loc, \
            f"{path} bounced the admin to a login page ({loc})"


# ── an admin page must bounce to the ADMIN login, never the guest one ────────
_ADMIN_PAGES = [p for m, p in ADMIN_GET if not p.startswith(("/api/", "/data/"))]


@pytest.mark.parametrize("path", _ADMIN_PAGES)
def test_admin_page_redirects_to_admin_login_not_guest(client, path):
    """Bouncing an admin page to /guest would advertise it as guest-reachable and
    hand the visitor a Turnstile that cannot grant access. main.py's 401 handler
    keeps a prefix tuple for the guest-gated pages; an admin path must not be in
    it."""
    r = client.get(_concrete(path), headers=dict(HTML_ACCEPT),
                   timeout=4.0 if path in _STREAMING else 15.0)
    if r.status_code in (302, 303, 307):
        loc = r.headers.get("location", "")
        assert "/guest" not in loc, f"{path} redirects to the GUEST login ({loc})"
        assert "/login" in loc, f"{path} redirects somewhere unexpected ({loc})"
    else:
        assert r.status_code in (401, 403), f"{path} neither refused nor redirected"


# ── mutating routes: tier asserted structurally, never fired ────────────────
def test_mutating_admin_routes_are_admin_tier_only():
    """Not fired over HTTP on purpose — see the module docstring. POST
    /api/morning against the live container would run the morning pipeline."""
    assert ADMIN_MUTATING, "no mutating admin routes found — scan is broken"
    for entry in ADMIN_MUTATING:
        assert entry not in TIERS["public"], f"{entry} is also public"
        assert entry not in TIERS["guest_protected"], f"{entry} is also guest"


# ── mount order: the catch-all must never outrank the admin router ───────────
#
# Starlette matches in REGISTRATION order and `app.mount("/", StaticFiles(...))`
# matches every path, so the only thing keeping /cc (and every other admin page)
# off the public static handler is that the routers are included first. Nothing
# enforced that, and the failure would be silent and total: the admin router
# would simply stop being reached.
#
# Asserted on source order rather than on an imported app because the mounts are
# hardcoded to container paths (/app/static, /app/nightfall). Importing `main`
# host-side means fabricating those directories, which buys a more fragile test,
# not a stronger one — registration order IS source order for module-level calls.
_MAIN = os.path.join(_API, "main.py")
_INCLUDE_CALL = re.compile(r"^\s*app\.include_router\(\s*(\w+)", re.M)
_ROOT_MOUNT = re.compile(r"^\s*app\.mount\(\s*[\"']/?[\"']", re.M)


def _line_of(match, text):
    return text.count("\n", 0, match.start()) + 1


def test_routers_are_registered_before_the_root_static_mount():
    text = _read(_MAIN)
    mounts = [(_line_of(m, text), m.group(0).strip()) for m in _ROOT_MOUNT.finditer(text)]
    includes = {m.group(1): _line_of(m, text) for m in _INCLUDE_CALL.finditer(text)}

    assert "protected" in includes, "app.include_router(protected) not found in main.py"
    assert mounts, "no root mount found — this guard is asserting nothing; re-check main.py"

    first_mount = min(line for line, _ in mounts)
    for name, line in includes.items():
        assert line < first_mount, (
            f"app.include_router({name}) is registered at line {line}, AFTER the "
            f"root mount at line {first_mount} — the catch-all now shadows it and "
            f"every route on that router is unreachable"
        )
