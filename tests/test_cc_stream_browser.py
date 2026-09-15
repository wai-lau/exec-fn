"""/cc streaming-UI tests (WebKit / playwright).

Two properties of a turn in flight, both of which only exist in a real engine
and both of which have already been reported as "the page is broken":

  1. **The cursor blinks while Claude is working.** It is the page's only
     "still going" signal — /cc drops the empty assistant bubble as soon as a
     tool call arrives, so a long fetch shows nothing else. The test does not
     settle for "the element is there": it scrubs the running animation to
     both halves of its period and demands the computed opacity actually
     change, which is the only way to tell a blinking block from a block that
     happens to be painted.
  2. **Sending a message interrupts the run in flight** (cc-interrupt.js). The
     old turn ends `[ interrupted ]`, the new one is sent.

Every boundary is mocked at the network edge, so no sidecar, no subscription
run, no LLM call — `/api/cc/query` is a route that simply never answers, which
is exactly the state being tested (Claude working, nothing rendered yet).

Marked `browser` so the fast smoke step skips it. Skips cleanly when playwright
/ WebKit / the app are absent.

    .venv/bin/playwright install webkit   # once
    .venv/bin/pytest tests/test_cc_stream_browser.py -q
"""
import json

import pytest

pytest.importorskip("playwright.sync_api")

pytestmark = pytest.mark.browser

_MARKED = "window.marked={use(){},parse:s=>s,Renderer:function(){}};"

_DONE_SSE = (
    'data: {"type":"text","text":"done thinking"}\n\n'
    'data: {"type":"done","turns":1,"ms":10}\n\n'
)


def _json_route(payload):
    def handler(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
    return handler


@pytest.fixture
def open_cc(browser, base_url, admin_headers):
    """Open /cc with every sidecar-backed endpoint mocked.

    `/api/cc/query` is handed a holder: the FIRST run hangs forever (the page
    sits in its working state, which is what both tests are about) and later
    runs answer immediately, so an interrupted send can be seen to complete."""
    contexts = []

    def _open():
        ctx = browser.new_context(extra_http_headers=admin_headers)
        contexts.append(ctx)
        pg = ctx.new_page()
        pg.route("**/marked.min.js", lambda r: r.fulfill(
            status=200, content_type="application/javascript", body=_MARKED))
        pg.route("**/api/cc/health*", _json_route({"ok": True, "busy": False, "authed": True}))
        pg.route("**/api/cc/history*", _json_route({"sessionId": "t", "messages": []}))
        pg.route("**/api/cc/title*", _json_route({"sessionId": "t", "title": "test"}))
        pg.route("**/api/cc/limits*", _json_route({"ok": False}))
        pg.route("**/api/cc/sessions*", _json_route({"current": "t", "sessions": []}))

        held = []
        sent = []

        def query(route):
            sent.append(route.request.post_data)
            if len(sent) == 1:
                held.append(route)          # never fulfilled: the run "in flight"
                return
            route.fulfill(status=200, content_type="text/event-stream", body=_DONE_SSE)

        pg.route("**/api/cc/query", query)
        pg.goto(f"{base_url}/cc", wait_until="domcontentloaded")
        pg.wait_for_selector("#msg-input", timeout=5000)
        return pg, sent

    yield _open
    for c in contexts:
        try:
            c.close()
        except Exception:
            pass


def _send(pg, text):
    pg.click("#msg-input")
    pg.keyboard.type(text)
    pg.keyboard.press("Enter")


_TOOL_TURN_SSE = (
    'data: {"type":"text","text":"Getting real numbers."}\n\n'
    'data: {"type":"tool","name":"WebFetch","input":{"url":"https://x/pricing"}}\n\n'
    'data: {"type":"tool_result","text":""}\n\n'
    'data: {"type":"text","text":"**HG group coaching:** 90 min weekly."}\n\n'
    'data: {"type":"tool","name":"WebFetch","input":{"url":"https://x/other"}}\n\n'
    'data: {"type":"done","turns":2,"ms":10}\n\n'
)


def test_text_after_a_tool_call_opens_its_own_bubble(browser, base_url, admin_headers):
    """A reply that resumes after a tool call must not be glued onto the text
    before it. Appending into the same bubble ran the two messages together with
    nothing between them — read as a missing space after the period — and put
    the continuation ABOVE the tool line it came after."""
    ctx = browser.new_context(extra_http_headers=admin_headers)
    try:
        pg = ctx.new_page()
        pg.route("**/marked.min.js", lambda r: r.fulfill(
            status=200, content_type="application/javascript", body=_MARKED))
        pg.route("**/api/cc/health*", _json_route({"ok": True, "busy": False, "authed": True}))
        pg.route("**/api/cc/history*", _json_route({"sessionId": "t", "messages": []}))
        pg.route("**/api/cc/title*", _json_route({"sessionId": "t", "title": "test"}))
        pg.route("**/api/cc/limits*", _json_route({"ok": False}))
        pg.route("**/api/cc/sessions*", _json_route({"current": "t", "sessions": []}))
        pg.route("**/api/cc/query", lambda r: r.fulfill(
            status=200, content_type="text/event-stream", body=_TOOL_TURN_SSE))
        pg.goto(f"{base_url}/cc", wait_until="domcontentloaded")
        pg.wait_for_selector("#msg-input", timeout=5000)
        _send(pg, "prices?")
        pg.wait_for_function(
            "document.querySelectorAll('#terminal .msg.assistant').length === 2",
            timeout=20000)

        got = pg.evaluate("""() => {
          const nodes = [...document.querySelectorAll('#terminal .msg')];
          const cls = nodes.map(n => n.className.replace(' open', ''));
          const tools = [...document.querySelectorAll('#terminal .msg.tool')];
          tools.forEach(t => t.click());
          return {
            order: cls.filter(c => /assistant|tool|out/.test(c)),
            bodies: [...document.querySelectorAll('#terminal .msg.assistant')]
                      .map(n => n.textContent.trim()),
            foldable: tools.map(t => t.classList.contains('cc-fold')),
            outs: [...document.querySelectorAll('#terminal .msg.out')]
                      .map(o => o.textContent.trim()),
          };
        }""")

        assert got["order"][:4] == ["msg assistant", "msg tool cc-fold",
                                   "msg out", "msg assistant"], \
            "the resumed reply belongs under the tool call, in its own bubble"
        assert got["bodies"][0].startswith("Getting real numbers.")
        assert "HG group coaching" not in got["bodies"][0], \
            "the second message must not be glued onto the first"
        assert all(got["foldable"]), "every tool line expands to something"
        assert got["outs"] == ["[ no output ]", "[ no result returned ]"], \
            "an empty result and a call that never answered both say so"
    finally:
        ctx.close()


def test_cursor_blinks_while_claude_is_working(open_cc):
    pg, _ = open_cc()
    _send(pg, "hello")
    pg.wait_for_selector("#blinkcursor", timeout=5000)

    # It is a CSS animation, not a JS timer: assert the declaration first, so a
    # failure says which half broke.
    css = pg.eval_on_selector("#blinkcursor", """el => {
      const s = getComputedStyle(el);
      return {name: s.animationName, iter: s.animationIterationCount,
              dur: s.animationDuration, display: s.display};
    }""")
    assert css["name"] == "blink"
    assert css["iter"] == "infinite"
    assert css["dur"] != "0s"
    assert css["display"] != "none"

    # And then that it is actually RUNNING, read off the animation itself
    # rather than off wall-clock samples: a page that is not the frontmost one
    # has its timers throttled to ~1s, which is the blink's own period, so
    # every sample lands in the same phase and a live cursor reads as frozen
    # (this test passed alone and failed in a three-test run before it stopped
    # timing anything). Scrubbing the animation is phase-exact and instant.
    blink = pg.evaluate("""() => {
      const el = document.getElementById('blinkcursor');
      const a = (el.getAnimations ? el.getAnimations() : [])[0];
      if (!a) return { supported: false };
      const before = a.playState;
      a.pause();
      const at = (t) => { a.currentTime = t; return getComputedStyle(el).opacity; };
      return { supported: true, before, lit: at(0), dark: at(750) };
    }""")
    assert blink["supported"], "no animation on #blinkcursor at all"
    assert blink["before"] == "running", f"animation not running: {blink}"
    assert blink["lit"] == "1" and blink["dark"] == "0", f"not blinking: {blink}"


def test_cursor_is_gone_once_the_turn_ends(open_cc):
    pg, _ = open_cc()
    _send(pg, "one")            # hangs, so the cursor is up
    pg.wait_for_selector("#blinkcursor", timeout=5000)
    _send(pg, "two")            # interrupts; the second run answers at once
    pg.wait_for_selector("#blinkcursor", state="detached", timeout=8000)
    assert pg.eval_on_selector_all("#blinkcursor", "els => els.length") == 0


def test_sending_again_interrupts_the_run_in_flight(open_cc):
    pg, sent = open_cc()
    _send(pg, "first")
    pg.wait_for_selector("#blinkcursor", timeout=5000)
    _send(pg, "second")

    # The interrupted turn says so, and says it once.
    pg.wait_for_function(
        "() => [...document.querySelectorAll('.msg.sys')]"
        ".some(e => e.textContent.includes('interrupted'))", timeout=8000)
    # The message that did the interrupting is IN the transcript (it used to be
    # dropped on the floor by `if (streaming) return`) and was actually sent.
    users = pg.eval_on_selector_all(".msg.user", "els => els.map(e => e.textContent)")
    assert any("second" in u for u in users)
    assert len(sent) == 2, f"expected a second query POST, got {sent}"
    assert "second" in (sent[1] or "")
