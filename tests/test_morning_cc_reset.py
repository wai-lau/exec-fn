"""The 4:30 morning run ends the Exec panel's sidecar thread (2026-10-06).

Since phase 3 the panel's conversation lives in the cc sidecar, not chat.json.
build_morning() still deletes chat.json, but that alone left the panel on the
same thread night after night. api_morning must also call
cc_client.new_conversation(), and a sidecar failure must surface in `errors`
without failing the morning.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
for _k in ("API_KEY", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET"):
    os.environ.setdefault(_k, "test")  # read at import by auth/routers

import routes_api  # noqa: E402


def _run(monkeypatch, cc_result):
    calls = []

    async def fake_new():
        calls.append(1)
        return cc_result

    async def fake_push(_payload):
        return None

    monkeypatch.setattr(routes_api, "build_morning", lambda: {"generated_at": "x"})
    monkeypatch.setattr(routes_api.cc_client, "new_conversation", fake_new)
    monkeypatch.setattr(routes_api, "push_to_monitor", fake_push)
    return asyncio.run(routes_api.api_morning()), calls


def test_morning_ends_the_sidecar_thread(monkeypatch):
    result, calls = _run(monkeypatch, {"ok": True, "archived": "a.md"})
    assert calls == [1]
    assert "errors" not in result


def test_sidecar_failure_is_reported_not_raised(monkeypatch):
    result, calls = _run(monkeypatch, {"ok": False, "detail": "unreachable"})
    assert calls == [1]
    assert result["errors"]["cc_new"] == "unreachable"
