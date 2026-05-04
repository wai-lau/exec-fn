import json
from datetime import datetime, timezone

from helpers import DATA_DIR, _load_json, _load_rd, _now_et, get_rd_log, _parse_json, ET


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
        f"- id:{c['id']} [{c.get('size','task')}] {c['title']} ({c.get('category','')}): {c.get('notes','')}"
        for c in selected
    ) or "None."
    ideas_text = "\n".join(
        f"- id:{c['id']} [{c.get('size','task')}] {c['title']} ({c.get('category','')}): {c.get('notes','')}"
        for c in ideas[:15]
    ) or "None."

    from datetime import date, timedelta
    week_days = [(date.today() + timedelta(days=i)).isoformat() for i in range(7)]
    scheduled_cards = [c for c in cards if c.get("scheduled_day") in week_days]
    scheduled_text = "\n".join(
        f"- {c.get('scheduled_day')} id:{c['id']} [{c.get('size','task')}] {c['title']}"
        for c in sorted(scheduled_cards, key=lambda x: x.get("scheduled_day", ""))
    ) or "None."

    stage_instructions = {
        "planning": (
            "Help Wai select tasks for today from the ideas pool or confirm existing selected tasks. "
            "Consider their available time and energy. Make specific suggestions with card IDs. "
            "Book category cards are for reading only — do NOT select them for directives. "
            "You can manage cards freely: create_card (new idea), move_card (change column), update_card (edit fields or add progress notes). "
            "When Wai mentions working on, making progress on, or completing part of a task, call update_card with a timestamped note appended to the notes field. "
            "COLUMN SEMANTICS: rd=upcoming ideas/backlog (card added here by default). hq=should be scheduled within remaining time today (active working set). archives=task completed. exile=wont-do. "
            "Use move_card to archive completed tasks or exile dropped ones without being asked twice. "
            "Keep responses concise — this is a planning terminal, not a chat app."
        ),
        "done": "The plan has been finalized. Wrap up warmly. No more actions needed.",
    }

    now = _now_et()
    today_str = f"{now.strftime('%A, %B')} {now.day}, {now.year} {now.strftime('%H:%M')} ET"
    return (
        f"Your name is Exec. You are Wai's personal AI planning assistant. Wai has ADHD and uses this tool daily for executive function.\n"
        f"TODAY: {today_str}\n"
        f"FORMATTING: Markdown is allowed. Do not use Unicode emoji.\n"
        f"Never expose raw card IDs or internal formats in your responses — refer to tasks by title only.\n"
        f"CRITICAL: When calling any tool that takes a card id, you MUST use ONLY the exact ids listed in CURRENTLY SELECTED TASKS or IDEAS POOL. Never invent, guess, or construct card ids. If you cannot find the card in the lists, say so.\n"
        f"Never state that a card is selected or on the active board unless it appears under CURRENTLY SELECTED TASKS. Do not invent or assume task status.\n"
        f"CRITICAL: NEVER describe taking an action without calling the tool. If you say you will create a card, move a card, update context, or do anything else — you MUST call the tool in that same response. Describing the action is not the action.\n"
        f"CRITICAL: When Wai says 'remember [X]' or 'don't forget [X]', immediately call update_context with action=add and note=[X]. No exceptions.\n\n"
        f"STAGE: {stage.upper()}\n"
        f"INSTRUCTION: {stage_instructions.get(stage, stage_instructions['planning'])}\n\n"
        f"ACTIVITY LOG (today):\n{rd_log_text}\n\n"
        f"CURRENTLY SELECTED TASKS:\n{selected_text}\n\n"
        f"IDEAS POOL (top 15):\n{ideas_text}\n\n"
        f"7-DAY SCHEDULE (scheduled_day assignments this week):\n{scheduled_text}\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}"
    )


def _chat_tools() -> list:
    return [
        {
            "name": "create_card",
            "description": "Add a new card to the r&d ideas pool. Use when Wai mentions a new project or task idea. Also use to create new tasks from delta notes (set column=hq for tasks to do today/tomorrow). Set due_date when you can reasonably infer it.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short title for the card."},
                    "category": {"type": "string", "enum": ["Hobby", "Interfacing", "Social", "Self", "Book"], "description": "Interfacing=admin/home/parents/partner/work; Hobby=crafts/art/gaming; Social=events/friends; Self=self-care/wellness/improvement; Book=reading/studying."},
                    "size": {"type": "string", "enum": ["chore", "task", "project", "titan", "book"], "description": "Size: chore (<45min), task (<3h), project (<6h), titan (6h+), book (long read). Omit for reminders."},
                    "notes": {"type": "string", "description": "Optional notes about the card."},
                    "column": {"type": "string", "enum": ["rd", "hq"], "description": "rd=ideas pool (default), hq=active today."},
                    "estimated_time": {"type": "integer", "description": "Estimated duration in minutes. Auto-populated from size if omitted. Omit for reminders."},
                    "due_date": {"type": "string", "description": "ISO date/datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM) by which the task must be done. Infer from context when possible."},
                    "is_reminder": {"type": "boolean", "description": "True for calendar reminders — no action needed, no size or estimated_time."},
                    "is_event": {"type": "boolean", "description": "True when the card is a fixed, immovable occurrence — it happens at a specific time regardless of whether Wai acts (e.g. party, concert, flight, show, sports game, wedding, scheduled call). These do NOT carry over if missed. False for tasks and todos that Wai controls the timing of (e.g. 'fix the bug', 'call mom', 'read chapter 3')."},
                },
                "required": ["title", "category"],
            },
        },
        {
            "name": "move_card",
            "description": "Move a card to a different column. Use to archive completed tasks, exile irrelevant ones, or pull ideas into the active pool.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "column": {"type": "string", "enum": ["rd", "hq", "archives", "exile"], "description": "rd=ideas pool, hq=today's plan, archives=completed, exile=dropped."},
                },
                "required": ["id", "column"],
            },
        },
        {
            "name": "update_card",
            "description": "Update fields on an existing card. Only include fields that should change. Setting estimated_time auto-updates size if the duration implies a different category. Use notes to record progress when Wai mentions working on or making progress on a task — append a timestamped note, don't overwrite existing notes.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "title": {"type": "string"},
                    "category": {"type": "string", "enum": ["Hobby", "Interfacing", "Social", "Self", "Book"]},
                    "size": {"type": "string", "enum": ["chore", "task", "project", "titan", "book"]},
                    "notes": {"type": "string", "description": "Progress notes. Append timestamped entry when Wai mentions working on or making progress on a task — don't overwrite existing content."},
                    "estimated_time": {"type": "integer", "description": "Estimated duration in minutes. Auto-updates size if the new value implies a different size category."},
                    "due_date": {"type": "string", "description": "ISO date/datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM) by which the task must be done."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "schedule_card",
            "description": "Set (or clear) the scheduled_day on a card to plan it for a specific date. Use during 7-day planning. Pass null to unschedule.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "scheduled_day": {"type": "string", "description": "ISO date YYYY-MM-DD, or null to unschedule."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "reschedule",
            "description": "Regenerate the time-block schedule from the current plan cards, incorporating Wai's feedback.",
            "input_schema": {
                "type": "object",
                "properties": {"feedback": {"type": "string", "description": "Wai's scheduling feedback or constraints (e.g. 'move the dive task to afternoon')."}},
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
        model="claude-haiku-4-5-20251001",
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


def classify_card(title: str) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        messages=[{"role": "user", "content": (
            f'Categorize this personal task for Wai: "{title}"\n\n'
            "Categories (pick one):\n"
            "- Interfacing: personal admin, organization, home improvement, taking care of parents or partner, work, productivity systems, tech tools\n"
            "- Hobby: crafts, creative projects, making things, cosplay, gaming, art\n"
            "- Social: events, social plans, gatherings, helping friends\n"
            "- Self: self-care, self-improvement, personal wellness, mental health\n"
            "- Book: reading, studying, long-form learning, research\n\n"
            "Sizes (pick one):\n"
            "- chore: under 1 hour\n"
            "- task: under 4 hours\n"
            "- book: ongoing read / long-form written work\n"
            "- project: under 2 days\n"
            "- titan: longer — reminder to break it down further\n\n"
            'JSON only: {"category": "...", "size": "..."}'
        )}],
    )
    try:
        parsed = _parse_json(msg.content[0].text)
    except Exception:
        parsed = {}
    return {
        "category": parsed.get("category", "Self"),
        "size": parsed.get("size", "task"),
    }


def parse_date_natural(text: str, size: str | None = None, estimated_minutes: int | None = None) -> tuple[str | None, str | None]:
    import anthropic
    now = datetime.now(ET)
    today = now.strftime("%Y-%m-%d %H:%M")
    duration_hint = ""
    if estimated_minutes:
        duration_hint = f" The task takes ~{estimated_minutes} minutes."
    elif size:
        size_map = {"chore": 30, "task": 90, "project": 240, "titan": 480, "book": 60}
        mins = size_map.get(size)
        if mins:
            duration_hint = f" The task size is '{size}' (~{mins} minutes)."
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=64,
        system=(
            f"Now is {today} ET.{duration_hint} "
            "Parse the due date from user input. "
            "All dates MUST be in the future (after today). If a relative term like 'this weekend' or 'Monday' refers to a date already passed, use the NEXT occurrence. "
            "Reply with ONLY one ISO 8601 string: the due date/datetime. "
            "Use YYYY-MM-DD or YYYY-MM-DDTHH:MM format. Reply 'null' if not applicable."
        ),
        messages=[{"role": "user", "content": text}],
    )
    import re as _re
    _iso_pat = _re.compile(r'^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$')

    def _valid(s: str) -> str | None:
        s = s.strip()
        return s if s and s != "null" and _iso_pat.match(s) else None

    lines = msg.content[0].text.strip().splitlines()
    due = _valid(lines[0]) if lines else None
    return due


def _save_chat(messages: list, stage: str):
    p = DATA_DIR / "chat.json"
    existing = json.loads(p.read_text()) if p.exists() else {}
    monitor_msgs = [m for m in existing.get("messages", []) if m.get("role") == "monitor"]
    p.write_text(json.dumps({
        "messages": messages + monitor_msgs,
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
