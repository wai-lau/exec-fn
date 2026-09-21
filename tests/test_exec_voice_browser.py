"""Exec-voice behaviour tests (WebKit / playwright).

Proves the GLaDOS voice actually FIRES for Exec's turns, and only the right
ones: an assistant reply is spoken (in the glados/piper voice, markdown +
bracketed bits stripped), a voice turned OFF stays silent, and user text is
never voiced. /cc runs the same narrator over the same core, so it is checked
here too rather than in a second file with a second fake. Mirrors the tarot browser suite — mock the boundaries, hit no real LLM
or TTS box:

  - /hosaka-audio.js is replaced by a fake `HosakaAudio` whose player records
    every speak() request into window.__execSpoken (so no /ws/hosaka, no home
    GPU box dependency — same trick as the tarot fake voice).
  - /api/chat streams a canned SSE reply.
  - the marked CDN is a no-op shim.

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
# /cc builds a marked.Renderer at load to sanitize agent-quoted links, so its
# shim needs the constructor too -- without it cc.js dies on line one and the
# page renders nothing at all.
_marked_cc = fulfill_js("window.marked={use(){},parse:s=>s,Renderer:function(){}};")

# Fake HosakaAudio: a player that records speak() reqs instead of streaming PCM.
# unlock() flips the gesture flag so execVoice.ready() turns true after a tap.
_FAKE_HOSAKA = """
window.__execSpoken = [];
window.HosakaAudio = {
  createPlayer: function (opts) {
    var unlocked = false;
    return {
      unlock: function () { unlocked = true; },
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
    'data: {"type":"text","delta":"Oh. It is **you**."}\n\n'
    'data: {"type":"done","next_stage":"planning"}\n\n'
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
        pg.route("**/marked.min.js", _marked)
        pg.route("**/api/chat", fulfill_sse(chat_sse))
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
    # A real tap opens the panel AND unlocks the fake player (gesture).
    pg.click("#exec-bubble")
    pg.wait_for_selector("#exec-panel.open", timeout=4000)
    assert pg.evaluate("() => window.execVoice && window.execVoice.ready()")


def _spoken(pg):
    return pg.evaluate("() => window.__execSpoken || []")


def test_assistant_reply_is_spoken_in_glados(open_rd):
    pg = open_rd()
    _open_panel(pg)
    pg.fill("#exec-minput", "hello")
    pg.keyboard.press("Enter")
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
    pg.wait_for_function("() => (window.__execSpoken || []).length >= 1", timeout=4000)
    assert _spoken(pg)[0]["input"] == "bold words code"


def test_speak_drops_a_table_and_keeps_snake_case_whole(open_rd):
    """Two things /cc answers with constantly. A table read aloud is a list of
    pipes, and the old underscore-emphasis rule ate the middle of every
    identifier -- `dir_start_min` came out as one spoken word."""
    pg = open_rd()
    _open_panel(pg)
    pg.evaluate(r"""() => window.execVoice.speak(
        'Edit dir_start_min here.\n\n| col | col |\n|---|---|\n| 1 | 2 |\n\nThen rerun.')""")
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


# ── /cc speaks with the same narrator ───────────────────────────────────────
# The sidecar's own frame vocabulary, relayed verbatim by cc_client.py.
_CC_SSE = (
    'data: {"type":"text","text":"Done. It is **fixed**."}\n\n'
    'data: {"type":"done","turns":1,"ms":900}\n\n'
)


@pytest.fixture
def open_cc(browser, base_url, admin_headers):
    """Open /cc with the TTS boundary, the agent stream and marked mocked."""
    contexts = []

    def _open(sse=_CC_SSE):
        ctx = browser.new_context(extra_http_headers=admin_headers)
        contexts.append(ctx)
        pg = ctx.new_page()
        pg.route("**/hosaka-audio.js*", fulfill_js(_FAKE_HOSAKA))
        pg.route("**/marked.min.js", _marked_cc)
        pg.route("**/api/cc/health", lambda r: r.fulfill(
            status=200, content_type="application/json",
            body='{"ok":true,"busy":false,"active":0,"authed":true}'))
        pg.route("**/api/cc/history", lambda r: r.fulfill(
            status=200, content_type="application/json", body='{"messages":[]}'))
        pg.route("**/api/cc/query", fulfill_sse(sse))
        pg.goto(f"{base_url}/cc", wait_until="domcontentloaded")
        pg.wait_for_selector("#msg-input", timeout=5000)
        return pg

    yield _open
    for c in contexts:
        try:
            c.close()
        except Exception:
            pass


def _send_cc(pg, text):
    # A real click unlocks the fake player (a gesture), exactly as a tap would;
    # the composer is contenteditable, so the text goes in by hand.
    pg.click("#terminal")
    pg.evaluate("""t => {
        const i = document.getElementById('msg-input');
        i.focus();
        i.textContent = t;
    }""", text)
    pg.keyboard.press("Enter")


def test_cc_reply_is_spoken_in_the_same_glados(open_cc):
    pg = open_cc()
    _send_cc(pg, "did it work?")
    pg.wait_for_function("() => (window.__execSpoken || []).length >= 1", timeout=10000)
    req = _spoken(pg)[0]
    assert req["voice"] == "glados"      # the droplet's piper, not the home box
    assert req["backend"] == "piper"
    assert req["input"] == "Done. It is fixed."   # markdown flattened
    assert "did it work?" not in req["input"]     # never Wai's own words


def test_cc_voice_off_stays_silent_and_still_shows_the_reply(open_cc):
    pg = open_cc()
    pg.evaluate("() => window.execVoice.setOn(false)")
    _send_cc(pg, "quietly please")
    pg.wait_for_function(
        """() => {
             const b = document.querySelector('.msg.assistant .msg-body');
             return b && b.innerText.includes('fixed');
           }""", timeout=10000)
    assert _spoken(pg) == []


def test_cc_carries_the_shared_toggle(open_cc):
    """Same element, same state contract as the panel's and /tarot's."""
    pg = open_cc()
    assert pg.query_selector("#exec-mute.voice-mute") is not None
    assert pg.evaluate("() => document.querySelector('.voice-mute').dataset.on") in ("true", "false")
