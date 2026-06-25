"""Exec-voice wiring smoke tests (HTTP — no browser).

The GLaDOS voice is delivered by a set of scripts injected into a page's bubble
by `_build_nav` (api/pages.py). These tests pin the WIRING — which pages load
the voice and which deliberately don't — against the live container, so a
refactor / version-bump that drops a script tag or leaks voice onto an excluded
page fails the commit. They do NOT test audio (that's the browser suite); they
assert the right `<script src>` tags are present/absent per auth + page tier.

  - planning pages (/rd, /prophecies): full panel voice (exec-voice.js +
    exec-bubble.js).
  - other protected pages (/debug, /color): the listener (exec-voice-listener.js
    + exec-voice.js) on the link-bubble, no panel.
  - /tarot + /hosaka: link-bubble only, NO exec voice (tarot has its own reader
    voice; /hosaka IS the TTS page).

Every page that loads exec voice must also load its deps (hosaka-audio.js +
voice-util.js) — exec-voice.js is undefined without them.
"""
import pytest

PLANNING = ["/rd", "/prophecies"]
LISTENER = ["/debug", "/color"]      # non-planning, protected, voice via listener
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
