import json
from datetime import datetime, timedelta

from helpers import (
    DATA_DIR, _load_rd, _save_rd, _find_card,
    _append_rd_log, _SIZE_MINUTES, _minutes_to_size, _now_et,
    _apply_context_update,
)


def _tool_create_card(input_: dict) -> dict:
    import time as _time

    rd = _load_rd()
    cards = rd.get("cards", [])
    column = input_.get("column", "rd")
    min_order = min((c.get("order", 0) for c in cards if c.get("column") == column), default=0)

    is_reminder = input_.get("is_reminder", False)
    size = None if is_reminder else input_.get("size", "task")
    estimated_time = None if is_reminder else (input_.get("estimated_time") or _SIZE_MINUTES.get(size, 90))

    new_card = {
        "id": f"card-{int(_time.time() * 1000)}",
        "title": input_.get("title", ""),
        "category": input_.get("category", "Self"),
        "size": size,
        "column": column,
        "order": min_order - 1,
        "due_date": input_.get("due_date") or None,
        "estimated_time": estimated_time,
    }
    if is_reminder:
        new_card["is_reminder"] = True
    if input_.get("is_event"):
        new_card["is_event"] = True
    if input_.get("notes"):
        new_card["notes"] = input_["notes"]

    cards.append(new_card)
    rd["cards"] = cards
    _save_rd(rd)
    _append_rd_log("created", new_card["title"], source="Exec", column=column)

    result = {"ok": True, "id": new_card["id"], "title": new_card["title"]}
    if input_.get("due_date") and not is_reminder:
        sched = _apply_schedule(new_card["id"], input_["due_date"], input_.get("dir_start_min"))
        result.update(sched)
    return result



def _tool_exile_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    from_col = card.get("column")
    card["column"] = "exile"
    card["scheduled_day"] = None
    _save_rd(rd)
    _append_rd_log("moved", card["title"], source="Exec", from_col=from_col, to_col="exile")
    return {"ok": True, "id": card["id"], "title": card["title"], "column": "exile"}


def _apply_reminder_flag(card: dict, input_: dict, changed: list) -> None:
    card["is_reminder"] = input_["is_reminder"]
    if input_["is_reminder"]:
        card["size"] = None
        card["estimated_time"] = None
    changed.append("is_reminder")


def _apply_size_time(card: dict, input_: dict, changed: list) -> None:
    if "size" in input_:
        card["size"] = input_["size"]
        changed.append("size")
    if "estimated_time" in input_:
        card["estimated_time"] = input_["estimated_time"]
        changed.append("estimated_time")
        if card.get("size") != "book":
            new_size = _minutes_to_size(input_["estimated_time"])
            if new_size != card.get("size"):
                card["size"] = new_size


def _tool_update_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    changed = []
    if "is_reminder" in input_:
        _apply_reminder_flag(card, input_, changed)
    for field in ("title", "category", "notes"):
        if field in input_:
            card[field] = input_[field]
            changed.append(field)
    if not card.get("is_reminder"):
        _apply_size_time(card, input_, changed)
    _save_rd(rd)
    extra = {"fields": changed}
    if "notes" in input_:
        extra["notes"] = input_["notes"]
    _append_rd_log("updated", card["title"], source="Exec", **extra)
    return {"ok": True, "id": card["id"], "title": card["title"]}


def _tool_delete_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    title = card.get("title", input_.get("id"))
    rd["cards"] = [c for c in rd.get("cards", []) if c["id"] != input_.get("id")]
    _save_rd(rd)
    _append_rd_log("deleted", title, source="Exec")
    return {"ok": True, "deleted": input_.get("id")}


def _tool_reschedule(input_: dict) -> dict:
    from pipeline import _generate_schedule

    plan_path = DATA_DIR / "plan.json"
    if not plan_path.exists():
        return {"error": "No plan.json found"}

    plan = json.loads(plan_path.read_text())
    seek_cards = plan.get("seek", [])
    hack_cards = plan.get("hack", [])
    dive_raw = plan.get("dive", [])
    dive_cards = [dive_raw] if isinstance(dive_raw, dict) else dive_raw
    events = plan.get("omens", [])
    feedback = input_.get("feedback", "")

    now_et = _now_et()
    done_titles = set()
    for entry in plan.get("schedule", []):
        try:
            t = datetime.strptime(entry["time"], "%H:%M").replace(year=now_et.year, month=now_et.month, day=now_et.day)
            if t + timedelta(minutes=entry.get("duration_min", 0)) < now_et:
                done_titles.add(entry.get("title", ""))
        except Exception:
            pass

    remaining_seek = [c for c in seek_cards if (c.get("title", c) if isinstance(c, dict) else c) not in done_titles]
    remaining_hack = [c for c in hack_cards if (c.get("title", c) if isinstance(c, dict) else c) not in done_titles]
    remaining_dive = [c for c in dive_cards if (c.get("title", c) if isinstance(c, dict) else c) not in done_titles]

    schedule = _generate_schedule(remaining_seek, remaining_hack, remaining_dive, events, "", feedback=feedback)

    plan["schedule"] = schedule
    plan_path.write_text(json.dumps(plan, indent=2))
    return {"ok": True, "schedule": schedule}


def _tool_update_context(input_: dict) -> dict:
    return _apply_context_update(
        action=input_.get("action", ""),
        note=input_.get("note", ""),
        match=input_.get("match", ""),
    )



def _apply_schedule(card_id: str, requested: str, dir_start_min: int | None = None) -> dict:
    """Shared scheduling logic: rd→hq promotion, window detection, due_date fallback."""
    from datetime import date
    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card:
        return {"error": f"Card not found: {card_id}"}
    try:
        target = date.fromisoformat(requested)
    except ValueError:
        return {"error": f"Invalid date: {requested}"}
    today = _now_et().date()
    window_end = today + timedelta(days=5)
    if target > window_end:
        if card.get("column") != "rd":
            card["column"] = "rd"
        card["due_date"] = requested
        _save_rd(rd)
        _append_rd_log("updated", card["title"], source="Exec", fields=["due_date"])
        return {"due_date": requested, "note": "beyond 6-day window, set as due date in backlog"}
    if card.get("column") == "rd":
        card["column"] = "hq"
    card["scheduled_day"] = requested
    if dir_start_min is not None and target == today:
        card["dir_start_min"] = dir_start_min
    _save_rd(rd)
    _append_rd_log("scheduled", card["title"], source="Exec", day=requested)
    return {"scheduled_day": requested}


def _tool_schedule_card(input_: dict) -> dict:
    card_id = input_.get("id", "")
    requested = input_.get("scheduled_day") or None
    if not requested:
        rd = _load_rd()
        card = _find_card(rd, card_id)
        if not card:
            return {"error": f"Card not found: {card_id}"}
        card["scheduled_day"] = None
        _save_rd(rd)
        _append_rd_log("scheduled", card["title"], source="Exec", day=None)
        return {"ok": True, "id": card_id, "title": card.get("title", ""), "scheduled_day": None}
    result = _apply_schedule(card_id, requested, input_.get("dir_start_min"))
    return {"ok": True, "id": card_id, **result}



_TOOL_HANDLERS = {
    "create_card":       _tool_create_card,
    "exile_card":        _tool_exile_card,
    "update_card":       _tool_update_card,
    "schedule_card":     _tool_schedule_card,
    "update_context":    _tool_update_context,
}


def _handle_tool(name: str, input_: dict) -> dict:
    handler = _TOOL_HANDLERS.get(name)
    if not handler:
        return {"error": f"Unknown tool: {name}"}
    return handler(input_)
