"""Exec nudge choice-row behaviour (WebKit / playwright).

Pins the split between the two kinds of button `exec-choices.js` renders under
a nudge:

  - ANSWER buttons (the model's trailing `[a | b | c]` row) are a reply about
    ONE step, so only the NEWEST nudge keeps them — tapping an older one would
    answer a question Exec has since moved off.
  - CARD ACTIONS (`done` / `exile`) are about a card id, and a finished task is
    still finished three nudges later, so they survive on EVERY nudge row.

The second rule is the regression. `clear()` used to remove whole rows, so a
day that fired two nudges ended with exactly one tappable `done` — under the
NEWER card. On 2026-09-16 the tap meant for the 14:00 climbing nudge PATCHed
`craft-lyre-poster` to archives instead, and climbing had to be archived by
hand from /hq 22 seconds later.

Boundaries mocked, no LLM and no writes to the real board: /api/chat serves a
canned two-nudge history, PATCH /api/rd is captured rather than applied.

Marked `browser` so the fast smoke step skips it.

    .venv/bin/pytest tests/test_exec_choices_browser.py -q
"""
import json

import pytest

pytest.importorskip("playwright.sync_api")

pytestmark = pytest.mark.browser


# Two nudges, oldest first — exactly the shape history replay walks. Each ends
# on an answer row and carries its own card id.
_HISTORY = {
    "messages": [
        {
            "role": "monitor",
            "ts": "2026-09-16T14:00:11+00:00",
            "card_id": "card-climbing",
            "content": "Shoes and chalk in the bag. Packed yet?\n\n[Packed | Not yet]",
        },
        {
            "role": "monitor",
            "ts": "2026-09-16T17:57:12+00:00",
            "card_id": "card-poster",
            "content": "Collect the Lyre poster. Retrieved?\n\n[Got it | Not yet]",
        },
    ],
    "stage": "planning",
}


@pytest.fixture
def open_panel(browser, base_url, admin_headers):
    """Open /rd with the chat history canned and PATCH /api/rd captured."""
    contexts = []

    def _open():
        ctx = browser.new_context(extra_http_headers=admin_headers)
        contexts.append(ctx)
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
        pg.route("**/api/chat",
                 lambda r: r.fulfill(status=200, content_type="application/json",
                                     body=json.dumps(_HISTORY)))

        # Capture the card-action write instead of moving a real card.
        def _patch_rd(route):
            if route.request.method == "PATCH":
                pg.evaluate("b => window.__patched.push(JSON.parse(b))",
                            route.request.post_data)
                route.fulfill(status=200, content_type="application/json", body="{}")
            else:
                route.continue_()

        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.evaluate("() => { window.__patched = []; }")
        pg.route("**/api/rd?source=Exec", _patch_rd)
        pg.wait_for_selector("#exec-bubble", timeout=5000)
        pg.click("#exec-bubble")
        pg.wait_for_selector("#exec-panel.open", timeout=4000)
        pg.wait_for_selector(".exec-choice-row", timeout=4000)
        return pg

    yield _open
    for c in contexts:
        try:
            c.close()
        except Exception:
            pass


def _rows(pg):
    """[[button label, ...], ...] per choice row, oldest row first."""
    return pg.evaluate("""() => Array.from(
        document.querySelectorAll('#exec-term .exec-choice-row'),
        r => Array.from(r.querySelectorAll('.exec-choice'), b => b.textContent))""")


def test_every_nudge_keeps_its_card_actions(open_panel):
    """Both nudges stay actionable; only the newest keeps its answers."""
    rows = _rows(open_panel())
    assert len(rows) == 2, rows
    # Older nudge: answers cleared, done/exile survive.
    assert rows[0] == ["done", "exile"]
    # Newest nudge: its own answers plus the card actions.
    assert rows[1] == ["Got it", "Not yet", "done", "exile"]


def test_older_done_patches_its_own_card(open_panel):
    """Tapping the OLDER row's `done` archives THAT card, not the newer one."""
    pg = open_panel()
    # .nth(0), not :first-of-type — the rows are <div> siblings of the message
    # <div>s, so "first of type" is the first message, not the first row.
    pg.locator("#exec-term .exec-choice-row .exec-act-done").nth(0).click()
    pg.wait_for_function("() => (window.__patched || []).length >= 1", timeout=4000)
    assert pg.evaluate("() => window.__patched")[0] == {
        "cards": [{"id": "card-climbing", "column": "archives"}]
    }
    # The tapped row is gone; the newest nudge is untouched.
    assert _rows(pg) == [["Got it", "Not yet", "done", "exile"]]
