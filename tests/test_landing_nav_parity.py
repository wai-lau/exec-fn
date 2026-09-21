"""Every section the public landing links to is reachable from the guest nav.

The landing wheel and the guest nav are built from two different tables --
`_LANDING_HUE_ORDER` in routes_views.py and `_GUEST_NAV_LINKS` in pages.py --
and nothing made them agree. They drifted: the landing offered `/graph`, the
guest nav did not, so a visitor who took that spoke landed on a page with no
way back to any of the other eight. CLAUDE.md had described GPH as being in the
guest nav for some time, which is how a doc can be the only place a thing is
true.

Both sides are read out of the RENDERED HTML, never from a hand-written list of
sections. A list here would be the same kind of denylist the admin-tier guard
exists to avoid: it covers what someone remembered on the day, and the tenth
section added next month is silently uncovered. Scraping the markup also tests
one step further than comparing the two constants would -- it catches a
divergence in the two builders, not just in the two tables.

Direction matters and only one direction is asserted: landing MUST be a subset
of the nav, the nav MAY hold more. The nav legitimately carries pages that are
deliberately not on the landing (`/zombo` is unlinked on purpose), and the
landing's own `admin` link is deliberately not a nav entry, so it is excluded
here by scoping the scrape to `.wheel-item`.
"""
import re

import pytest

# `<a class="wheel-item" href="/x">` -- the landing's spokes, which excludes the
# `landing-admin` link to /login by construction.
_WHEEL = re.compile(r'<a\s+class="wheel-item"\s+href="([^"]+)"')
# The nav is one `<div class="exec-nav">...</div>`; take its hrefs in isolation
# so a link elsewhere on the page cannot satisfy the assertion for it.
_NAV_BLOCK = re.compile(r'<div class="exec-nav">(.*?)</div>', re.S)
_HREF = re.compile(r'href="([^"]+)"')


def _landing_hrefs(client) -> set[str]:
    r = client.get("/", headers={"Accept": "text/html"})
    assert r.status_code == 200, f"landing: {r.status_code}"
    hrefs = set(_WHEEL.findall(r.text))
    assert hrefs, "no .wheel-item links found — the landing markup changed shape"
    return hrefs


def _guest_nav_hrefs(client, guest_cookie) -> set[str]:
    # /UI is guest-gated and renders the shared shell, so its nav IS the guest
    # nav. Any other guest page would do; this one carries no live data.
    r = client.get("/UI", headers=guest_cookie)
    assert r.status_code == 200, f"/UI as guest: {r.status_code}"
    block = _NAV_BLOCK.search(r.text)
    assert block, "no .exec-nav block on /UI — the shell markup changed shape"
    hrefs = set(_HREF.findall(block.group(1)))
    assert hrefs, "guest nav rendered with no links"
    return hrefs


def test_every_landing_link_is_in_the_guest_nav(client, guest_cookie):
    landing = _landing_hrefs(client)
    nav = _guest_nav_hrefs(client, guest_cookie)
    missing = sorted(landing - nav)
    assert not missing, (
        f"landing links with no guest-nav entry: {missing}. A visitor who "
        f"follows one of these has no way back to the other sections. Add it "
        f"to _GUEST_NAV_LINKS in api/pages.py (and give it _NAV_LABELS / "
        f"_NAV_ICONS entries), or drop it from _LANDING_HUE_ORDER."
    )


def test_landing_sections_all_render_a_label_and_a_blurb(client):
    """A spoke with no title or no description is a blank slot on the wheel --
    the landing tables are three parallel dicts keyed by section, so a section
    added to one and forgotten in the others renders empty rather than failing."""
    r = client.get("/", headers={"Accept": "text/html"})
    assert r.status_code == 200
    spokes = re.findall(
        r'<a class="wheel-item".*?</a>', r.text, re.S)
    assert spokes, "no landing spokes rendered"
    empty = [
        s for s in spokes
        if not re.search(r'<span class="landing-blurb">\s*\S', s)
        or not re.search(r'<span class="landing-sub">\s*\S', s)
    ]
    assert not empty, (
        f"{len(empty)} landing section(s) render an empty title or description "
        f"— check _LANDING_BLURBS / _LANDING_DESCS in api/routes_views.py"
    )


@pytest.mark.parametrize("tier", ["guest", "anon"])
def test_guest_nav_icons_resolve(client, guest_cookie, tier):
    """Every nav icon the guest shell references is actually served.

    The nav moved from /x.png to /icons/x.svg; a typo in one name is a broken
    image in the bar and nothing else would catch it."""
    headers = guest_cookie if tier == "guest" else {"Accept": "text/html"}
    path = "/UI" if tier == "guest" else "/"
    r = client.get(path, headers=headers)
    assert r.status_code == 200
    srcs = sorted(set(re.findall(r'<img src="(/icons/[^"]+)"', r.text)))
    assert srcs, f"no /icons/ references on {path} — did the nav stop using them?"
    for src in srcs:
        got = client.get(src)
        assert got.status_code == 200, f"{src} -> {got.status_code}"
        assert "svg" in got.headers.get("content-type", ""), (
            f"{src} served as {got.headers.get('content-type')!r}, not SVG"
        )
