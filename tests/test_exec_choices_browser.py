"""A nudge's trailing [a | b | c] line becomes tappable answer buttons.

Real WebKit, because the whole feature is DOM + a regex over text the model
wrote, and the failure modes are all browser-side: a marker mistaken for a
markdown link, a stale row left tappable under an older nudge, a button that
sends twice. Skips cleanly when the app or WebKit is unavailable.
"""
import pytest


PARSE_CASES = [
    # (raw text, expected clean tail, expected options)
    ("Text Clay to lock it in. Sent yet?\n\n[Sent it | Not yet | Doing it now]",
     "Sent yet?", ["Sent it", "Not yet", "Doing it now"]),
    ("One newline works too.\n[Yes | No]", "One newline works too.", ["Yes", "No"]),
    # A sys note and a markdown link both carry brackets and must NOT parse as
    # choices — the pipe is what makes a choice row a choice row.
    ('[ created: "thing" ]', '[ created: "thing" ]', []),
    ("See [the docs](https://x/y) first.", "See [the docs](https://x/y) first.", []),
    ("Trailing [one option]", "Trailing [one option]", []),
    # The row the model actually wrote on 2026-09-15: bolded, and in an ordinary
    # reply rather than a nudge. It printed as raw brackets with no buttons.
    ("So - is that step done?\n\n**[Got everything | Not yet | On it now]**",
     "So - is that step done?", ["Got everything", "Not yet", "On it now"]),
    ("Single stars too.\n*[Yes | No]*", "Single stars too.", ["Yes", "No"]),
    ("Trailing newline after the row.\n[Yes | No]\n",
     "Trailing newline after the row.", ["Yes", "No"]),
]


def test_choice_row_parses_renders_and_sends(browser, admin_headers, base_url):
    ctx = browser.new_context(extra_http_headers=admin_headers,
                              viewport={"width": 430, "height": 932})
    try:
        pg = ctx.new_page()
        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.wait_for_function("window.execChoices && document.getElementById('exec-term')",
                             timeout=15000)

        for raw, clean, opts in PARSE_CASES:
            got = pg.evaluate("t => window.execChoices.parse(t)", raw)
            assert got["opts"] == opts, raw
            assert got["clean"].endswith(clean), raw

        # Render two rows in a row: the older one must be gone, because an
        # answered or overtaken question must not stay tappable.
        res = pg.evaluate(
            """() => {
              const term = document.getElementById('exec-term');
              const sent = [];
              const mk = (txt) => {
                const d = document.createElement('div');
                d.className = 'msg probe';
                term.appendChild(d);
                const p = window.execChoices.parse(txt);
                window.execChoices.attach(term, d, p.opts, (s) => sent.push(s));
              };
              mk('older nudge\\n[Old A | Old B]');
              mk('newer nudge\\n[Sent it | Not yet | Doing it now]');
              const rows = term.querySelectorAll('.exec-choice-row');
              const btns = [...term.querySelectorAll('.exec-choice')].map(b => b.textContent);
              const first = term.querySelector('.exec-choice');
              const box = first.getBoundingClientRect();
              first.click();
              first.click();  // a second tap on a removed row must send nothing
              return { rows: rows.length, btns, sent,
                       left: Math.round(box.left), h: Math.round(box.height),
                       after: term.querySelectorAll('.exec-choice-row').length };
            }"""
        )
        assert res["rows"] == 1, "only the newest nudge keeps buttons"
        assert res["btns"] == ["Sent it", "Not yet", "Doing it now"]
        assert res["sent"] == ["Sent it"], "one tap sends exactly one message"
        assert res["after"] == 0, "the row is consumed by the tap"
        assert res["h"] >= 18, "buttons must be tappable, not hairlines"
        assert res["left"] > 0, "row is indented onto the message body's edge"
    finally:
        ctx.close()


def test_ordinary_reply_gets_answer_buttons_but_no_card_actions(browser, admin_headers, base_url):
    """Exec asks questions in normal replies too, not only in nudges — those rows
    must render as buttons. They get NO done/exile actions: a chat reply carries
    no card id, and guessing one would archive the wrong card."""
    ctx = browser.new_context(extra_http_headers=admin_headers,
                              viewport={"width": 430, "height": 932})
    try:
        pg = ctx.new_page()
        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.wait_for_function("window.execChoices && document.getElementById('exec-term')",
                             timeout=15000)
        res = pg.evaluate(
            """() => {
              const term = document.getElementById('exec-term');
              const sent = [];
              const d = document.createElement('div');
              d.className = 'msg assistant';
              term.appendChild(d);
              const p = window.execChoices.parse(
                'Is that step done?\\n\\n**[Got everything | Not yet]**');
              d.textContent = p.clean;
              window.execChoices.attach(term, d, p.opts, (s) => sent.push(s), null);
              const btns = [...term.querySelectorAll('.exec-choice')].map(b => b.textContent);
              term.querySelector('.exec-choice').click();
              return { btns, sent, body: d.textContent,
                       acts: term.querySelectorAll('.exec-act').length };
            }"""
        )
        assert res["btns"] == ["Got everything", "Not yet"]
        assert res["acts"] == 0, "no card id -> no done/exile actions"
        assert res["sent"] == ["Got everything"]
        assert "[" not in res["body"], "the row is stripped from the message body"
    finally:
        ctx.close()


def test_choice_row_is_not_spoken(browser, admin_headers, base_url):
    """exec-voice.js strips every [...] span before narrating, so the choice
    row never reaches the TTS — the reason the marker is single brackets."""
    ctx = browser.new_context(extra_http_headers=admin_headers)
    try:
        pg = ctx.new_page()
        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.wait_for_function("window.VoiceUtil", timeout=15000)
        spoken = pg.evaluate(
            """() => VoiceUtil.stripMarkdown('Sent yet?\\n[Sent it | Not yet]')
                       .replace(/\\[[^\\]]*\\]/g, ' ').replace(/\\s+/g, ' ').trim()"""
        )
        assert spoken == "Sent yet?"
    finally:
        ctx.close()


def test_card_actions_patch_the_card_and_send_nothing(browser, admin_headers, base_url):
    """done / exile are NOT answers — they move the card the way the dialog's
    own two buttons do, so they must PATCH {id, column} and send no message.

    fetch is stubbed: this suite runs against the LIVE container, and a real
    PATCH here would archive one of Wai's actual cards.
    """
    ctx = browser.new_context(extra_http_headers=admin_headers,
                              viewport={"width": 430, "height": 932})
    try:
        pg = ctx.new_page()
        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.wait_for_function("window.execChoices && document.getElementById('exec-term')",
                             timeout=15000)

        res = pg.evaluate(
            """async () => {
              const term = document.getElementById('exec-term');
              const calls = [], sent = [], events = [];
              const realFetch = window.fetch;
              window.fetch = (url, opt) => {
                calls.push({ url: String(url), body: JSON.parse(opt.body) });
                return Promise.resolve({ ok: true, status: 200 });
              };
              window.addEventListener('exec:cards-changed', () => events.push(1));

              // A nudge (has a card id) and a monitor comment (has none).
              const mk = (txt, cardId) => {
                const d = document.createElement('div');
                d.className = 'msg probe';
                term.appendChild(d);
                const p = window.execChoices.parse(txt);
                window.execChoices.attach(term, d, p.opts, (s) => sent.push(s), cardId);
                return d;
              };

              mk('monitor line\\n[Yes | No]', null);
              const noAct = [...term.querySelectorAll('.exec-act')].length;

              mk('nudge\\n[Sent it | Not yet]', 'card-123');
              const labels = [...term.querySelectorAll('.exec-choice')].map(b => b.textContent);
              const exileBox = term.querySelector('.exec-act-exile').getBoundingClientRect();

              term.querySelector('.exec-act-done').click();
              await new Promise(r => setTimeout(r, 50));
              const afterDone = term.querySelectorAll('.exec-choice-row').length;

              // Now the failure path: the row must survive and re-arm.
              window.fetch = () => Promise.resolve({ ok: false, status: 500 });
              const d2 = mk('nudge 2\\n[A | B]', 'card-456');
              const ex = term.querySelector('.exec-act-exile');
              ex.click();
              await new Promise(r => setTimeout(r, 50));
              const afterFail = term.querySelectorAll('.exec-choice-row').length;
              const reArmed = !ex.disabled;

              window.fetch = realFetch;
              return { noAct, labels, calls, sent, events: events.length,
                       afterDone, afterFail, reArmed,
                       exileH: Math.round(exileBox.height) };
            }"""
        )

        assert res["noAct"] == 0, "a monitor comment has no card, so no card actions"
        assert res["labels"] == ["Sent it", "Not yet", "done", "exile"], \
            "card actions are appended by the client, after the model's answers"
        assert res["sent"] == [], "a card action is a mutation, never a message"
        assert len(res["calls"]) == 1, "exactly one PATCH per tap"
        call = res["calls"][0]
        assert "/api/rd" in call["url"] and "source=Exec" in call["url"]
        assert call["body"] == {"cards": [{"id": "card-123", "column": "archives"}]}, \
            "done archives the card, sending only the fields the client owns"
        assert res["events"] == 1, "an open board is repainted immediately"
        assert res["afterDone"] == 0, "a successful action consumes the row"
        assert res["afterFail"] == 1, "a failed action leaves the row in place"
        assert res["reArmed"], "a failed action re-arms its button"
        assert res["exileH"] >= 18, "actions must be tappable, not hairlines"
    finally:
        ctx.close()


def test_exile_action_sends_the_exile_column(browser, admin_headers, base_url):
    ctx = browser.new_context(extra_http_headers=admin_headers)
    try:
        pg = ctx.new_page()
        pg.goto(f"{base_url}/rd", wait_until="domcontentloaded")
        pg.wait_for_function("window.execChoices && document.getElementById('exec-term')",
                             timeout=15000)
        body = pg.evaluate(
            """async () => {
              const term = document.getElementById('exec-term');
              let captured = null;
              const realFetch = window.fetch;
              window.fetch = (url, opt) => {
                captured = JSON.parse(opt.body);
                return Promise.resolve({ ok: true, status: 200 });
              };
              const d = document.createElement('div');
              d.className = 'msg probe';
              term.appendChild(d);
              window.execChoices.attach(term, d, [], () => {}, 'card-789');
              term.querySelector('.exec-act-exile').click();
              await new Promise(r => setTimeout(r, 50));
              window.fetch = realFetch;
              return captured;
            }"""
        )
        assert body == {"cards": [{"id": "card-789", "column": "exile"}]}
    finally:
        ctx.close()


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__])
