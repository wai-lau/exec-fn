"""Quebec statutory holidays, for Ask noodle's date list ("...unless it's a
stat holiday"). A Python MIRROR of web/qc-holidays.js -- noodle may not import
the app, and the rules are formulas, so they are restated here and pinned
against the JS by tests/test_noodle_holidays.py. Same list, same judgement
calls (Good Friday rather than Easter Monday; no Remembrance Day, Boxing Day,
Family Day, Civic Holiday or Sep 30) -- see the header of the JS file.
"""
from datetime import date, timedelta
from functools import lru_cache


def _easter_sunday(y: int) -> date:
    # anonymous Gregorian computus
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    n = h + l_ - 7 * m + 114
    return date(y, n // 31, n % 31 + 1)


def _nth_monday(y: int, month: int, nth: int) -> date:
    first = date(y, month, 1)
    return first + timedelta(days=(0 - first.weekday()) % 7 + 7 * (nth - 1))


def _patriotes(y: int) -> date:
    # the Monday strictly before May 25
    may25 = date(y, 5, 25)
    back = 7 if may25.weekday() == 0 else may25.weekday()
    return may25 - timedelta(days=back)


def _canada_day(y: int) -> date:
    jul1 = date(y, 7, 1)
    return jul1 + timedelta(days=1) if jul1.weekday() == 6 else jul1


@lru_cache(maxsize=16)
def qc_holidays(y: int) -> dict[date, str]:
    return {
        date(y, 1, 1): "Jour de l'An",
        _easter_sunday(y) - timedelta(days=2): "Vendredi saint",
        _patriotes(y): "Journee nationale des patriotes",
        date(y, 6, 24): "Fete nationale du Quebec",
        _canada_day(y): "Fete du Canada",
        _nth_monday(y, 9, 1): "Fete du Travail",
        _nth_monday(y, 10, 2): "Action de grace",
        date(y, 12, 25): "Noel",
    }


def holiday_name(d: date) -> str | None:
    return qc_holidays(d.year).get(d)
