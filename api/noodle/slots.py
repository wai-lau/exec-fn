"""Pure helpers: names, date windows and slot strings. No I/O.

A slot is "YYYY-MM-DD:m" (midday) or "YYYY-MM-DD:n" (night). No clock times.
"""
import unicodedata
from datetime import date, timedelta

from noodle import config

_CODES = set(config.BLOCK_CODES.values())


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


def parse_window(start: str, end: str) -> tuple[date, date]:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    if e < s:
        raise ValueError("window ends before it starts")
    if (e - s).days + 1 > config.MAX_WINDOW_DAYS:
        raise ValueError(f"window longer than {config.MAX_WINDOW_DAYS} days")
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


def clean_slots(slots, start: str, end: str) -> list[str]:
    """Validate a client's slot list: every slot well-formed and inside the
    window. Returns them sorted + deduped (the canonical order the signature
    covers). Raises ValueError on anything out of bounds -- a vote is never
    silently trimmed, since the voter signed exactly what they sent."""
    if not isinstance(slots, list):
        raise ValueError("slots must be a list")
    s, e = parse_window(start, end)
    if len(slots) > 2 * ((e - s).days + 1):
        raise ValueError("too many slots")
    out = set()
    for slot in slots:
        d, _ = parse_slot(slot)
        if not s <= d <= e:
            raise ValueError(f"{slot} is outside the poll window")
        out.add(slot)
    return sorted(out)


def clamp_slots(pairs, start: str, end: str) -> list[str]:
    """Model output -> slots. Unlike clean_slots this DISCARDS anything invalid
    or outside the window rather than refusing: the model is a suggestion box,
    the voter reviews the grid before anything is signed."""
    s, e = parse_window(start, end)
    out = set()
    for p in pairs if isinstance(pairs, list) else []:
        if not isinstance(p, dict):
            continue
        code = config.BLOCK_CODES.get(p.get("block"))
        try:
            d = date.fromisoformat(str(p.get("date", "")))
        except ValueError:
            continue
        if code and s <= d <= e:
            out.add(f"{d.isoformat()}:{code}")
    return sorted(out)
