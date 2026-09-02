import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from gpu_mode_client import effective_mode, needs_user_confirm  # noqa: E402


def test_emo_with_users_needs_confirm():
    assert needs_user_confirm("emo", presence_count=2, force=False) is True


def test_idle_with_users_needs_confirm():
    assert needs_user_confirm("idle", presence_count=1, force=False) is True


def test_homo_never_needs_confirm():
    assert needs_user_confirm("homo", presence_count=5, force=False) is False


def test_no_users_no_confirm():
    assert needs_user_confirm("emo", presence_count=0, force=False) is False


def test_force_bypasses_confirm():
    assert needs_user_confirm("emo", presence_count=3, force=True) is False


# effective_mode -- the strip must not light "homo" over a dead backend. /mode
# reports the box's INTENT, which outlives reality when hosaka-server dies.

def test_effective_mode_homo_with_dead_tts_reads_idle():
    assert effective_mode("homo", tts_live=False) == "idle"


def test_effective_mode_homo_with_live_tts_stays_homo():
    assert effective_mode("homo", tts_live=True) == "homo"


def test_effective_mode_does_not_second_guess_stopped_modes():
    # emo/idle mean hosaka-server is deliberately stopped -- a failing TTS probe
    # is the expected state there, not a contradiction to correct.
    assert effective_mode("emo", tts_live=False) == "emo"
    assert effective_mode("idle", tts_live=False) == "idle"


def test_effective_mode_leaves_gone_alone():
    # the box itself is unreachable; that already says everything
    assert effective_mode("gone", tts_live=False) == "gone"
