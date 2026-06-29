"""Tarot reading-progression tests (WebKit / playwright).

The /tarot reader is a client-side state machine: a turn streams from
/api/tarot/chat, a typewriter reveals it (silent or audio-paced), and the
querent's input must come back when the turn ends. The invariant these tests
pin down is that the reading ALWAYS PROGRESSES — whatever the server, network,
SSE framing, or voice layer does, the turn settles (streaming clears, the input
bar is usable again) and never freezes the page.

They drive the real page in WebKit (iOS-engine parity — see the project memory),
mocking only the boundaries: /api/tarot/chat (the SSE turn), the marked CDN (a
no-op shim so reveal text == buffered text), and /tarot-voice.js (a controllable
fake voice, to exercise the audio-failure / stall fallbacks without a TTS box).
Nothing here hits the LLM or the hosaka WebSocket.

Marked `browser` so the general smoke step skips them (`-m "not browser"`) —
playwright + WebKit are heavier than the HTTP suite. They DO run in pre-commit
as a dedicated step whenever the reader changes (its JS / template / api / this
test), so a hang/freeze can't ship. Run by hand with:

    .venv/bin/playwright install webkit   # once
    .venv/bin/pytest tests/test_tarot_progression.py -q

Skips cleanly (like the smoke suite) when playwright isn't installed, the WebKit
browser is absent, or the app isn't reachable.
"""
import json

import pytest

playwright_api = pytest.importorskip("playwright.sync_api")
sync_playwright = playwright_api.sync_playwright
PWError = playwright_api.Error

pytestmark = pytest.mark.browser


# ── SSE / route helpers ────────────────────────────────────────────────────
def sse(*events: dict) -> str:
    """Frame events as the SSE the reader stream emits: `data: <json>\\n\\n`."""
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events)


def txt(delta: str) -> dict:
    return {"type": "text", "delta": delta}


def tool(name: str, **input_) -> dict:
    return {"type": "tool_call", "name": name, "input": input_, "count": 1}


def fulfill_sse(body: str):
    """A /api/tarot/chat route handler that streams `body` as 200 event-stream."""
    def handler(route):
        route.fulfill(status=200, content_type="text/event-stream", body=body)
    return handler


def fulfill_js(js: str):
    # Single-arg handler: playwright invokes route handlers as (route, request),
    # so a `js=...` default param would be clobbered by the request positional.
    def handler(route):
        route.fulfill(status=200, content_type="application/javascript", body=js)
    return handler


# Offline, deterministic marked: parse(x) == x, so revealed innerText is exactly
# the buffered stream text (no markdown rewriting to assert around).
_marked = fulfill_js("window.marked={use(){},parse:s=>s};")


# A fake voice whose narration FAILS immediately: streamResponse takes the audio
# branch, the typewriter bails to the guessed pace, the reading still finishes.
VOICE_FAIL = """
window.tarotVoice = {
  ready: () => true,
  wantsDeferredOpening: () => false,
  armOpeningUnlock: () => {},
  armPersistedUnlock: () => {},
  speak: () => ({ ok:false, ended:true, error:'stub voice fail',
                  elapsed:()=>0, duration:()=>0 }),
};
"""

# A fake voice that "starts" but never advances the clock — the audio-stall case
# the 2.5s watchdog must catch and finish at the guessed pace.
VOICE_STALL = """
window.tarotVoice = {
  ready: () => true,
  wantsDeferredOpening: () => false,
  armOpeningUnlock: () => {},
  armPersistedUnlock: () => {},
  speak: () => ({ ok:true, ended:false, error:null,
                  elapsed:()=>0, duration:()=>0 }),
};
"""

# The reading has SETTLED: not streaming, and the turn left a result behind
# (revealed reader text, or a sys note for a prose-less / errored turn).
SETTLED = """() => {
  if (typeof streaming === 'undefined' || streaming) return false;
  const t = document.getElementById('terminal');
  if (!t) return false;
  const reader = t.querySelector('.msg.assistant .msg-body');
  const readerDone = !!(reader && reader.innerText.trim().length > 0);
  const status = document.getElementById('tarot-statusline');
  const statusDone = !!(status && status.innerText.trim().length > 0);
  return readerDone || statusDone;
}"""


# ── fixtures ───────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def _pw():
    pw = sync_playwright().start()
    yield pw
    pw.stop()


@pytest.fixture(scope="session")
def browser(_pw):
    try:
        b = _pw.webkit.launch()
    except PWError as e:
        pytest.skip(f"WebKit not installed (run: .venv/bin/playwright install webkit): {e}")
    yield b
    b.close()


@pytest.fixture
def open_tarot(browser, base_url, admin_headers):
    """Open /tarot in a fresh context with the boundaries mocked.

    `chat_handler` answers /api/tarot/chat (this turn). Reader narration is
    audible by default, so the opening is eager-generated on load but HELD for
    the first gesture (browsers won't autoplay audio) — install routes BEFORE
    goto, then tap to begin the reading. The stub voices (voice_js) report no
    deferral, so for them the opening auto-fires and the tap is a harmless no-op.
    """
    contexts = []

    def _open(chat_handler, *, voice_js=None, init_script=None):
        ctx = browser.new_context(
            extra_http_headers={"Authorization": admin_headers["Authorization"]})
        contexts.append(ctx)
        pg = ctx.new_page()
        pg.route("**/marked.min.js", _marked)
        if voice_js is not None:
            pg.route("**/tarot-voice.js*", fulfill_js(voice_js))
        pg.route("**/api/tarot/chat", chat_handler)
        if init_script:
            pg.add_init_script(init_script)
        pg.goto(f"{base_url}/tarot", wait_until="domcontentloaded")
        # Audible-by-default opening holds for the first gesture; tap to start it.
        try:
            pg.wait_for_selector("body.opening-pending", timeout=3000)
            pg.mouse.click(200, 400)
        except PWError:
            pass  # not held (stub voice) -> already auto-fired
        return pg

    yield _open
    for c in contexts:
        try:
            c.close()
        except Exception:
            pass


def settle(pg, timeout=10000):
    pg.wait_for_function(SETTLED, timeout=timeout)


def reader_text(pg) -> str:
    el = pg.query_selector(".msg.assistant .msg-body")
    return el.inner_text() if el else ""


def sys_texts(pg) -> list[str]:
    # Sys notes now live in the top status bar (latest-wins), not the chat.
    el = pg.query_selector("#tarot-statusline")
    t = el.inner_text() if el else ""
    return [t] if t.strip() else []


def assert_recovered(pg):
    """The querent can act again: not streaming, input unblocked, nothing held."""
    assert pg.evaluate("typeof streaming !== 'undefined' && streaming === false")
    assert not pg.evaluate("document.body.classList.contains('no-input')")
    assert not pg.evaluate("document.body.classList.contains('opening-pending')")
    assert not pg.evaluate("document.body.classList.contains('reader-speaking')")


# ── tests ──────────────────────────────────────────────────────────────────
def test_happy_path_reveals_full_text(open_tarot):
    pg = open_tarot(fulfill_sse(sse(txt("The cards "), txt("stir."))))
    settle(pg)
    assert reader_text(pg) == "The cards stir."
    assert_recovered(pg)


def test_server_500_logs_error_and_recovers(open_tarot):
    pg = open_tarot(lambda r: r.fulfill(status=500, content_type="text/plain", body="boom"))
    settle(pg)
    assert any("error" in n.lower() for n in sys_texts(pg))
    assert_recovered(pg)


def test_network_abort_logs_error_and_recovers(open_tarot):
    pg = open_tarot(lambda r: r.abort("failed"))
    settle(pg)
    assert any("error" in n.lower() for n in sys_texts(pg))
    assert_recovered(pg)


def test_malformed_sse_skips_bad_lines(open_tarot):
    # bad JSON and a truncated event between two valid text deltas: the parser
    # skips the junk (try/catch continue) and the good text still reveals whole.
    body = (
        'data: {"type":"text","delta":"Hello"}\n\n'
        'data: not-json\n\n'
        'data: {"type":"text","delta":" world."}\n\n'
        'data: {"type":"text","delta":\n\n'
    )
    pg = open_tarot(fulfill_sse(body))
    settle(pg)
    assert reader_text(pg) == "Hello world."
    assert_recovered(pg)


def test_textless_tool_turn_still_progresses(open_tarot):
    # A turn that emits only a tool_call (no prose) must not hang the reveal
    # loop waiting on text that never comes — it settles and notes the lookup.
    pg = open_tarot(fulfill_sse(sse(tool("lookup_card_meaning", card_id="the_fool"))))
    settle(pg)
    assert any("the_fool" in n for n in sys_texts(pg))
    assert_recovered(pg)


def test_voice_failure_falls_back_to_text(open_tarot):
    pg = open_tarot(fulfill_sse(sse(txt("Reading anyway."))), voice_js=VOICE_FAIL)
    settle(pg)
    assert reader_text(pg) == "Reading anyway."
    assert any("voice unavailable" in n.lower() for n in sys_texts(pg))
    assert_recovered(pg)


def test_voice_stall_watchdog_unblocks(open_tarot):
    # Audio "starts" but the clock never advances; the 2.5s watchdog bails to the
    # guessed pace so the reveal still completes. Wide timeout for the stall wait.
    pg = open_tarot(fulfill_sse(sse(txt("Stalled but finishes."))), voice_js=VOICE_STALL)
    settle(pg, timeout=12000)
    assert reader_text(pg) == "Stalled but finishes."
    assert any("voice unavailable" in n.lower() for n in sys_texts(pg))
    assert_recovered(pg)
