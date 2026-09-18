"""Hands-free chat input on BOTH surfaces (voice-input.js).

One engine, two bindings — /cc's prompt (cc-mic.js) and the Exec panel's
(exec-mic.js) — so both are exercised here: the `$` prompt becomes the control,
and a final result sends the way Enter would. The panel adds the case /cc does
not have: anything heard while Exec is TALKING is dropped rather than sent, or
the panel transcribes its own GLaDOS narration and answers itself.

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

_HISTORY = {"messages": [], "stage": "planning"}

_MARKED = "window.marked={use(){},parse:s=>s,Renderer:function(){}};"


def _json_route(payload):
    def handler(route):
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps(payload))
    return handler


@pytest.fixture
def phone(browser, base_url, admin_headers):
    """iPhone-sized /rd with the panel's audio + markdown deps stubbed out."""
    ctx = browser.new_context(extra_http_headers=admin_headers,
                              viewport={"width": 430, "height": 932},
                              has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.add_init_script(_FAKE_REC)
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


@pytest.fixture
def cc(browser, base_url, admin_headers):
    """/cc with the sidecar stubbed out — the mic's other binding."""
    ctx = browser.new_context(extra_http_headers=admin_headers,
                              viewport={"width": 430, "height": 932},
                              has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.add_init_script(_FAKE_REC)
    pg.route("**/marked.min.js",
             lambda r: r.fulfill(status=200,
                                 content_type="application/javascript",
                                 body=_MARKED))
    pg.route("**/api/cc/health*", _json_route({"ok": True, "busy": False, "authed": True}))
    pg.route("**/api/cc/history*", _json_route({"sessionId": "t", "messages": []}))
    pg.route("**/api/cc/title*", _json_route({"sessionId": "t", "title": "test"}))
    pg.route("**/api/cc/limits*", _json_route({"ok": False}))
    pg.route("**/api/cc/sessions*", _json_route({"current": "t", "sessions": []}))

    def _query(route):
        pg.evaluate("b => window.__sent.push(b)", route.request.post_data)
        route.fulfill(status=200, content_type="text/event-stream",
                      body='data: {"type":"done"}\n\n')

    pg.route("**/api/cc/query", _query)
    pg.goto(f"{base_url}/cc", wait_until="domcontentloaded")
    pg.evaluate("() => { window.__sent = []; }")
    pg.wait_for_selector("#input-prompt.mic", timeout=5000)
    yield pg
    ctx.close()


def test_cc_prompt_is_the_control(cc):
    """/cc's `$` carries the mic too — same engine, same affordance."""
    assert cc.eval_on_selector("#input-prompt", "e => e.textContent") == "$"
    cc.tap("#input-prompt")
    cc.wait_for_function(
        "() => document.getElementById('input-prompt').dataset.live === 'true'",
        timeout=4000)
    assert cc.eval_on_selector("#input-prompt", "e => e.textContent") == "●"


def test_cc_final_result_sends_it(cc):
    """A finished utterance reaches /api/cc/query as the prompt."""
    cc.tap("#input-prompt")
    cc.wait_for_function(
        "() => document.getElementById('input-prompt').dataset.live === 'true'",
        timeout=4000)
    cc.evaluate("() => window.__rec.say('list the files here', true)")
    cc.wait_for_function("() => (window.__sent || []).length >= 1", timeout=4000)
    assert "list the files here" in json.loads(cc.evaluate("() => window.__sent")[0])["prompt"]


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
    """What she said reaches /api/chat as the message she would have typed."""
    _listen(phone)
    phone.evaluate("() => window.__rec.say('archive the climbing card', true)")
    phone.wait_for_function("() => (window.__sent || []).length >= 1", timeout=4000)
    sent = phone.evaluate("() => window.__sent")[0]["messages"][-1]["content"]
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
