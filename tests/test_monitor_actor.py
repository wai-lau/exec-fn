"""The monitor does not comment on Exec's own card changes (2026-09-29).

Exec reports what it did in its reply; a monitor comment on the same change a
minute later is Exec talking about itself. Everything logged inside one Exec
tool call is stamped actor=exec (helpers.LOG_ACTOR, set by exec_tools.run_tool)
and the monitor skips those. The panel's done/exile buttons log source=Exec
too, but they are Wai's taps, carry no actor, and still earn a comment.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import exec_tools  # noqa: E402
import helpers  # noqa: E402
import monitor  # noqa: E402


def test_tool_call_entries_are_stamped_and_nothing_else_is(tmp_path, monkeypatch):
    log = tmp_path / "activity_log.json"
    monkeypatch.setattr(helpers, "_ACTIVITY_LOG", log)

    def handler(name, inp):
        helpers._append_rd_log("advanced", "Call mom", source="Exec")
        return {"ok": True}

    monkeypatch.setattr(exec_tools, "_handle_tool", handler)
    asyncio.run(exec_tools.run_tool("advance_chunk", {}))
    helpers._append_rd_log("moved", "Call mom", source="Exec", to_col="archives")  # Wai's tap

    by_exec, by_wai = json.loads(log.read_text())
    assert by_exec["actor"] == "exec"
    assert "actor" not in by_wai


def test_monitor_skips_exec_entries_only():
    mine = {"action": "advanced", "source": "Exec", "actor": "exec"}
    tap = {"action": "moved", "source": "Exec", "to_col": "archives"}
    assert not monitor._is_commentable(mine) and not monitor._entry_is_significant(mine)
    assert monitor._is_commentable(tap) and monitor._entry_is_significant(tap)
