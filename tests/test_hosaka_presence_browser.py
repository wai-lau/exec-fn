"""Presence-count behaviour (WebKit / playwright).

Proves the two rules of the /hosaka count: it excludes the viewer's OWN socket
("N other people speaking", not N+1), and a /tarot reader counts as one of
those others even though /tarot renders no count of its own.

Runs against the LIVE app, so a real visitor could be connected at any moment:
every assertion is RELATIVE to a baseline read at the start, never an absolute
number.

Marked `browser` so the fast smoke step skips it. Skips cleanly when
playwright / WebKit / the app / TURNSTILE_SECRET are absent.

    .venv/bin/pytest tests/test_hosaka_presence_browser.py -q
"""
import hashlib
import re

import pytest

from conftest import TURNSTILE_SECRET

pytest.importorskip("playwright.sync_api")

pytestmark = pytest.mark.browser

# "0 other people speaking" / "1 other person speaking" -- the plural must agree.
_COUNT = re.compile(r"^(\d+) other (person|people) speaking$")


def _others(page) -> int:
    """The count currently rendered, asserting the wording as it reads it."""
    text = page.locator("#tts-presence").inner_text().strip().lower()
    m = _COUNT.match(text)
    assert m, f"unexpected presence wording: {text!r}"
    n = int(m.group(1))
    assert m.group(2) == ("person" if n == 1 else "people"), f"plural disagrees: {text!r}"
    return n


def _wait_for(page, want: int, what: str):
    """Poll the rendered count until it reaches `want` (broadcast is async)."""
    page.wait_for_function(
        "want => {"
        "  const el = document.getElementById('tts-presence');"
        "  const m = el && el.textContent.trim().match(/^(\\d+) other/);"
        "  return !!m && Number(m[1]) === want;"
        "}",
        arg=want,
        timeout=10000,
    )
    assert _others(page) == want, what


@pytest.fixture
def guest_context(browser, base_url):
    """A WebKit context carrying the guest_session cookie a Turnstile solve sets."""
    if not TURNSTILE_SECRET:
        pytest.skip("TURNSTILE_SECRET not set (env or .env) — cannot mint guest cookie")
    token = hashlib.sha256(f"guest:{TURNSTILE_SECRET}".encode()).hexdigest()
    ctx = browser.new_context()
    ctx.add_cookies([{"name": "guest_session", "value": token, "url": base_url}])
    yield ctx
    ctx.close()


def test_hosaka_excludes_self_and_counts_tarot(guest_context, base_url):
    hosaka = guest_context.new_page()
    hosaka.goto(f"{base_url}/hosaka")
    hosaka.wait_for_selector("#tts-presence")
    # The page's own socket must not be in its own count, so a lone viewer
    # reads 0 -- plus whatever real visitors are connected right now.
    baseline = _others(hosaka)

    # A /tarot reader speaks through the same backend: +1 other, from a page
    # that renders no count itself.
    tarot = guest_context.new_page()
    tarot.goto(f"{base_url}/tarot")
    tarot.wait_for_selector("#terminal")
    _wait_for(hosaka, baseline + 1, "a /tarot reader must count as another person")
    assert tarot.locator("#tts-presence").count() == 0, "/tarot renders no count of its own"

    # And a second /hosaka viewer is another other -- still not counting self.
    second = guest_context.new_page()
    second.goto(f"{base_url}/hosaka")
    second.wait_for_selector("#tts-presence")
    _wait_for(hosaka, baseline + 2, "a second /hosaka viewer must count as another person")
    _wait_for(second, baseline + 2, "the second viewer excludes its own socket too")

    second.close()
    tarot.close()
    _wait_for(hosaka, baseline, "closing the other tabs must drop them from the count")
