"""exec_board: which cards Exec sees each turn.

All of rd + hq; archives/exile only when the latest logged move there is inside
the 7-day window AND the card is still in that column. Logs are read from
today's file plus the dated rotations, id first, title as the fallback for the
exile tool's older id-less entries.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import exec_board  # noqa: E402

NOW = datetime(2026, 9, 28, 18, 0, tzinfo=timezone.utc)


def _ago(days: float) -> str:
    return (NOW - timedelta(days=days)).isoformat()


def _card(i, col, title=None):
    return {"id": f"card-{i}", "title": title or f"t{i}", "column": col, "order": i}


def test_window_and_columns(tmp_path, monkeypatch):
    monkeypatch.setattr(exec_board, "DATA_DIR", tmp_path)
    (tmp_path / "activity_log_20260924.json").write_text(json.dumps([
        {"ts": _ago(4), "action": "moved", "id": "card-3", "to_col": "archives"},
        {"ts": _ago(4), "action": "moved", "title": "old exile", "to_col": "exile"},
    ]))
    (tmp_path / "activity_log_20260901.json").write_text(json.dumps([
        {"ts": _ago(27), "action": "moved", "id": "card-4", "to_col": "archives"},
    ]))
    (tmp_path / "activity_log.json").write_text(json.dumps([
        {"ts": _ago(0.1), "action": "moved", "id": "card-6", "to_col": "archives"},
    ]))
    monkeypatch.setattr(exec_board, "datetime", _Frozen)
    cards = [
        _card(1, "rd"), _card(2, "hq"),
        _card(3, "archives"),              # in window -> shown
        _card(4, "archives"),              # 27 days ago -> not shown
        _card(5, "exile", "old exile"),    # id-less entry, matched by title
        _card(6, "rd"),                    # archived today, then revived -> rd only
    ]
    out = exec_board.board_sections(cards)
    sel, ideas, done, dropped = out.split("\n\n")
    assert "card-2" in sel
    assert "card-1" in ideas and "card-6" in ideas
    assert "card-3" in done and "card-4" not in done and "card-6" not in done
    assert "card-5" in dropped


def test_unreadable_log_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(exec_board, "DATA_DIR", tmp_path)
    (tmp_path / "activity_log.json").write_text("{not json")
    assert exec_board.recent_moves(NOW) == {}


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW
