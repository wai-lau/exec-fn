"""Ask Noodle's rule language, and the code that applies it.

The model does NOT decide dates. It translates the voter's words into a short
ordered list of rules, and this module applies them to every date in the
window -- exactly, every time. Asking the model to judge each date itself put
it through ~50 small arithmetic problems per answer and some always slipped
(measured on a phone: the 9th/15th/25th/27th lit as "prime or Fibonacci", the
8th and the 11th missed). Listing the primes up to 31 ONCE is reliable;
checking 49 dates against them is not -- so the checking is done here.

A rule:   {"action": "add" | "remove", "blocks": ["midday", "night"], "where": <cond>}
Rules apply in order to an empty calendar ("add" unions, "remove" subtracts),
so "every day except Tuesdays" is add-every then remove-Tuesdays.

A condition (<cond>) is ONE of:
  {"every": true}                  every date in the window
  {"weekday": ["friday", ...]}     by day of the week (English names)
  {"day": [1, 3, 5, ...]}          by day of the MONTH
  {"month": [10, 11]}              by month number
  {"date": ["2026-10-23", ...]}    exact dates
  {"holiday": true}                Quebec statutory holidays
  {"all": [<cond>, ...]}           every sub-condition holds
  {"any": [<cond>, ...]}           at least one holds
  {"not": <cond>}                  the sub-condition does not hold
Anything else makes that RULE invalid; an invalid rule is dropped, never
guessed at, and the others still apply.
"""
from datetime import date

from noodle import config, holidays

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_MAX_DEPTH = 8
_MAX_RULES = 40


class BadRule(ValueError):
    pass


def _ints(v, lo, hi):
    if not isinstance(v, list) or not all(isinstance(x, int) and not isinstance(x, bool) for x in v):
        raise BadRule("expected a list of integers")
    if any(x < lo or x > hi for x in v):
        raise BadRule(f"value outside {lo}..{hi}")
    return set(v)


def _dates(v):
    if not isinstance(v, list):
        raise BadRule("expected a list of dates")
    try:
        return {date.fromisoformat(x) for x in v}
    except (TypeError, ValueError):
        raise BadRule("bad date") from None


def _weekday(v, d, depth):
    if not isinstance(v, list) or not all(isinstance(x, str) and x.lower() in WEEKDAYS for x in v):
        raise BadRule("weekday names only")
    return WEEKDAYS[d.weekday()] in {x.lower() for x in v}


def _combine(key):
    def run(v, d, depth):
        if not isinstance(v, list) or not v:
            raise BadRule(f"{key} needs a non-empty list")
        results = [matches(c, d, depth + 1) for c in v]
        return all(results) if key == "all" else any(results)
    return run


_TESTS = {
    "every": lambda v, d, depth: v is True,
    "weekday": _weekday,
    "day": lambda v, d, depth: d.day in _ints(v, 1, 31),
    "month": lambda v, d, depth: d.month in _ints(v, 1, 12),
    "date": lambda v, d, depth: d in _dates(v),
    "holiday": lambda v, d, depth: (holidays.holiday_name(d) is not None) == (v is True),
    "all": _combine("all"),
    "any": _combine("any"),
    "not": lambda v, d, depth: not matches(v, d, depth + 1),
}


def matches(cond, d: date, depth: int = 0) -> bool:
    if depth > _MAX_DEPTH or not isinstance(cond, dict) or len(cond) != 1:
        raise BadRule("a condition is an object with exactly one key")
    (key, v), = cond.items()
    if key not in _TESTS:
        raise BadRule(f"unknown condition {key!r}")
    return _TESTS[key](v, d, depth)


def _codes(blocks) -> list[str]:
    if not isinstance(blocks, list) or not blocks or not all(b in config.BLOCK_CODES for b in blocks):
        raise BadRule("blocks must be a non-empty list of midday/night")
    return [config.BLOCK_CODES[b] for b in blocks]


def apply(rules, dates: list[date]) -> tuple[list[str], int]:
    """-> (sorted slots, number of rules dropped as invalid)."""
    picked: set[str] = set()
    dropped = 0
    for rule in (rules if isinstance(rules, list) else [])[:_MAX_RULES]:
        try:
            if not isinstance(rule, dict) or rule.get("action") not in ("add", "remove"):
                raise BadRule("action must be add or remove")
            codes = _codes(rule.get("blocks"))
            hit = {f"{d.isoformat()}:{c}" for d in dates if matches(rule.get("where"), d) for c in codes}
        except BadRule:
            dropped += 1
            continue
        picked = picked | hit if rule["action"] == "add" else picked - hit
    return sorted(picked), dropped
