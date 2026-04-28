import json
from datetime import date, timedelta, datetime, timezone

from helpers import DATA_DIR, _load_rd, _save_rd

_PROPHECIES_LOG = DATA_DIR / "prophecies_log.json"


def _today_iso() -> str:
    return date.today().isoformat()


def get_week_data(start_iso: str | None = None) -> dict:
    """Return cards scheduled for 7 days starting from start_iso (default today)."""
    start = date.fromisoformat(start_iso) if start_iso else date.today()
    week_days = [(start + timedelta(days=i)).isoformat() for i in range(7)]

    rd = _load_rd()
    cards = rd.get("cards", [])

    days: dict[str, list] = {d: [] for d in week_days}
    unscheduled = []

    for c in cards:
        if c.get("column") not in ("rd", "hq"):
            continue
        sd = c.get("scheduled_day")
        if sd in days:
            days[sd].append(c)
        elif not sd and c.get("column") == "hq":
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
    """Apply list of {id, scheduled_day, manual_pin?} updates to rd.json."""
    rd = _load_rd()
    cards_by_id = {c["id"]: c for c in rd.get("cards", [])}
    changed = 0

    for upd in updates:
        cid = upd.get("id")
        card = cards_by_id.get(cid)
        if not card:
            continue
        old_day = card.get("scheduled_day")
        new_day = upd.get("scheduled_day") or None
        if old_day != new_day:
            card["scheduled_day"] = new_day
            if upd.get("manual_pin", True):
                card["manual_pin"] = True
            log_prophecy_change(cid, old_day, new_day)
            changed += 1

    _save_rd(rd)
    return {"ok": True, "changed": changed}


def log_prophecy_change(card_id: str, from_day: str | None, to_day: str | None):
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "card_id": card_id,
        "from_day": from_day,
        "to_day": to_day,
    }
    log = json.loads(_PROPHECIES_LOG.read_text()) if _PROPHECIES_LOG.exists() else []
    log.append(entry)
    _PROPHECIES_LOG.write_text(json.dumps(log[-1000:]))


def get_prophecies_log(limit: int = 50) -> list:
    if not _PROPHECIES_LOG.exists():
        return []
    log = json.loads(_PROPHECIES_LOG.read_text())
    return log[-limit:][::-1]
