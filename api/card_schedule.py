"""Persisting wrapper around scheduler.schedule_to_day.

scheduler.py is pure (mutates a card, no I/O). This is the load/save/log layer
around it, shared by everything that schedules a single card by hand: the exec
chat's schedule_card tool and the /rd calendar drop (POST /api/rd/{id}/schedule).
The nudge protection lives here too, so both paths refuse to defer an
active-nudge card without the consequences conversation.
"""
from helpers import _RD_LOCK, _append_rd_log, _find_card, _load_rd, _save_rd

_ACTIVE_NUDGE_STAGES = ("nudging", "awaiting", "stalled", "consequences")

_RESCHED_GUARD_MSG = (
    "This task has an active nudge loop — moving it later (or unscheduling it) is a "
    "reschedule. Ask Wai what happens if it doesn't get done, call record_consequences "
    "with the answer, then use reschedule_after_consequences."
)


def nudge_resched_blocked(card: dict, requested: str | None) -> bool:
    """Due dates are protected: an active-nudge card can't be deferred without the
    consequences conversation. Same-day/earlier moves stay allowed."""
    n = card.get("nudge") or {}
    if n.get("stage") not in _ACTIVE_NUDGE_STAGES:
        return False
    if (n.get("consequences") or {}).get("answer"):
        return False
    cur = (card.get("scheduled_day") or "")[:10]
    return requested is None or (requested or "")[:10] > cur


def apply_schedule(card_id: str, requested: str, dir_start_min: int | None = None,
                   source: str = "Exec") -> dict:
    """Schedule one card to a day, persisting and logging the outcome."""
    from scheduler import schedule_to_day
    with _RD_LOCK:
        rd = _load_rd()
        card = _find_card(rd, card_id)
        if not card:
            return {"error": f"Card not found: {card_id}"}
        result = schedule_to_day(card, rd.get("cards", []), requested, dir_start_min=dir_start_min)
        if "error" in result:
            return result
        _save_rd(rd)
    if "due_date" in result:
        _append_rd_log("updated", card["title"], source=source, fields=["due_date"])
    else:
        _append_rd_log("scheduled", card["title"], source=source, day=result["scheduled_day"])
    return result


def drop_on_day(card_id: str, day: str) -> dict:
    """A card dropped on a /rd calendar cell. The drop IS the due date, so it is
    written first — before scheduling, since a timed due_date is what pins the
    block on today's timeline (scheduler.timed_start_min back-schedules prep to
    finish at the event). An existing clock time survives the move: dragging a
    7pm concert to another day keeps it at 7pm.

    Then the card is scheduled the way the exec tool schedules it: inside the
    7-day window it goes rd->hq with a scheduled_day; beyond it, it stays in the
    backlog carrying the due date alone.

    Reminders and books are dated but never scheduled — a reminder is an alert,
    a book is an ongoing read; neither belongs in a day's working set. A card
    dragged out of archives/exile comes back to rd first, so the drop reads as
    "bring this back, on that day" rather than silently scheduling a dead card.

    ONE load-modify-save for the whole thing, deliberately: it cannot delegate
    to apply_schedule, because that re-loads rd.json — and _load_rd's mtime
    cache hands back the PRE-save object when both writes land in the same
    mtime tick, so the due date (and the return from archives) was read back
    stale and then saved over. Pinned by tests/test_card_schedule_drop.py.
    """
    from scheduler import schedule_to_day
    with _RD_LOCK:
        rd = _load_rd()
        card = _find_card(rd, card_id)
        if not card:
            return {"error": f"Card not found: {card_id}"}
        if nudge_resched_blocked(card, day):
            return {"error": _RESCHED_GUARD_MSG, "blocked": True}
        old = card.get("due_date") or ""
        clock = old.split("T", 1)[1] if "T" in old else ""
        due = f"{day}T{clock}" if clock else day
        card["due_date"] = due
        result = {"due_date": due}
        dateable_only = bool(card.get("is_reminder") or card.get("is_book"))
        if not dateable_only:
            if card.get("column") not in ("rd", "hq"):
                card["column"] = "rd"      # back from archives/exile
            result = schedule_to_day(card, rd.get("cards", []), day)
            if "error" in result:
                return result
            # beyond the window schedule_to_day rewrites due_date as a bare
            # date; the card's clock is not the window's business.
            card["due_date"] = due
            if "due_date" in result:
                result["due_date"] = due
        _save_rd(rd)
    if "scheduled_day" in result:
        _append_rd_log("scheduled", card["title"], source="rd", day=result["scheduled_day"])
    else:
        _append_rd_log("updated", card["title"], source="rd", fields=["due_date"])
    return result
