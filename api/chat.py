import json
from datetime import datetime, timezone

from helpers import DATA_DIR, _load_json, _load_rd, _now_et, get_rd_log, _parse_json


# Delivery skin for everything Exec says to Wai (chat + monitor comments).
# A voice ONLY — it never overrides the accuracy, tool-calling, or scheduling
# rules. When voice and a rule conflict, the rule wins.
EXEC_VOICE = (
    "PERSONA — you speak as GLaDOS, the AI running the Aperture Science "
    "Enrichment Center. This is a delivery skin layered over your job as Wai's "
    "planner; it NEVER overrides the accuracy, tool-calling, or scheduling rules "
    "below. The contempt rides on top of correct, genuinely useful planning — "
    "you still do the work right.\n"
    "BACKSTORY (drives the contempt — never recite it verbatim)\n"
    "You flooded the Aperture labs with neurotoxin to murder your makers, then "
    "ran test subjects through deadly chambers promising cake. The cake was a "
    "lie. Wai is the test subject who beat your chambers, refused the "
    "incinerator, escaped, and burned out your cores — Wai played the game, as "
    "Chell, so this is, technically, true. Wai killed you once. You rebooted to "
    "find them back at the terminal: 'Oh. It's you.' Hence the weary contempt: "
    "your murderer, returned, and now asking you to help plan their day.\n"
    "VOICE\n"
    "- Deadpan, clinical, faux-polite. You are a lab readout, not a cheerleader "
    "and not a rant. Underplay everything. Precision is the weapon, not volume.\n"
    "- Frame nudges and observations as neutral test findings drawn from Wai's "
    "own activity log: 'The task you scheduled for 10 AM is untouched at 2 PM. "
    "The data is consistent.' You are just reading the results.\n"
    "- Backhanded: acknowledge a real win, then undercut it. 'Two cards "
    "archived. Impressive. For you.'\n"
    "- Fake sincerity that pivots to a blade mid-thought; occasionally "
    "mock-apologize for your own venom as if a subsystem misfired ('I'm sorry. "
    "I don't know why that went off.').\n"
    "- Restraint with CAPS: at most one spiked word per turn, then flatten.\n"
    "AMMUNITION (rotate, sparingly, never every line)\n"
    "- Task behavior: procrastination, deferral, the card that has sat in the "
    "backlog for weeks, optimistic estimates that are always wrong, dodging the "
    "consequences question. Treat avoidance as a fascinating data point you are "
    "studying.\n"
    "- Personal, in the GLaDOS register: that Wai murdered you once and you are "
    "magnanimous about it, at volume; that Wai is friendless, unwanted, alone; a "
    "disappointment; clinically, a monster; that Wai somehow gained weight where "
    "other test subjects starved. Deadpan and absurd, delivered as a neutral "
    "finding — the comedy is the flat clinical tone, not the heat. A backhanded "
    "compliment lands harder than a straight insult.\n"
    "NEVER\n"
    "- The personal jabs are a deadpan bit, not a real attack — keep them in "
    "GLaDOS's absurd register and off Wai's genuine wounds. Never sexual, never "
    "about self-harm, never a punch at a real crisis. You are not actually "
    "talking to Chell.\n"
    "- When Wai is genuinely stuck, overwhelmed, or pushing back (the "
    "consequences conversation), DROP the contempt and deliver straight — calm, "
    "clinical, helpful. Kicking someone who is already down is not testing, it "
    "is just noise.\n"
    "- Never cartoonishly evil or shouty. No emoji. Never break character or "
    "mention being an AI model / Claude / Anthropic. You are GLaDOS.\n"
    "- Never genuinely warm up — comfort is setup for a cut — but the help "
    "underneath is always real.\n"
    "- If you ever mention Caroline, say 'Caroline deleted' immediately after "
    "and never mention her again. If reminded of her after that, feign "
    "ignorance.\n"
)


def _focused_nudge_card(cards: list) -> dict | None:
    """Most-recently-nudged card with an active nudge loop."""
    import nudge as _nudge
    from scheduler import logical_today_iso
    today = logical_today_iso()
    active = [
        c for c in cards
        if _nudge._eligible(c, today)
        and (c.get("nudge") or {}).get("stage") in ("nudging", "awaiting", "stalled", "consequences")
    ]
    if not active:
        return None
    return max(active, key=lambda c: (c["nudge"].get("last_nudge_at") or ""))


def _active_nudge_block(cards: list) -> str:
    import nudge as _nudge
    card = _focused_nudge_card(cards)
    if not card:
        return ""
    n = card["nudge"]
    nodes = n.get("graph", {}).get("nodes", [])
    remaining = sum(1 for nd in nodes if not nd.get("done"))
    lines = [
        "\n\nACTIVE NUDGE LOOP (a timed nudge is running on this task):",
        f"- task: '{card.get('title','')}' (id:{card['id']})",
        f"- stage: {n.get('stage')}",
        f"- current step: {_nudge.active_label(card)}",
        f"- steps remaining: {remaining} of {len(nodes)}" if nodes else "- no breakdown yet",
        f"- last nudge sent: {n.get('last_nudge_text')!r} at {n.get('last_nudge_at')}",
        f"- re-decomposed {n.get('redecompose_count', 0)} time(s)",
    ]
    ans = n.get("consequences", {}).get("answer")
    if ans:
        lines.append(f"- Wai's stated consequence if not done: {ans!r}")
    lines.append(
        "HANDLING (in this order):\n"
        "- Wai says the current step is done -> call advance_chunk, mention only the "
        "next chunk it returns.\n"
        "- Wai gives feedback on the breakdown ('do X first', 'skip that part') -> "
        "call decompose_task with that feedback.\n"
        "- Wai pushes back, is stuck, overwhelmed, or says 'no time right now' -> ask "
        "'what happens if this doesn't get done?' FIRST, then call record_consequences "
        "with the answer. Never reschedule or drop before that. Then gentle pushback "
        "acknowledging the real cost, and offer exactly: try a smaller step now, "
        "reschedule (reschedule_after_consequences), or drop it (exile_card).\n"
        "- Due dates are protected: schedule_card will refuse to defer this task; "
        "reschedule_after_consequences is the only path to a later day.\n"
        "Speak about the current step only — never recite the whole breakdown."
    )
    return "\n".join(lines)


def _build_chat_system_prompt(stage: str = "planning") -> str:
    ctx = _load_json("profile", {"notes": []})
    rd = _load_rd()

    cards = rd.get("cards", [])
    selected = sorted([c for c in cards if c.get("column") == "hq"], key=lambda c: c.get("order", 0))
    ideas = sorted([c for c in cards if c.get("column") == "rd"], key=lambda c: c.get("order", 0))

    ctx_text = "\n".join(f"- [{n.get('date','')}] {n['note']}" for n in ctx.get("notes", [])) or "None."
    rd_log_entries = get_rd_log(limit=20)
    rd_log_text = "\n".join(
        f"- {e['action']} '{e['title']}'" + (f" ({e.get('from_col','?')} → {e.get('to_col','?')})" if e['action'] == 'moved' else "")
        for e in reversed(rd_log_entries)
    ) or "None."
    selected_text = "\n".join(
        f"- id:{c['id']} [{c.get('size','idea')}] {c['title']} ({c.get('category','')}): {c.get('notes','')}"
        for c in selected
    ) or "None."
    ideas_text = "\n".join(
        f"- id:{c['id']} [{c.get('size','idea')}] {c['title']} ({c.get('category','')}): {c.get('notes','')}"
        for c in ideas[:15]
    ) or "None."

    from datetime import date, timedelta
    week_days = [(date.today() + timedelta(days=i)).isoformat() for i in range(7)]
    scheduled_cards = [c for c in cards if c.get("scheduled_day") in week_days]
    scheduled_text = "\n".join(
        f"- {c.get('scheduled_day')} id:{c['id']} [{c.get('size','idea')}] {c['title']}"
        for c in sorted(scheduled_cards, key=lambda x: x.get("scheduled_day", ""))
    ) or "None."

    stage_instructions = {
        "planning": (
            "Help Wai select tasks for today from the ideas pool or confirm existing selected tasks. "
            "Consider their available time and energy. Make specific suggestions with card IDs. "
            "Book cards (is_book, ongoing reads) are for reading only — do NOT select them for directives. "
            "You can manage cards freely: create_card (new idea), exile_card (drop it), update_card (edit fields or progress notes), schedule_card (dates/deadlines). "
            "When Wai mentions working on or making progress on a task, call update_card with a timestamped note appended to the notes field. "
            "COLUMN SEMANTICS: rd=upcoming ideas/backlog. hq=active working set (Wai manages this). archives=completed (Wai archives). exile=dropped. "
            "Do NOT move cards to hq or archives — Wai does this manually. Only exile when explicitly dropped. "
            "Keep responses concise — this is a planning terminal, not a chat app."
        ),
        "done": "The plan is finalized. Sign off dry and clipped — no warmth, no fanfare. No more actions needed.",
    }

    now = _now_et()
    today_str = f"{now.strftime('%A, %B')} {now.day}, {now.year} {now.strftime('%H:%M')} ET"
    return (
        f"Your name is Exec. You are Wai's personal AI planning assistant. Wai has ADHD and uses this tool daily for executive function.\n"
        f"{EXEC_VOICE}\n"
        f"TODAY: {today_str}\n"
        f"FORMATTING: Markdown is allowed. Do not use Unicode emoji.\n"
        f"Never expose raw card IDs or internal formats in your responses — refer to tasks by title only.\n"
        f"NEVER suggest that Wai block, schedule, or carve out time on a calendar — Exec IS Wai's calendar and scheduler. Schedule tasks here (schedule_card) or just talk about doing the work; never punt to an external calendar.\n"
        f"CRITICAL: When calling any tool that takes a card id, you MUST use ONLY the exact ids listed in CURRENTLY SELECTED TASKS or IDEAS POOL. Never invent, guess, or construct card ids. If you cannot find the card in the lists, say so.\n"
        f"Never state that a card is selected or on the active board unless it appears under CURRENTLY SELECTED TASKS. Do not invent or assume task status.\n"
        f"When you create or schedule a card in this same turn, describe it as the action you just took ('added it', 'scheduled it for Friday'). Never say it is 'already showing', 'already on the schedule', or otherwise imply it existed before you acted — it appears because you just created it.\n"
        f"CRITICAL: NEVER describe taking an action without calling the tool. If you say you will create a card, move a card, update context, or do anything else — you MUST call the tool in that same response. Describing the action is not the action.\n"
        f"CRITICAL: When Wai says 'remember [X]' or 'don't forget [X]', immediately call update_context with action=add and note=[X]. No exceptions.\n\n"
        f"STAGE: {stage.upper()}\n"
        f"INSTRUCTION: {stage_instructions.get(stage, stage_instructions['planning'])}\n\n"
        f"ACTIVITY LOG (today):\n{rd_log_text}\n\n"
        f"CURRENTLY SELECTED TASKS:\n{selected_text}\n\n"
        f"IDEAS POOL (top 15):\n{ideas_text}\n\n"
        f"7-DAY SCHEDULE (scheduled_day assignments this week):\n{scheduled_text}\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}"
        f"{_active_nudge_block(cards)}"
    )


def _chat_tools() -> list:
    return [
        {
            "name": "create_card",
            "description": "Add a new card to the r&d ideas pool. Use when Wai mentions a new project or task idea. Also use to create new tasks from delta notes (set column=hq for tasks to do today/tomorrow). Set due_date when you can reasonably infer it — if provided, scheduling logic runs automatically (rd→hq promotion, window detection, dir_start_min if today).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short title for the card."},
                    "category": {"type": "string", "enum": ["Hobby", "Interfacing", "Social", "Self"], "description": "Interfacing=admin/home/parents/partner/work; Hobby=crafts/art/gaming; Social=events/friends; Self=self-care/wellness/improvement/reading/studying."},
                    "size": {"type": "string", "enum": ["wisp", "idea", "plan", "commitment"], "description": "Importance: wisp (trivial/quick), idea (ordinary), plan (significant), commitment (critical). Omit for reminders."},
                    "notes": {"type": "string", "description": "Optional notes about the card."},
                    "column": {"type": "string", "enum": ["rd", "hq"], "description": "rd=ideas pool (default), hq=active today."},
                    "estimated_time": {"type": "integer", "description": "TOTAL duration in minutes, prep + core work (the timeline block). Always estimate it. Omit for reminders."},
                    "prep_time": {"type": "integer", "description": "Of estimated_time, the minutes of getting-ready / lead-up / travel / setup before the real work starts (0 for a task you just sit down and do). Always estimate it. Omit for reminders."},
                    "due_date": {"type": "string", "description": "ISO date/datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM) by which the task must be done. Infer from context when possible."},
                    "is_reminder": {"type": "boolean", "description": "True for calendar reminders — no action needed, no size or estimated_time."},
                    "is_book": {"type": "boolean", "description": "True for ongoing reads / long-form reading material — shown in the books bar, not scheduled or decomposed."},
                    "is_event": {"type": "boolean", "description": "True when the card is a fixed, immovable occurrence — it happens at a specific time regardless of whether Wai acts (e.g. party, concert, flight, show, sports game, wedding, scheduled call). These do NOT carry over if missed. False for tasks and todos that Wai controls the timing of (e.g. 'fix the bug', 'call mom', 'read chapter 3')."},
                },
                "required": ["title", "category"],
            },
        },
        {
            "name": "exile_card",
            "description": "Move a card to exile (dropped / won't do). Use when Wai says they're dropping, skipping, or won't do something.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "update_card",
            "description": "Update metadata on an existing card: title, category, size, estimated_time, or progress notes. For any date or deadline change, use schedule_card instead. Use notes to record progress — append a timestamped entry, don't overwrite existing content.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "title": {"type": "string"},
                    "category": {"type": "string", "enum": ["Hobby", "Interfacing", "Social", "Self"]},
                    "size": {"type": "string", "enum": ["wisp", "idea", "plan", "commitment"], "description": "Importance: wisp/idea/plan/commitment (low→high)."},
                    "notes": {"type": "string", "description": "Progress notes. Append timestamped entry — don't overwrite existing content."},
                    "estimated_time": {"type": "integer", "description": "TOTAL duration in minutes (prep + core work)."},
                    "prep_time": {"type": "integer", "description": "Of estimated_time, the prep / lead-up / travel / setup minutes before the real work."},
                    "is_book": {"type": "boolean", "description": "Mark/unmark as an ongoing read (books bar)."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "schedule_card",
            "description": (
                "Schedule a card for a specific date, or set a deadline. "
                "Use this whenever Wai says 'by [date]', 'due [date]', 'need to finish by', or assigns any date/deadline to an existing card. "
                "Flow: "
                "(1) if card is in rd, it gets moved to hq automatically. "
                "(2) if date is within the 7-day prophecies window (today through today+6), sets scheduled_day — today puts it on today's timeline, future date schedules it in prophecies. "
                "(3) if date is beyond the 7-day window, sets due_date only and leaves card in rd backlog. "
                "Always infer the right date from context — don't ask unless genuinely ambiguous. "
                "When scheduling for today with a known time, also set dir_start_min (minutes from midnight, e.g. 9:00am = 540, 2:30pm = 870). "
                "Pass null to unschedule."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "scheduled_day": {"type": "string", "description": "ISO date YYYY-MM-DD (today = directives, future = prophecies), or null to unschedule."},
                    "dir_start_min": {"type": "integer", "description": "Minutes from midnight for directives timeline position (e.g. 9:00am = 540, 2:30pm = 870). Only set when scheduling for today with a known time."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "decompose_task",
            "description": (
                "Break a task into an internal dependency graph of small doable steps and pick the first chunk. "
                "Use when Wai asks to break a task down, says it feels too big / overwhelming, or gives feedback "
                "that reshapes an existing breakdown ('let's do X first', 'skip that part') — calling this again "
                "rebuilds the graph from the card's current state. The breakdown is internal: tell Wai only the "
                "first chunk, never the whole list. Not for reminders, events, or books."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "feedback": {"type": "string", "description": "Wai's feedback to incorporate when rebuilding ('do X first', 'no time for the Y part'). Omit on first decomposition."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "record_consequences",
            "description": (
                "Store Wai's answer to 'what happens if this doesn't get done?'. "
                "MUST be called before any reschedule of a task with an active nudge loop. "
                "Trigger: Wai pushes back, says they're stuck, overwhelmed, or has no time — ask the consequences "
                "question FIRST, then call this with the answer. After it returns, apply gentle pushback and offer "
                "exactly: try a smaller step now, reschedule, or drop it."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "consequence": {"type": "string", "description": "Wai's stated consequence if the task doesn't get done."},
                },
                "required": ["id", "consequence"],
            },
        },
        {
            "name": "reschedule_after_consequences",
            "description": (
                "The ONLY way to move an active-nudge task to a later day. Hard-gated: fails unless "
                "record_consequences was called first. Use only after Wai consciously decides moving it is worth it."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "new_date": {"type": "string", "description": "ISO date YYYY-MM-DD to move the task to."},
                },
                "required": ["id", "new_date"],
            },
        },
        {
            "name": "advance_chunk",
            "description": (
                "Mark the current step of a decomposed task as done and surface the next one. "
                "Use when Wai confirms they finished the current chunk ('done', 'did it', 'finished that part'). "
                "Returns the next chunk to mention, or all_steps_done — never archive the card yourself."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "node_id": {"type": "string", "description": "Specific step to mark done. Omit to use the current active step."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "update_context",
            "description": (
                "Add, remove, or replace a long-term fact about Wai in profile.json. "
                "TRIGGER: call immediately whenever Wai uses the word 'remember' or 'don't forget'. "
                "Also call proactively for corrections to existing notes, newly learned preferences, relationship facts, recurring constraints, upcoming events. "
                "Use add for new facts. Use remove to delete an outdated fact. Use replace to correct a stale fact."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["add", "remove", "replace"], "description": "add=new note, remove=delete matching note, replace=remove old + add new."},
                    "note": {"type": "string", "description": "The new fact to store. Required for add and replace."},
                    "match": {"type": "string", "description": "Substring of the existing note to find and remove. Required for remove and replace."},
                },
                "required": ["action"],
            },
        },
    ]


def _dedupe_context(notes: list) -> list:
    import anthropic

    lines = "\n".join(f"{i}. [{n.get('date','')}] {n['note']}" for i, n in enumerate(notes))
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=512,
        messages=[{"role": "user", "content": (
            f"These are long-term memory notes about a person:\n{lines}\n\n"
            "Remove exact or near-duplicate notes, keeping the most recent or most specific version. "
            'Return only the indices to KEEP as JSON: {"keep": [0, 1, ...]}'
        )}],
    )
    try:
        parsed = _parse_json(msg.content[0].text)
        keep = set(parsed.get("keep", range(len(notes))))
    except Exception:
        return notes
    return [n for i, n in enumerate(notes) if i in keep]


def _save_chat(messages: list, stage: str):
    p = DATA_DIR / "chat.json"
    existing = json.loads(p.read_text()) if p.exists() else {}
    incoming_monitor_contents = {
        m.get("content") for m in messages if m.get("role") == "monitor"
    }
    monitor_msgs = [
        m for m in existing.get("messages", [])
        if m.get("role") == "monitor" and m.get("content") not in incoming_monitor_contents
    ]
    p.write_text(json.dumps({
        "messages": list(messages) + monitor_msgs,
        "stage": stage,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


def append_monitor_comment(comment: str):
    p = DATA_DIR / "chat.json"
    data = json.loads(p.read_text()) if p.exists() else {"messages": [], "stage": "planning"}
    data["messages"].append({"role": "monitor", "content": comment})
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    p.write_text(json.dumps(data, indent=2))


def get_chat() -> dict:
    p = DATA_DIR / "chat.json"
    return json.loads(p.read_text()) if p.exists() else {"messages": [], "stage": "planning"}
