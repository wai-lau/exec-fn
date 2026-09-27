"""Pure helpers: names, date windows and slot strings. No I/O.

A slot is "YYYY-MM-DD:m" (midday) / "YYYY-MM-DD:n" (night) in a SPLIT poll, or
"YYYY-MM-DD:d" (the whole day) in an unsplit one. No clock times.
"""
import unicodedata
from datetime import date, timedelta

from noodle import config

_CODES = set(config.BLOCK_CODES.values()) | {config.DAY_CODE}


def normalize_name(raw: str) -> str:
    """The identity a name binds to. Must match noodleNormName() in
    web/noodle-kdf.js byte for byte, because the browser salts the KDF with it.
    NFKC, control/format chars rejected, whitespace collapsed, lowercased."""
    if not isinstance(raw, str):
        raise ValueError("name must be text")
    s = unicodedata.normalize("NFKC", raw)
    if any(unicodedata.category(c) in ("Cc", "Cf") for c in s):
        raise ValueError("name has control characters")
    s = " ".join(s.split()).lower()
    if not s:
        raise ValueError("name is empty")
    if len(s) > config.NAME_MAX:
        raise ValueError("name too long")
    return s


def codes(halves: bool) -> set[str]:
    return set(config.BLOCK_CODES.values()) if halves else {config.DAY_CODE}


def parse_window(start, end, max_days: int | None = None) -> tuple[date, date]:
    """A date range -- only ever a VIEW now (a crop, Ask's horizon), never a
    limit on the poll."""
    if not start or not end:
        raise ValueError("a range needs both ends")
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    if e < s:
        raise ValueError("range ends before it starts")
    if max_days and (e - s).days + 1 > max_days:
        raise ValueError(f"range longer than {max_days} days")
    return s, e


def window_dates(start: str, end: str) -> list[date]:
    s, e = parse_window(start, end)
    return [s + timedelta(days=i) for i in range((e - s).days + 1)]


def parse_slot(slot: str) -> tuple[date, str]:
    if not isinstance(slot, str) or len(slot) != 12 or slot[10] != ":":
        raise ValueError(f"bad slot {slot!r}")
    code = slot[11]
    if code not in _CODES:
        raise ValueError(f"bad block in {slot!r}")
    return date.fromisoformat(slot[:10]), code


def clean_slots(slots, halves: bool = True, today: date | None = None) -> list[str]:
    """Validate a client's slot list: every slot well-formed, of this poll's
    kind (whole days, or midday/night), and not absurdly far out. There is no
    window -- the calendar is endless. Returns them sorted + deduped (the
    canonical order the signature covers). Raises ValueError rather than
    trimming: the voter signed exactly what they sent."""
    if not isinstance(slots, list):
        raise ValueError("slots must be a list")
    if len(slots) > config.MAX_SLOTS:
        raise ValueError("too many slots")
    today = today or date.today()
    last = date(today.year + config.SLOT_YEARS_AHEAD, today.month, min(today.day, 28))
    out = set()
    allowed = codes(halves)
    for slot in slots:
        d, code = parse_slot(slot)
        if code not in allowed:
            raise ValueError(f"{slot}: this poll's days are {'split' if halves else 'not split'}")
        if d.year < 2020 or d > last:
            raise ValueError(f"{slot} is out of range")
        out.add(slot)
    return sorted(out)


def convert(slots_: list[str], halves: bool) -> list[str]:
    """Re-express picks when the host splits or unsplits the days. Splitting:
    a whole day becomes both halves. Unsplitting: a day survives only if BOTH
    halves were picked -- the cautious direction, since someone free at midday
    alone is not free all day."""
    if halves:
        return sorted({f"{s[:10]}:{c}" for s in slots_ if s.endswith(":d") for c in "mn"}
                      | {s for s in slots_ if not s.endswith(":d")})
    have = set(slots_)
    return sorted({f"{s[:10]}:d" for s in slots_
                   if s.endswith(":d") or {f"{s[:10]}:m", f"{s[:10]}:n"} <= have})

