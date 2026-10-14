"""Hands-free chat input (voice-input.js), on the Exec panel's binding
(exec-mic.js): the `$` prompt becomes the control, a final result sends the way
Enter would, and anything heard while the page is TALKING is dropped rather
than sent, or the surface transcribes its own narration and answers itself.
(/cc's binding went with the page, 2026-09-29.)

WebKit headless has no SpeechRecognition, so a fake one is installed before any
page script runs; it is the same shape the engine drives (continuous session,
results accumulating across utterances, `isFinal` on the last one).

Marked `browser` so the fast smoke step skips it.

    .venv/bin/pytest tests/test_voice_input_browser.py -q
"""
import json

import pytest

pytest.importorskip("playwright.sync_api")

pytestmark = pytest.mark.browser


# A continuous recognizer: results ACCUMULATE, which is what the engine's `base`
# floor exists to survive — without it the second utterance resends the first.
_FAKE_REC = """
window.__recStarts = 0;
class FakeRec {
  constructor() { this.results = []; window.__rec = this; }
  start() { window.__recStarts += 1; }
  stop() { if (this.onend) this.onend(); }
  abort() { this.aborted = true; }
  say(text, final) {
    this.results.push(Object.assign([{ transcript: text }], { isFinal: !!final }));
    if (this.onresult) this.onresult({ results: this.results });
  }
}
window.webkitSpeechRecognition = FakeRec;
"""

_HISTORY = {"messages": [], "monitorTotal": 0}

def _json_route(payload):
    def handler(route):
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps(payload))
    return handler


@pytest.fixture
def phone(browser, base_url, admin_headers):
    """iPhone-sized /rd with the panel's audio stubbed out (markdown is the
    real vendored marked + DOMPurify, served by the app itself)."""
    ctx = browser.new_context(extra_http_headers=admin_headers,
                              viewport={"width": 430, "height": 932},
                              has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.add_init_script(_FAKE_REC)
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
                          body='data: {"type":"done"}\n\n')
        else:
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps(_HISTORY))

    pg.route("**/api/cc/exec-history", _chat)
    pg.route("**/api/cc/query", _chat)
    pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
    pg.evaluate("() => { window.__sent = []; }")
    pg.wait_for_selector("#exec-bubble", timeout=5000)
    yield pg
    ctx.close()


def _open(pg):
    pg.tap("#exec-bubble")
    pg.wait_for_selector("#exec-panel.open", timeout=4000)
    pg.wait_for_selector("#exec-prompt.mic", timeout=4000)


def _listen(pg):
    """Open the panel and tap the prompt into a listening session."""
    _open(pg)
    pg.tap("#exec-prompt")
    pg.wait_for_function(
        "() => document.getElementById('exec-prompt').dataset.live === 'true'",
        timeout=4000)


def test_the_prompt_is_the_control(phone):
    """`$` carries the mic; a separate button would sit where the bubble rests."""
    _open(phone)
    assert phone.eval_on_selector("#exec-prompt", "e => e.textContent") == "$"
    assert phone.eval_on_selector("#exec-prompt",
                                  "e => e.getAttribute('aria-pressed')") == "false"


def test_tapping_the_prompt_opens_a_session(phone):
    """One tap starts the recognizer and lights the prompt."""
    _listen(phone)
    assert phone.evaluate("() => window.__recStarts") == 1
    assert phone.eval_on_selector("#exec-prompt", "e => e.textContent") == "●"


def test_a_final_result_sends_it(phone):
    """What she said reaches /api/cc/query as the message she would have typed."""
    _listen(phone)
    phone.evaluate("() => window.__rec.say('archive the climbing card', true)")
    phone.wait_for_function("() => (window.__sent || []).length >= 1", timeout=4000)
    sent = phone.evaluate("() => window.__sent")[0]["prompt"]
    assert sent.endswith("archive the climbing card")


def test_exec_talking_is_never_sent_back(phone):
    """Heard while Exec speaks = binned: composer empty, nothing posted.

    The mic cannot be paused (start() needs a gesture, so a pause would be
    one-way), so the drop is the whole defence against the panel answering its
    own narration.
    """
    _listen(phone)
    phone.evaluate("() => { window.execVoice.isSpeaking = () => true; }")
    phone.evaluate("() => window.__rec.say('that was rhetorical', true)")
    assert phone.eval_on_selector("#exec-minput", "e => e.textContent") == ""
    assert phone.evaluate("() => window.__sent.length") == 0
    assert phone.eval_on_selector("#exec-prompt", "e => e.dataset.drop") == "true"


def test_closing_the_panel_ends_the_session(phone):
    """A mic left open behind a hidden panel keeps sending with nothing on screen."""
    _listen(phone)
    phone.tap("#exec-ph-close")
    phone.wait_for_function(
        "() => document.getElementById('exec-prompt').dataset.live === 'false'",
        timeout=4000)
    assert phone.evaluate("() => window.__rec.aborted === true")


# ── /tarot: the reading table ──────────────────────────────────────────────
# A player that records instead of streaming PCM, and hands the TEST the
# utterance's terminal frame (__endLast) instead of sending it itself.
#
# The real upstream always ends an utterance -- and two layers synthesize one if
# it dies mid-sentence (routes_tts.died_mid_utterance, hosaka-audio's onclose) --
# so a fake that never ends would leave `speaking` true forever, which is not a
# state the app can actually reach. Driving it by hand is what lets one test
# clear the flag and another hold it true on purpose.
_FAKE_HOSAKA = """
window.__spoken = [];
window.HosakaAudio = { createPlayer: function () {
  var unlocked = false;
  function arm(r) {
    window.__endLast = function () { if (r && r.onStatus) r.onStatus({ type: "end" }); };
  }
  return {
    unlock: function () { unlocked = true; },
    speak: function (r) { window.__spoken.push(r); arm(r); return Promise.resolve(); },
    speakBuffer: function (r) { arm(r); return Promise.resolve(); },
    flush: function () {}, setVolume: function () {},
    elapsed: function () { return 0; }, audioDuration: function () { return 0; },
    isUnlocked: function () { return unlocked; },
    gestureUnlocked: function () { return unlocked; },
  };
}};
"""


@pytest.fixture
def tarot(browser, base_url, admin_headers):
    # Wai's phone, and touch: the prompt is tapped, not clicked.
    ctx = browser.new_context(extra_http_headers=admin_headers,
                              viewport={"width": 430, "height": 932},
                              has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    # __sent must exist before ANY page script: the opening reader turn fires
    # /api/tarot/chat during load, long before the fixture's own evaluate could
    # create it.
    pg.add_init_script(_FAKE_REC + "\nwindow.__sent = [];")
    pg.route("**/hosaka-audio.js*",
             lambda r: r.fulfill(status=200,
                                 content_type="application/javascript",
                                 body=_FAKE_HOSAKA))
    # No canned opening in the test: the LIVE path is the one with a mic under it.
    pg.route("**/api/tarot/opening*", _json_route({"clip": None}))
    pg.route("**/api/tarot/warm", _json_route({"ok": True, "skipped": "test"}))
    pg.route("**/api/hosaka/health", _json_route({"ok": True, "home": True, "piper": True}))

    def _chat(route):
        pg.evaluate("b => window.__sent.push(b)", route.request.post_data)
        route.fulfill(status=200, content_type="text/event-stream",
                      body='data: {"type":"text","delta":"The cards wait."}\n\n')

    pg.route("**/api/tarot/chat", _chat)
    pg.goto(f"{base_url}/tarot", wait_until="domcontentloaded")
    # The opening turn is held for the first gesture when the voice is on; tap
    # to start it, then let it settle so the mic is not "busy" on a live turn.
    pg.mouse.click(200, 400)
    pg.wait_for_function("() => typeof streaming !== 'undefined' && streaming === false",
                         timeout=15000)
    # End the opening's narration the way the upstream would, so the reader is
    # not still "speaking" (which the mic reads as a moment to drop what it
    # hears) for the rest of the fixture.
    pg.evaluate("() => { if (window.__endLast) window.__endLast(); }")
    pg.wait_for_function("() => tarotVoice.isSpeaking() === false", timeout=4000)
    pg.evaluate("() => { window.__sent = []; }")
    pg.wait_for_selector("#input-prompt.mic", timeout=5000)
    yield pg
    ctx.close()


def _tarot_listen(pg):
    pg.tap("#input-prompt")
    pg.wait_for_function(
        "() => document.getElementById('input-prompt').dataset.live === 'true'",
        timeout=4000)


def test_tarot_prompt_is_the_control(tarot):
    """The reading table's `$` carries the mic too — same engine, same glyph."""
    assert tarot.eval_on_selector("#input-prompt", "e => e.textContent") == "$"
    _tarot_listen(tarot)
    assert tarot.eval_on_selector("#input-prompt", "e => e.textContent") == "●"


def test_tarot_final_result_sends_it(tarot):
    """A finished utterance reaches /api/tarot/chat as the querent's answer."""
    _tarot_listen(tarot)
    tarot.evaluate("() => window.__rec.say('my work has been eating me', true)")
    tarot.wait_for_function("() => (window.__sent || []).length >= 1", timeout=4000)
    body = json.loads(tarot.evaluate("() => window.__sent")[0])
    assert body["messages"][-1]["content"] == "my work has been eating me"


def test_the_reader_talking_is_never_sent_back(tarot):
    """The reader speaks over the same speaker the mic hears. Without the
    isSpeaking() guard the page transcribes the reading and answers itself."""
    _tarot_listen(tarot)
    tarot.evaluate("() => tarotVoice.speak('The Tower falls in the third position.')")
    tarot.wait_for_function("() => tarotVoice.isSpeaking() === true", timeout=4000)
    tarot.evaluate("() => window.__rec.say('the tower falls in the third position', true)")
    tarot.wait_for_timeout(700)
    assert tarot.evaluate("() => window.__sent") == []
