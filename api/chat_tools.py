import json
from datetime import datetime, timedelta, timezone

from helpers import (
    DATA_DIR, _load_json, _load_rd, _save_rd, _find_card,
    _append_rd_log, _SIZE_MINUTES, _minutes_to_size, _now_et,
    _apply_context_update,
)
from gcal import fetch_omens



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


def _tool_refresh_omens(input_: dict) -> dict:
    result = fetch_omens()
    events = result.get("events", [])
    return {"ok": True, "event_count": len(events), "events": ", ".join(e.get("title", "") for e in events) or "none"}


def _tool_move_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    from_col = card.get("column")
    card["column"] = input_["column"]
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


def _build_card_obj(cards_by_id: dict, card_id: str) -> dict | None:
    card = cards_by_id.get(card_id)
    if not card or card.get("column") not in ("hq", "rd"):
        return None
    steps = [s.strip() for s in card.get("description", "").split(".") if s.strip()]
    return {"id": card_id, "title": card["title"], "steps": steps, "size": card.get("size", "task"), "estimated_time": card.get("estimated_time")}


def _build_plan_cards(rd: dict, seek_ids: list, hack_ids: list, dive_ids: list) -> tuple[list, list, list]:
    cards_by_id = {c["id"]: c for c in rd.get("cards", [])}

    def mk(i):
        return _build_card_obj(cards_by_id, i)

    seek_cards = [o for o in (mk(i) for i in seek_ids) if o]
    hack_cards = [o for o in (mk(i) for i in hack_ids) if o]
    dive_cards = [o for o in (mk(i) for i in dive_ids) if o]

    selected_ids = set(seek_ids + hack_ids + dive_ids)
    remaining_hq = sorted(
        [c for c in rd.get("cards", []) if c.get("column") == "hq" and c["id"] not in selected_ids and c.get("size") != "book"],
        key=lambda c: c.get("order", 0),
    )
    for raw in remaining_hq:
        obj = mk(raw["id"])
        if obj:
            (dive_cards if raw.get("size") in ("project", "titan") else hack_cards).append(obj)

    dirty = False
    for c in seek_cards + hack_cards + dive_cards:
        raw = cards_by_id.get(c["id"])
        if raw and "estimated_time" not in raw:
            raw["estimated_time"] = _SIZE_MINUTES.get(raw.get("size", "task"), 90)
            c["estimated_time"] = raw["estimated_time"]
            dirty = True
    if dirty:
        _save_rd(rd)

    return seek_cards, hack_cards, dive_cards


def _tool_assemble_plan(input_: dict) -> dict:
    import anthropic
    from pipeline import _generate_schedule

    seek_ids = list(input_.get("seek_ids", []))
    hack_ids = list(input_.get("hack_ids", []))
    dive_ids = list(input_.get("dive_ids", []))

    try:
        fetch_omens()
    except Exception:
        pass

    events = _load_json("omens", {}).get("events", [])
    rd = _load_rd()
    seek_cards, hack_cards, dive_cards = _build_plan_cards(rd, seek_ids, hack_ids, dive_ids)

    encouraging = ""
    try:
        from helpers import get_rd_log
        client = anthropic.Anthropic()
        rd_log_entries = get_rd_log(limit=20)
        rd_log_text = "\n".join(f"- [{e['action']}] {e['title']}" for e in rd_log_entries) if rd_log_entries else "none"
        omens_text = "\n".join(f"- {e['date']}: {e['title']}" for e in events) if events else "none"
        seek_titles = [c.get("title", "") if isinstance(c, dict) else c for c in seek_cards]
        hack_titles = [c.get("title", "") if isinstance(c, dict) else c for c in hack_cards]
        dive_title = dive_cards[0].get("title", "") if dive_cards and isinstance(dive_cards[0], dict) else (dive_cards[0] if dive_cards else "")
        plan_text = (
            f"seek: {', '.join(seek_titles) or 'none'}\n"
            f"hack: {', '.join(hack_titles) or 'none'}\n"
            f"dive: {dive_title or 'none'}"
        )
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": (
                f"TODAY'S PLAN:\n{plan_text}\n"
                f"UPCOMING EVENTS:\n{omens_text}\n"
                f"ACTIVITY LOG (recent card activity):\n{rd_log_text}\n\n"
                "Write a warm, personal encouraging message for Wai (3-5 sentences). "
                "Be specific — reference what's coming up or what's on deck. "
                "Plain text only. No em-dashes."
            )}],
        )
        encouraging = resp.content[0].text.strip()
    except Exception:
        pass

    schedule_error = None
    try:
        schedule = _generate_schedule(seek_cards, hack_cards, dive_cards, events, "")
    except Exception as e:
        schedule = []
        schedule_error = str(e)

    plan = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seek": seek_cards,
        "hack": hack_cards,
        "dive": dive_cards,
        "encouraging_message": encouraging,
        "omens": events,
        "schedule": schedule,
    }
    (DATA_DIR / "plan.json").write_text(json.dumps(plan, indent=2))

    directives = {k: plan[k] for k in ("generated_at", "seek", "hack", "dive", "encouraging_message")}
    (DATA_DIR / "directives.json").write_text(json.dumps(directives, indent=2))

    result = {"ok": True}
    if schedule_error:
        result["schedule_error"] = schedule_error
    return result


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
    "refresh_omens":     _tool_refresh_omens,
    "move_card":         _tool_move_card,
    "update_card":       _tool_update_card,
    "delete_card":       _tool_delete_card,
    "schedule_card":     _tool_schedule_card,
    "assemble_plan":     _tool_assemble_plan,
    "reschedule":        _tool_reschedule,
    "update_context":    _tool_update_context,
}


def _handle_tool(name: str, input_: dict) -> dict:
    handler = _TOOL_HANDLERS.get(name)
    if not handler:
        return {"error": f"Unknown tool: {name}"}
    return handler(input_)
