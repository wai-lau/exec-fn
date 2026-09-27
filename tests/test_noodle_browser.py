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
        assert len(seal) == 6 and all(len(row) == 9 for row in seal), seal
        assert any(c.startswith('nd-hue-') for c in page.get_attribute('#nd-seal', 'class').split())
        teach = page.inner_text("#nd-teach")
        assert teach.startswith("argon2id(") and "m=64MiB" in teach

        cell = page.query_selector(".nd-d:not(.out)")
        cell.scroll_into_view_if_needed()
        box = cell.bounding_box()
        was_mid = "mid" in (cell.get_attribute("class") or "")
        page.mouse.click(box["x"] + box["width"] * 0.15, box["y"] + box["height"] * 0.15)
        assert ("mid" in cell.get_attribute("class")) != was_mid, "top-left tap must flip MIDDAY"

        page.click("#nd-submit")
        page.wait_for_function("document.querySelector('#nd-status').textContent.startsWith('reserved')",
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
        assert page.input_value("#nd-name") == NAME   # lowercased as typed
        page.fill("#nd-pass", "not the passphrase")
        page.wait_for_function(
            "document.querySelector('#nd-why').textContent.includes('different passphrase')", timeout=20000)
        assert page.is_disabled("#nd-submit")
        assert page.inner_text("#nd-seal-cap") == f"NOT {NAME}'s seal of approval"
        assert page.evaluate("document.getElementById('nd-cal').inert")
        assert page.evaluate("document.querySelector('.nd-ask').inert")
        # a name nobody holds unlocks everything again
        page.fill("#nd-name", "smoke unique name")
        page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
        assert not page.evaluate("document.getElementById('nd-cal').inert")
        assert page.inner_text("#nd-seal-cap") == "smoke unique name's seal of approval"
    finally:
        page.close()


def test_form_is_remembered_locally_never_in_a_cookie(browser, base_url, noodle_slug):
    ctx = browser.new_context(viewport={"width": 430, "height": 932})
    page = ctx.new_page()
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        _ready(page)
        assert page.inner_text("#nd-seal-cap") == "smoke bot's seal of approval"
        assert page.inner_text("#nd-why") == ""   # enabled: no reason shown
        # the roster is on this page now, and voters' dots wear their seal's ink
        assert page.locator("#nd-voters .nd-face").count() >= 1
        assert page.is_visible("#nd-who")
        page.reload()
        assert page.input_value("#nd-name") == NAME
        assert page.input_value("#nd-pass") == PASS
        page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
        assert all(PASS not in c["value"] for c in ctx.cookies()), "passphrase must never be a cookie"
    finally:
        ctx.close()


def test_empty_passphrase_is_allowed_with_a_warning(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", "smoke nopass")
        page.fill("#nd-pass", "")
        assert page.is_visible("#nd-warn")
        page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
        page.fill("#nd-pass", "x")
        assert not page.is_visible("#nd-warn")
    finally:
        page.close()


def test_empty_name_cannot_submit(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", "   ")
        page.fill("#nd-pass", "something")
        page.wait_for_timeout(2500)
        assert page.is_disabled("#nd-submit")
        assert page.inner_text("#nd-why") == "enter your name first."
        assert page.inner_text("#nd-seal-cap") == "your seal of approval"
    finally:
        page.close()


def test_draft_is_local_until_submit_then_only_signed_data_is_sent(browser, base_url, noodle_slug):
    """Picks and the Ask box live in localStorage until submit; the submit
    request carries exactly {name, pub, slots, ts, sig} -- never the passphrase."""
    ctx = browser.new_context(viewport={"width": 430, "height": 932})
    page = ctx.new_page()
    sent = []
    page.on("request", lambda r: sent.append((r.url, r.post_data)) if r.method == "POST" else None)
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        _ready(page)
        cell = page.locator(".nd-d:not(.out)").nth(1)
        cell.scroll_into_view_if_needed()
        box = cell.bounding_box()
        page.mouse.click(box["x"] + box["width"] * 0.85, box["y"] + box["height"] * 0.85)
        page.fill("#nd-ask", "draft text")
        picked = cell.get_attribute("class")
        assert page.inner_text("#nd-submit") == "Reserve*" and page.is_visible("#nd-dirty")
        assert sent == [], f"nothing may leave before submit: {sent}"

        page.reload()
        _ready(page)
        assert page.locator(".nd-d:not(.out)").nth(1).get_attribute("class") == picked
        assert page.input_value("#nd-ask") == "draft text"

        page.click("#nd-submit")
        page.wait_for_function("document.querySelector('#nd-status').textContent.startsWith('reserved')",
                               timeout=10000)
        import json
        votes = [json.loads(b) for u, b in sent if u.endswith("/vote")]
        assert len(votes) == 1 and set(votes[0]) == {"name", "pub", "slots", "ts", "sig"}
        assert all(PASS not in (b or "") for _, b in sent), "passphrase left the browser"
        assert page.evaluate(f"localStorage.getItem('noodle.draft.{noodle_slug}')") is None
        assert page.inner_text("#nd-submit") == "Reserve" and not page.is_visible("#nd-dirty")
    finally:
        ctx.close()


def test_tapping_a_face_fills_the_name(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        face = page.locator("#nd-voters .nd-face").first
        face.wait_for(timeout=10000)
        name = face.get_attribute("data-name")
        face.click()
        assert page.input_value("#nd-name") == name
        assert page.evaluate("document.activeElement.id") == "nd-pass"
        assert page.get_attribute("#nd-pass", "placeholder") == "empty for no passphrase"
    finally:
        page.close()
