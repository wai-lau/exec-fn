import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from gpu_mode_client import effective_mode, needs_user_confirm  # noqa: E402


def test_both_actions_with_users_need_confirm():
    # homo and lomo both restart hosaka-server (always-on nicole): either cuts listeners.
    assert needs_user_confirm("homo", presence_count=1, force=False) is True
    assert needs_user_confirm("lomo", presence_count=2, force=False) is True


def test_no_users_no_confirm():
    assert needs_user_confirm("lomo", presence_count=0, force=False) is False


def test_force_bypasses_confirm():
    assert needs_user_confirm("homo", presence_count=3, force=True) is False


# effective_mode -- the strip shows homo, lomo or unavailable. /mode reports the
# box's INTENT, which outlives reality when hosaka-server dies.

def test_homo_with_live_tts_stays_homo():
    assert effective_mode("homo", tts_live=True) == "homo"


def test_nicole_only_box_modes_read_lomo():
    # nicole is always on at the box: emo and idle serve exactly what lomo does.
    for m in ("lomo", "emo", "idle"):
        assert effective_mode(m, tts_live=True) == "lomo"


def test_dead_tts_reads_unavailable_in_every_mode():
    for m in ("homo", "lomo", "emo", "idle"):
        assert effective_mode(m, tts_live=False) == "unavailable"


def test_unreachable_box_reads_unavailable():
    assert effective_mode("gone", tts_live=False) == "unavailable"
    assert effective_mode("gone", tts_live=True) == "unavailable"


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
