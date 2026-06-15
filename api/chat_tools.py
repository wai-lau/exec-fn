from datetime import timedelta

from helpers import (
    _load_rd, _save_rd, _find_card,
    _append_rd_log, _DEFAULT_MINUTES, _now_et,
    _apply_context_update,
)


def _tool_create_card(input_: dict) -> dict:
    import time as _time

    rd = _load_rd()
    cards = rd.get("cards", [])
    column = input_.get("column", "rd")
    min_order = min((c.get("order", 0) for c in cards if c.get("column") == column), default=0)

    is_reminder = input_.get("is_reminder", False)
    size = None if is_reminder else input_.get("size", "idea")
    # estimated_time is the TOTAL (prep + work); prep_time is the lead-up slice of it.
    estimated_time = None if is_reminder else (input_.get("estimated_time") or _DEFAULT_MINUTES)
    prep_time = None if is_reminder else max(0, int(input_.get("prep_time") or 0))

    new_card = {
        "id": f"card-{int(_time.time() * 1000)}",
        "title": input_.get("title", ""),
        "category": input_.get("category", "Self"),
        "size": size,
        "column": column,
        "order": min_order - 1,
        "due_date": input_.get("due_date") or None,
        "estimated_time": estimated_time,
        "prep_time": prep_time,
    }
    if is_reminder:
        new_card["is_reminder"] = True
    if input_.get("is_book"):
        new_card["is_book"] = True
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
    n = card.get("nudge")
    if n and n.get("stage") == "consequences":
        n["consequences"]["decision"] = "delete"
    _save_rd(rd)
    _append_rd_log("moved", card["title"], source="Exec", from_col=from_col, to_col="exile")
    return {"ok": True, "id": card["id"], "title": card["title"], "column": "exile"}


def _apply_reminder_flag(card: dict, input_: dict, changed: list) -> None:
    card["is_reminder"] = input_["is_reminder"]
    if input_["is_reminder"]:
        card["size"] = None
        card["estimated_time"] = None
        card["prep_time"] = None
    changed.append("is_reminder")


def _apply_size_time(card: dict, input_: dict, changed: list) -> None:
    if "size" in input_:
        card["size"] = input_["size"]
        changed.append("size")
    if "estimated_time" in input_:
        card["estimated_time"] = input_["estimated_time"]
        changed.append("estimated_time")
    if "prep_time" in input_:
        card["prep_time"] = max(0, int(input_["prep_time"] or 0))
        changed.append("prep_time")
    # importance (size) is a manual rating now — no longer derived from time


def _tool_update_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    changed = []
    if "is_reminder" in input_:
        _apply_reminder_flag(card, input_, changed)
    if "is_book" in input_:
        card["is_book"] = bool(input_["is_book"])
        changed.append("is_book")
    for field in ("title", "category", "notes"):
        if field in input_:
            card[field] = input_[field]
            changed.append(field)
    if not card.get("is_reminder"):
        _apply_size_time(card, input_, changed)
    if ("notes" in changed or "title" in changed) and (card.get("nudge") or {}).get("graph", {}).get("nodes"):
        card["nudge"]["triage_pending"] = True
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


def _tool_update_context(input_: dict) -> dict:
    return _apply_context_update(
        action=input_.get("action", ""),
        note=input_.get("note", ""),
        match=input_.get("match", ""),
    )



def _apply_schedule(card_id: str, requested: str, dir_start_min: int | None = None) -> dict:
    """Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day."""
    from scheduler import schedule_to_day
    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card:
        return {"error": f"Card not found: {card_id}"}
    result = schedule_to_day(card, rd.get("cards", []), requested, dir_start_min=dir_start_min)
    if "error" in result:
        return result
    _save_rd(rd)
    if "due_date" in result:
        _append_rd_log("updated", card["title"], source="Exec", fields=["due_date"])
    else:
        _append_rd_log("scheduled", card["title"], source="Exec", day=result["scheduled_day"])
    return result


_ACTIVE_NUDGE_STAGES = ("nudging", "awaiting", "stalled", "consequences")

_RESCHED_GUARD_MSG = (
    "This task has an active nudge loop — moving it later (or unscheduling it) is a "
    "reschedule. Ask Wai what happens if it doesn't get done, call record_consequences "
    "with the answer, then use reschedule_after_consequences."
)


def _nudge_resched_blocked(card: dict, requested: str | None) -> bool:
    """Due dates are protected: an active-nudge card can't be deferred without the
    consequences conversation. Same-day/earlier moves stay allowed."""
    n = card.get("nudge") or {}
    if n.get("stage") not in _ACTIVE_NUDGE_STAGES:
        return False
    if (n.get("consequences") or {}).get("answer"):
        return False
    cur = (card.get("scheduled_day") or "")[:10]
    return requested is None or (requested or "")[:10] > cur


def _tool_schedule_card(input_: dict) -> dict:
    card_id = input_.get("id", "")
    requested = input_.get("scheduled_day") or None
    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card:
        return {"error": f"Card not found: {card_id}"}
    if _nudge_resched_blocked(card, requested):
        return {"error": _RESCHED_GUARD_MSG}
    if not requested:
        card["scheduled_day"] = None
        card.pop("dir_start_min", None)
        _save_rd(rd)
        _append_rd_log("scheduled", card["title"], source="Exec", day=None)
        return {"ok": True, "id": card_id, "title": card.get("title", ""), "scheduled_day": None}
    result = _apply_schedule(card_id, requested, input_.get("dir_start_min"))
    return {"ok": True, "id": card_id, **result}


def _tool_record_consequences(input_: dict) -> dict:
    import nudge as _nudge
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    answer = (input_.get("consequence") or "").strip()
    if not answer:
        return {"error": "consequence required — Wai's answer to 'what happens if this doesn't get done?'"}
    n = _nudge.ensure_nudge(card)
    n["consequences"]["answer"] = answer
    n["consequences"]["asked_at"] = _nudge._fmt_et(_now_et())
    n["stage"] = "consequences"
    n["awaiting_reply"] = False
    n["window_deadline"] = None
    n["next_nudge_at"] = None
    _save_rd(rd)
    _append_rd_log("consequences", card["title"], source="Exec")
    return {
        "ok": True, "id": card["id"], "title": card["title"],
        "note": (
            "Recorded. Now apply gentle pushback acknowledging the real cost, then "
            "offer exactly: try a smaller step now, reschedule "
            "(reschedule_after_consequences), or drop it (exile_card)."
        ),
    }


def _tool_reschedule_after_consequences(input_: dict) -> dict:
    import nudge as _nudge
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    n = _nudge.ensure_nudge(card)
    if not (n.get("consequences") or {}).get("answer"):
        return {"error": (
            "Consequences not recorded — ask Wai what happens if this doesn't get "
            "done and call record_consequences first."
        )}
    new_date = (input_.get("new_date") or "").strip()
    if not new_date:
        return {"error": "new_date required (ISO date)."}
    n["consequences"]["decision"] = "reschedule"
    # Reset loop timing for the new day; keep graph + metrics (cumulative).
    n["stage"] = "idle"
    n["awaiting_reply"] = False
    n["first_nudge_at"] = None
    n["next_nudge_at"] = None
    n["window_deadline"] = None
    _save_rd(rd)
    result = _apply_schedule(card["id"], new_date)
    if "error" in result:
        return result
    return {"ok": True, "id": card["id"], "title": card["title"], **result}



def _tool_decompose_task(input_: dict) -> dict:
    import nudge as _nudge
    import nudge_llm as _nllm
    import nudge_deadlines as _nd
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    if card.get("is_reminder") or card.get("is_event") or card.get("is_book"):
        return {"error": "Reminders, events, and books can't be decomposed."}
    n = _nudge.ensure_nudge(card)
    result = _nllm.decompose_sync(card, feedback=input_.get("feedback", ""))
    n["graph"] = {"nodes": result["nodes"], "edges": result["edges"]}
    n["active_node"] = result["active_node"]
    _nd.compute_deadlines(card)
    _save_rd(rd)
    _append_rd_log("decomposed", card["title"], source="Exec",
                   nodes=len(result["nodes"]))
    return {
        "ok": True, "id": card["id"], "title": card["title"],
        "first_chunk": _nudge.active_label(card),
        "node_count": len(result["nodes"]),
    }


def _tool_advance_chunk(input_: dict) -> dict:
    import nudge as _nudge
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    n = _nudge.ensure_nudge(card)
    nodes = n["graph"]["nodes"]
    if not nodes:
        return {"error": "No breakdown on this card — call decompose_task first."}
    target = input_.get("node_id") or n.get("active_node")
    node = next((nd for nd in nodes if nd["id"] == target), None)
    if not node:
        return {"error": f"Step not found: {target}"}
    node["done"] = True
    now = _now_et()
    n["awaiting_reply"] = False
    n["last_user_reply_at"] = _nudge._fmt_et(now)
    n["window_deadline"] = None
    nxt = _nudge._first_open(nodes, n["graph"]["edges"])
    if nxt is None:
        n["active_node"] = None
        n["stage"] = "resolved"
        n["next_nudge_at"] = None
        _save_rd(rd)
        _append_rd_log("advanced", card["title"], source="Exec",
                       step=node["label"], remaining=0)
        return {"ok": True, "id": card["id"], "completed_step": node["label"],
                "all_steps_done": True,
                "note": "All steps done. Do NOT archive — Wai archives manually."}
    n["active_node"] = nxt
    # Re-nudge later only if Wai goes quiet again — one stall-window from now.
    n["stage"] = "nudging"
    n["next_nudge_at"] = _nudge._fmt_et(now + timedelta(minutes=_nudge.window_for(card)))
    _save_rd(rd)
    remaining = sum(1 for nd in nodes if not nd.get("done"))
    _append_rd_log("advanced", card["title"], source="Exec",
                   step=node["label"], remaining=remaining)
    return {"ok": True, "id": card["id"], "completed_step": node["label"],
            "next_chunk": _nudge.active_label(card), "remaining_steps": remaining}


_TOOL_HANDLERS = {
    "create_card":                   _tool_create_card,
    "exile_card":                    _tool_exile_card,
    "update_card":                   _tool_update_card,
    "schedule_card":                 _tool_schedule_card,
    "update_context":                _tool_update_context,
    "decompose_task":                _tool_decompose_task,
    "advance_chunk":                 _tool_advance_chunk,
    "record_consequences":           _tool_record_consequences,
    "reschedule_after_consequences": _tool_reschedule_after_consequences,
}


def _handle_tool(name: str, input_: dict) -> dict:
    handler = _TOOL_HANDLERS.get(name)
    if not handler:
        return {"error": f"Unknown tool: {name}"}
    return handler(input_)
