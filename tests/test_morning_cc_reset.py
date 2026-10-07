"""The 4:30 morning run ends the Exec panel's sidecar thread (2026-10-06).

Since phase 3 the panel's conversation lives in the cc sidecar, not chat.json.
build_morning() still deletes chat.json, but that alone left the panel on the
same thread night after night. api_morning must also call
cc_client.new_conversation(), and a sidecar failure must surface in `errors`
without failing the morning. Any morning error is also posted to the Exec
chat (2026-10-07) so it is seen that day, not only in /debug.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
for _k in ("API_KEY", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET"):
    os.environ.setdefault(_k, "test")  # read at import by auth/routers

import routes_api  # noqa: E402


def _run(monkeypatch, cc_result, morning=None):
    calls = []
    posted = []

    async def fake_new():
        calls.append(1)
        return cc_result

    async def fake_push(payload):
        if "comment" in payload:
            posted.append(payload["comment"])

    monkeypatch.setattr(routes_api, "build_morning", morning or (lambda: {"generated_at": "x"}))
    monkeypatch.setattr(routes_api, "append_monitor_comment", lambda _t: None)
    monkeypatch.setattr(routes_api.cc_client, "new_conversation", fake_new)
    monkeypatch.setattr(routes_api, "push_to_monitor", fake_push)
    return asyncio.run(routes_api.api_morning()), calls, posted


def test_morning_ends_the_sidecar_thread(monkeypatch):
    result, calls, posted = _run(monkeypatch, {"ok": True, "archived": "a.md"})
    assert calls == [1]
    assert "errors" not in result
    assert posted == []   # a clean morning says nothing


def test_sidecar_failure_is_reported_not_raised(monkeypatch):
    result, calls, posted = _run(monkeypatch, {"ok": False, "detail": "unreachable"})
    assert calls == [1]
    assert result["errors"]["cc_new"] == "unreachable"
    assert len(posted) == 1 and "cc_new" in posted[0]


def test_step_errors_are_posted_to_exec_chat(monkeypatch):
    def morning():
        return {"generated_at": "x", "errors": {"gcal_import": "invalid_grant"}}

    _, _, posted = _run(monkeypatch, {"ok": True}, morning)
    assert len(posted) == 1
    assert "gcal_import" in posted[0] and "invalid_grant" in posted[0]


def test_crashed_morning_is_posted_then_raised(monkeypatch):
    import pytest
    from fastapi import HTTPException

    def boom():
        raise RuntimeError("disk full")

    posted = []

    async def fake_push(payload):
        posted.append(payload.get("comment"))

    monkeypatch.setattr(routes_api, "build_morning", boom)
    monkeypatch.setattr(routes_api, "append_monitor_comment", lambda _t: None)
    monkeypatch.setattr(routes_api, "push_to_monitor", fake_push)
    with pytest.raises(HTTPException):
        asyncio.run(routes_api.api_morning())
    assert len(posted) == 1 and "disk full" in posted[0]
