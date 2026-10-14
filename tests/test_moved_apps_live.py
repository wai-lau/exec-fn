"""Live E2E for the apps that live in submodules (ARCHITECTURE.md §1e): each
page renders for its real tier, and EVERY same-origin asset it names is served
200 with the content-hash `?v=` the server stamps (asset_version.py).

The submodule move changed only WHERE files live -- the static mount, the
template loaders and sys.path now search apps/*/ and nightfall-incident -- so
a file the move dropped, a path a loader no longer finds, or an asset
unreachable through the "/" mount shows up here as a non-200, against the
running container (SMOKE_BASE_URL), not a mock.
"""
import re

import pytest

from conftest import HTML_ACCEPT

# page -> the tier that opens it (guest pages are opened as a guest)
PAGES = {
    "/spire": "guest",
    "/noodle": "guest",
    "/nightfall": "guest",
    "/rd": "admin",      # the Exec panel: the sidecar's (claude-box) client
}
_REF = re.compile(r"""(?:src|href|content)=["'](?:https://wai-lau\.net)?(/(?!/)[^"'#?\s]+(?:\?[^"'#\s]*)?)["']""")
_ASSET = re.compile(r"\.(?:css|js|mjs|woff2?|ttf|png|jpe?g|webp|svg|ico|json|webmanifest|mp3|m4a|txt)(?:\?|$)")


def _auth(tier, guest_cookie, admin_cookie):
    """The fixtures are HEADER dicts ({"Cookie": ...}); passed as `cookies=` they
    would send a cookie literally named Cookie and the page would load logged
    out -- through a redirect to the login page, which is also a 200."""
    return guest_cookie if tier == "guest" else admin_cookie


@pytest.mark.parametrize("page", sorted(PAGES))
def test_page_and_every_asset_it_names(client, guest_cookie, admin_cookie, page):
    auth = {**_auth(PAGES[page], guest_cookie, admin_cookie), **HTML_ACCEPT}
    r = client.get(page, headers=auth, follow_redirects=False)
    assert r.status_code == 200, f"{page} -> {r.status_code} (a redirect = the tier was refused)"
    assets = sorted({m.group(1) for m in _REF.finditer(r.text) if _ASSET.search(m.group(1))})
    assert assets, f"{page} names no assets? (page shape changed)"
    bad = []
    for url in assets:
        a = client.get(url, headers=auth)
        if a.status_code != 200:
            bad.append(f"{url} -> {a.status_code}")
    assert not bad, f"{page}: assets not served:\n" + "\n".join(bad)


@pytest.mark.parametrize("page", ["/spire", "/noodle"])
def test_app_assets_carry_content_hashes(client, guest_cookie, page):
    """A moved app's own assets come back with ?v=<8 hex> (asset_version.py),
    i.e. the rewrite found the file in apps/<name>/web, not the parent's web/."""
    r = client.get(page, headers={**guest_cookie, **HTML_ACCEPT}, follow_redirects=False)
    assert r.status_code == 200, f"{page} -> {r.status_code}"
    own = re.findall(r"/(?:aspira|noodle)[\w.-]*\.(?:css|js)\?v=([\w.-]+)", r.text)
    assert own, f"{page}: no app assets found"
    assert all(re.fullmatch(r"[0-9a-f]{8}", v) for v in own), f"{page}: un-hashed ?v= {set(own)}"


def test_sidecar_reachable_through_the_parent(client, admin_cookie):
    """claude-box (submodule) is the Exec panel's agent; the parent reaches it
    over the docker bridge. Health only -- a query would land in Wai's thread."""
    r = client.get("/api/cc/health", headers=admin_cookie, timeout=15.0)
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True and body.get("authed") is True, body
