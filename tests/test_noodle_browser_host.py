"""noodle in the real engine (WebKit = iOS), the HOST and IDENTITY flows: the
crop lines, a fresh poll's defaults, retitling, and changing a name or
passphrase. Split from test_noodle_browser.py at the 500-line cap.
"""
import pytest

pytestmark = pytest.mark.browser


@pytest.fixture
def crop_slug(base_url):
    """A poll of its OWN, made for this test and deleted after: the crop test
    must be the host, and on a shared poll whoever acted first already is."""
    import httpx
    from conftest import API_KEY
    if not API_KEY:
        pytest.skip("API_KEY not set")
    auth = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=base_url, timeout=15.0) as c:
        slug = c.post("/api/noodle-polls", headers=auth, json={"title": "__smoke_crop__"}).json()["slug"]
    yield slug
    with httpx.Client(base_url=base_url, timeout=15.0) as c:
        c.delete(f"/api/noodle-polls/{slug}", headers=auth)


def test_the_host_drags_the_crop_lines_and_commit_saves_them(browser, base_url, crop_slug):
    """The host always has two lines on the calendar; a drop crops the page
    locally and Commit saves it for everyone. A line can
    be dragged past the current edge, and the cropped-off weeks are shaded."""
    page = browser.new_page(viewport={"width": 430, "height": 932})

    def drag(which, dy):
        # only the OUTER grip stroke is grabbable: the rest of the line lets
        # taps through to the days under it
        h = page.locator(f".nd-crop-h.{which} .grip.out")
        h.scroll_into_view_if_needed()
        # scrolling can lazy-load weeks, which re-places the line: wait until
        # the grip holds still before aiming at it
        b, prev = h.bounding_box(), None
        while b != prev:
            page.wait_for_timeout(250)
            prev, b = b, h.bounding_box()
        page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        page.mouse.down()
        page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2 + dy, steps=8)
        page.mouse.up()
        page.wait_for_function("document.querySelector('#nd-submit').textContent === 'Commit*'", timeout=5000)
        page.evaluate("NDV.committed = 0")
        page.click("#nd-submit")
        page.wait_for_function("NDV.committed > 0",
                               timeout=10000)
        return page.evaluate(f"fetch('/api/noodle/{crop_slug}').then(r => r.json())")["crop"]

    try:
        page.goto(f"{base_url}/noodle/{crop_slug}")
        page.fill("#nd-name", "smoke crop host")
        page.fill("#nd-pass", "crop host pass")
        page.wait_for_function("(NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick'), !document.getElementById('nd-cal').classList.contains('nd-readonly'))", timeout=20000)
        # a host must offer something to commit: give this one the first open time
        page.evaluate("NDV.cal.getSel().size || (NDV.cal.setSel(new Set([...NDV.cal.openSlots('0', '9')].slice(0, 1))), ndvSaveDraft())")
        page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
        assert page.locator(".nd-crop-h .grip.out").count() == 2, "each line shows a grip"
        first = drag("bot", -250)
        assert first and first["from"] <= first["to"]
        assert page.locator(".nd-shade.bot").is_visible(), "the weeks below the crop are shaded"
        wider = drag("bot", 300)
        assert wider["to"] > first["to"], (first, wider)
        assert page.evaluate("window.getSelection().toString()") == "", "a drag must not select text"
    finally:
        page.close()


def test_changing_the_passphrase_and_name_hands_the_vote_to_the_new_key(browser, base_url, noodle_slug):
    """Right passphrase -> the field locks, and each field gets a 'change'
    button; tap it, type the new value, Commit: the OLD key signs the new one
    (and the new name) over, and only the new one opens the vote. A cross
    cancels. Changed there and back, so the shared poll keeps one voter."""
    name, renamed, one, two = "smoke rekey", "smoke renamed", "rekey pass one", "rekey pass two"
    page = browser.new_page(viewport={"width": 430, "height": 932})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e) + " @ " + str(getattr(e, "stack", ""))))

    def fresh(nm, pw):
        """A clean load (nothing remembered), then this name + passphrase:
        is it the one sealed to that name?"""
        page.evaluate("localStorage.clear()")
        page.reload()
        page.fill("#nd-name", nm)
        page.fill("#nd-pass", pw)
        page.wait_for_function("(NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick'), !document.getElementById('nd-cal').classList.contains('nd-readonly'))"
                               " || document.querySelector('#nd-why').textContent.includes('different')",
                               timeout=20000)
        return page.evaluate("NDV.mine")

    def commit():
        assert page.inner_text("#nd-submit") == "Commit*"
        page.evaluate("NDV.committed = 0")
        page.click("#nd-submit")
        page.wait_for_function("NDV.committed > 0",
                               timeout=20000)

    def change(field, btn, new):
        page.evaluate("ndvStep('you')")   # one section at a time: the fields live on YOU
        page.wait_for_function(f"!document.querySelector('#{btn}').hidden", timeout=10000)
        assert page.inner_text(f"#{btn}") == "change"
        page.click(f"#{btn}")
        assert page.inner_text(f"#{btn}") == "undo"
        assert not page.is_disabled(f"#{field}")
        page.fill(f"#{field}", new)
        page.click("#nd-next")   # Commit carries the change, on the PICK step
        page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
        commit()

    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        if not fresh(name, one):
            # a previous run stopped half way: find where it left the voter
            for nm, pw in ((name, two), (renamed, one), (renamed, two)):
                if fresh(nm, pw):
                    break
            else:
                # first run: commit so there is a vote to change (a host must offer something)
                page.evaluate("ndxIsHost() && !NDV.cal.getSel().size && (NDV.cal.setSel(new Set("
                              "[...NDV.cal.openSlots('0', '9')].slice(0, 1))), ndvSaveDraft())")
                page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
                page.click("#nd-submit")
                page.wait_for_function("NDV.mine", timeout=10000)
            if page.input_value("#nd-name") != name:
                change("nd-name", "nd-rename", name)
            if page.input_value("#nd-pass") != one:
                change("nd-pass", "nd-rekey", one)
        # right passphrase: locked, with a change button beside each field
        assert page.is_disabled("#nd-pass")
        change("nd-pass", "nd-rekey", two)
        assert page.get_attribute("#nd-pass", "placeholder") == "please enter your passphrase"   # a held name
        assert page.is_disabled("#nd-pass"), "the new passphrase locks once committed"
        page.reload()
        page.wait_for_function("NDV.mine", timeout=20000)
        assert page.input_value("#nd-pass") == two, "the committed passphrase is the remembered one"
        assert not fresh(name, one), "the old passphrase no longer opens the vote"
        assert fresh(name, two)
        change("nd-name", "nd-rename", renamed)
        assert fresh(renamed, two)
        # mid change the roster keeps YOUR face (typed name), never the empty seat
        page.click("#nd-you-edit")
        page.click("#nd-rename")
        page.fill("#nd-name", "smoke midway")
        page.wait_for_function("[...document.querySelectorAll('.nd-face-name')].some(e => e.textContent === 'smoke midway')",
                               timeout=5000)
        assert page.locator(".nd-face.pending[data-name='']").count() == 0   # never the empty "you" seat
        page.click("#nd-rename")   # cancel
        page.wait_for_function("NDV.mine", timeout=20000)
        change("nd-name", "nd-rename", name)
        change("nd-pass", "nd-rekey", one)
        # the cross puts the old value back untouched
        page.click("#nd-you-edit")
        page.click("#nd-rekey")
        assert page.input_value("#nd-pass") == ""
        page.click("#nd-rekey")
        assert page.input_value("#nd-pass") == one
        page.wait_for_function("NDV.mine", timeout=20000)   # the old key re-derives, then locks again
        assert page.is_disabled("#nd-pass")
        assert page.inner_text("#nd-submit") == "Commit"
        # this test RELOADS mid-flight on purpose: a request cut off by its own
        # reload is WebKit's 'Load failed', not a page bug
        assert [e for e in errors if not e.startswith("Load failed")] == []
    finally:
        page.close()


def test_a_new_name_shows_its_face_among_the_voters(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        # no name yet: a blank seat says there is room, and tapping it fills nothing
        page.wait_for_selector(".nd-face.pending", timeout=10000)
        assert page.inner_text(".nd-face.pending .nd-face-name") == "you"
        blank = page.inner_text(".nd-face.pending .nd-seal")
        assert blank.strip(), "the placeholder seat wears a seal"
        page.click(".nd-face.pending")
        assert page.input_value("#nd-name") == ""
        page.reload()   # the placeholder seal is kept, not rerolled
        page.wait_for_selector(".nd-face.pending", timeout=10000)
        assert page.inner_text(".nd-face.pending .nd-seal") == blank
        # a voter's name (still deriving, or wrong passphrase) is not a new seat
        taken = page.evaluate("NDV.poll.voters.length ? NDV.poll.voters[0].name : null")
        if taken:   # the shared poll may have been recreated empty
            page.fill("#nd-name", taken)
            page.wait_for_function("!document.querySelector('.nd-face.pending')", timeout=5000)
        page.fill("#nd-name", "smoke newcomer")
        page.wait_for_function("document.querySelector('.nd-face.pending .nd-face-name').textContent"
                               " === 'smoke newcomer'", timeout=20000)
        page.wait_for_selector(".nd-face.pending", timeout=20000)
        assert page.inner_text(".nd-face.pending .nd-face-name") == "smoke newcomer"
        first = page.inner_text(".nd-face.pending .nd-seal")
        page.fill("#nd-pass", "another pass")
        page.wait_for_function(f"(document.querySelector('.nd-face.pending .nd-seal') || {{}}).textContent"
                               f" && document.querySelector('.nd-face.pending .nd-seal').textContent !== {first!r}",
                               timeout=20000)
    finally:
        page.close()


def test_name_and_passphrase_keep_only_letters_digits_and_spaces(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.wait_for_function("NDV.poll", timeout=10000)
        host = page.evaluate("ndxIsHost()")
        assert page.get_attribute("#nd-name", "placeholder") == (
            "how shall the guests address you, host?" if host else "please help the host know who you are")
        assert page.get_attribute("#nd-pass", "placeholder") == "you'll need this to change your vote"
        page.type("#nd-name", "Jane.Doe-2!")
        page.type("#nd-pass", "p@ss w0rd?")
        assert page.input_value("#nd-name") == "janedoe2"
        assert page.input_value("#nd-pass") == "pss w0rd"
    finally:
        page.close()


def test_a_fresh_poll_starts_three_weeks_with_nothing_picked(browser, base_url):
    """Host on a FRESH poll: cropped to this week + the next two, and every
    cell UNAVAILABLE -- the host picks what to offer, even from a fresh start."""
    import httpx
    from conftest import API_KEY
    if not API_KEY:
        pytest.skip("API_KEY not set")
    auth = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=base_url, timeout=15.0) as c:
        slug = c.post("/api/noodle-polls", headers=auth, json={"title": "__smoke_fresh__"}).json()["slug"]
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{slug}")
        page.wait_for_function("NDV.pendingCrop && NDV.cal", timeout=10000)
        crop = page.evaluate("NDV.pendingCrop")
        from datetime import date
        span = (date.fromisoformat(crop["to"]) - date.fromisoformat(crop["from"])).days
        assert span == 20, crop   # three whole weeks, Sunday to Saturday
        page.fill("#nd-name", "smoke fresh host")
        page.wait_for_function("(NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick'), !document.getElementById('nd-cal').classList.contains('nd-readonly'))", timeout=20000)
        assert page.evaluate("NDV.cal.getSel().size") == 0
        assert "pick at least one" in page.inner_text("#nd-why")
    finally:
        page.close()
        with httpx.Client(base_url=base_url, timeout=15.0) as c:
            c.delete(f"/api/noodle-polls/{slug}", headers=auth)


def test_the_host_retitles_by_tapping_the_title(browser, base_url):
    import httpx
    from conftest import API_KEY
    if not API_KEY:
        pytest.skip("API_KEY not set")
    auth = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=base_url, timeout=15.0) as c:
        slug = c.post("/api/noodle-polls", headers=auth, json={"title": "__smoke_title__"}).json()["slug"]
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{slug}")
        page.fill("#nd-name", "smoke titler")
        page.wait_for_function("(NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick'), !document.getElementById('nd-cal').classList.contains('nd-readonly'))", timeout=20000)
        # a host must offer something to commit
        page.evaluate("NDV.cal.setSel(new Set([...NDV.cal.openSlots('0', '9')].slice(0, 1))); ndvSaveDraft()")
        page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
        page.click("#nd-title")
        page.keyboard.press("End")
        page.keyboard.type(" renamed")
        page.keyboard.press("Enter")
        assert page.inner_text("#nd-submit") == "Commit*"
        page.evaluate("NDV.committed = 0")
        page.click("#nd-submit")
        page.wait_for_function("NDV.committed > 0",
                               timeout=20000)
        assert page.evaluate(f"fetch('/api/noodle/{slug}').then(r => r.json())")["title"] == "__smoke_title__ renamed"
        # the note under it: the same mechanism
        assert page.inner_text("#nd-note") == "" and "editable" in page.get_attribute("#nd-note", "class")
        page.click("#nd-note")
        page.keyboard.type("bring snacks")
        page.keyboard.press("Enter")
        assert page.inner_text("#nd-submit") == "Commit*"
        page.evaluate("NDV.committed = 0")
        page.click("#nd-submit")
        page.wait_for_function("NDV.committed > 0", timeout=20000)
        assert page.evaluate(f"fetch('/api/noodle/{slug}').then(r => r.json())")["note"] == "bring snacks"
    finally:
        page.close()
        with httpx.Client(base_url=base_url, timeout=15.0) as c:
            c.delete(f"/api/noodle-polls/{slug}", headers=auth)


def test_an_answer_with_parts_of_a_day_splits_the_hosts_calendar(browser, base_url):
    import json
    import httpx
    from conftest import API_KEY
    if not API_KEY:
        pytest.skip("API_KEY not set")
    auth = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=base_url, timeout=15.0) as c:
        slug = c.post("/api/noodle-polls", headers=auth, json={"title": "__smoke_split__"}).json()["slug"]
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{slug}")
        page.fill("#nd-name", "smoke splitter")
        page.wait_for_function("(NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick'), !document.getElementById('nd-cal').classList.contains('nd-readonly'))", timeout=20000)
        day = page.evaluate("[...NDV.cal.openSlots('0', '9')][0].slice(0, 10)")
        page.route("**/ask", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(
            {"slots": [f"{day}:n"], "reading": "nights", "dropped": 0, "crop": None, "split": True})))
        page.fill("#nd-ask", "that night only")
        page.click("#nd-ask-go")
        page.wait_for_function("document.getElementById('nd-split').checked", timeout=5000)
        cls = page.get_attribute(f".nd-d[data-day='{day}']", "class")
        assert "nit" in cls and "mid" not in cls, cls
        # the same question again re-applies the answer on the now-split calendar
        page.evaluate("NDV.cal.setSel(new Set())")
        page.click("#nd-ask-go")
        page.wait_for_function(f"document.querySelector(\".nd-d[data-day='{day}']\").classList.contains('nit')",
                               timeout=5000)
    finally:
        page.close()
        with httpx.Client(base_url=base_url, timeout=15.0) as c:
            c.delete(f"/api/noodle-polls/{slug}", headers=auth)


def test_title_and_note_are_editable_on_the_you_step(browser, base_url):
    """The host may name the poll while naming themself: the title and note
    take taps on the YOU step, before any name is typed (Wai, 2026-10-03)."""
    import httpx
    from conftest import API_KEY
    if not API_KEY:
        pytest.skip("API_KEY not set")
    auth = {"Authorization": f"Bearer {API_KEY}"}
    slug = httpx.post(f"{base_url}/api/noodle-polls", headers=auth, json={"title": "title"}).json()["slug"]
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{slug}")
        page.wait_for_function("NDV.poll", timeout=10000)
        assert page.evaluate("NDV.step") == "you"
        assert "editable" in page.get_attribute("#nd-title", "class").split()
        page.click("#nd-title")
        page.keyboard.type("LAN party")
        page.keyboard.press("Enter")
        page.click("#nd-note")
        page.keyboard.type("bring snacks")
        page.keyboard.press("Enter")
        assert page.evaluate("[NDV.pendingTitle, NDV.pendingNote]") == ["LAN party", "bring snacks"]
    finally:
        page.close()
        httpx.delete(f"{base_url}/api/noodle-polls/{slug}", headers=auth)
