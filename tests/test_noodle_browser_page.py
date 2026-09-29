"""noodle in the real engine (WebKit = iOS), the parts of a poll page AROUND
the vote: Ask noodle (Enter, the rate-limit countdown, re-applying an answer),
what the browser remembers (the Ask text, the passphrase per poll and name),
the share link, the top dates and the pick note. The signing and voting
itself is test_noodle_browser.py; the host's tools test_noodle_browser_host.py.
"""
import pytest

from noodle_helpers import can_commit as _can_commit

pytestmark = pytest.mark.browser


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


def test_the_passphrase_is_remembered_per_poll_and_name(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.fill("#nd-name", "smoke rememberer")
        page.fill("#nd-pass", "remember me")
        page.reload()
        page.wait_for_function("document.getElementById('nd-pass').value === 'remember me'", timeout=10000)
        assert "pass" not in (page.evaluate("localStorage.getItem('noodle.identity')") or ""), \
            "the passphrase is no longer kept poll-agnostic"
        page.fill("#nd-name", "smoke someone new")   # another name: nothing to offer
        assert page.input_value("#nd-pass") == ""
        page.fill("#nd-name", "smoke rememberer")    # back: offered again
        assert page.input_value("#nd-pass") == "remember me"
        page.fill("#nd-pass", "typed by hand")
        page.fill("#nd-name", "smoke rememberer2")   # a hand-typed passphrase is never replaced
        assert page.input_value("#nd-pass") == "typed by hand"
        # nothing saved for the name on THIS poll: the last passphrase that NAME
        # used anywhere ("typed by hand" was typed under it above)
        page.evaluate(f"localStorage.removeItem('noodle.pass.{noodle_slug}.smoke rememberer')")
        page.fill("#nd-pass", "")
        page.fill("#nd-name", "smoke rememberer")
        assert page.input_value("#nd-pass") == "typed by hand"
        page.fill("#nd-pass", "")
        page.fill("#nd-name", "smoke never seen")    # a name never used: still empty
        assert page.input_value("#nd-pass") == ""
    finally:
        page.close()


def test_the_top_dates_rank_and_line_up(browser, base_url, noodle_slug):
    """Every slot a non-host voter picked (cols[0] is the host), most voters
    first, soonest on a tie; a sun or moon only on a split poll; every row's
    dots start at the same x."""
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.wait_for_function("window.ndtRender && window.NoodleCalParts")
        rows = page.evaluate("""() => {
          const P = window.NoodleCalParts, d = n => P.addDays(P.iso(new Date()), n);
          const A = {slots: new Set([d(1)+':m', d(2)+':n', d(3)+':m', d(4)+':m', d(5)+':n', d(6)+':m']), ink: '10 80% 70%'};
          const B = {slots: new Set([d(3)+':m', d(2)+':n', d(-1)+':m']), ink: '200 80% 70%'};
          window.ndtRender([A, B, {self: true, ink: null}], new Set([d(3)+':m']));
          const el = document.getElementById('nd-top');
          return {hidden: el.parentNode.hidden, rows: [...el.children].map(li => ({
            text: li.textContent,
            x: li.querySelector('.nd-top-dots').getBoundingClientRect().left,
            on: [...li.querySelectorAll('.nd-top-dots i')].map(i => i.classList.contains('on'))}))};
        }""")
        assert not rows["hidden"]
        r = rows["rows"]
        # A is the host: its four slots nobody else picked are not results
        assert [x["on"] for x in r] == [[True, True, True], [True, True, False]]   # 3 voters, then 2
        assert r[0]["text"][0] == "" and r[1]["text"][0] == ""             # sun midday, moon night
        assert len({round(x["x"], 1) for x in r}) == 1, "dots do not line up"
        assert all(":" in x["text"] and len(x["text"].split(":")[0]) == len(r[0]["text"].split(":")[0]) for x in r)
        # a whole-day poll: no glyph
        text = page.evaluate("""() => {
          const P = window.NoodleCalParts, d = P.addDays(P.iso(new Date()), 2);
          window.ndtRender([{slots: new Set([d+':d']), ink: null}, {self: true, ink: null}], new Set([d+':d']));
          return document.getElementById('nd-top').textContent; }""")
        assert text[0] not in "\uf185\uf186" and text.endswith(": ")
    finally:
        page.close()


def test_the_pick_note_shows_only_once_unlocked(browser, base_url, noodle_slug):
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.wait_for_function("NDV.poll ? 1 : 0")
        vis = "getComputedStyle(document.querySelector('.nd-pick-note')).visibility"
        page.evaluate("document.getElementById('noodle').classList.add('nd-off')")
        assert page.evaluate(vis) == "hidden"
        page.evaluate("document.getElementById('noodle').classList.remove('nd-off')")
        assert page.evaluate(vis) == "visible"
    finally:
        page.close()


def test_past_days_are_unavailable(browser, base_url, noodle_slug):
    """A pick on a day gone by is dropped: never drawn, never sent again, and
    a stored one is not an unsaved change."""
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.wait_for_function("NDV.cal && NDV.poll ? 1 : 0")
        got = page.evaluate("""() => {
          const P = window.NoodleCalParts, t = P.iso(new Date());
          const past = P.addDays(t, -1), soon = P.addDays(t, 2), k = NDV.poll.halves ? ':m' : ':d';
          NDV.cal.setSel(new Set([past + k, soon + k]));
          return {sel: [...NDV.cal.getSel()], present: [...ndvPresent([past + k, soon + k])], soon: soon + k};
        }""")
        assert got["sel"] == [got["soon"]] and got["present"] == [got["soon"]]
    finally:
        page.close()


def test_month_names_stay_over_rows_loaded_later(browser, base_url, noodle_slug):
    """Names share the week column's z, so DOM order decides: after every row
    (weeks loaded later once covered "october"), before the crop box (whose
    shade must dim them)."""
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{noodle_slug}")
        page.wait_for_function("NDV.cal && NDV.poll ? 1 : 0")
        page.evaluate("NDV.cal.more(); NDV.cal.more()")   # a no-op on a bounded (guest) calendar
        page.wait_for_timeout(300)
        order = page.evaluate("""() => {
          const k = [...document.querySelector('.nd-grid').children];
          const at = sel => k.map((e, i) => e.matches(sel) ? i : -1).filter(i => i >= 0);
          return {rows: at('.nd-wk'), names: at('.nd-mlabel'), box: at('.nd-cropbox'),
                  texts: [...document.querySelectorAll('.nd-mlabel')].map(m => m.textContent)};
        }""")
        assert order["names"] and min(order["names"]) > max(order["rows"]), order
        assert not order["box"] or order["box"][0] > max(order["names"]), order
        assert all(order["texts"]), order
    finally:
        page.close()
