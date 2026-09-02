import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from tts_routing import died_mid_utterance, merge_voices, pick_upstream  # noqa: E402


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


# died_mid_utterance -- the proxy's terminal-frame guarantee. When a backend
# vanishes without sending {end}/{error}, /tarot's typewriter (paced off the
# audio clock) waits forever on a frame that never comes, so the proxy has to
# synthesize one. These pin WHEN it may.

class _Sock:
    """Stand-in for an upstream websocket -- identity is all that matters."""


def test_died_mid_utterance_true_when_live_conn_dies_in_flight():
    up = _Sock()
    assert died_mid_utterance({"home:1": up}, {"home:1": True}, "home:1", up) is True


def test_died_mid_utterance_false_after_clean_end():
    up = _Sock()  # {end}/{error} already cleared busy -- nothing to synthesize
    assert died_mid_utterance({"home:1": up}, {"home:1": False}, "home:1", up) is False


def test_died_mid_utterance_false_for_superseded_connection():
    stale, fresh = _Sock(), _Sock()
    # _ws_dispatch cut `stale` to start a new utterance on `fresh`; an error from
    # the stale stream would abort the utterance that replaced it.
    assert died_mid_utterance({"home:1": fresh}, {"home:1": True}, "home:1", stale) is False


def test_died_mid_utterance_false_when_conn_already_evicted():
    up = _Sock()
    assert died_mid_utterance({}, {"home:1": True}, "home:1", up) is False


def test_died_mid_utterance_isolates_per_upstream():
    home, piper = _Sock(), _Sock()
    conns = {"home:1": home, "piper:1": piper}
    busy = {"home:1": True, "piper:1": False}
    # the home box dying mid-utterance must not speak for the live piper stream
    assert died_mid_utterance(conns, busy, "home:1", home) is True
    assert died_mid_utterance(conns, busy, "piper:1", piper) is False
