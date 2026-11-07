"""Exec-voice behaviour tests (WebKit / playwright).

Proves the GLaDOS voice actually FIRES for Exec's turns, and only the right
ones: an assistant reply is spoken (in the glados/piper voice, markdown +
bracketed bits stripped), a voice turned OFF stays silent, and user text is
never voiced. Mirrors the tarot browser suite — mock the boundaries, hit no real LLM
or TTS box:

  - /hosaka-audio.js is replaced by a fake `HosakaAudio` whose player records
    every speak() request into window.__execSpoken (so no /ws/hosaka, no home
    GPU box dependency — same trick as the tarot fake voice).
  - /api/cc/query streams a canned SSE reply (history is empty).
  - marked (web/vendor/) is a no-op shim.

Marked `browser` so the fast smoke step skips it; runs in pre-commit as a
dedicated step when the voice layer changes. Skips cleanly when playwright /
WebKit / the app are absent.

    .venv/bin/playwright install webkit   # once
    .venv/bin/pytest tests/test_exec_voice_browser.py -q
"""
import pytest

# Skip the file cleanly when playwright isn't installed; the shared WebKit
# `browser` fixture (conftest.py) handles the browser-absent skip.
pytest.importorskip("playwright.sync_api")

pytestmark = pytest.mark.browser


def fulfill_js(js: str):
    def handler(route):
        route.fulfill(status=200, content_type="application/javascript", body=js)
    return handler


def fulfill_sse(body: str):
    def handler(route):
        route.fulfill(status=200, content_type="text/event-stream", body=body)
    return handler


_marked = fulfill_js("window.marked={use(){},parse:s=>s};")

# Fake HosakaAudio: a player that records speak() reqs instead of streaming PCM.
# unlock() flips the gesture flag so execVoice.ready() turns true after a tap,
# and counts itself: a voice that is off must never take the audio session.
_FAKE_HOSAKA = """
window.__execSpoken = [];
window.__unlocks = 0;
window.HosakaAudio = {
  createPlayer: function (opts) {
    var unlocked = false;
    return {
      unlock: function () { unlocked = true; window.__unlocks++; },
      speak: function (req) { window.__execSpoken.push(req); return Promise.resolve(); },
      flush: function () {},
      setVolume: function () {},
      elapsed: function () { return 0; },
      audioDuration: function () { return 0; },
      isUnlocked: function () { return unlocked; },
      gestureUnlocked: function () { return unlocked; },
    };
  }
};
"""

# One assistant turn: bold markdown that must be flattened before TTS.
_REPLY_SSE = (
    'data: {"type":"text","text":"Oh. It is **you**."}\n\n'
    'data: {"type":"done"}\n\n'
)


# The session-scoped WebKit `browser` fixture lives in conftest.py, shared with
# the tarot browser suite (one sync_playwright per session — see the note there).
@pytest.fixture
def open_rd(browser, base_url, admin_headers):
    """Open /rd (the planning panel) with the TTS boundary + chat mocked."""
    contexts = []

    def _open(chat_sse=_REPLY_SSE):
        ctx = browser.new_context(extra_http_headers=admin_headers)
        contexts.append(ctx)
        pg = ctx.new_page()
        pg.route("**/hosaka-audio.js*", fulfill_js(_FAKE_HOSAKA))
        pg.route("**/vendor/marked-*.min.js", _marked)
        pg.route("**/api/cc/exec-history",
                 lambda r: r.fulfill(status=200, content_type="application/json",
                                     body='{"messages":[],"monitorTotal":0}'))
        pg.route("**/api/cc/query", fulfill_sse(chat_sse))
        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.wait_for_selector("#exec-bubble", timeout=5000)
        return pg

    yield _open
    for c in contexts:
        try:
            c.close()
        except Exception:
            pass


def _open_panel(pg):
    # Opening the panel is NOT a request for audio: it must leave the session
    # alone (it used to unlock, which paused Wai's music on every open).
    pg.click("#exec-bubble")
    pg.wait_for_selector("#exec-panel.open", timeout=4000)
    assert not pg.evaluate("() => window.execVoice.ready()")
    assert pg.evaluate("() => window.__unlocks") == 0


def _pass_gate(pg):
    """Exec has a line and no gesture yet: the tap-to-hear overlay asks."""
    pg.wait_for_selector("#voice-gate:not([hidden])", timeout=8000)
    pg.click("#voice-gate .vg-go")
    assert pg.is_hidden("#voice-gate")
    assert pg.evaluate("() => window.execVoice.ready()")
    # A tap on the overlay is an answer to Exec, not a click outside the panel.
    assert pg.is_visible("#exec-panel.open")


def _spoken(pg):
    return pg.evaluate("() => window.__execSpoken || []")


def test_assistant_reply_is_spoken_in_glados(open_rd):
    pg = open_rd()
    _open_panel(pg)
    pg.fill("#exec-minput", "hello")
    pg.keyboard.press("Control+Enter")  # bare Enter is a newline; 3 in a row send
    _pass_gate(pg)
    pg.wait_for_function("() => (window.__execSpoken || []).length >= 1", timeout=8000)
    spoken = _spoken(pg)
    assert len(spoken) == 1
    req = spoken[0]
    assert req["voice"] == "glados"
    assert req["backend"] == "piper"
    # markdown flattened, and the user's own text is never voiced
    assert req["input"] == "Oh. It is you."
    assert "hello" not in req["input"]


def test_speak_strips_markdown_and_brackets(open_rd):
    pg = open_rd()
    _open_panel(pg)
    pg.evaluate("() => window.execVoice.speak('**bold** [ skip me ] words `code`')")
    _pass_gate(pg)
    pg.wait_for_function("() => (window.__execSpoken || []).length >= 1", timeout=4000)
    assert _spoken(pg)[0]["input"] == "bold words code"


def test_speak_drops_a_table_and_keeps_snake_case_whole(open_rd):
    """Two things the agent answers with constantly. A table read aloud is a list of
    pipes, and the old underscore-emphasis rule ate the middle of every
    identifier -- `dir_start_min` came out as one spoken word."""
    pg = open_rd()
    _open_panel(pg)
    pg.evaluate(r"""() => window.execVoice.speak(
        'Edit dir_start_min here.\n\n| col | col |\n|---|---|\n| 1 | 2 |\n\nThen rerun.')""")
    _pass_gate(pg)
    pg.wait_for_function("() => (window.__execSpoken || []).length >= 1", timeout=4000)
    said = _spoken(pg)[0]["input"]
    assert "dir_start_min" in said
    assert "|" not in said
    assert said == "Edit dir_start_min here. Then rerun."


def test_muted_player_stays_silent(open_rd):
    pg = open_rd()
    _open_panel(pg)
    pg.evaluate("() => window.execVoice.setOn(false)")
    pg.evaluate("() => window.execVoice.speak('You should not hear this.')")
    pg.wait_for_timeout(800)
    assert _spoken(pg) == []
    # Off asks for no tap and takes no audio session.
    assert pg.query_selector("#voice-gate:not([hidden])") is None
    assert pg.evaluate("() => window.__unlocks") == 0


def test_skip_drops_the_line_and_leaves_the_audio_alone(open_rd):
    pg = open_rd()
    _open_panel(pg)
    pg.evaluate("() => window.execVoice.speak('Not now.')")
    pg.wait_for_selector("#voice-gate:not([hidden])", timeout=4000)
    pg.click("#voice-gate .vg-skip")
    pg.wait_for_timeout(500)
    assert _spoken(pg) == []
    assert pg.evaluate("() => window.__unlocks") == 0
    assert pg.is_visible("#exec-panel.open")


# ── voice off (was /cc's test; /cc folded into the panel 2026-09-29) ──────
def test_voice_off_stays_silent_and_still_shows_the_reply(open_rd):
    """OFF means off, not muted -- and the reply still types out at the silent
    pace rather than waiting on audio that will never come."""
    pg = open_rd()
    _open_panel(pg)
    assert pg.query_selector("#exec-mute.voice-mute") is not None
    pg.evaluate("() => window.execVoice.setOn(false)")
    pg.fill("#exec-minput", "quietly please")
    pg.keyboard.press("Control+Enter")  # bare Enter is a newline; 3 in a row send
    pg.wait_for_function(
        """() => [...document.querySelectorAll('#exec-term .msg.assistant .msg-body')]
                 .some(b => b.innerText.includes('It is'))""", timeout=10000)
    assert _spoken(pg) == []
    assert pg.query_selector("#voice-gate:not([hidden])") is None
    assert pg.evaluate("() => window.__unlocks") == 0
