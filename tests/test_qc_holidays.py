"""Québec statutory holidays (web/qc-holidays.js).

The dates are computed from formulas -- a computus for Easter, "nth weekday of
month" for two others, and a "Monday strictly before May 25" rule -- so an
off-by-one is invisible until a wrong day shows up pink on the calendar years
from now. These pin published dates against the implementation, and pin the
holidays that must NOT appear (the ones belonging to other provinces or to
federally regulated workers only).

Driven through node because the module is browser JS; skips if node is absent.
"""

import json
import os
import shutil
import subprocess

import pytest

_JS = os.path.join(os.path.dirname(__file__), "..", "web", "qc-holidays.js")

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def _holidays(year: int) -> set[str]:
    out = subprocess.run(
        ["node", "-e",
         f"global.window={{}};require({json.dumps(os.path.abspath(_JS))});"
         f"console.log(JSON.stringify([...window.QcHolidays.qcHolidays({year})]))"],
        capture_output=True, text=True, check=True,
    )
    return set(json.loads(out.stdout))


def test_eight_holidays_a_year_for_the_next_two_decades():
    # seven from the Loi sur les normes du travail + the Fête nationale
    for year in range(2026, 2046):
        assert len(_holidays(year)) == 8, year


@pytest.mark.parametrize("date,label", [
    ("2026-01-01", "Jour de l'An"),
    ("2026-04-03", "Vendredi saint"),
    ("2027-03-26", "Vendredi saint"),
    ("2028-04-14", "Vendredi saint"),
    ("2026-05-18", "Journée nationale des patriotes"),
    ("2027-05-24", "Journée nationale des patriotes"),
    ("2028-05-22", "Journée nationale des patriotes"),
    ("2026-06-24", "Fête nationale"),
    ("2026-07-01", "Fête du Canada"),
    ("2026-09-07", "Fête du Travail"),
    ("2026-10-12", "Action de grâce"),
    ("2026-12-25", "Noël"),
])
def test_published_dates(date, label):
    assert date in _holidays(int(date[:4])), label


def test_patriotes_falls_back_a_full_week_when_may_25_is_a_monday():
    # "le lundi qui précède le 25 mai" is strictly before, so May 25 itself
    # never qualifies -- 2015 is the textbook case (Victoria Day was May 18).
    assert "2015-05-18" in _holidays(2015)
    assert "2015-05-25" not in _holidays(2015)


def test_canada_day_moves_to_july_2_when_july_1_is_a_sunday():
    assert "2029-07-02" in _holidays(2029)
    assert "2029-07-01" not in _holidays(2029)


@pytest.mark.parametrize("date,label", [
    ("2026-02-16", "Family Day — Ontario/BC/Alberta, not Québec"),
    ("2026-08-03", "Civic Holiday — Ontario etc., not Québec"),
    ("2026-09-30", "Truth & Reconciliation — federally regulated only"),
    ("2026-11-11", "Remembrance Day — not a Québec statutory holiday"),
    ("2026-12-26", "Boxing Day — Ontario, not Québec"),
])
def test_other_provinces_holidays_never_appear(date, label):
    assert date not in _holidays(int(date[:4])), label
