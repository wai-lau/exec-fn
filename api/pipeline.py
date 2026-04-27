import json
import re
from datetime import datetime

from helpers import (
    DATA_DIR, _SIZE_MINUTES, _now_et, _parse_json, _load_json, _load_rd, _save_rd,
    get_rd_log, _RD_LOG,
)
from rm import pull_rmdocs, push_pdf
from gcal import analyze_omens
from delta import analyze_delta
from chat import _dedupe_context


# ── rd card management ────────────────────────────────────────────────────────

def _haiku_archive_decision(selected: list, notes: str, carry_ids: set) -> tuple[set, str]:
    import anthropic
    cards_text = "\n".join(f"- id:{c['id']} [{c.get('size','task')}] {c['title']}" for c in selected)
    protect_text = (
        f"\nDo NOT archive these — Wai explicitly said to carry them forward: {', '.join(carry_ids)}\n"
        if carry_ids else ""
    )
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        messages=[{"role": "user", "content": (
            "Based on Wai's day notes, which cards should move to 'archives' (completed or abandoned)?\n\n"
            f"SELECTED CARDS:\n{cards_text}\n{protect_text}\n"
            f"WAI'S NOTES:\n{notes or 'No notes recorded.'}\n\n"
            "Return IDs to archive. If none, return empty list.\n"
            'JSON only: {"move_to_archives": ["id", ...], "summary": "one sentence"}'
        )}],
    )
    try:
        parsed = _parse_json(msg.content[0].text)
    except Exception:
        parsed = {"move_to_archives": []}
    return set(parsed.get("move_to_archives", [])) - carry_ids, parsed.get("summary", "")


def update_rd_from_delta(delta: dict) -> str:
    """Apply delta: archive completed cards, carry forward incomplete ones, create new tasks."""
    import time as _time

    rd = _load_rd()
    cards_by_id = {c["id"]: c for c in rd.get("cards", [])}
    selected = [c for c in rd.get("cards", []) if c.get("column") == "hq"]
    notes = " ".join(filter(None, [delta.get("wai_notes", ""), delta.get("adjustments", "")])).strip()
    carry_ids = set(delta.get("carry_forward", []))
    summary_parts = []

    if selected:
        archive_ids, summary = _haiku_archive_decision(selected, notes, carry_ids)
        for c in rd.get("cards", []):
            if c["id"] in archive_ids:
                c["column"] = "archives"
        if archive_ids:
            summary_parts.append(f"archived {len(archive_ids)}")
        if summary:
            summary_parts.append(summary)

    for card_id in carry_ids:
        card = cards_by_id.get(card_id)
        if card and card.get("column") != "hq":
            card["column"] = "hq"
            summary_parts.append(f"carried forward: {card['title']}")

    cards = rd.get("cards", [])
    for title in delta.get("new_tasks", []):
        title = title.strip()
        if not title:
            continue
        min_order = min((c.get("order", 0) for c in cards if c.get("column") == "hq"), default=0)
        cards.append({
            "id": f"card-{int(_time.time() * 1000)}",
            "title": title,
            "category": "Self",
            "size": "task",
            "description": "",
            "column": "hq",
            "order": min_order - 1,
            "due_date": None,
            "notes": "",
            "estimated_time": _SIZE_MINUTES.get("task", 90),
        })
        summary_parts.append(f"created: {title}")

    rd["cards"] = cards
    _save_rd(rd)
    return "; ".join(summary_parts) if summary_parts else "no changes"


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
    try:
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        entries = _parse_json(resp.content[0].text)
        for entry in entries:
            entry["title"] = re.sub(r'^(SEEK|HACK|DIVE|HQ)\s+\[[^\]]*\]\s*', '', entry.get("title", ""), flags=re.IGNORECASE).strip()
    except Exception:
        return []

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

def generate_morning_recap(delta: dict, omens: dict, rd_changes: str, rd_log: list | None = None) -> dict:
    import anthropic

    ctx = _load_json("profile", {"notes": []})
    ctx_text = "\n".join(
        f"- [{n.get('date','')}] {n['note']}" for n in ctx.get("notes", [])[-15:]
    ) or "None."

    rd = _load_rd()
    cards = rd.get("cards", [])
    selected = sorted([c for c in cards if c.get("column") == "hq"], key=lambda c: c.get("order", 0))
    ideas = sorted([c for c in cards if c.get("column") == "rd"], key=lambda c: c.get("order", 0))

    selected_text = "\n".join(f"- [{c.get('size','task')}] {c['title']}" for c in selected) or "None."
    ideas_text = "\n".join(
        f"- [{c.get('size','task')}] {c['title']} ({c.get('category','')})" for c in ideas[:15]
    ) or "None."
    events_text = "\n".join(f"- {e['title']} ({e.get('date','?')})" for e in omens.get("events", [])) or "None."

    log_entries = "\n".join(
        f"- {e['action']} '{e['title']}'" + (f" ({e.get('from_col','?')} → {e.get('to_col','?')})" if e['action'] == 'moved' else "")
        for e in (rd_log or [])
    )
    rd_log_text = f"R&D ACTIVITY LOG (today):\n{log_entries}\n\n" if rd_log else ""

    prompt = (
        "Generate a morning briefing for Wai's planning terminal. Be terse. Use lists. No prose except the final question.\n\n"
        f"YESTERDAY — what Wai wrote/did:\n{delta.get('wai_notes', 'No annotations recorded.')}\n\n"
        f"YESTERDAY — adjustments for today:\n{delta.get('adjustments', 'None.')}\n\n"
        f"R&D CHANGES APPLIED:\n{rd_changes or 'None.'}\n\n"
        f"{rd_log_text}"
        f"CURRENTLY SELECTED:\n{selected_text}\n\n"
        f"IDEAS POOL:\n{ideas_text}\n\n"
        f"UPCOMING EVENTS:\n{events_text}\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}\n\n"
        "Output format (use exactly this structure, plain text):\n\n"
        "yesterday\n"
        "- [bullet per notable thing done or noted, use real task names, skip if nothing]\n\n"
        "carrying forward\n"
        "- [tasks still selected or recommended from adjustments]\n\n"
        "omens\n"
        "- [time-sensitive events only, skip section if none]\n\n"
        "suggested\n"
        "- [2-3 specific r&d items from ideas pool that fit context and delta]\n\n"
        "[one short human question about today's time and energy — the only sentence that sounds like a person]\n\n"
        "No headers with colons. No markdown. No extra commentary."
    )

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )

    result = {"generated_at": datetime.now().isoformat(), "opening_message": msg.content[0].text.strip()}
    (DATA_DIR / "morning.json").write_text(json.dumps(result, indent=2))
    return result


def build_morning() -> dict:  # noqa: C901
    chat_path = DATA_DIR / "chat.json"
    if chat_path.exists():
        chat_path.unlink()

    if _RD_LOG.exists():
        archive_name = DATA_DIR / f"rd_log_{_now_et().strftime('%m%d')}.json"
        _RD_LOG.rename(archive_name)
    _RD_LOG.write_text("[]")

    profile_path = DATA_DIR / "profile.json"
    old_ctx = DATA_DIR / "context.json"
    if old_ctx.exists() and not profile_path.exists():
        old_ctx.rename(profile_path)

    if profile_path.exists():
        ctx = json.loads(profile_path.read_text())
        if len(ctx.get("notes", [])) > 1:
            ctx["notes"] = _dedupe_context(ctx["notes"])
            profile_path.write_text(json.dumps(ctx, indent=2))

    errors = {}

    latest_path = None
    try:
        latest_path = pull_rmdocs()
    except Exception as e:
        errors["pull"] = str(e)

    delta = {}
    try:
        delta = analyze_delta(path=latest_path)
    except Exception as e:
        errors["delta"] = str(e)

    omens = {}
    try:
        omens = analyze_omens()
    except Exception as e:
        errors["omens"] = str(e)

    rd_changes = ""
    try:
        rd_changes = update_rd_from_delta(delta)
    except Exception as e:
        errors["rd"] = str(e)

    try:
        recap = generate_morning_recap(delta, omens, rd_changes, rd_log=get_rd_log(limit=50))
    except Exception as e:
        errors["recap"] = str(e)
        recap = {"generated_at": datetime.now().isoformat(), "opening_message": ""}

    try:
        push_pdf()
    except Exception as e:
        errors["push_pdf"] = str(e)

    if errors:
        recap["errors"] = errors
        (DATA_DIR / "morning.json").write_text(json.dumps(recap, indent=2))

    return recap
