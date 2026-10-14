"""THE ASCENDANTS store (api/spire_board.py): only plausible wins are kept, NEVER lost.

Owner, 2026-10-11 (the first winner): "make sure we never lose it". Pinned here: no
trimming, a journal fsynced before the board, a corrupt or missing board rebuilt from
the journal (never overwritten by the next win), a pre-journal board seeded into it.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import spire_board  # noqa: E402


def win(ini, ts, lives=10):
    return {"initials": ini, "lives": lives, "team": ["arc"], "ts": ts}


def test_clean_entry_accepts_a_win():
    e = spire_board.clean_entry({"initials": "abc", "lives": 42, "team": ["sol", "arc"]})
    assert e["initials"] == "ABC" and e["lives"] == 42 and e["team"] == ["arc", "sol"]


def test_a_loss_past_wave_10_may_post():
    e = spire_board.clean_entry({"initials": "abc", "lives": 0, "team": ["frz"], "won": False, "wave": 37})
    assert e["won"] is False and e["wave"] == 37 and e["lives"] == 0
    assert spire_board.clean_entry({"initials": "abc", "lives": 0, "team": ["frz"], "won": False, "wave": 10}) is None
    assert spire_board.clean_entry({"initials": "abc", "lives": 0, "team": ["frz"], "won": False}) is None


def test_ranked_puts_ascendants_first_then_waves():
    rows = [
        {"initials": "LOS", "lives": 0, "team": ["arc"], "ts": 5, "won": False, "wave": 80},
        {"initials": "OLD", "lives": 49, "team": ["arc"], "ts": 1},  # pre-`won`: a win
        {"initials": "WIN", "lives": 60, "team": ["arc"], "ts": 3, "won": True, "wave": 100},
        {"initials": "LOW", "lives": 0, "team": ["arc"], "ts": 4, "won": False, "wave": 20},
    ]
    assert [r["initials"] for r in spire_board.ranked(rows)] == ["WIN", "OLD", "LOS", "LOW"]


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


def test_nothing_is_ever_trimmed(tmp_path):
    for i in range(600):
        spire_board.add(tmp_path, win("AAA", i))
    rows = spire_board.load(tmp_path)
    assert len(rows) == 600 and rows[0]["ts"] == 599 and rows[-1]["ts"] == 0


def test_a_corrupt_board_is_rebuilt_not_overwritten(tmp_path):
    spire_board.add(tmp_path, win("SMD", 1, 49))
    (tmp_path / spire_board.FILE_NAME).write_text("{ torn")
    assert [r["initials"] for r in spire_board.load(tmp_path)] == ["SMD"]
    rows = spire_board.add(tmp_path, win("NEW", 2))
    assert [r["initials"] for r in rows] == ["NEW", "SMD"]


def test_a_deleted_board_is_rebuilt_from_the_journal(tmp_path):
    spire_board.add(tmp_path, win("SMD", 1, 49))
    (tmp_path / spire_board.FILE_NAME).unlink()
    assert [r["initials"] for r in spire_board.load(tmp_path)] == ["SMD"]


def test_a_pre_journal_board_is_seeded_and_kept(tmp_path):
    (tmp_path / spire_board.FILE_NAME).write_text(json.dumps([win("SMD", 1, 49)]))
    rows = spire_board.add(tmp_path, win("NEW", 2))
    assert [r["initials"] for r in rows] == ["NEW", "SMD"]
    journal = (tmp_path / spire_board.JOURNAL_NAME).read_text().splitlines()
    assert [json.loads(x)["initials"] for x in journal] == ["SMD", "NEW"]


def test_a_lost_journal_line_survives_through_the_board(tmp_path):
    spire_board.add(tmp_path, win("SMD", 1, 49))
    spire_board.add(tmp_path, win("TWO", 2))
    j = tmp_path / spire_board.JOURNAL_NAME
    j.write_text(j.read_text().splitlines()[1] + "\n{torn")  # SMD's line gone, a torn tail
    rows = spire_board.add(tmp_path, win("THR", 3))
    assert [r["initials"] for r in rows] == ["THR", "TWO", "SMD"]


def test_load_survives_nothing_on_disk(tmp_path):
    assert spire_board.load(tmp_path) == []


def test_owner_games_are_hidden_from_guests(tmp_path):
    """Owner, 2026-10-12: "don't show results added by owner" - a flagged post or a marked old game; a guest WAI still shows."""
    spire_board.add(tmp_path, win("WAI", 1))
    spire_board.add(tmp_path, win("JUU", 2))
    spire_board.add(tmp_path, {**win("WAI", 3), "owner": True})
    spire_board.add(tmp_path, win("WAI", 4))  # a GUEST called WAI, posted after the marks
    assert spire_board.mark_owner(tmp_path, {"JUU"}) == 3  # (run before the guest's game: marks 1, 3 and 4 here)
    marks = json.loads((tmp_path / spire_board.OWNER_MARKS).read_text())
    (tmp_path / spire_board.OWNER_MARKS).write_text(json.dumps([m for m in marks if m[0] != 4]))
    rows = spire_board.load(tmp_path)
    assert sorted(r["ts"] for r in spire_board.visible(tmp_path, rows, owner=False)) == [2, 4]
    assert len(spire_board.visible(tmp_path, rows, owner=True)) == 4
    assert len(spire_board.load(tmp_path)) == 4  # nothing removed from the store


def test_hide_takes_initials_off_for_everyone_and_keeps_the_journal(tmp_path):
    for ini in ("AAA", "WAI", "BOO"):
        spire_board.add(tmp_path, spire_board.clean_entry({"initials": ini, "lives": 10, "team": ["sol"]}) | {"ts": len(ini) + ord(ini[0])})
    assert spire_board.hide(tmp_path, {"WAI", "BOO"}) == 2
    rows = spire_board.load(tmp_path)
    for owner in (True, False):
        assert [r["initials"] for r in spire_board.visible(tmp_path, rows, owner)] == ["AAA"]
    assert len(spire_board._read_journal(tmp_path / spire_board.JOURNAL_NAME)) == 3  # never lost, only hidden


def test_hide_leaves_later_games_under_the_same_initials(tmp_path):
    spire_board.add(tmp_path, spire_board.clean_entry({"initials": "WAI", "lives": 10, "team": ["sol"]}) | {"ts": 1})
    spire_board.hide(tmp_path, {"WAI"})
    spire_board.add(tmp_path, spire_board.clean_entry({"initials": "WAI", "lives": 12, "team": ["sol"]}) | {"ts": 2})
    rows = spire_board.visible(tmp_path, spire_board.load(tmp_path), True)
    assert [(r["initials"], r["ts"]) for r in rows] == [("WAI", 2)]


def test_owner_games_from_oct_14_show_to_guests(tmp_path):
    """Owner, 2026-10-14: "show owner on leaderboard, but only the ones starting from today" - a flagged post from that day on shows."""
    rows = [{**win("WAI", 3), "owner": True, "ts": spire_board.OWNER_SHOWN_FROM - 1},
            {**win("WAI", 5), "owner": True, "ts": spire_board.OWNER_SHOWN_FROM}]
    assert [r["ts"] for r in spire_board.visible(tmp_path, rows, owner=False)] == [spire_board.OWNER_SHOWN_FROM]
    assert len(spire_board.visible(tmp_path, rows, owner=True)) == 2
