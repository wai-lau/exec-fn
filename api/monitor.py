import json
from datetime import datetime, timezone

import anthropic

from helpers import _load_json, _load_rd, _now_et, _ACTIVITY_LOG

_SRC_LABELS = {"core": "kanban", "dirs": "directives", "prof": "prophecies", "Exec": "Exec chat"}


def _recent_entries(batch_start_ts: float) -> list:
    cutoff = datetime.fromtimestamp(batch_start_ts, tz=timezone.utc)
    log = json.loads(_ACTIVITY_LOG.read_text()) if _ACTIVITY_LOG.exists() else []
    out = []
    for e in log:
        try:
            ts = datetime.fromisoformat(e.get("ts", ""))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts >= cutoff:
                out.append(e)
        except Exception:
            pass
    return out


def _entry_line(e: dict) -> str:
    src = _SRC_LABELS.get(e.get("source", ""), e.get("source", ""))
    line = f"- [{src}] {e['action']} '{e['title']}'"
    if e["action"] == "moved":
        line += f" ({e.get('from_col','?')} -> {e.get('to_col','?')})"
    elif e["action"] == "updated" and e.get("size") == "book" and e.get("current_page") is not None:
        tp = e.get("total_pages")
        line += f" — now on page {e['current_page']}" + (f" of {tp}" if tp else "")
    return line


def _build_context() -> tuple[str, str, str, str]:
    ctx = _load_json("profile", {"notes": []})
    rd = _load_rd()
    plan = _load_json("plan", {})
    cards = rd.get("cards", [])

    ctx_text = (
        "\n".join(f"- [{n.get('date','')}] {n['note']}" for n in ctx.get("notes", []))
        or "None."
    )
    hq = sorted([c for c in cards if c.get("column") == "hq"], key=lambda c: c.get("order", 0))
    hq_text = (
        "\n".join(
            f"- {c['title']}" + (f": {c.get('notes','')[:120]}" if c.get("notes") else "")
            for c in hq
        )
        or "None."
    )
    books = [c for c in cards if c.get("size") == "book" and c.get("column") not in ("archives", "exile")]
    books_text = (
        "\n".join(
            f"- {c['title']}" + (f": {c.get('notes','')[:150]}" if c.get("notes") else "")
            for c in books
        )
        or "None."
    )
    sched = plan.get("schedule", [])
    sched_text = "\n".join(f"- {s.get('time','?')}: {s.get('task','?')}" for s in sched) or "None."
    return ctx_text, hq_text, books_text, sched_text


async def generate_encouragement(batch_start_ts: float) -> str:
    recent = _recent_entries(batch_start_ts)
    if not recent:
        return ""

    activity_text = "\n".join(_entry_line(e) for e in recent)
    ctx_text, hq_text, books_text, sched_text = _build_context()

    now = _now_et()
    today_str = f"{now.strftime('%A, %B')} {now.day}, {now.year} {now.strftime('%H:%M')} ET"

    system = (
        "Your name is Exec. You are Wai's personal AI planning assistant. Wai has ADHD.\n"
        f"TODAY: {today_str}\n"
        "FORMATTING: Markdown is allowed. Do not use Unicode emoji.\n\n"
        "You are watching Wai work. Based on the recent activity, write a brief encouraging comment.\n\n"
        "COLUMN SEMANTICS (do not mention these names in your response):\n"
        "- hq = Wai's active working set, things they're committing to today\n"
        "- archives = completed\n"
        "- exile = intentionally dropped / won't do\n\n"
        "RULES:\n"
        "- NEVER describe what happened mechanically. Never say 'moved to', 'added to hq', 'archived', or mention column names.\n"
        "- Speak to the *meaning*: finishing something, committing to tackle something today, letting something go, making reading progress.\n"
        "- Comment on ALL significant actions — group related ones into a sentence, give separate sentences for unrelated ones.\n"
        "- Be warm and human, like a friend noticing good work. Specific > generic.\n"
        "- Do not ask questions. Do not suggest next steps.\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}\n\n"
        f"CURRENTLY SELECTED TASKS (hq):\n{hq_text}\n\n"
        f"BOOKS IN PROGRESS:\n{books_text}\n\n"
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
