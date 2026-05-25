"""Single home for dirs-timeline scheduling (dir_start_min).

Every dir_start_min decision flows through here so there is one place to grow
the future cron autoscheduler. `layout_day` is the entry point that autoscheduler
will own; `place_card_today` handles intraday single-card placement.
"""
from datetime import timedelta

from helpers import _now_et, _SIZE_MINUTES

TL_START_MIN = 4 * 60 + 30     # 4:30 AM — dirs timeline start / floor
AUTOSTACK_ANCHOR = 10 * 60     # 10:00 AM — morning autostack anchor
SNAP = 15


def _snap_up(m: int, snap: int = SNAP) -> int:
    return ((m + snap - 1) // snap) * snap


def logical_today_iso() -> str:
    """Yesterday if before 4:30 AM ET — matches dirs.html isoToday()."""
    now = _now_et()
    d = now.date()
    if now.hour * 60 + now.minute < TL_START_MIN:
        d -= timedelta(days=1)
    return d.isoformat()


def now_minutes() -> int:
    """Current ET minutes from midnight; wrapped past 24h if before 4:30 AM."""
    now = _now_et()
    m = now.hour * 60 + now.minute
    if m < TL_START_MIN:
        m += 24 * 60
    return m


def card_duration(c: dict) -> int:
    raw = c.get("estimated_time") or _SIZE_MINUTES.get(c.get("size") or "task", 90)
    return max(SNAP, _snap_up(raw))


def is_dir_card(c: dict, today_iso: str) -> bool:
    """A card that belongs on today's dirs timeline."""
    return (
        c.get("scheduled_day") == today_iso
        and c.get("column") in ("rd", "hq")
        and not c.get("is_reminder")
        and not c.get("is_event")
    )


def layout_day(cards: list[dict], anchor_min: int = AUTOSTACK_ANCHOR,
               today_iso: str | None = None, only_ids: set[str] | None = None) -> None:
    """Autostack today's eligible cards sequentially from anchor_min, in `order`.

    only_ids restricts which cards are (re)stacked; others keep their dir_start_min.
    This is the entry point the future cron autoscheduler will own.
    """
    today = today_iso or logical_today_iso()
    targets = [c for c in cards if is_dir_card(c, today) and (only_ids is None or c["id"] in only_ids)]
    targets.sort(key=lambda c: c.get("order", 0))
    cur = anchor_min
    for c in targets:
        c["dir_start_min"] = cur
        cur += card_duration(c)


def place_card_today(cards: list[dict], today_iso: str | None = None) -> int:
    """Intraday slot for one card: >= now (snapped up), stacked after the last pinned today card."""
    today = today_iso or logical_today_iso()
    snap_now = max(_snap_up(now_minutes()), TL_START_MIN)
    pinned = [c for c in cards if is_dir_card(c, today) and c.get("dir_start_min") is not None]
    if not pinned:
        return snap_now
    last_end = max(c["dir_start_min"] + card_duration(c) for c in pinned)
    return max(snap_now, last_end)
