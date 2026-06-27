import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from tts_routing import merge_voices, pick_upstream  # noqa: E402


def test_pick_upstream_piper_goes_to_piper():
    assert pick_upstream({"backend": "piper", "voice": "glados"}, "home:1", "piper:1") == "piper:1"


def test_pick_upstream_kokoro_goes_home():
    assert pick_upstream({"backend": "kokoro", "voice": "nicole"}, "home:1", "piper:1") == "home:1"


def test_pick_upstream_missing_backend_defaults_home():
    assert pick_upstream({"voice": "nicole"}, "home:1", "piper:1") == "home:1"


def test_pick_upstream_non_dict_defaults_home():
    assert pick_upstream("garbage", "home:1", "piper:1") == "home:1"


def test_merge_voices_keeps_piper_from_piper_and_rest_from_home():
    piper = [{"id": "glados", "backend": "piper"}, {"id": "sneaky", "backend": "kokoro"}]
    home = [{"id": "nicole", "backend": "kokoro"}, {"id": "glados", "backend": "piper"}]
    out = merge_voices(piper, home)
    pairs = [(v["id"], v["backend"]) for v in out]
    assert ("glados", "piper") in pairs  # glados from the piper upstream
    assert ("nicole", "kokoro") in pairs  # gpu voice from the home upstream
    assert ("sneaky", "kokoro") not in pairs  # non-piper from piper upstream dropped
    assert pairs.count(("glados", "piper")) == 1  # home's piper entry dropped (no dup)
