"""The owner's chart on /noodle (polls created per day) in the real engine
(WebKit = iOS): the owner sees a column a day from the first counted day to
today, with a tooltip on tap; a guest's page never shows it."""
import hashlib

import pytest

pytestmark = pytest.mark.browser


def _page(browser, base_url, cookie):
    ctx = browser.new_context(viewport={"width": 430, "height": 932})
    ctx.add_cookies([{**cookie, "url": base_url}])
    return ctx, ctx.new_page()


def test_the_owner_sees_polls_created_per_day(browser, base_url):
    from conftest import API_KEY
    if not API_KEY:
        pytest.skip("API_KEY not set")
    ctx, page = _page(browser, base_url, {"name": "session", "value": hashlib.sha256(f"session:{API_KEY}".encode()).hexdigest()})
    try:
        page.goto(f"{base_url}/noodle")
        page.wait_for_selector("#nd-owner:not([hidden])", timeout=10000)
        bars = page.locator(".nd-bar")
        if not bars.count():
            assert page.inner_text("#nd-chart-sub") == "no polls yet"
            return
        assert page.inner_text("#nd-chart-from") and page.inner_text("#nd-chart-sub").endswith(page.inner_text("#nd-chart-from"))
        last = bars.nth(bars.count() - 1)
        last.click()
        assert page.is_visible("#nd-chart-tip")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "the chart pushed the page sideways"
    finally:
        ctx.close()


def test_a_guest_never_sees_it(browser, base_url):
    from conftest import TURNSTILE_SECRET
    if not TURNSTILE_SECRET:
        pytest.skip("TURNSTILE_SECRET not set")
    ctx, page = _page(browser, base_url, {"name": "guest_session", "value": hashlib.sha256(f"guest:{TURNSTILE_SECRET}".encode()).hexdigest()})
    try:
        page.goto(f"{base_url}/noodle")
        page.wait_for_load_state("networkidle")
        assert page.locator("#nd-owner").is_hidden() and page.locator(".nd-bar").count() == 0
    finally:
        ctx.close()
