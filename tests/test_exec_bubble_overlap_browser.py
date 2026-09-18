"""The exec bubble must not sit on top of the open panel (WebKit / playwright).

The bubble paints at --z-max and the panel at --z-bubble, so wherever the
bubble rests it is ABOVE the panel and swallows every tap inside its 50px
circle -- and the tap it swallows calls togglePanel(), which CLOSES the panel.
At phone width the panel is full-screen and the bubble's resting corner (right
14px, bottom --nav-h + 10) lands on the tail of the last choice row and on the
composer's right end (the mute and [x] buttons). So answering a nudge by
tapping a button near the right edge minimised the panel instead of sending
the answer -- reported 2026-09-18.

Measured on a 430x932 screen before the fix: bubble 366..416 x 807..857, the
choice row 12..418 x 808..841.

Marked `browser` so the fast smoke step skips it.

    .venv/bin/pytest tests/test_exec_bubble_overlap_browser.py -q
"""
import json

import pytest

pytest.importorskip("playwright.sync_api")

pytestmark = pytest.mark.browser


# A realistic three-answer nudge: with the client-appended done/exile the row
# runs to the right edge of a 430px screen, which is where the bubble rests.
_HISTORY = {
    "messages": [
        {
            "role": "monitor",
            "ts": "2026-09-18T14:00:11+00:00",
            "card_id": "card-climbing",
            "content": "Shoes and chalk in the bag. Packed yet?\n\n"
                       "[Sent it | Not yet | Doing it now]",
        },
    ],
    "stage": "planning",
}


@pytest.fixture
def phone(browser, base_url, admin_headers):
    """iPhone-sized /rd with a nudge in the transcript, boundaries mocked."""
    ctx = browser.new_context(extra_http_headers=admin_headers,
                              viewport={"width": 430, "height": 932},
                              has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.route("**/marked.min.js",
             lambda r: r.fulfill(status=200,
                                 content_type="application/javascript",
                                 body="window.marked={use(){},parse:s=>s};"))
    pg.route("**/hosaka-audio.js*",
             lambda r: r.fulfill(status=200,
                                 content_type="application/javascript",
                                 body="window.HosakaAudio={createPlayer:()=>({"
                                      "unlock(){},speak(){return Promise.resolve()},"
                                      "flush(){},setVolume(){},elapsed:()=>0,"
                                      "audioDuration:()=>0,isUnlocked:()=>true,"
                                      "gestureUnlocked:()=>true})};"))

    def _chat(route):
        if route.request.method == "POST":
            pg.evaluate("b => window.__sent.push(JSON.parse(b))",
                        route.request.post_data)
            route.fulfill(status=200, content_type="text/event-stream",
                          body='data: {"type":"done","next_stage":"planning"}\n\n')
        else:
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps(_HISTORY))

    pg.route("**/api/chat", _chat)
    pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
    pg.evaluate("() => { window.__sent = []; }")
    pg.wait_for_selector("#exec-bubble", timeout=5000)
    yield pg
    ctx.close()


def _bubble_box(pg):
    return pg.eval_on_selector("#exec-bubble", """e => {
        const r = e.getBoundingClientRect();
        return {x: r.left, y: r.top, w: r.width, h: r.height};
    }""")


def _open(pg):
    """Tap the bubble open and wait for the slide-in to settle."""
    pg.tap("#exec-bubble")
    pg.wait_for_selector("#exec-panel.open", timeout=4000)
    pg.wait_for_selector(".exec-choice-row", timeout=4000)
    pg.wait_for_function(
        "() => document.getElementById('exec-panel').getBoundingClientRect().left === 0",
        timeout=4000)


def test_bubble_is_not_over_the_open_panel(phone):
    """Nothing of the bubble intersects the panel while it is open."""
    _open(phone)
    assert phone.evaluate("""() => {
        const b = document.getElementById('exec-bubble');
        if (!b.offsetParent && getComputedStyle(b).display === 'none') return true;
        const r = b.getBoundingClientRect();
        const p = document.getElementById('exec-panel').getBoundingClientRect();
        return r.right <= p.left || r.left >= p.right
            || r.bottom <= p.top || r.top >= p.bottom;
    }""" ), "the bubble covers part of the open panel"


def test_tapping_the_last_answer_sends_it(phone):
    """The row's last button is where the bubble used to rest."""
    _open(phone)
    phone.locator("#exec-term .exec-choice-row .exec-choice").nth(2).tap()
    phone.wait_for_function("() => (window.__sent || []).length >= 1", timeout=4000)
    sent = phone.evaluate("() => window.__sent")[0]["messages"][-1]["content"]
    assert sent.endswith("Doing it now")
    assert phone.eval_on_selector("#exec-panel", "e => e.classList.contains('open')"), \
        "tapping an answer closed the panel"


def test_every_choice_button_is_tappable(phone):
    """No answer or card action is hit-blocked by anything painted over it."""
    _open(phone)
    assert phone.evaluate("""() => {
        const out = [];
        document.querySelectorAll('#exec-term .exec-choice').forEach(el => {
          const r = el.getBoundingClientRect();
          for (const x of [r.left + 2, (r.left + r.right) / 2, r.right - 2]) {
            const top = document.elementFromPoint(x, (r.top + r.bottom) / 2);
            if (top !== el && !el.contains(top)) {
              out.push(el.textContent.trim() + ' <- ' +
                       (top ? (top.id || top.className || top.tagName) : 'nothing'));
              break;
            }
          }
        });
        return out;
    }""") == []
