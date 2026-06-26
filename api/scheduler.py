"""Single home for dirs-timeline scheduling (dir_start_min).

Every dir_start_min decision flows through here so there is one place to grow
the future cron autoscheduler. `layout_day` is the entry point that autoscheduler
will own; `place_card_today` handles intraday single-card placement.
"""
from datetime import datetime, timedelta

from helpers import _now_et, _DEFAULT_MINUTES, _prep_min

TL_START_MIN = 4 * 60 + 30     # 4:30 AM — dirs timeline start / floor
AUTOSTACK_ANCHOR = 10 * 60     # 10:00 AM — morning autostack anchor
SNAP = 15
SCHED_WINDOW_DAYS = 6          # today + 6 = 7-day HQ/scheduling window


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
    raw = c.get("estimated_time") or _DEFAULT_MINUTES
    return max(SNAP, _snap_up(raw))


def is_dir_card(c: dict, today_iso: str) -> bool:
    """A card that belongs on today's dirs timeline. No-Rollover cards (fixed
    occurrences) DO sit on the timeline now — their prep back-schedules before
    the event time; only reminders (alerts) and books (reading) stay off it."""
    return (
        c.get("scheduled_day") == today_iso
        and c.get("column") in ("rd", "hq")
        and not c.get("is_reminder")
        and not c.get("is_book")
    )


def timed_start_min(c: dict) -> int | None:
    """Block-start minute for a card with a fixed event TIME: the event time
    (its due_date clock) minus its prep, so prep back-schedules to finish exactly
    at the event. None when the due_date carries no time component."""
    dd = c.get("due_date") or ""
    if "T" not in dd:
        return None
    try:
        t = datetime.fromisoformat(dd)
    except ValueError:
        return None
    m = t.hour * 60 + t.minute
    if m < TL_START_MIN:        # after-midnight event sits past the 24h mark
        m += 24 * 60
    return max(TL_START_MIN, m - _prep_min(c))


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
        pinned = timed_start_min(c)     # fixed event time -> back-scheduled slot
        if pinned is not None:
            c["dir_start_min"] = pinned
            continue                    # timed cards don't consume the autostack cursor
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


def schedule_to_day(card: dict, cards: list[dict], target_iso: str,
                    today_iso: str | None = None, dir_start_min: int | None = None,
                    clamp_to_window: bool = False) -> dict:
    """Canonical rd->hq scheduling. Mutates `card` in place; no I/O.

    `target_iso` is the day to aim for — a card's due day (auto) or an
    explicitly requested day (exec chat / manual drag). Single rule:
      - Beyond the 7-day window: by default keep/return to rd, set due_date
        only. With clamp_to_window=True (manual move into hq), clamp the
        target to the last window day instead so the card stays in hq.
      - In window: promote rd->hq, scheduled_day = target. An overdue target
        is clamped to today (the latest still-actionable day). dir_start_min
        is assigned only when the target is today.
    Returns an outcome dict ({"scheduled_day": ...} / {"due_date": ..., "note": ...}
    / {"error": ...}); callers persist and log.
    """
    from datetime import date
    try:
        target = date.fromisoformat((target_iso or "").split("T")[0])
    except ValueError:
        return {"error": f"Invalid date: {target_iso}"}
    today = date.fromisoformat(today_iso) if today_iso else _now_et().date()
    window_end = today + timedelta(days=SCHED_WINDOW_DAYS)
    if target > window_end:
        if clamp_to_window:
            target = window_end
        else:
            if card.get("column") != "rd":
                card["column"] = "rd"
            card["due_date"] = target.isoformat()
            card["scheduled_day"] = None
            card.pop("dir_start_min", None)
            return {"due_date": target.isoformat(), "note": "beyond 7-day window, set as due date in backlog"}
    if target < today:
        target = today
    if card.get("column") == "rd":
        card["column"] = "hq"
    target_s = target.isoformat()
    card["scheduled_day"] = target_s
    card.pop("dir_start_min", None)
    if target == today:
        if dir_start_min is not None:
            card["dir_start_min"] = dir_start_min
        else:
            # A fixed event time pins the slot (prep back-scheduled before it);
            # otherwise stack after the day's already-placed cards.
            card["dir_start_min"] = timed_start_min(card) or place_card_today(cards, target_s)
    return {"scheduled_day": target_s}
