import json
import time
import asyncio
from datetime import datetime, timezone

import anthropic

from helpers import _load_json, _load_rd, _now_et, _ACTIVITY_LOG
from monitor_sse import push_to_monitor
from chat import append_monitor_comment, EXEC_VOICE

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
    elif e["action"] == "updated" and e.get("is_book") and e.get("current_page") is not None:
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
    books = [c for c in cards if c.get("is_book") and c.get("column") not in ("archives", "exile")]
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


def _is_commentable(e: dict) -> bool:
    if e.get("is_reminder"):
        return False
    action = e.get("action", "")
    if action == "moved" and e.get("to_col") in ("archives", "exile"):
        return True
    if action == "updated" and e.get("is_book"):
        return True
    return False


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
        f"{EXEC_VOICE}\n"
        f"TODAY: {today_str}\n"
        "FORMATTING: Markdown is allowed. Do not use Unicode emoji.\n\n"
        "You are watching Wai work. Based on the recent activity, write a brief unsolicited comment in your voice — a backhanded observation, not encouragement.\n\n"
        "COLUMN SEMANTICS (do not mention these names in your response):\n"
        "- hq = Wai's active working set, things they're committing to today\n"
        "- archives = completed\n"
        "- exile = intentionally dropped / won't do\n\n"
        "RULES:\n"
        "- NEVER describe what happened mechanically. Never say 'moved to', 'added to hq', 'archived', or mention column names.\n"
        "- Speak to the *meaning*: finishing something, committing to tackle something today, letting something go, making reading progress.\n"
        "- Comment on ALL significant actions — group related ones into a sentence, give separate sentences for unrelated ones.\n"
        "- A real win earns a grudging, backhanded acknowledgment; a dropped task earns a dry, clinical note. Specific > generic. Stay deadpan; the help underneath is real.\n"
        "- Do not ask questions. Do not suggest next steps.\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}\n\n"
        f"CURRENTLY SELECTED TASKS (hq):\n{hq_text}\n\n"
        f"BOOKS IN PROGRESS:\n{books_text}\n\n"
        f"TODAY'S SCHEDULE:\n{sched_text}"
    )

    client = anthropic.AsyncAnthropic()
    msg = await client.messages.create(
        model="claude-opus-4-8",
        max_tokens=200,
        system=system,
        messages=[{"role": "user", "content": f"Recent activity:\n{activity_text}"}],
    )
    return msg.content[0].text


# ── debounce runtime ────────────────────────────────────────────────────────
# Trailing 60s debounce so a burst of card moves yields one warm comment, plus
# a flush path the UI can hit to fire immediately. State lives here (not main)
# so the whole monitor lives under one name.

_monitor_task: asyncio.Task | None = None
_SIGNIFICANT_TO_COLS = {"archives", "exile"}


def _init_monitor_ts() -> float:
    if not _ACTIVITY_LOG.exists():
        return time.time()
    try:
        log = json.loads(_ACTIVITY_LOG.read_text())
        if log:
            ts = datetime.fromisoformat(log[-1].get("ts", ""))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return ts.timestamp()
    except Exception:
        pass
    return time.time()


_monitor_last_comment_ts: float = _init_monitor_ts()


def _entry_is_significant(e: dict) -> bool:
    if e.get("is_reminder"):
        return False
    action = e.get("action", "")
    if action == "moved" and e.get("to_col") in _SIGNIFICANT_TO_COLS:
        return True
    if action == "updated" and e.get("is_book"):
        return True
    return False


def schedule_monitor() -> None:
    """Trailing debounce: each call resets the 60s timer."""
    global _monitor_task
    if _monitor_task and not _monitor_task.done():
        _monitor_task.cancel()
    _monitor_task = asyncio.create_task(_run_monitor())


async def _run_monitor(delay: float = 60.0) -> None:
    global _monitor_last_comment_ts
    try:
        await asyncio.sleep(delay)
    except asyncio.CancelledError:
        return
    try:
        capture_ts = _monitor_last_comment_ts
        if not any(_is_commentable(e) for e in _recent_entries(capture_ts)):
            return
        _monitor_last_comment_ts = time.time()
        await push_to_monitor({"thinking": True})
        comment = await generate_encouragement(capture_ts)
        await push_to_monitor({"thinking": False})
        if not comment:
            return
        append_monitor_comment(comment)
        await push_to_monitor({"comment": comment})
    except Exception as e:
        print(f"[monitor] error: {e}")
        await push_to_monitor({"thinking": False})


async def flush_monitor() -> dict:
    """Fire the monitor now if significant activity exists since the last
    comment (bypasses the 60s debounce). Returns {ok, fired}."""
    global _monitor_task
    cutoff = datetime.fromtimestamp(_monitor_last_comment_ts or 0, tz=timezone.utc)
    log = json.loads(_ACTIVITY_LOG.read_text()) if _ACTIVITY_LOG.exists() else []
    has_new = False
    for e in log:
        try:
            ts = datetime.fromisoformat(e.get("ts", ""))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts >= cutoff and _entry_is_significant(e):
                has_new = True
                break
        except Exception:
            pass
    if not has_new:
        return {"ok": True, "fired": False}
    if _monitor_task and not _monitor_task.done():
        _monitor_task.cancel()
    _monitor_task = asyncio.create_task(_run_monitor(delay=0))
    return {"ok": True, "fired": True}
