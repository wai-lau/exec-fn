import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from gpu_mode_client import needs_user_confirm  # noqa: E402


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
