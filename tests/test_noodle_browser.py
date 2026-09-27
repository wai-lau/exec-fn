"""Noodle in the real engine (WebKit = iOS): the browser derives the key
(Argon2id in a worker -> Ed25519), signs, and the SERVER verifies -- the one
place a byte of disagreement between noodle-vote.js's JSON.stringify and
noodle/sig.py's canonical() would show.

Votes as a fixed voter with a fixed passphrase, so every run re-derives the
same key and EDITS the same vote on the shared __smoke__ poll rather than
adding a new voter each time.
"""
import pytest

pytestmark = pytest.mark.browser

NAME, PASS = "smoke bot", "a fixed smoke passphrase"


def _ready(page):
    page.fill("#nd-name", NAME)
    page.fill("#nd-pass", PASS)
    page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)


def test_sign_in_browser_verify_on_server(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        _ready(page)

        seal = page.inner_text("#nd-seal").split("\n")
        assert len(seal) == 5 and all(len(row) == 9 for row in seal), seal
        teach = page.inner_text("#nd-teach")
        assert teach.startswith("argon2id(") and "m=64MiB" in teach

        cell = page.query_selector(".nd-d:not(.out)")
        cell.scroll_into_view_if_needed()
        box = cell.bounding_box()
        was_mid = "mid" in (cell.get_attribute("class") or "")
        page.mouse.click(box["x"] + box["width"] * 0.15, box["y"] + box["height"] * 0.15)
        assert ("mid" in cell.get_attribute("class")) != was_mid, "top-left tap must flip MIDDAY"

        page.click("#nd-submit")
        page.wait_for_function("document.querySelector('#nd-status').textContent.startsWith('sealed')",
                               timeout=10000)
        voters = page.evaluate(f"fetch('/api/noodle/{noodle_slug}').then(r => r.json())")["voters"]
        mine = [v for v in voters if v["name"].lower() == NAME]
        assert len(mine) == 1 and mine[0]["pub"]
        assert errors == []
    finally:
        page.close()


def test_same_name_other_passphrase_is_blocked(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", NAME.upper())
        page.fill("#nd-pass", "not the passphrase")
        page.wait_for_function("document.querySelector('#nd-status').dataset.kind === 'err'", timeout=20000)
        assert page.is_disabled("#nd-submit")
    finally:
        page.close()
