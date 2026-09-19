"""A link Exec names is a link Wai can tap (WebKit / playwright).

The regression, 2026-09-19: the biweekly EI nudge said "open the login link"
and the panel rendered exactly that — no anchor — while the URL sat in the
card's notes the whole time. The prompt half of the fix lives in
`chat._CHAT_STATIC_PREFIX` / `nudge_llm._TONE`; this pins the render half.

Three properties:

  * a markdown link in a NUDGE renders as an anchor that opens in a new tab.
    Same-tab is not a style choice here — the panel lives ON /rd and /hq, so
    following a link in place tears down the board, the panel, and the nudge's
    own unanswered answer row;
  * an unusable scheme keeps the label and drops the anchor;
  * a nudge's links are cyan like a reply's. `.msg.probe` is a panel-only role,
    so chat-msg.css's `.msg.assistant a` never reached it and it fell through
    to the UA's default blue.

Boundaries mocked, no LLM and no board writes: /api/chat serves a canned
history, marked is stubbed with a link-only parser that honours the renderer
option (the real one is a CDN fetch).

Marked `browser` so the fast smoke step skips it.

    .venv/bin/pytest tests/test_exec_links_browser.py -q
"""
import json

import pytest

pytest.importorskip("playwright.sync_api")

pytestmark = pytest.mark.browser


# Enough marked to exercise the path under test: [text](href) through the
# renderer the caller passes, everything else verbatim.
_MARKED = """window.marked = {
  use(){},
  Renderer: function(){},
  parse: (s, o) => '<p>' + s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,
    (m, text, href) => (o && o.renderer && o.renderer.link)
      ? o.renderer.link({ href: href, text: text })
      : m) + '</p>'
};"""

_LOGIN_URL = "https://srv265.hrdc-drhc.gc.ca/interdec/ouverturedesession-login/x.aspx?lang=eng"

_HISTORY = {
    "messages": [
        {
            "role": "monitor",
            "ts": "2026-09-19T09:00:00+00:00",
            "card_id": "card-ei",
            "content": f"Fifteen minutes, biweekly. [The EI login]({_LOGIN_URL}) is open in one tap.",
        },
        {
            "role": "monitor",
            "ts": "2026-09-19T09:01:00+00:00",
            "card_id": "card-ei",
            "content": "[Nothing doing](javascript:alert(1)) is not a link.",
        },
    ],
    "stage": "planning",
}


@pytest.fixture
def panel(browser, base_url, admin_headers):
    """/rd with the chat history canned and marked stubbed; panel open."""
    ctx = browser.new_context(extra_http_headers=admin_headers)
    pg = ctx.new_page()
    pg.route("**/marked.min.js",
             lambda r: r.fulfill(status=200,
                                 content_type="application/javascript",
                                 body=_MARKED))
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
    pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
    pg.wait_for_selector("#exec-bubble", timeout=5000)
    pg.click("#exec-bubble")
    pg.wait_for_selector("#exec-panel.open", timeout=4000)
    pg.wait_for_selector("#exec-term .msg.probe", timeout=4000)
    yield pg
    try:
        ctx.close()
    except Exception:
        pass


def test_a_nudge_link_is_an_anchor_that_opens_a_new_tab(panel):
    a = panel.locator("#exec-term .msg.probe a").first
    assert a.text_content() == "The EI login"
    assert a.get_attribute("href") == _LOGIN_URL
    # New tab, and no window.opener handed to the page it opens.
    assert a.get_attribute("target") == "_blank"
    assert a.get_attribute("rel") == "noopener"


def test_an_unusable_scheme_keeps_the_label_and_drops_the_link(panel):
    """`javascript:` never becomes an anchor — the label survives as text."""
    second = panel.locator("#exec-term .msg.probe").nth(1)
    assert "Nothing doing" in second.text_content()
    assert second.locator("a").count() == 0


def test_a_nudge_link_is_cyan_like_a_reply_link(panel):
    """`.msg.probe a` in exec-bubble.css — the shared vocabulary only covers
    `.msg.assistant a`, so without it a nudge's link renders UA-default blue."""
    got, want = panel.evaluate("""() => {
        const a = document.querySelector('#exec-term .msg.probe a');
        const probe = document.createElement('span');
        probe.style.color = 'hsl(var(--cyan-hsl) / 0.8)';
        document.body.appendChild(probe);
        const want = getComputedStyle(probe).color;
        probe.remove();
        return [getComputedStyle(a).color, want];
    }""")
    assert got == want
