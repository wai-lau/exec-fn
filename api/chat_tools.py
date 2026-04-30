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

    size = input_.get("size", "task")
    estimated_time = input_.get("estimated_time") or _SIZE_MINUTES.get(size, 90)

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
    if input_.get("notes"):
        new_card["notes"] = input_["notes"]

    cards.append(new_card)
    rd["cards"] = cards
    _save_rd(rd)
    _append_rd_log("created", new_card["title"], source="Exec", column=column)
    return {"ok": True, "id": new_card["id"], "title": new_card["title"]}



def _tool_move_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    from_col = card.get("column")
    card["column"] = input_["column"]
    if from_col == "hq" and card["column"] != "hq":
        card["scheduled_day"] = None
    elif card["column"] == "hq" and from_col != "hq":
        from helpers import _now_et
        card["scheduled_day"] = _now_et().strftime("%Y-%m-%d")
    _save_rd(rd)
    _append_rd_log("moved", card["title"], source="Exec", from_col=from_col, to_col=card["column"])
    return {"ok": True, "id": card["id"], "title": card["title"], "column": card["column"]}


def _tool_update_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    changed = []
    for field in ("title", "category", "size", "notes", "due_date"):
        if field in input_:
            card[field] = input_[field]
            changed.append(field)
    if "estimated_time" in input_:
        card["estimated_time"] = input_["estimated_time"]
        changed.append("estimated_time")
        if card.get("size") != "book":
            new_size = _minutes_to_size(input_["estimated_time"])
            if new_size != card.get("size"):
                card["size"] = new_size
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



def _tool_schedule_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    card["scheduled_day"] = input_.get("scheduled_day") or None
    _save_rd(rd)
    _append_rd_log("scheduled", card["title"], source="Exec", day=card.get("scheduled_day"))
    return {"ok": True, "id": card["id"], "title": card["title"], "scheduled_day": card.get("scheduled_day")}



_TOOL_HANDLERS = {
    "create_card":       _tool_create_card,
    "move_card":         _tool_move_card,
    "update_card":       _tool_update_card,
    "delete_card":       _tool_delete_card,
    "schedule_card":     _tool_schedule_card,
    "reschedule":        _tool_reschedule,
    "update_context":    _tool_update_context,
}


def _handle_tool(name: str, input_: dict) -> dict:
    handler = _TOOL_HANDLERS.get(name)
    if not handler:
        return {"error": f"Unknown tool: {name}"}
    return handler(input_)
