"""Exec-voice wiring smoke tests (HTTP — no browser).

The GLaDOS voice is delivered by a set of scripts injected into a page's bubble
by `_build_nav` (api/pages.py). These tests pin the WIRING — which pages load
the voice and which deliberately don't — against the live container, so a
refactor / version-bump that drops a script tag or leaks voice onto an excluded
page fails the commit. They do NOT test audio (that's the browser suite); they
assert the right `<script src>` tags are present/absent per auth + page tier.

  - planning pages (/rd, /hq): full panel voice (exec-voice.js +
    exec-bubble.js).
  - /cc: the same glados voice for its own replies, loaded by its OWN template
    (cc.js mounts the shared control at load, before the nav injection runs) —
    so the injection must NOT add a second copy.
  - other non-planning pages (/debug, /UI): the listener (exec-voice-listener.js
    + exec-voice.js) on the link-bubble, no panel.
  - /tarot + /hosaka: link-bubble only, NO exec voice (tarot has its own reader
    voice; /hosaka IS the TTS page).

Every page that loads exec voice must also load its deps — hosaka-audio.js,
voice-util.js, and the shared voice-narrator.js + voice-ui.js. exec-voice.js is
undefined without them.
"""
import pytest

PLANNING = ["/rd", "/hq"]
SPEAKING = ["/rd", "/hq", "/cc"]     # pages that narrate their own replies
LISTENER = ["/debug", "/UI"]         # non-planning, voice via listener
EXCLUDED = ["/tarot", "/hosaka"]     # link-bubble, no voice


def _body(client, path, headers):
    r = client.get(path, headers=headers)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    return r.text


@pytest.mark.parametrize("path", PLANNING)
def test_planning_pages_load_panel_voice(client, admin_cookie, path):
    html = _body(client, path, admin_cookie)
    assert "/exec-voice.js" in html
    assert "/exec-bubble.js" in html          # the chat panel (speaks replies)
    assert "/hosaka-audio.js" in html and "/voice-util.js" in html
    assert "/exec-voice-listener.js" not in html  # panel handles it, not the listener


@pytest.mark.parametrize("path", LISTENER)
def test_other_protected_pages_load_listener_voice(client, admin_cookie, path):
    html = _body(client, path, admin_cookie)
    assert "/exec-voice-listener.js" in html
    assert "/exec-voice.js" in html
    assert "/hosaka-audio.js" in html and "/voice-util.js" in html
    assert "/exec-link.js" in html            # link-bubble, not the chat panel
    assert "/exec-bubble.js" not in html


@pytest.mark.parametrize("path", EXCLUDED)
def test_tarot_and_hosaka_have_no_exec_voice(client, admin_cookie, path):
    html = _body(client, path, admin_cookie)
    assert "/exec-voice.js" not in html
    assert "/exec-voice-listener.js" not in html
    assert "/exec-link.js" in html            # the link-bubble still stays


def test_voice_deps_never_appear_without_exec_voice(client, admin_cookie):
    """A page loading exec-voice.js must also load its deps, and vice-versa the
    listener implies the player — guards the load-order contract."""
    for path in PLANNING + LISTENER:
        html = _body(client, path, admin_cookie)
        if "/exec-voice.js" in html:
            assert "/hosaka-audio.js" in html, f"{path}: exec-voice without hosaka-audio"
            assert "/voice-util.js" in html, f"{path}: exec-voice without voice-util"


# ── the shared stack ────────────────────────────────────────────────────────
@pytest.mark.parametrize("path", SPEAKING)
def test_speaking_pages_load_the_shared_narrator(client, admin_cookie, path):
    """One narrator core and one control, not a copy per surface."""
    html = _body(client, path, admin_cookie)
    assert "/voice-narrator.js" in html
    assert "/voice-ui.js" in html
    assert "/exec-voice.js" in html


@pytest.mark.parametrize("path", ["/cc", "/tarot"])
def test_pages_with_an_inline_control_link_its_stylesheet(client, admin_cookie, path):
    """/cc and /tarot place the toggle in their own markup, so they link the
    shared stylesheet. The PANEL injects it at runtime instead
    (exec-bubble-assets.js), because the panel itself is built there."""
    assert "/voice-ui.css" in _body(client, path, admin_cookie)


@pytest.mark.parametrize("path", PLANNING)
def test_the_panel_injects_the_control_stylesheet(client, admin_cookie, path):
    assert "/exec-bubble-assets.js" in _body(client, path, admin_cookie)


def test_cc_loads_the_voice_exactly_once(client, admin_cookie):
    """The nav injection also carries the voice stack. /cc loads it in its own
    template (cc.js needs it at load), so a second copy would re-evaluate
    exec-voice.js and throw `duplicate variable` — taking the page with it."""
    html = _body(client, "/cc", admin_cookie)
    assert html.count("/exec-voice.js") == 1
    assert html.count("/voice-narrator.js") == 1


def test_cc_speaks_and_paces_with_the_shared_engine(client, admin_cookie):
    html = _body(client, "/cc", admin_cookie)
    assert "/cc-reveal.js" in html       # the typer that picks guessed vs audio
    assert "/typewriter.js" in html      # twGuess + twAudio live here


def test_tarot_loads_the_shared_stack_not_execs_voice(client, admin_cookie):
    """/tarot narrates with the same core and the same control, but its own
    voice: nicole on the home box, never glados."""
    html = _body(client, "/tarot", admin_cookie)
    assert "/voice-narrator.js" in html
    assert "/voice-ui.js" in html and "/voice-ui.css" in html
    assert "/tarot-voice.js" in html
    assert "/exec-voice.js" not in html
