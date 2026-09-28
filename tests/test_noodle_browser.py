"""noodle in the real engine (WebKit = iOS): the browser derives the key
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
    page.wait_for_function("!document.getElementById('nd-cal').classList.contains('nd-readonly')"
                           " || document.querySelector('#nd-why').textContent.includes('different')", timeout=20000)
    _offer_one(page)
    page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)


def _can_commit(page):
    page.wait_for_function("!document.getElementById('nd-cal').classList.contains('nd-readonly')", timeout=20000)
    _offer_one(page)
    page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)


def _offer_one(page):
    """A host must offer something to commit; on a shared poll that may have
    been recreated empty, the test voter can be the host."""
    page.evaluate("ndxIsHost() && !NDV.cal.getSel().size && "
                  "(NDV.cal.setSel(new Set([...NDV.cal.openSlots('0', '9')].slice(0, 1))), ndvSaveDraft())")


def test_sign_in_browser_verify_on_server(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        _ready(page)

        seal = page.inner_text("#nd-seal").split("\n")
        assert len(seal) == 6 and all(len(row) == 9 for row in seal), seal
        # ink is any hue from the key, carried as --seal-hsl "<h> <s>% <l>%" with l >= 62
        assert "inked" in page.get_attribute("#nd-seal", "class").split()
        ink = page.evaluate("document.getElementById('nd-seal').style.getPropertyValue('--seal-hsl')")
        h, sat, light = ink.split()
        assert 0 <= int(h) < 360 and 60 <= int(sat[:-1]) <= 100 and 62 <= int(light[:-1]) <= 82
        teach = page.inner_text("#nd-teach")
        assert teach.startswith("salt = sha256(poll, name)\nseal = argon2id(passphrase, salt)")
        assert "commit ──> stamp(data, seal)" in teach

        # an open day other than the one a host is offering (flipping that one
        # off would leave nothing to commit)
        cell = page.query_selector_all(".nd-d:not(.out):not(.shut)")[1]
        cell.scroll_into_view_if_needed()
        box = cell.bounding_box()
        was_mid = "mid" in (cell.get_attribute("class") or "")
        page.mouse.click(box["x"] + box["width"] * 0.15, box["y"] + box["height"] * 0.15)
        assert ("mid" in cell.get_attribute("class")) != was_mid, "top-left tap must flip MIDDAY"

        _can_commit(page)
        page.evaluate("NDV.committed = 0")
        page.click("#nd-submit")
        page.wait_for_function("NDV.committed > 0",
                               timeout=10000)
        assert page.inner_text(".nd-approved-by") == f"approved by {NAME}"
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
        assert page.evaluate("getComputedStyle(document.getElementById('nd-seal-cap')).fontWeight") == "700"
        assert page.evaluate("document.getElementById('nd-cal').classList.contains('nd-readonly')")
        assert page.evaluate("document.querySelector('.nd-ask').inert")
        label = "getComputedStyle(document.getElementById('nd-pass-label')).color"
        locked_colour = page.evaluate(label)
        # a name nobody holds unlocks everything again
        page.fill("#nd-name", "smoke unique name")
        _can_commit(page)
        assert not page.evaluate("document.getElementById('nd-cal').classList.contains('nd-readonly')")
        assert page.inner_text("#nd-seal-cap") == "smoke unique name's seal of approval"
        assert page.evaluate(label) != locked_colour, "the passphrase label must lose its warning colour"
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
        _can_commit(page)
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
        _can_commit(page)
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
        assert page.inner_text("#nd-why") == "enter your name first"
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
        assert page.inner_text("#nd-submit") == "Commit*" and page.is_visible("#nd-dirty")
        assert sent == [], f"nothing may leave before submit: {sent}"

        page.reload()
        _ready(page)
        assert page.locator(".nd-d:not(.out)").nth(1).get_attribute("class") == picked
        assert page.input_value("#nd-ask") == "draft text"

        page.evaluate(f"localStorage.setItem('noodle.draft.{noodle_slug}.STALE', '{{\"slots\":[\"2027-01-01:d\"]}}')")
        page.evaluate("NDV.committed = 0")

        page.click("#nd-submit")
        page.wait_for_function("NDV.committed > 0",
                               timeout=10000)
        import json
        votes = [json.loads(b) for u, b in sent if u.endswith("/vote")]
        assert len(votes) == 1 and set(votes[0]) == {"name", "pub", "slots", "ts", "sig"}
        assert all(PASS not in (b or "") for _, b in sent), "passphrase left the browser"
        assert page.evaluate("localStorage.getItem(ndvDraftKey())") is None   # per poll AND identity
        # and every OTHER draft this poll held is gone too (a stale one would
        # beat the saved picks the next time its seal matched)
        assert page.evaluate(f"Object.keys(localStorage).filter(k => k.startsWith('noodle.draft.{noodle_slug}.')).length") == 0
        assert page.inner_text("#nd-submit") == "Commit" and not page.is_visible("#nd-dirty")
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
        want = ("please enter your passphrase" if page.evaluate("NDV.held") else
                "you'll NEED to remember this" if page.evaluate("ndxIsHost()") else
                "you'll need this to change your vote")
        assert page.get_attribute("#nd-pass", "placeholder") == want
    finally:
        page.close()


def test_your_taps_light_the_half_and_add_your_dot(browser, base_url, noodle_slug):
    """Dark half = unavailable, lit = available, all dark by default; a tap
    also adds (or removes) YOUR dot in your own column."""
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", "smoke dots")
        page.fill("#nd-pass", "p")
        _can_commit(page)
        # a non-host can only light what the host offered: tap one of those
        poll = page.evaluate(f"fetch('/api/noodle/{noodle_slug}').then(r => r.json())")
        offered = sorted(poll["voters"][0]["slots"] if poll["voters"] else [])
        if poll["voters"] and not offered:
            pytest.skip("the smoke poll's host offers nothing")
        day, half = offered[0].split(":") if offered else (None, "m")
        cell = (page.locator(f".nd-d[data-day='{day}']") if day
                else page.locator(".nd-d:not(.out)").nth(5))
        lit, fy = ("mid", 0.15) if half == "m" else ("nit", 0.85)
        cell.scroll_into_view_if_needed()
        cls = cell.get_attribute("class")
        assert "mid" not in cls and "nit" not in cls, "every half starts dark"
        before = cell.locator(".nd-dots i.on").count()
        box = cell.bounding_box()
        page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * fy)
        assert lit in cell.get_attribute("class")
        assert cell.locator(".nd-dots i.on").count() == before + 1
        page.wait_for_timeout(600)   # not a double-click
        box = cell.bounding_box()
        page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * fy)
        assert lit not in cell.get_attribute("class")
        assert cell.locator(".nd-dots i.on").count() == before
    finally:
        page.close()


def test_enter_in_ask_is_a_newline_not_a_question(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", "smoke enter")
        _can_commit(page)
        asked = []
        page.on("request", lambda r: asked.append(r.url) if r.url.endswith("/ask") else None)
        page.click("#nd-ask")
        page.keyboard.type("fridays")
        page.keyboard.press("Enter")
        page.keyboard.type("nights")
        page.wait_for_timeout(300)
        assert page.input_value("#nd-ask") == "fridays\nnights" and asked == []
        ask, box = page.locator("#nd-ask-go").bounding_box(), page.locator("#nd-ask").bounding_box()
        assert ask["x"] >= box["x"] + box["width"], "the ask button sits to the right of the box"
    finally:
        page.close()


def test_a_rate_limit_counts_down_and_help_stays_pressable(browser, base_url, noodle_slug):
    """A 429 is a pause, not an end: the status counts retry_after down and
    clears by itself, and the button is never disabled for it. Stubbed."""
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.route("**/ask", lambda route: route.fulfill(
            status=429, content_type="application/json",
            body='{"error": "noodle needs a breather -- try again in 2s", "retry_after": 2}'))
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", "smoke ratelimit")
        _can_commit(page)
        page.fill("#nd-ask", "fridays")
        page.click("#nd-ask-go")
        page.wait_for_function("document.querySelector('#nd-ask-status').textContent.includes('too fast')")
        assert not page.is_disabled("#nd-ask-go")
        page.wait_for_function("document.querySelector('#nd-ask-status').textContent === ''", timeout=5000)
    finally:
        page.close()


def test_a_non_host_can_only_pick_what_the_host_offered(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        poll = page.evaluate(f"fetch('/api/noodle/{noodle_slug}').then(r => r.json())")
        if not poll["voters"]:
            pytest.skip("no host on the smoke poll yet")
        offered = set(poll["voters"][0]["slots"])
        page.fill("#nd-name", "smoke guest")
        _can_commit(page)

        def tap(day, half):
            cell = page.locator(f".nd-d[data-day='{day}']")
            cell.scroll_into_view_if_needed()
            b = cell.bounding_box()
            page.mouse.click(b["x"] + b["width"] * 0.5, b["y"] + b["height"] * (0.15 if half == "m" else 0.85))
            page.wait_for_timeout(600)
            return ("mid" if half == "m" else "nit") in cell.get_attribute("class")

        code = "m" if poll["halves"] else "d"   # an unsplit day is one slot, drawn as both halves
        days = page.evaluate("[...document.querySelectorAll('.nd-d:not(.out)')].map(c => c.dataset.day)")
        closed = next((d for d in days if f"{d}:{code}" not in offered), None)
        if closed:
            assert not tap(closed, "m"), "an un-offered time must not take a tap"
            assert "no-m" in page.get_attribute(f".nd-d[data-day='{closed}']", "class")
        if offered:
            day, half = sorted(offered)[0].split(":")
            assert tap(day, "m" if half == "d" else half), "an offered time must"
    finally:
        page.close()


def test_the_calendar_is_endless_and_guests_get_no_crop(browser, base_url, noodle_slug):
    """No poll dates: weeks load as the grid scrolls. The crop is the HOST's
    alone -- a guest (here: no key yet, on a poll that has a host) sees no
    crop handles and no crop button."""
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.locator(".nd-wk").first.wait_for()
        poll = page.evaluate(f"fetch('/api/noodle/{noodle_slug}').then(r => r.json())")
        if not poll["voters"]:
            pytest.skip("no host on this session's poll yet (run alone): the visitor would be the host")
        assert page.locator(".nd-crop-h").count() == 0 and page.locator("#nd-crop").count() == 0
        if poll.get("crop"):
            return   # a host-cropped calendar is finite by design
        start = page.locator(".nd-wk").count()
        for _ in range(4):
            page.evaluate("const s = document.querySelector('.nd-scroll'); s.scrollTop = s.scrollHeight")
            page.wait_for_timeout(400)
        assert page.locator(".nd-wk").count() > start, "scrolling to the bottom must load more weeks"
    finally:
        page.close()


def test_the_polls_link_sits_under_commit_with_a_copy_button(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.wait_for_function("NDV.poll", timeout=10000)
        if not page.evaluate("NDV.poll.voters.length && NDV.poll.voters[0].slots.length"):
            assert page.is_hidden("#nd-share"), "no link until the host has offered something"
            pytest.skip("the shared poll has no host offer yet")
        assert page.input_value("#nd-url") == f"{base_url}/noodle/{noodle_slug}"
        assert page.get_attribute("#nd-url", "readonly") is not None
        assert page.inner_text("#nd-copy") == "\uf0c5"   # the copy icon
        page.click("#nd-copy")
        page.wait_for_function("document.querySelector('#nd-copy').textContent === '\\u2713'", timeout=3000)
    finally:
        page.close()



def test_the_same_question_reapplies_the_last_answer(browser, base_url, noodle_slug):
    """An unchanged question does not ask again: the last answer is re-applied.
    The model is stubbed; the stub counts how often it is reached."""
    page = browser.new_page(viewport={"width": 430, "height": 932})
    calls = []

    def answer(route):
        calls.append(1)
        route.fulfill(status=200, content_type="application/json",
                      body='{"slots": [], "reading": "nothing", "dropped": 0, "crop": null}')
    try:
        page.route("**/ask", answer)
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", "smoke asker")   # Ask is off until a key is yours
        page.wait_for_function("!document.getElementById('noodle').classList.contains('nd-off')", timeout=20000)
        page.fill("#nd-ask", "fridays")
        page.click("#nd-ask-go")
        page.wait_for_function("document.querySelector('#nd-ask-status').textContent.includes('read that as')")
        page.evaluate("document.querySelector('#nd-ask-status').textContent = ''")
        page.click("#nd-ask-go")
        page.wait_for_function("document.querySelector('#nd-ask-status').textContent.includes('read that as')")
        assert len(calls) == 1, "the same question must not be asked twice"
        page.fill("#nd-ask", "")
        assert not page.is_disabled("#nd-ask-go")
        page.click("#nd-ask-go")
        assert "help how? type in box pls" in page.inner_text("#nd-ask-status")
    finally:
        page.close()


def test_the_ask_text_is_kept_per_poll_and_name(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", "smoke asker two")
        page.wait_for_function("!document.getElementById('noodle').classList.contains('nd-off')", timeout=20000)
        page.fill("#nd-ask", "fridays after work")
        page.reload()
        page.fill("#nd-name", "smoke asker two")
        page.wait_for_function("document.getElementById('nd-ask').value === 'fridays after work'", timeout=20000)
        page.fill("#nd-name", "smoke someone else")   # another name: its own (empty) text
        page.wait_for_function("document.getElementById('nd-ask').value === ''", timeout=20000)
    finally:
        page.close()
