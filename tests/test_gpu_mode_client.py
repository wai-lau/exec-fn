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


def test_lomo_with_users_needs_confirm():
    # lomo restarts hosaka-server with chatterbox unloaded -- it cuts listeners.
    assert needs_user_confirm("lomo", presence_count=1, force=False) is True


def test_effective_mode_lomo_with_dead_tts_reads_idle():
    assert effective_mode("lomo", tts_live=False) == "idle"
    assert effective_mode("lomo", tts_live=True) == "lomo"


def test_switch_to_action_the_box_lacks_raises_unsupported(monkeypatch):
    # The box is up but has no such route (lomo before it learns it): that is
    # not `gone` -- reporting gone lit nomo as if the click had switched it off.
    import asyncio

    import httpx
    import pytest

    import gpu_mode_client

    real = httpx.AsyncClient
    transport = httpx.MockTransport(lambda req: httpx.Response(404, json={"detail": "Not Found"}))
    monkeypatch.setattr(gpu_mode_client.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    with pytest.raises(gpu_mode_client.UnsupportedMode):
        asyncio.run(gpu_mode_client.switch_mode("box", "t", "lomo"))
