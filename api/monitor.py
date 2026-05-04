import json
from datetime import datetime, timezone

import anthropic

from helpers import _load_json, _load_rd, _now_et, _ACTIVITY_LOG


async def generate_encouragement(batch_start_ts: float) -> str:
    cutoff = datetime.fromtimestamp(batch_start_ts, tz=timezone.utc)

    log = json.loads(_ACTIVITY_LOG.read_text()) if _ACTIVITY_LOG.exists() else []
    recent = []
    for e in log:
        try:
            ts = datetime.fromisoformat(e.get("ts", ""))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts >= cutoff:
                recent.append(e)
        except Exception:
            pass

    if not recent:
        return ""

    ctx = _load_json("profile", {"notes": []})
    rd = _load_rd()
    plan = _load_json("plan", {})

    ctx_text = (
        "\n".join(f"- [{n.get('date','')}] {n['note']}" for n in ctx.get("notes", []))
        or "None."
    )
    cards = rd.get("cards", [])
    hq = sorted([c for c in cards if c.get("column") == "hq"], key=lambda c: c.get("order", 0))
    hq_text = (
        "\n".join(
            f"- {c['title']}" + (f": {c.get('notes','')[:120]}" if c.get("notes") else "")
            for c in hq
        )
        or "None."
    )
    sched = plan.get("schedule", [])
    sched_text = (
        "\n".join(f"- {s.get('time','?')}: {s.get('task','?')}" for s in sched) or "None."
    )

    src_labels = {
        "core": "kanban", "dirs": "directives", "prof": "prophecies", "Exec": "Exec chat"
    }
    lines = []
    for e in recent:
        src = src_labels.get(e.get("source", ""), e.get("source", ""))
        line = f"- [{src}] {e['action']} '{e['title']}'"
        if e["action"] == "moved":
            line += f" ({e.get('from_col','?')} -> {e.get('to_col','?')})"
        elif e["action"] == "rescheduled":
            line += f" ({e.get('from_day') or 'unscheduled'} -> {e.get('to_day') or 'unscheduled'})"
        elif e["action"] == "revived":
            line += f" (recurring — next: {e.get('next_due','')})"
        lines.append(line)
    activity_text = "\n".join(lines)

    now = _now_et()
    today_str = f"{now.strftime('%A, %B')} {now.day}, {now.year} {now.strftime('%H:%M')} ET"

    system = (
        "Your name is Exec. You are Wai's personal AI planning assistant. Wai has ADHD.\n"
        f"TODAY: {today_str}\n"
        "FORMATTING: Markdown is allowed. Do not use Unicode emoji.\n\n"
        "You are passively monitoring Wai's activity across all views (kanban, directives, prophecies). "
        "Based on the recent changes below, write ONE brief encouraging comment (1-3 sentences) "
        "that is SPECIFIC to what Wai just did. "
        "Celebrate completions (moved to archives). Acknowledge picking up a task (moved to hq). "
        "Notice scheduling work (rescheduled in prophecies). Recognize progress notes (updated). "
        "Acknowledge exiling something (moved to exile — letting go is a valid choice). "
        "Be warm, genuine, specific. Not generic, not sycophantic. "
        "Do not ask questions. Do not suggest what to do next. Just recognize the work.\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}\n\n"
        f"CURRENTLY SELECTED TASKS (hq):\n{hq_text}\n\n"
        f"TODAY'S SCHEDULE:\n{sched_text}"
    )

    client = anthropic.AsyncAnthropic()
    msg = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=200,
        system=system,
        messages=[{"role": "user", "content": f"Recent activity:\n{activity_text}"}],
    )
    return msg.content[0].text
