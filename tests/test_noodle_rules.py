"""noodle/rules.py: the model writes rules, code applies them to every date.

The two phone queries that went wrong when the model judged each date itself
are pinned here with the rules the model now writes for them -- applied by
code, the answer is exact by construction, so these check the APPLIER, date by
date, against a hand computation.
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle import rules  # noqa: E402
from noodle.holidays import holiday_name  # noqa: E402

START, END = date(2026, 9, 28), date(2026, 11, 15)
DATES = [START + timedelta(days=i) for i in range((END - START).days + 1)]
PRIMES = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31}
FIB = {1, 2, 3, 5, 8, 13, 21}


def slots_of(rule_list):
    picked, dropped = rules.apply(rule_list, DATES)
    assert dropped == 0
    return set(picked)


def expect(fn):
    return {f"{d}:{b}" for d in DATES for b in fn(d)}


def test_friday_nights_prime_and_fibonacci_all_day_holiday_midday():
    got = slots_of([
        {"action": "add", "blocks": ["night"], "where": {"weekday": ["friday"]}},
        {"action": "add", "blocks": ["midday", "night"], "where": {"day": sorted(PRIMES & FIB)}},
        {"action": "add", "blocks": ["midday"], "where": {"holiday": True}},
    ])
    want = expect(lambda d: ({"n"} if d.weekday() == 4 else set())
                  | ({"m", "n"} if d.day in PRIMES & FIB else set())
                  | ({"m"} if holiday_name(d) else set()))
    assert got == want
    for bad in ("2026-10-09:m", "2026-10-15:m", "2026-10-25:m", "2026-10-27:m"):
        assert bad not in got   # what the per-date model lit wrongly on the phone


def test_odd_days_no_tuesdays_prime_nights_nonprime_middays_minus_holidays():
    odd = [x for x in range(1, 32, 2)]
    got = slots_of([
        {"action": "add", "blocks": ["midday", "night"], "where": {"day": odd}},
        {"action": "remove", "blocks": ["midday", "night"], "where": {"weekday": ["tuesday"]}},
        {"action": "remove", "blocks": ["midday"], "where": {"day": sorted(PRIMES)}},
        {"action": "remove", "blocks": ["night"], "where": {"not": {"day": sorted(PRIMES)}}},
        {"action": "remove", "blocks": ["midday"], "where": {"holiday": True}},
    ])
    want = expect(lambda d: set() if d.day % 2 == 0 or d.weekday() == 1 else
                  ({"n"} if d.day in PRIMES else ({"m"} if not holiday_name(d) else set())))
    assert got == want


def test_order_matters_add_then_remove():
    add_all = {"action": "add", "blocks": ["midday"], "where": {"every": True}}
    no_tue = {"action": "remove", "blocks": ["midday"], "where": {"weekday": ["Tuesday"]}}
    assert len(slots_of([add_all, no_tue])) == len(DATES) - sum(d.weekday() == 1 for d in DATES)
    assert len(slots_of([no_tue, add_all])) == len(DATES)


@pytest.mark.parametrize("where", [
    {"weekday": ["funday"]}, {"day": [0]}, {"day": [32]}, {"day": ["3"]}, {"day": [True]},
    {"month": [13]}, {"date": ["2026-13-01"]}, {"date": "2026-10-01"}, {"all": []},
    {"weekday": ["friday"], "day": [1]}, {"sometimes": True}, "friday", None,
])
def test_a_bad_condition_drops_only_its_rule(where):
    good = {"action": "add", "blocks": ["night"], "where": {"date": ["2026-10-01"]}}
    picked, dropped = rules.apply([{"action": "add", "blocks": ["midday"], "where": where}, good], DATES)
    assert picked == ["2026-10-01:n"] and dropped == 1


def test_nesting_is_bounded():
    cond = {"every": True}
    for _ in range(20):
        cond = {"not": {"not": cond}}
    picked, dropped = rules.apply([{"action": "add", "blocks": ["night"], "where": cond}], DATES)
    assert picked == [] and dropped == 1


def test_days_before_and_after_a_holiday():
    from datetime import date, timedelta
    from noodle import rules
    ds = [date(2026, 10, 1) + timedelta(days=i) for i in range(20)]   # Thanksgiving: Mon 12 Oct
    weekend_before = {"all": [{"weekday": ["saturday", "sunday"]}, {"holiday_within": 3}]}
    picked, dropped = rules.apply([{"action": "add", "blocks": ["night"], "where": weekend_before}], ds)
    assert picked == ["2026-10-10:n", "2026-10-11:n"] and dropped == 0
    picked, _ = rules.apply([{"action": "add", "blocks": ["night"], "where": {"holiday_since": 1}}], ds)
    assert picked == ["2026-10-13:n"]
    _, dropped = rules.apply([{"action": "add", "blocks": ["night"], "where": {"holiday_within": 40}}], ds)
    assert dropped == 1
