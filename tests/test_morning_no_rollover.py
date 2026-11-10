"""The 4:30 run archives a No-Rollover card whose day has passed (2026-11-10).

Left in hq it fell outside the visible week, /hq's auto-placer gave it a later
day (the rollover the flag forbids), and a hand archive then recorded that day.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
for _k in ("API_KEY", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET"):
    os.environ.setdefault(_k, "test")

import morning  # noqa: E402

TODAY = "2026-11-10"


def _card(cid, **kw):
    return {"id": cid, "title": cid, "column": "hq", "no_rollover": True, **kw}


def test_passed_card_is_archived_on_its_own_day():
    cards = [_card("a", scheduled_day="2026-11-08", due_date="2026-11-08", dir_start_min=600,
                   nudge={"stage": "awaiting", "awaiting_reply": True, "next_nudge_at": "x"})]
    entries = morning._archive_passed_no_rollover(cards, TODAY)
    c = cards[0]
    assert c["column"] == "archives" and c["scheduled_day"] == "2026-11-08"
    assert "dir_start_min" not in c
    assert c["nudge"] == {"stage": "resolved", "awaiting_reply": False, "next_nudge_at": None}
    assert [(e["action"], e["to_col"]) for e in entries] == [("moved", "archives")]


def test_unscheduled_rd_card_takes_its_due_day():
    cards = [_card("a", column="rd", due_date="2026-11-07T19:00")]
    morning._archive_passed_no_rollover(cards, TODAY)
    assert cards[0]["column"] == "archives" and cards[0]["scheduled_day"] == "2026-11-07"


def test_today_future_dateless_and_rolling_cards_are_left_alone():
    cards = [
        _card("today", scheduled_day=TODAY),
        _card("future", column="rd", due_date="2026-12-05"),
        _card("dateless", column="rd"),
        _card("rolls", no_rollover=False, scheduled_day="2026-11-08"),
        _card("exiled", column="exile", due_date="2026-11-01"),
    ]
    assert morning._archive_passed_no_rollover(cards, TODAY) == []
    assert [c["column"] for c in cards] == ["hq", "rd", "rd", "hq", "exile"]


def test_recurring_card_revives_its_next_occurrence():
    cards = [_card("a", scheduled_day="2026-11-08", due_date="2026-11-08", recur_type="week")]
    entries = morning._archive_passed_no_rollover(cards, TODAY)
    assert len(cards) == 2
    clone = cards[1]
    assert clone["column"] == "rd" and clone["due_date"][:10] == "2026-11-15"
    assert clone["scheduled_day"] is None
    assert [e["action"] for e in entries] == ["moved", "revived"]
