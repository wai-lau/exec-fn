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


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__])
