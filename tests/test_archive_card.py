"""Unit tests for the Exec `archive_card` tool + the shared recurrence clone.

Pure unit tests against the api modules — no live app, no container; the
helpers.DATA_DIR monkeypatch is the same one test_rd_lock.py uses.

What's pinned here is the parity that makes chat-side archiving safe: archiving
through Exec must do what the card dialog's archive button does — keep
`scheduled_day` (the only record of the day the work happened, and what /rd's
calendar counts archived cards on), put the nudge loop to rest, and revive a
recurring card's next occurrence exactly once.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import helpers  # noqa: E402


def _seed(data_dir: Path, cards: list) -> None:
    (data_dir / "rd.json").write_text(json.dumps(
        {"columns": ["rd", "hq", "archives", "exile"], "cards": cards}))


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(helpers, "DATA_DIR", tmp_path)
    monkeypatch.setattr(helpers, "_ACTIVITY_LOG", tmp_path / "activity_log.json")
    helpers._json_cache.clear()
    yield tmp_path
    helpers._json_cache.clear()


def _cards(data_dir: Path) -> list:
    return json.loads((data_dir / "rd.json").read_text())["cards"]


def test_archive_moves_card_and_keeps_scheduled_day(data_dir):
    import chat_tools
    _seed(data_dir, [{"id": "card-1", "title": "file taxes", "column": "hq",
                      "scheduled_day": "2026-09-15", "dir_start_min": 600}])
    res = chat_tools._tool_archive_card({"id": "card-1"})
    assert res["ok"] and res["column"] == "archives"
    card = _cards(data_dir)[0]
    assert card["column"] == "archives"
    # the day the work happened must survive the archive — /rd's calendar reads it
    assert card["scheduled_day"] == "2026-09-15"


def test_archive_resolves_the_nudge_loop(data_dir):
    import chat_tools
    _seed(data_dir, [{"id": "card-1", "title": "file taxes", "column": "hq",
                      "scheduled_day": "2026-09-15",
                      "nudge": {"stage": "awaiting", "awaiting_reply": True,
                                "next_nudge_at": "2026-09-15T11:00:00"}}])
    chat_tools._tool_archive_card({"id": "card-1"})
    n = _cards(data_dir)[0]["nudge"]
    assert n["stage"] == "resolved"
    assert n["awaiting_reply"] is False
    assert n["next_nudge_at"] is None


def test_archive_unknown_card_is_an_error_not_a_write(data_dir):
    import chat_tools
    _seed(data_dir, [{"id": "card-1", "title": "x", "column": "hq"}])
    assert "error" in chat_tools._tool_archive_card({"id": "card-nope"})
    assert _cards(data_dir)[0]["column"] == "hq"


def test_archive_twice_does_not_double_anything(data_dir):
    """Second call is a no-op report — it must not re-log or re-clone."""
    import chat_tools
    _seed(data_dir, [{"id": "card-1", "title": "weekly review", "column": "hq",
                      "due_date": "2026-09-15", "recur_type": "week"}])
    chat_tools._tool_archive_card({"id": "card-1"})
    again = chat_tools._tool_archive_card({"id": "card-1"})
    assert again["ok"] and "next_occurrence" not in again
    assert len(_cards(data_dir)) == 2  # the archived card + exactly one clone


def test_archive_revives_a_recurring_card(data_dir):
    import chat_tools
    _seed(data_dir, [{"id": "card-1", "title": "weekly review", "column": "hq",
                      "due_date": "2026-09-15", "recur_type": "week",
                      "scheduled_day": "2026-09-15", "dir_start_min": 600,
                      "nudge": {"stage": "nudging"}}])
    res = chat_tools._tool_archive_card({"id": "card-1"})
    clone = [c for c in _cards(data_dir) if c["id"] != "card-1"][0]
    assert res["next_occurrence"] == clone["due_date"]
    assert clone["column"] == "rd"
    assert clone["due_date"] > "2026-09-15"
    assert clone["scheduled_day"] is None
    # each occurrence starts its own loop / placement
    assert "nudge" not in clone and "dir_start_min" not in clone


def test_recurring_clone_dedupes_against_an_existing_occurrence(data_dir):
    """The next occurrence already on the board must not be cloned again — a
    re-archive would otherwise stack duplicates of the same week."""
    nxt = helpers._next_recurrence("2026-09-15", "week")
    done = {"id": "card-1", "title": "weekly review", "column": "archives",
            "due_date": "2026-09-15", "recur_type": "week"}
    existing = {"id": "card-2", "title": "Weekly Review", "column": "rd",
                "due_date": nxt, "recur_type": "week"}
    assert helpers.recurring_clone(done, [done, existing]) is None


def test_recurring_clone_id_never_collides(data_dir):
    """Two cards archived in the same millisecond must not share an id."""
    a = {"id": "card-1", "title": "one", "column": "archives",
         "due_date": "2026-09-15", "recur_type": "week"}
    b = {"id": "card-2", "title": "two", "column": "archives",
         "due_date": "2026-09-15", "recur_type": "week"}
    board = [a, b]
    c1 = helpers.recurring_clone(a, board)
    board = board + [c1]
    c2 = helpers.recurring_clone(b, board)
    assert c1["id"] != c2["id"]


def test_non_recurring_card_clones_nothing(data_dir):
    import chat_tools
    _seed(data_dir, [{"id": "card-1", "title": "one-off", "column": "hq",
                      "due_date": "2026-09-15"}])
    res = chat_tools._tool_archive_card({"id": "card-1"})
    assert "next_occurrence" not in res
    assert len(_cards(data_dir)) == 1


def test_archive_card_is_dispatchable_by_name(data_dir):
    """The handler map is what the model actually reaches — a tool declared in
    chat._chat_tools() but missing here answers 'Unknown tool'."""
    import chat_tools
    _seed(data_dir, [{"id": "card-1", "title": "x", "column": "hq"}])
    assert chat_tools._handle_tool("archive_card", {"id": "card-1"})["ok"]


def test_every_declared_tool_has_a_handler():
    """Schema and handler map must stay in sync in BOTH directions."""
    import chat
    import chat_tools
    declared = {t["name"] for t in chat._chat_tools()}
    assert declared == set(chat_tools._TOOL_HANDLERS)
