"""The Exec panel's agent transcript, in WebKit (Wai's phone engine).

The panel is what /cc's page was until 2026-09-29, so this file carries that
page's streaming tests too. Every boundary is mocked at the network edge -- no
sidecar, no subscription run, no LLM:

  - an Exec card tool leaves a one-line receipt; any other tool is ONE line
    with its output folded under it, and an empty or missing result says so;
  - a reply that resumes after a tool call opens its own bubble UNDER it;
  - the prompt sent is Wai's words alone -- the server adds the board;
  - the cursor blinks while a turn is in flight and is gone once it ends;
  - sending again interrupts the run in flight;
  - a busy sidecar says so; /help answers without a query.
"""
import json

import pytest

pytest.importorskip("playwright.sync_api")

pytestmark = pytest.mark.browser

_STUB_AUDIO = ("window.HosakaAudio={createPlayer:()=>({"
               "unlock(){},speak(){return Promise.resolve()},"
               "flush(){},setVolume(){},elapsed:()=>0,"
               "audioDuration:()=>0,isUnlocked:()=>true,"
               "gestureUnlocked:()=>true})};")


def _frames(*events) -> str:
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events)


def _json(payload):
    return lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(payload))


_CARD_TURN = _frames(
    {"type": "session", "sessionId": "s"},
    {"type": "text", "text": "Checking."},
    {"type": "tool", "name": "mcp__exec__create_card", "input": {"title": "Buy chalk"}},
    {"type": "tool_result", "isError": False, "text": '{"ok":true,"title":"Buy chalk"}'},
    {"type": "text", "text": "Added it."},
    {"type": "done"},
)

_TOOL_TURN = _frames(
    {"type": "text", "text": "Getting real numbers."},
    {"type": "tool", "name": "WebFetch", "input": {"url": "https://x/pricing"}},
    {"type": "tool_result", "text": ""},
    {"type": "text", "text": "**HG group coaching:** 90 min weekly."},
    {"type": "tool", "name": "WebFetch", "input": {"url": "https://x/other"}},
    {"type": "done", "turns": 2, "ms": 10},
)

_DONE = _frames({"type": "text", "text": "done thinking"}, {"type": "done", "turns": 1, "ms": 10})


@pytest.fixture
def panel(browser, base_url, admin_headers):
    """/rd with the panel open and every sidecar-backed route mocked.

    `replies` is the list of SSE bodies, one per query; None HOLDS that query
    forever (a run in flight)."""
    contexts = []

    def _open(*replies):
        ctx = browser.new_context(extra_http_headers=admin_headers)
        contexts.append(ctx)
        pg = ctx.new_page()
        # Voice OFF: the audio stub's clock never advances, so a reveal paced to
        # it would wait forever. Narration has its own suite
        # (test_exec_voice_browser.py); this one is about layout.
        pg.add_init_script("try { localStorage.setItem('exec.voice', '0'); } catch (e) {}")
        pg.route("**/marked.min.js", lambda r: r.fulfill(
            status=200, content_type="application/javascript",
            body="window.marked={use(){},parse:s=>s,Renderer:function(){}};"))
        pg.route("**/hosaka-audio.js*", lambda r: r.fulfill(
            status=200, content_type="application/javascript", body=_STUB_AUDIO))
        pg.route("**/api/cc/exec-history", _json({"messages": [], "monitorTotal": 0}))
        pg.route("**/api/cc/health*", _json({"ok": True, "busy": False, "authed": True}))
        pg.route("**/api/cc/title*", _json({"sessionId": "t", "title": "test"}))
        pg.route("**/api/cc/limits*", _json({"ok": False}))
        pg.route("**/api/cc/sessions*", _json({"current": "t", "sessions": []}))
        sent = []

        def _query(route):
            sent.append(json.loads(route.request.post_data))
            body = replies[len(sent) - 1] if len(sent) <= len(replies) else _DONE
            if body is not None:
                route.fulfill(status=200, content_type="text/event-stream", body=body)

        pg.route("**/api/cc/query", _query)
        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.wait_for_selector("#exec-bubble", timeout=5000)
        pg.click("#exec-bubble")
        pg.wait_for_selector("#exec-panel.open", timeout=4000)
        return pg, sent

    yield _open
    for c in contexts:
        try:
            c.close()
        except Exception:
            pass


def _send(pg, text):
    pg.locator("#exec-minput").fill(text)
    pg.keyboard.press("Enter")


def _texts(pg, sel):
    return pg.eval_on_selector_all(sel, "els => els.map(e => e.textContent.trim())")


def _idle(pg):
    """The turn is over. The user line lands before the turn starts (and the
    turn starts in the same tick), so a mocked turn that finishes instantly is
    still caught -- waiting for `execStreaming === true` first would miss it."""
    pg.wait_for_function(
        "() => document.querySelector('#exec-term .msg.user') && execStreaming === false"
        " && !document.querySelector('#exec-term #exec-bc')", timeout=15000)


def test_card_tool_is_a_receipt_and_the_prompt_is_only_her_words(panel):
    pg, sent = panel(_CARD_TURN)
    _send(pg, "buy chalk")
    _idle(pg)
    assert _texts(pg, "#exec-term .msg.sys") == ["[ card added: Buy chalk ]"]
    assert _texts(pg, "#exec-term .msg.tool") == []
    bodies = _texts(pg, "#exec-term .msg.assistant")
    assert any("Checking." in b for b in bodies) and any("Added it." in b for b in bodies)
    assert sent == [{"prompt": "buy chalk", "images": [], "files": []}]


def test_text_after_a_tool_call_opens_its_own_bubble(panel):
    """Appending into the same bubble ran two messages together and put the
    continuation ABOVE the tool line it came after."""
    pg, _ = panel(_TOOL_TURN)
    _send(pg, "prices?")
    _idle(pg)
    got = pg.evaluate("""() => {
      const tools = [...document.querySelectorAll('#exec-term .msg.tool')];
      const order = [...document.querySelectorAll('#exec-term .msg')]
        .map(n => n.className.replace(' open', ''))
        .filter(c => /assistant|tool|out/.test(c));
      const foldable = tools.map(t => t.classList.contains('exec-fold'));
      tools.forEach(t => t.click());
      return {order, foldable,
              outs: [...document.querySelectorAll('#exec-term .msg.out')].map(o => o.textContent.trim())};
    }""")
    assert got["order"][:4] == ["msg assistant", "msg tool exec-fold", "msg out", "msg assistant"]
    bodies = _texts(pg, "#exec-term .msg.assistant")
    assert bodies[0].startswith("Getting real numbers.") and "HG group" not in bodies[0]
    assert all(got["foldable"])
    assert got["outs"] == ["[ no output ]", "[ no result returned ]"]


def test_cursor_blinks_while_a_turn_is_in_flight(panel):
    pg, _ = panel(None)
    _send(pg, "hello")
    pg.wait_for_selector("#exec-term #exec-bc", timeout=5000)
    # Scrub the animation to both halves of its period: phase-exact, where
    # wall-clock samples on a throttled background page all land in one phase.
    blink = pg.evaluate("""() => {
      const el = document.querySelector('#exec-term #exec-bc');
      const a = (el.getAnimations ? el.getAnimations() : [])[0];
      if (!a) return { supported: false };
      const before = a.playState;
      a.pause();
      const at = (t) => { a.currentTime = t; return getComputedStyle(el).opacity; };
      return { supported: true, before, lit: at(0), dark: at(750) };
    }""")
    assert blink["supported"] and blink["before"] == "running", blink
    assert blink["lit"] == "1" and blink["dark"] == "0", blink


def test_sending_again_interrupts_and_the_cursor_goes(panel):
    pg, sent = panel(None, _DONE)
    _send(pg, "first")
    pg.wait_for_selector("#exec-term #exec-bc", timeout=5000)
    _send(pg, "second")
    pg.wait_for_function(
        "() => [...document.querySelectorAll('#exec-term .msg.sys')]"
        ".some(e => e.textContent.includes('interrupted'))", timeout=8000)
    _idle(pg)
    assert any("second" in u for u in _texts(pg, "#exec-term .msg.user"))
    assert [s["prompt"] for s in sent] == ["first", "second"]


def test_busy_sidecar_is_said_out_loud(panel):
    pg, _ = panel(_frames({"type": "busy", "detail": "a run is already in flight"}))
    _send(pg, "hi")
    pg.wait_for_function(
        "() => [...document.querySelectorAll('#exec-term .msg.sys')].some(d => /busy/.test(d.textContent))",
        timeout=8000)


def test_help_answers_without_a_query(panel):
    pg, sent = panel()
    _send(pg, "/help")
    pg.wait_for_selector("#exec-term .exec-help-row", timeout=4000)
    assert sent == []


def test_a_dropped_file_waits_as_a_chip_and_is_sent(panel):
    """Drag a file anywhere: the panel takes it (the browser must not navigate
    to it), it waits as a named chip, and the send carries it as {name, data}
    beside Wai's words -- the sidecar writes it into the sandbox."""
    pg, sent = panel(_DONE)
    pg.evaluate("""() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['hello'], 'notes.txt', {type: 'text/plain'}));
      for (const t of ['dragover', 'drop'])
        window.dispatchEvent(new DragEvent(t, {dataTransfer: dt, bubbles: true, cancelable: true}));
    }""")
    pg.wait_for_selector("#exec-thumbs .exec-thumb-file", timeout=4000)
    _send(pg, "read this")
    _idle(pg)
    assert sent[0]["prompt"] == "read this"
    assert sent[0]["files"] == [{"name": "notes.txt", "data": "aGVsbG8="}]
    assert _texts(pg, "#exec-term .msg.user .exec-file") == ["notes.txt"]
