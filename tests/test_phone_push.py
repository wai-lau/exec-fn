"""phone_push: Exec's comments and grouped error alerts to Wai's ntfy server."""
import asyncio
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
import phone_push  # noqa: E402
import monitor_sse  # noqa: E402


def _fresh(monkeypatch, configured=True):
    importlib.reload(phone_push)
    if configured:
        monkeypatch.setenv("NTFY_URL", "https://ntfy.example/")
        monkeypatch.setenv("NTFY_TOKEN", "tk_test")
    else:
        monkeypatch.delenv("NTFY_URL", raising=False)
        monkeypatch.delenv("NTFY_TOKEN", raising=False)
    return phone_push


def test_unconfigured_sends_nothing(monkeypatch):
    pp = _fresh(monkeypatch, configured=False)
    assert asyncio.run(pp.send("exec", "hi")) is False


def test_comments_go_to_the_phone_and_other_events_do_not(monkeypatch):
    pp = _fresh(monkeypatch)
    sent = []

    async def fake_send(topic, message, **kw):
        sent.append((topic, message, kw.get("title")))
        return True
    monkeypatch.setattr(pp, "send", fake_send)

    async def scenario():
        task = asyncio.create_task(pp.run_phone_push())
        await asyncio.sleep(0)
        await monitor_sse.push_to_monitor({"thinking": True})
        await monitor_sse.push_to_monitor({"cards_changed": True})
        await monitor_sse.push_to_monitor({"comment": "Start the laundry now.", "card_id": "c1"})
        await asyncio.sleep(0.05)
        task.cancel()
    asyncio.run(scenario())
    assert sent == [("exec", "Start the laundry now.", "Exec")]


def test_errors_group_per_route_and_cap_per_day(monkeypatch):
    pp = _fresh(monkeypatch)
    t0 = 1_000_000.0
    assert pp._error_allowed("/api/x", t0) is True
    assert pp._error_allowed("/api/x", t0 + 60) is False  # same route inside 15 minutes
    assert pp._error_allowed("/api/y", t0 + 60) is True   # another route
    assert pp._error_allowed("/api/x", t0 + pp.ERROR_GROUP_S + 1) is True
    allowed = sum(pp._error_allowed(f"/r{i}", t0 + 120) for i in range(50))
    assert allowed == pp.ERROR_DAY_MAX - 3  # the daily ceiling holds
    assert pp._error_allowed("/new", t0 + 86400) is True  # a new day starts over


def test_report_error_is_silent_when_unconfigured(monkeypatch):
    pp = _fresh(monkeypatch, configured=False)
    pp.report_error("GET", "/api/x", RuntimeError("boom"))  # no loop, no config: no raise
