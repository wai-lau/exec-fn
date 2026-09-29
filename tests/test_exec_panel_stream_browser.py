"""The Exec panel reading the /cc sidecar's frames (phase 3 of
docs/plan-exec-cc-merge.md).

Pinned in WebKit (Wai's phone engine), boundaries mocked:
  - an Exec card tool leaves its one-line receipt; any other tool the agent
    runs (a web search, Bash) leaves nothing on the board's panel;
  - a reply that resumes after a tool call is ONE answer, both blocks in it;
  - the prompt sent is Wai's words alone -- the server adds the board;
  - a busy sidecar says so instead of failing silently.
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


_TOOL_TURN = _frames(
    {"type": "session", "sessionId": "s"},
    {"type": "text", "text": "Checking."},
    {"type": "tool", "name": "WebSearch", "input": {"query": "chalk"}},
    {"type": "tool_result", "isError": False, "text": "results..."},
    {"type": "tool", "name": "mcp__exec__create_card", "input": {"title": "Buy chalk"}},
    {"type": "tool_result", "isError": False, "text": '{"ok":true,"title":"Buy chalk"}'},
    {"type": "text", "text": "Added it."},
    {"type": "done"},
)


@pytest.fixture
def send(browser, base_url, admin_headers):
    contexts = []

    def _send(sse, text="buy chalk"):
        ctx = browser.new_context(extra_http_headers=admin_headers)
        contexts.append(ctx)
        pg = ctx.new_page()
        pg.route("**/marked.min.js", lambda r: r.fulfill(
            status=200, content_type="application/javascript",
            body="window.marked={use(){},parse:s=>s};"))
        pg.route("**/hosaka-audio.js*", lambda r: r.fulfill(
            status=200, content_type="application/javascript", body=_STUB_AUDIO))
        pg.route("**/api/cc/exec-history", lambda r: r.fulfill(
            status=200, content_type="application/json",
            body='{"messages":[],"monitorTotal":0}'))

        def _query(route):
            pg.evaluate("b => window.__sent.push(JSON.parse(b))", route.request.post_data)
            route.fulfill(status=200, content_type="text/event-stream", body=sse)

        pg.route("**/api/cc/query", _query)
        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.evaluate("() => { window.__sent = []; }")
        pg.wait_for_selector("#exec-bubble", timeout=5000)
        pg.click("#exec-bubble")
        pg.wait_for_selector("#exec-panel.open", timeout=4000)
        pg.locator("#exec-minput").fill(text)
        pg.keyboard.press("Enter")
        return pg

    yield _send
    for c in contexts:
        try:
            c.close()
        except Exception:
            pass


def _sys(pg):
    return pg.evaluate("() => Array.from(document.querySelectorAll('#exec-term .msg.sys'), d => d.textContent)")


def test_card_tools_leave_a_receipt_and_nothing_else_does(send):
    pg = send(_TOOL_TURN)
    pg.wait_for_function(
        "() => [...document.querySelectorAll('#exec-term .msg.assistant')].some(d => /Added it/.test(d.textContent))",
        timeout=15000)
    assert _sys(pg) == ["[ card added: Buy chalk ]"]
    reply = pg.locator("#exec-term .msg.assistant").last.text_content()
    assert "Checking." in reply and "Added it." in reply
    assert pg.evaluate("() => window.__sent") == [{"prompt": "buy chalk"}]


def test_busy_sidecar_is_said_out_loud(send):
    pg = send(_frames({"type": "busy", "detail": "a run is already in flight"}))
    pg.wait_for_function(
        "() => [...document.querySelectorAll('#exec-term .msg.sys')].some(d => /busy/.test(d.textContent))",
        timeout=8000)
