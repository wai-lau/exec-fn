"""Exec nudge choice-row behaviour (WebKit / playwright).

EVERY open question stays tappable — answer buttons and card actions both —
and a tapped answer carries a deterministic reference to the question it
answers, so the model never has to guess which one a bare "Not yet" belongs to.

This is the regression. `clear()` used to wipe every row but the newest, so a
day that fired two nudges ended with exactly one tappable row — under the NEWER
card. On 2026-09-16 the tap meant for the 14:00 climbing nudge PATCHed
`craft-lyre-poster` to archives instead, and climbing had to be archived by
hand from /hq 22 seconds later.

Boundaries mocked, no LLM and no writes to the real board: /api/chat serves a
canned two-nudge history, PATCH /api/rd is captured rather than applied, and
POST /api/chat is captured so a tapped answer's outgoing text can be read.

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


# An ordinary chat reply — no nudge, no card_id in any payload. The card it is
# about is named in the row itself (`card=`), which is the only thing that can
# tell the panel which card `done` would archive.
_CHAT_HISTORY = {
    "messages": [
        {"role": "user", "ts": "2026-09-19T10:00:00+00:00", "content": "poster?"},
        {
            "role": "assistant",
            "ts": "2026-09-19T10:00:04+00:00",
            "content": "It has been sitting there since Tuesday. Picked up?"
                       "\n\n[card=card-poster | Got it | Not yet]",
        },
    ],
    "stage": "planning",
}


@pytest.fixture
def open_panel(browser, base_url, admin_headers):
    """Open /rd with the chat history canned and PATCH /api/rd captured."""
    contexts = []

    def _open(history=_HISTORY):
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
        # GET replays the canned history; POST (a sent answer) is captured and
        # answered with an empty SSE stream so the panel settles.
        def _chat(route):
            if route.request.method == "POST":
                pg.evaluate("b => window.__sent.push(JSON.parse(b))",
                            route.request.post_data)
                route.fulfill(status=200, content_type="text/event-stream",
                              body='data: {"type":"done","next_stage":"planning"}\n\n')
            else:
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps(history))

        pg.route("**/api/chat", _chat)

        # Capture the card-action write instead of moving a real card.
        def _patch_rd(route):
            if route.request.method == "PATCH":
                pg.evaluate("b => window.__patched.push(JSON.parse(b))",
                            route.request.post_data)
                route.fulfill(status=200, content_type="application/json", body="{}")
            else:
                route.continue_()

        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.evaluate("() => { window.__patched = []; window.__sent = []; }")
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


def test_every_open_question_stays_tappable(open_panel):
    """Both nudges keep their own answers AND their own card actions."""
    rows = _rows(open_panel())
    assert rows == [
        ["Packed", "Not yet", "done", "exile"],
        ["Got it", "Not yet", "done", "exile"],
    ]


def test_answer_carries_a_reference_to_its_question(open_panel):
    """A tapped answer names the question and the card it belongs to.

    Both nudges offer a "Not yet" — the whole point of the reference is that
    the two are distinguishable.
    """
    pg = open_panel()
    pg.locator("#exec-term .exec-choice-row").nth(0).get_by_text("Not yet").click()
    pg.wait_for_function("() => (window.__sent || []).length >= 1", timeout=4000)
    sent = pg.evaluate("() => window.__sent")[0]["messages"]
    text = sent[-1]["content"]
    assert '[answering: "Packed yet?" card=card-climbing]' in text
    assert text.endswith("Not yet")
    # Answering retires that question's answers; its card actions and the OTHER
    # question both stay live.
    assert _rows(pg) == [["done", "exile"], ["Got it", "Not yet", "done", "exile"]]


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


def test_chat_reply_naming_a_card_gets_card_actions(open_panel):
    """An ordinary reply carries no card_id — the `card=` cell supplies it.

    The cell itself is never a button and never prose: the whole row is stripped
    before the message renders, so the id stays out of Wai's sight.
    """
    pg = open_panel(_CHAT_HISTORY)
    assert _rows(pg) == [["Got it", "Not yet", "done", "exile"]]
    body = pg.text_content("#exec-term .msg.assistant .msg-body")
    assert "card-poster" not in body and "[" not in body

    pg.locator("#exec-term .exec-choice-row .exec-act-done").click()
    pg.wait_for_function("() => (window.__patched || []).length >= 1", timeout=4000)
    assert pg.evaluate("() => window.__patched")[0] == {
        "cards": [{"id": "card-poster", "column": "archives"}]
    }
    assert _rows(pg) == []
