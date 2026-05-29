from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from helpers import _load_rd, _save_rd, _append_rd_log, get_rd_log
from scheduler import place_card_today

_ET = ZoneInfo("America/New_York")


def _logical_today() -> date:
    """Yesterday if before 4:30 AM ET, matching client isoToday()."""
    now = datetime.now(_ET)
    d = now.date()
    if now.hour * 60 + now.minute < 4 * 60 + 30:
        d -= timedelta(days=1)
    return d


def _today_iso() -> str:
    return _logical_today().isoformat()


def get_week_data(start_iso: str | None = None) -> dict:
    """Return cards scheduled for 6 days starting from start_iso (default logical today)."""
    start = date.fromisoformat(start_iso) if start_iso else _logical_today()
    week_days = [(start + timedelta(days=i)).isoformat() for i in range(6)]

    rd = _load_rd()
    cards = rd.get("cards", [])

    days: dict[str, list] = {d: [] for d in week_days}
    unscheduled = []

    for c in cards:
        # Prophecies mirrors hq exactly: same card set, no more, no less.
        if c.get("column") != "hq":
            continue
        sd = c.get("scheduled_day")
        if sd in days:
            days[sd].append(c)
        else:
            # hq card with no scheduled_day, or one falling outside the
            # visible week — still belongs in profs (hq set == profs set).
            unscheduled.append(c)

    for d in week_days:
        days[d].sort(key=lambda x: x.get("order", 0))
    unscheduled.sort(key=lambda x: x.get("order", 0))

    return {
        "week_start": week_days[0],
        "days": days,
        "unscheduled": unscheduled,
    }


def bulk_update_scheduled_days(updates: list[dict]) -> dict:
    """Apply list of {id, scheduled_day?, order?} updates to rd.json."""
    rd = _load_rd()
    cards_by_id = {c["id"]: c for c in rd.get("cards", [])}
    changed = 0

    for upd in updates:
        cid = upd.get("id")
        card = cards_by_id.get(cid)
        if not card:
            continue
        changed_this = False

        if "scheduled_day" in upd:
            old_day = card.get("scheduled_day")
            new_day = upd["scheduled_day"] or None
            if old_day != new_day:
                card["scheduled_day"] = new_day
                card.pop("dir_start_min", None)
                if new_day is None:
                    # Unscheduling in profs only clears the day; the card stays
                    # in hq so profs keeps mirroring the hq set (unscheduled lane).
                    hq_orders = [c.get("order", 0) for c in rd.get("cards", []) if c.get("column") == "hq"]
                    card["order"] = (min(hq_orders) - 1) if hq_orders else 0
                elif new_day == _today_iso():
                    card["dir_start_min"] = place_card_today(rd.get("cards", []), new_day)
                log_prophecy_change(cid, old_day, new_day, title=card.get("title", cid))
                changed_this = True

        if "order" in upd:
            card["order"] = upd["order"]
            changed_this = True

        if changed_this:
            changed += 1

    _save_rd(rd)
    return {"ok": True, "changed": changed}


def log_prophecy_change(card_id: str, from_day: str | None, to_day: str | None, title: str = ""):
    _append_rd_log("rescheduled", title or card_id, source="prof", card_id=card_id, from_day=from_day, to_day=to_day)


def get_prophecies_log(limit: int = 50) -> list:
    return get_rd_log(limit=limit, source="prof")
