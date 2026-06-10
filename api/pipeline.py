import json
import re
from datetime import datetime, timezone

from helpers import (
    DATA_DIR, _now_et, _parse_json,
    _RD_LOG,
)
from chat import _dedupe_context


# ── schedule generation ───────────────────────────────────────────────────────

def _cards_text(seek: list, hack: list, dive: list) -> str:
    lines = []
    for cat, cards in [("SEEK", seek), ("HACK", hack), ("DIVE", dive)]:
        for c in cards:
            if isinstance(c, dict):
                time_hint = f", ~{c['estimated_time']}min" if c.get("estimated_time") else ""
                lines.append(f"{cat} [{c.get('size','task')}] {c.get('title','')} (id:{c.get('id','')}){time_hint}")
            else:
                lines.append(f"{cat} {c}")
    return "\n".join(lines) or "None."


def _generate_schedule(seek: list, hack: list, dive: list, events: list, delta_text: str, feedback: str = "", extra_hq: list | None = None) -> list:
    import anthropic

    now_et = _now_et()
    today_dow = now_et.strftime("%A")
    current_time = now_et.strftime("%H:%M")
    junni = "- 08:10–08:45: Drive Junni to work (fixed)\n" if today_dow in ("Tuesday", "Wednesday", "Friday") else ""

    cards = _cards_text(seek, hack, dive)
    extra_hq_text = ""
    if extra_hq:
        extra_lines = []
        for c in extra_hq:
            if isinstance(c, dict):
                time_hint = f", ~{c['estimated_time']}min" if c.get("estimated_time") else ""
                extra_lines.append(f"HQ [{c.get('size','task')}] {c.get('title','')} (id:{c.get('id','')}){time_hint}")
        if extra_lines:
            extra_hq_text = "\n\nADDITIONAL HQ TASKS (schedule if time allows):\n" + "\n".join(extra_lines)

    events_text = "\n".join(
        f"- [event_id:{e.get('event_id','')}] {e.get('title','')} ({e.get('date','')})" for e in events
    ) or "None."
    action = "Reschedule the remaining" if feedback else "Generate a time-blocked schedule for"

    prompt = (
        f"{action} tasks for Wai's day ({today_dow}). Current time: {current_time}.\n\n"
        f"TASKS:\n{cards}{extra_hq_text}\n\n"
        f"CALENDAR EVENTS:\n{events_text}\n\n"
        f"YESTERDAY'S NOTES:\n{delta_text or 'none'}\n\n"
        f"CONSTRAINTS:\n"
        f"- Start at or after {current_time}, rounded to :00 :15 :30 or :45\n"
        f"- All times on :00 :15 :30 :45\n"
        f"- Last task must end by 01:00\n"
        f"{junni}"
        f"- Lunch 11:30–12:30 (skip if past 13:00)\n"
        f"- Dinner 19:00–20:00 (skip if past 20:00)\n"
        f"- SIZE→DURATION: chore=30min, task=90min, project=240min, titan=480min, book=60min; use ~Nmin hint if provided\n"
        "- 15min gap between tasks; group SEEK tasks if possible\n"
        "- Do NOT add buffer, wake, wind-down, sleep, or reading entries\n"
        "- Do NOT schedule book/reading tasks\n"
        f"- ONLY schedule tasks from TASKS above — use their exact card_id\n"
        f"- TASKS are listed in priority order — schedule higher-priority tasks earlier\n"
        f"- Calendar events: include using their event_id, set card_id to empty string\n"
        + (f"\nWAI'S FEEDBACK:\n{feedback}\n" if feedback else "") +
        '\nJSON array only. The "title" field must be the task name only — do NOT include category or size.\n'
        '[{"time":"HH:MM","card_id":"...","event_id":"","title":"...","duration_min":90,"type":"seek|hack|dive"}, '
        '{"time":"HH:MM","card_id":"","event_id":"gcal-id","title":"...","duration_min":60,"type":"omen"}]'
    )

    client = anthropic.Anthropic()
    raw_text = ""
    try:
        resp = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = resp.content[0].text
        entries = _parse_json(raw_text)
        for entry in entries:
            entry["title"] = re.sub(r'^(SEEK|HACK|DIVE|HQ)\s+\[[^\]]*\]\s*', '', entry.get("title", ""), flags=re.IGNORECASE).strip()
    except Exception as e:
        raise RuntimeError(f"schedule generation failed: {e} | raw: {raw_text[:200]}")

    valid_card_ids = {c["id"] for c in seek + hack + dive + (extra_hq or []) if isinstance(c, dict) and c.get("id")}
    valid_event_ids = {e.get("event_id", "") for e in events if e.get("event_id")}

    result = []
    for entry in entries:
        card_id = entry.get("card_id", "")
        event_id = entry.get("event_id", "")
        if card_id and card_id in valid_card_ids:
            result.append(entry)
        elif event_id and event_id in valid_event_ids:
            result.append(entry)
    return result


# ── morning pipeline ───────────────────────────────────────────────────────────


def _run_step(errors: dict, key: str, fn):
    try:
        return fn()
    except Exception as e:
        errors[key] = str(e)
        return None


def _morning_retrospective(log_entries: list, profile_path) -> None:
    if not log_entries:
        return
    import anthropic
    profile = json.loads(profile_path.read_text()) if profile_path.exists() else {"notes": []}
    existing = "\n".join(f"- [{n.get('date','')}] {n['note']}" for n in profile.get("notes", [])) or "None."
    log_text = "\n".join(
        f"- [{e.get('action','')}] {e.get('title','')} (source: {e.get('source','')})"
        + (f" {e.get('from_col','?')}→{e.get('to_col','?')}" if e.get('action') == 'moved' else "")
        for e in log_entries
    )
    today = _now_et().strftime("%Y-%m-%d")
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=512,
        messages=[{"role": "user", "content": (
            f"Today is {today}. Here is Wai's activity log from the past day:\n{log_text}\n\n"
            f"Existing profile notes:\n{existing}\n\n"
            "Extract 0–3 durable facts about Wai worth remembering long-term — ONLY preferences, relationships, "
            "or recurring habits. NEVER write: appointments, one-time events, upcoming plans, task status, "
            "travel dates, specific dated events, or anything time-bound. If the log only shows routine task "
            "management (creating/moving/archiving cards) with no new behavioral insight, reply with just: none\n"
            "Do NOT already include facts in the existing profile notes. Be ruthlessly selective — "
            "if unsure whether something is durable, omit it. "
            "Reply with one fact per line, plain text, no bullets or numbering."
        )}],
    )
    text = resp.content[0].text.strip()
    if text.lower() == "none" or not text:
        return
    notes = profile.get("notes", [])
    for line in text.splitlines():
        line = line.strip()
        if line:
            notes.append({"date": today, "note": line})
    profile["notes"] = notes
    profile_path.write_text(json.dumps(profile, indent=2))


def _purge_stale_notes(profile_path) -> None:
    if not profile_path.exists():
        return
    import anthropic
    profile = json.loads(profile_path.read_text())
    notes = profile.get("notes", [])
    if not notes:
        return
    today = _now_et().strftime("%Y-%m-%d")
    numbered = "\n".join(f"{i}: [{n.get('date','')}] {n['note']}" for i, n in enumerate(notes))
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=256,
        messages=[{"role": "user", "content": (
            f"Today is {today}. Below are profile notes (numbered 0-based).\n{numbered}\n\n"
            "List the 0-based index numbers of any notes that refer to a specific past event or date that is now over "
            "(e.g. appointments, birthdays that already passed this year, one-time events). "
            "Do NOT remove durable facts (preferences, relationships, recurring info). "
            "Reply with ONLY comma-separated numbers, or 'none'."
        )}],
    )
    text = resp.content[0].text.strip().lower()
    if text == "none" or not text:
        return
    to_remove = set()
    for part in text.split(","):
        part = part.strip()
        if part.isdigit():
            to_remove.add(int(part))
    if not to_remove:
        return
    profile["notes"] = [n for i, n in enumerate(notes) if i not in to_remove]
    profile_path.write_text(json.dumps(profile, indent=2))


def _roll_and_schedule(cards: list, today_iso: str) -> set:
    """Roll past-dated scheduled_day forward; auto-schedule rd cards due
    within the 6-day window (rd->hq) on their due day. Returns ids needing
    a today restack."""
    from scheduler import schedule_to_day
    restack: set[str] = set()
    for c in cards:
        sd = c.get("scheduled_day")
        if sd and sd < today_iso and c.get("column") in ("rd", "hq") and not c.get("is_event"):
            c["scheduled_day"] = today_iso
            restack.add(c["id"])
    for c in cards:
        dd = c.get("due_date")
        if not dd or c.get("scheduled_day") or c.get("column") != "rd" or c.get("is_event"):
            continue
        result = schedule_to_day(c, cards, dd, today_iso=today_iso)
        if result.get("scheduled_day") == today_iso:
            restack.add(c["id"])
    return restack


def build_morning() -> dict:
    chat_path = DATA_DIR / "chat.json"
    profile_path = DATA_DIR / "profile.json"
    old_ctx = DATA_DIR / "context.json"
    if old_ctx.exists() and not profile_path.exists():
        old_ctx.rename(profile_path)

    log_entries = json.loads(_RD_LOG.read_text()) if _RD_LOG.exists() else []

    errors: dict = {}
    _run_step(errors, "retrospective", lambda: _morning_retrospective(log_entries, profile_path))
    _run_step(errors, "recalibrate", lambda: __import__("recalibration").recalibrate(log_entries))
    _run_step(errors, "purge_stale", lambda: _purge_stale_notes(profile_path))
    _run_step(errors, "gcal_import", lambda: __import__("gcal").import_gcal_cards(days_ahead=14))

    if _RD_LOG.exists():
        archive_name = DATA_DIR / f"activity_log_{_now_et().strftime('%m%d')}.json"
        _RD_LOG.rename(archive_name)
    _RD_LOG.write_text("[]")

    heartbeat_path = DATA_DIR / "moltbook-heartbeat.log"
    if heartbeat_path.exists():
        hb_archive = DATA_DIR / f"moltbook-heartbeat_{_now_et().strftime('%m%d')}.log"
        heartbeat_path.rename(hb_archive)
    heartbeat_path.write_text("")

    from helpers import _load_rd, _save_rd
    from scheduler import layout_day, is_dir_card, AUTOSTACK_ANCHOR
    today_iso = _now_et().strftime("%Y-%m-%d")
    rd = _load_rd()
    cards = rd.get("cards", [])
    restack = _roll_and_schedule(cards, today_iso)
    # Restack carryover + any today card missing a position; preserve pre-placed today cards.
    restack |= {c["id"] for c in cards if is_dir_card(c, today_iso) and c.get("dir_start_min") is None}
    layout_day(cards, anchor_min=AUTOSTACK_ANCHOR, today_iso=today_iso, only_ids=restack)
    from nudge import morning_reconcile
    morning_reconcile(cards, today_iso)
    _save_rd(rd)

    if chat_path.exists():
        chat_path.unlink()

    if profile_path.exists():
        ctx = json.loads(profile_path.read_text())
        if len(ctx.get("notes", [])) > 1:
            ctx["notes"] = _dedupe_context(ctx["notes"])
            profile_path.write_text(json.dumps(ctx, indent=2))

    result = {"generated_at": datetime.now(timezone.utc).isoformat()}
    if errors:
        result["errors"] = errors
    return result
