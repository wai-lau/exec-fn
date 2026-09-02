"""Regression tests for a card dropped on a /rd calendar day.

`card_schedule.drop_on_day` is what POST /api/rd/{id}/schedule runs. The
properties pinned here are the ones the drop gesture promises and that are
easy to break from either side (the pure scheduler or the persistence around
it):

  - the dropped day IS the due date, whatever the window says;
  - an existing clock time survives the move -- a 7pm concert dragged to
    another day is still at 7pm, which is what keeps scheduler.timed_start_min
    able to pin its block. schedule_to_day rewrites due_date as a BARE date on
    the beyond-window path, so that one needs the clock put back;
  - inside the 7-day window the card is promoted rd->hq with a scheduled_day;
    beyond it, it stays in the backlog carrying the date alone;
  - reminders and books get the date and nothing else -- neither belongs in a
    day's working set;
  - a card dragged out of archives/exile comes back to rd first, so the drop
    reads as "bring this back, on that day";
  - an active nudge loop refuses to be deferred without the consequences
    conversation, and says so instead of silently moving.

Pure unit tests -- no live app, no fastapi. helpers.DATA_DIR is monkeypatched
to a tmp dir, the same way test_rd_merge_patch.py does it.
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import helpers  # noqa: E402
import card_schedule  # noqa: E402

TODAY = date.today()
NEAR = (TODAY + timedelta(days=2)).isoformat()
FAR = (TODAY + timedelta(days=30)).isoformat()


def _seed(data_dir: Path, cards: list) -> None:
    (data_dir / "rd.json").write_text(json.dumps(
        {"columns": ["rd", "hq", "archives", "exile"], "cards": cards}))


def _card(data_dir: Path, card_id: str) -> dict:
    cards = json.loads((data_dir / "rd.json").read_text())["cards"]
    return next(c for c in cards if c["id"] == card_id)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(helpers, "DATA_DIR", tmp_path)
    monkeypatch.setattr(helpers, "_ACTIVITY_LOG", tmp_path / "activity_log.json")
    helpers._json_cache.clear()
    yield tmp_path
    helpers._json_cache.clear()


def _base(**over) -> dict:
    card = {"id": "c1", "title": "a task", "column": "rd", "category": "Self",
            "size": "idea", "estimated_time": 30, "prep_time": 0,
            "due_date": None, "scheduled_day": None}
    card.update(over)
    return card


def test_in_window_drop_promotes_to_hq(data_dir):
    _seed(data_dir, [_base()])
    result = card_schedule.drop_on_day("c1", NEAR)
    assert result == {"scheduled_day": NEAR}
    c = _card(data_dir, "c1")
    assert (c["column"], c["due_date"], c["scheduled_day"]) == ("hq", NEAR, NEAR)


def test_beyond_window_drop_sets_the_due_date_only(data_dir):
    _seed(data_dir, [_base()])
    result = card_schedule.drop_on_day("c1", FAR)
    assert result["due_date"] == FAR and "note" in result
    c = _card(data_dir, "c1")
    assert (c["column"], c["due_date"], c["scheduled_day"]) == ("rd", FAR, None)


def test_clock_time_survives_an_in_window_drop(data_dir):
    _seed(data_dir, [_base(due_date=f"{FAR}T19:30")])
    card_schedule.drop_on_day("c1", NEAR)
    assert _card(data_dir, "c1")["due_date"] == f"{NEAR}T19:30"


def test_clock_time_survives_a_beyond_window_drop(data_dir):
    """schedule_to_day writes a bare date here -- the clock has to be restored."""
    _seed(data_dir, [_base(due_date=f"{NEAR}T19:30")])
    result = card_schedule.drop_on_day("c1", FAR)
    assert result["due_date"] == f"{FAR}T19:30"
    assert _card(data_dir, "c1")["due_date"] == f"{FAR}T19:30"


@pytest.mark.parametrize("flag", ["is_reminder", "is_book"])
def test_reminders_and_books_are_dated_but_never_scheduled(data_dir, flag):
    _seed(data_dir, [_base(**{flag: True})])
    result = card_schedule.drop_on_day("c1", NEAR)
    assert result == {"due_date": NEAR}
    c = _card(data_dir, "c1")
    assert (c["column"], c["due_date"], c["scheduled_day"]) == ("rd", NEAR, None)


@pytest.mark.parametrize("column", ["archives", "exile"])
def test_a_finished_card_comes_back_to_the_board(data_dir, column):
    _seed(data_dir, [_base(column=column)])
    card_schedule.drop_on_day("c1", NEAR)
    c = _card(data_dir, "c1")
    assert (c["column"], c["scheduled_day"]) == ("hq", NEAR)


def test_an_active_nudge_refuses_a_later_day(data_dir):
    _seed(data_dir, [_base(column="hq", scheduled_day=TODAY.isoformat(),
                           nudge={"stage": "nudging", "consequences": {}})])
    result = card_schedule.drop_on_day("c1", NEAR)
    assert result["blocked"] is True and "consequences" in result["error"]
    c = _card(data_dir, "c1")
    assert (c["scheduled_day"], c["due_date"]) == (TODAY.isoformat(), None)


def test_an_active_nudge_still_allows_an_earlier_day(data_dir):
    later = (TODAY + timedelta(days=4)).isoformat()
    _seed(data_dir, [_base(column="hq", scheduled_day=later,
                           nudge={"stage": "nudging", "consequences": {}})])
    result = card_schedule.drop_on_day("c1", NEAR)
    assert result == {"scheduled_day": NEAR}


def test_unknown_card_is_an_error_not_a_write(data_dir):
    _seed(data_dir, [_base()])
    assert "error" in card_schedule.drop_on_day("nope", NEAR)
    assert _card(data_dir, "c1")["due_date"] is None
