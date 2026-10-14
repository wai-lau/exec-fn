"""noodle's vote page under its real Content-Security-Policy (WebKit = iOS).

The page answers with a strict CSP (scripts from this site only, no eval, no
framing). Every other browser suite bypasses page CSP, because Playwright's
wait_for_function evaluates a string in the page; this one keeps the policy ON
and polls from Python, through a plain poll's whole vote and an end-to-end
poll's create -> commit -- so a policy that blocks something the page needs
(the key worker, WebCrypto, a fetch, a style) fails here."""
import hashlib
import time

import pytest

from noodle_helpers import offer_one

pytestmark = pytest.mark.browser

WATCH = ("window.__csp = []; document.addEventListener('securitypolicyviolation',"
         " function (e) { window.__csp.push(e.violatedDirective + ' ' + e.blockedURI); });")


def _until(page, expr, timeout=20.0):
    """Poll a JS expression from Python (page.evaluate is not subject to the CSP)."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if page.evaluate(expr):
            return
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {expr}")


def _context(browser, base_url, cookie=None):
    ctx = browser.new_context(viewport={"width": 430, "height": 932}, bypass_csp=False)
    if cookie:
        ctx.add_cookies([{**cookie, "url": base_url}])
    ctx.add_init_script(WATCH)
    return ctx


def _vote(page, name, pw):
    page.fill("#nd-name", name)
    page.fill("#nd-pass", pw)
    _until(page, "NDV.kdf && NDV.kdf.ready()")
    page.evaluate("NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick')")
    _until(page, "!document.getElementById('nd-cal').classList.contains('nd-readonly')")
    offer_one(page)
    _until(page, "!document.querySelector('#nd-submit').disabled")
    page.evaluate("NDV.committed = 0")
    page.click("#nd-submit")
    _until(page, "NDV.committed > 0")


def test_a_plain_poll_votes_under_the_csp(browser, base_url, noodle_slug):
    ctx = _context(browser, base_url)
    try:
        page = ctx.new_page()
        resp = page.goto(f"{base_url}/noodle/{noodle_slug}")
        # only this site's scripts, no framing, never in the disk cache
        csp = resp.headers["content-security-policy"]
        assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp
        assert resp.headers["cache-control"] == "no-store"
        _vote(page, "csp voter", "csp pass")
        assert page.evaluate("window.__csp") == [], "the CSP blocked something the page needs"
    finally:
        ctx.close()


def test_an_end_to_end_poll_is_created_and_committed_under_the_csp(browser, base_url):
    import httpx
    from conftest import API_KEY, TURNSTILE_SECRET
    if not API_KEY or not TURNSTILE_SECRET:
        pytest.skip("API_KEY / TURNSTILE_SECRET not set")
    guest = {"name": "guest_session", "value": hashlib.sha256(f"guest:{TURNSTILE_SECRET}".encode()).hexdigest()}
    ctx, slug = _context(browser, base_url, guest), None
    try:
        page = ctx.new_page()
        page.goto(f"{base_url}/noodle")
        page.click("#nd-create button")
        _until(page, "window.NDV && NDV.keyStr")
        slug = page.evaluate("NDV.slug")
        _vote(page, "csp host", "csp host pass")
        assert page.evaluate("NDV.poll.e2e && NDV.poll.voters.length") == 1
        assert page.evaluate("window.__csp") == [], "the CSP blocked something the page needs"
    finally:
        ctx.close()
        if slug:
            httpx.delete(f"{base_url}/api/noodle-polls/{slug}", headers={"Authorization": f"Bearer {API_KEY}"})
