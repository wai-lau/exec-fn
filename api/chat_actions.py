"""Action-diff block for the Exec follow-up turn.

After a tool round, `routes_chat`/`discord_bot` rebuild the system prompt so the
follow-up turn sees the refreshed board — which now carries any card the turn
just created. Without a record of what it just did, the model misreads its own
new card (now sitting in the ideas pool) as a pre-existing one and reports a
phantom duplicate. `_actions_taken_block(actions)` renders that turn's actions
into the volatile tail so the model reads the board as the RESULT of its own
action. Each `action` = `{"name", "input", "result"}` collected at dispatch."""


def _sched_line(name: str, title: str, res: dict) -> str:
    verb = "rescheduled" if name == "reschedule_after_consequences" else "scheduled"
    if name == "schedule_card" and res.get("scheduled_day") is None and "scheduled_day" in res and "due_date" not in res:
        return f"unscheduled '{title}'"
    day = res.get("scheduled_day") or res.get("due_date")
    prep = "to" if verb == "rescheduled" else "for"
    return f"{verb} '{title}'" + (f" {prep} {day}" if day else "")


def _advance_line(res: dict) -> str:
    step = res.get("completed_step", "a step")
    if res.get("all_steps_done"):
        return f"marked the final step done ({step})"
    return f"marked '{step}' done (next: {res.get('next_chunk', '')})"


def _action_line(name: str, res: dict, inp: dict) -> str:
    """One human line describing an action just taken this turn. Fed to the
    follow-up system prompt so the model reads the refreshed board state as the
    RESULT of its own action — not as a pre-existing or duplicate card."""
    title = res.get("title") or inp.get("title") or ""
    simple = {
        "exile_card": f"dropped (exiled) '{title}'",
        "update_card": f"edited '{title}'",
        "record_consequences": f"recorded Wai's consequence answer for '{title}'",
        "update_context": "updated Wai's long-term context notes",
    }
    if name in simple:
        return simple[name]
    if name == "create_card":
        where = "today's active tasks" if inp.get("column") == "hq" else "the ideas pool"
        return f"created a NEW card '{title}' — it now appears in {where} above because you just made it"
    if name in ("schedule_card", "reschedule_after_consequences"):
        return _sched_line(name, title, res)
    if name == "decompose_task":
        return f"broke '{title}' into steps (first chunk: {res.get('first_chunk', '')})"
    if name == "advance_chunk":
        return _advance_line(res)
    return f"acted on '{title}'".strip()


def _actions_taken_block(actions: list | None) -> str:
    """Diff of the tool actions taken this turn, appended to the volatile tail of
    the FOLLOW-UP system prompt. Without it, the follow-up turn rebuilds the board
    state (which now includes a card it just created) and misreads its own new
    card as a pre-existing one — reporting a phantom duplicate."""
    if not actions:
        return ""
    lines = []
    for a in actions:
        res = a.get("result")
        if not isinstance(res, dict) or not res.get("ok"):
            continue
        lines.append(f"- You {_action_line(a.get('name', ''), res, a.get('input') or {})}.")
    if not lines:
        return ""
    return (
        "\n\nACTIONS YOU JUST TOOK THIS TURN — the board state above ALREADY reflects them:\n"
        + "\n".join(lines)
        + "\nAny card in the lists above that matches one you just created or edited is THAT SAME card, "
        "appearing because you just acted — NOT a pre-existing card and NOT a duplicate. Do not warn about a "
        "duplicate or say a card 'already existed' / 'was already there' for anything you just did this turn; "
        "describe it plainly as the action you just performed. The ACTIVITY LOG above may carry SEVERAL entries "
        "for a single card you just made (a create with a due date logs both 'created' and 'updated') — entries "
        "sharing an [id:...] are the same card, never two."
    )
