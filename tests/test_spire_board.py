"""THE ASCENDANTS store (api/spire_board.py): only plausible wins are kept, newest first, capped."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import spire_board  # noqa: E402


def test_clean_entry_accepts_a_win():
    e = spire_board.clean_entry({"initials": "abc", "lives": 42, "team": ["sol", "arc"]})
    assert e["initials"] == "ABC" and e["lives"] == 42 and e["team"] == ["arc", "sol"]


def test_clean_entry_rejects_bad_shapes():
    for body in [
        {"initials": "AB", "lives": 1, "team": ["arc"]},
        {"initials": "A1C", "lives": 1, "team": ["arc"]},
        {"initials": "ABC", "lives": 0, "team": ["arc"]},
        {"initials": "ABC", "lives": True, "team": ["arc"]},
        {"initials": "ABC", "lives": "9", "team": ["arc"]},
        {"initials": "ABC", "lives": 5, "team": ["xyz"]},
        {"initials": "ABC", "lives": 5, "team": []},
        {"initials": "<b>", "lives": 5, "team": ["arc"]},
    ]:
        assert spire_board.clean_entry(body) is None, body


def test_add_keeps_newest_first_and_caps(tmp_path, monkeypatch):
    monkeypatch.setattr(spire_board, "MAX_ENTRIES", 3)
    for i, ini in enumerate(["AAA", "BBB", "CCC", "DDD"]):
        spire_board.add(tmp_path, {"initials": ini, "lives": i + 1, "team": ["arc"], "ts": i})
    rows = spire_board.load(tmp_path)
    assert [r["initials"] for r in rows] == ["DDD", "CCC", "BBB"]


def test_load_survives_a_missing_or_broken_file(tmp_path):
    assert spire_board.load(tmp_path) == []
    (tmp_path / spire_board.FILE_NAME).write_text("not json")
    assert spire_board.load(tmp_path) == []
