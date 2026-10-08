"""/spire tower upgrades by SLIDERS (WebKit / playwright).

A chart tower is upgraded by dragging each axis of its triangle outward, a
stop per tier (owner, 2026-10-07). This pins the rules the sliders enforce:

- a handle moves only outward from the LOCKED-IN tier and never past the top
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
    page.wait_for_selector(".asp-sliders .handle")


def _drag_axis(page, i, frac):
    """Set axis i's slider to the tier `frac` of the way along it (0..1 -> tier 0..3; past 1 clamps to the top, below 0 to the bottom), as a drag would."""
    tier = max(0, min(3, round(frac * 3)))
    page.evaluate(f"""() => {{ const s = document.querySelectorAll('.asp-axis')[{i}]; s.value = {tier}; s.dispatchEvent(new Event('input', {{ bubbles: true }})); }}""")


def _basket(page):
    return page.evaluate("() => ({ ...basket.add })")


def test_sliders_preview_limits_and_lock_in(guest_page):
    page = guest_page
    _place_arc(page)
    assert page.evaluate("CELLS.length") == 6
    assert page.evaluate("CORE_PICKS") == [30, 60]
    assert page.locator(".asp-axis").count() == 3
    up = page.locator("#asp-up")
    assert up.inner_text().strip() == "Arc"

    # one stop out on the first axis: a point in the basket, priced, previewed
    _drag_axis(page, 0, 0.34)
    assert _basket(page).get("conductivity") == 1
    assert "Arc I" in up.inner_text() and "100" in up.inner_text()
    assert page.locator("#asp-stats-box .asp-next").count() >= 1
    assert page.locator("#asp-desc-box ins").count() >= 1
    assert page.locator("#asp-slider-note").inner_text().strip() == ""

    # to the end of the slider: the top tier
    _drag_axis(page, 0, 1.6)
    assert _basket(page).get("conductivity") == 3
    assert page.locator(".asp-axis-tier").nth(0).inner_text() == "0→III"
    assert "Arc III" in up.inner_text()

    # a poor bank: the pull still lands, the button goes red and takes no tap
    page.evaluate("G.money = 150")
    _drag_axis(page, 1, 0.34)
    assert _basket(page).get("voltage") == 1
    assert "poor" in (up.get_attribute("class") or "") and up.is_disabled()
    assert "4 points" not in up.inner_text() and "(" in up.inner_text()
    _drag_axis(page, 1, 0)  # back to the locked tier: the basket is affordable again
    assert not _basket(page).get("voltage") and not up.is_disabled()

    # lock in: every pulled point bought in order, each at its own step
    page.evaluate("G.money = 100000")
    up.click()
    t = page.evaluate("() => ({ lvl: G.towers[0].lvl, skills: G.towers[0].skills, money: G.money })")
    assert t["skills"] == {"conductivity": 3} and t["lvl"] == 4
    assert t["money"] == 100000 - (100 + 160 + 280)
    assert _basket(page) == {}
    assert "III" in up.inner_text() and "(" not in up.inner_text()

    # pulling back below the locked tier: refused, and the reason shows
    _drag_axis(page, 0, 0)
    assert _basket(page) == {}
    assert "locked" in page.locator("#asp-slider-note").inner_text()
    assert page.evaluate("document.querySelectorAll('.asp-axis')[0].value") == "3"  # snapped back

    # the second axis one stop out, then the U key locks it in
    _drag_axis(page, 1, 0.34)
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
