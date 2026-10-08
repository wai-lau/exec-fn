"""/spire tower upgrades by + / - STEPPERS (WebKit / playwright).

A chart tower is upgraded a tier at a time on each axis of its triangle with
+ and - buttons (owner, 2026-10-08; were range sliders). This pins the rules they enforce:

- an axis moves only outward from the LOCKED-IN tier and never past the top
  tier - and the card SAYS why it stopped; the bank is no limit to a pull, but a
  basket it cannot cover shows its cost red on a button that takes no tap;
- the pulled points PREVIEW: stat rows show now -> next, the description shows
  the change as track changes (an <ins>), the button prices the basket;
- the upgrade button locks every pulled point in at once; the U key locks in;
- six tower slots only, the core's picks at waves 30 and 60.
- the BUILD cards fit the screen, landscape and portrait alike, with the cancel
  button visible below them.

Marked `browser` so the fast smoke step skips it.

    .venv/bin/pytest tests/test_spire_sliders_browser.py -q
"""
import hashlib

import pytest

pytest.importorskip("playwright.sync_api")

from conftest import TURNSTILE_SECRET  # noqa: E402

pytestmark = pytest.mark.browser


@pytest.fixture
def guest_page(browser, base_url):
    """A WebKit page on /spire carrying the guest_session cookie a Turnstile solve sets."""
    if not TURNSTILE_SECRET:
        pytest.skip("TURNSTILE_SECRET not set")
    token = hashlib.sha256(f"guest:{TURNSTILE_SECRET}".encode()).hexdigest()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_cookies([{"name": "guest_session", "value": token, "url": base_url}])
    page = ctx.new_page()
    page.goto(f"{base_url}/spire", wait_until="networkidle")
    page.wait_for_function("typeof G !== 'undefined' && typeof placeTower === 'function'")
    yield page
    ctx.close()


def _place_arc(page):
    """One ARC on the first slot, selected, the game paused and rich."""
    page.evaluate("""() => {
        G.money = 100000; ui.build = 'arc';
        placeTower({ x: CELLS[0].x, y: CELLS[0].y });
        ui.paused = true; ui.build = null; ui.sel = G.towers[0].id; refreshPanels();
    }""")
    page.wait_for_selector(".asp-axis-btn.plus")


def _tap(page, i, sign, n=1):
    """Tap axis i's + (sign 1) or - (sign -1) button n times."""
    btn = page.locator(".asp-axis-btn." + ("plus" if sign > 0 else "minus")).nth(i)
    for _ in range(n):
        btn.click(force=True)  # force: a disabled + at the top tier is tapped as a player would


def _basket(page):
    return page.evaluate("() => ({ ...basket.add })")


def test_sliders_preview_limits_and_lock_in(guest_page):
    page = guest_page
    _place_arc(page)
    assert page.evaluate("CELLS.length") == 6
    assert page.evaluate("CORE_PICKS") == [30, 60]
    assert page.locator(".asp-axis-row").count() == 3
    top = page.evaluate("SKILL_TIERS")
    up = page.locator("#asp-up")
    assert up.inner_text().strip() == "Arc"

    # one stop out on the first axis: a point in the basket, priced, previewed
    _tap(page, 0, 1)
    assert _basket(page).get("conductivity") == 1
    assert "Arc I" in up.inner_text() and str(page.evaluate("skillPointsCost(G.towers[0], 1)")) in up.inner_text()
    assert page.locator("#asp-stats-box .asp-next").count() >= 1
    assert page.locator("#asp-desc-box ins").count() >= 1
    assert page.locator("#asp-slider-note").inner_text().strip() == ""

    # past the top: it stops at the top tier
    _tap(page, 0, 1, top + 2)
    assert _basket(page).get("conductivity") == top
    assert page.locator(".asp-axis-tier").nth(0).inner_text() == "0→" + page.evaluate(f"roman({top})")
    _tap(page, 0, -1, top - 3)  # back down to III
    assert _basket(page).get("conductivity") == 3
    assert "Arc III" in up.inner_text()

    # a poor bank: the pull still lands, the button goes red and takes no tap
    page.evaluate("G.money = 150")
    _tap(page, 1, 1)
    assert _basket(page).get("voltage") == 1
    assert "poor" in (up.get_attribute("class") or "") and up.is_disabled()
    assert "4 points" not in up.inner_text() and "(" in up.inner_text()
    _tap(page, 1, -1)  # back to the locked tier: the point leaves the basket
    assert not _basket(page).get("voltage")
    page.evaluate("G.money = 100000; refreshUpgradePreview(G.towers[0])")  # a bank that covers it: the button takes the tap
    assert not up.is_disabled()

    # lock in: every pulled point bought in order, each at its own step
    page.evaluate("G.money = 100000")
    cost = page.evaluate("basketCost(G.towers[0])")
    up.click()
    t = page.evaluate("() => ({ lvl: G.towers[0].lvl, skills: G.towers[0].skills, money: G.money })")
    assert t["skills"] == {"conductivity": 3} and t["lvl"] == 4
    assert t["money"] == 100000 - cost
    assert _basket(page) == {}
    assert "III" in up.inner_text() and "(" not in up.inner_text()

    # pulling back below the locked tier: refused, and the reason shows
    _tap(page, 0, -1)
    assert not any(_basket(page).values())
    assert "locked" in page.locator("#asp-slider-note").inner_text()
    assert page.locator(".asp-axis-tier").nth(0).inner_text() == "III"

    # the second axis one stop out, then the U key locks it in
    _tap(page, 1, 1)
    assert _basket(page).get("voltage") == 1
    page.keyboard.press("u")
    assert page.evaluate("G.towers[0].skills.voltage") == 1
    assert _basket(page) == {}


def _cards_fit(page):
    """Every build card and the cancel button inside the viewport, the button below the cards."""
    return page.evaluate("""() => {
        const vh = window.innerHeight, vw = window.innerWidth, cards = [...document.querySelectorAll('.asp-build-cards .asp-card')];
        const boxes = cards.map(c => c.getBoundingClientRect()), btn = document.getElementById('asp-spend').getBoundingClientRect();
        const bottom = Math.max(...boxes.map(b => b.bottom));
        return { n: cards.length, cardsIn: boxes.every(b => b.top >= 0 && b.bottom <= vh && b.left >= 0 && b.right <= vw),
          btnIn: btn.top >= bottom && btn.bottom <= vh, cols: new Set(boxes.map(b => Math.round(b.left))).size };
    }""")


def test_build_cards_fit_landscape_and_portrait(guest_page):
    page = guest_page
    page.evaluate("() => { G.money = 100000; openBuildChooser(0); }")
    page.wait_for_selector(".asp-build-cards .asp-card")
    fit = _cards_fit(page)
    assert fit["n"] == 4 and fit["cardsIn"] and fit["btnIn"], fit
    assert fit["cols"] >= 2, fit  # landscape: side by side, not one tall column
    page.evaluate("closeChooser()")

    page.set_viewport_size({"width": 430, "height": 932})
    page.evaluate("() => { openBuildChooser(0); }")
    page.wait_for_selector(".asp-build-cards .asp-card")
    fit = _cards_fit(page)
    assert fit["n"] == 4 and fit["cardsIn"] and fit["btnIn"], fit
    assert fit["cols"] == 1, fit  # portrait: one column
