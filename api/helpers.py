import json
import re
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DATA_DIR = Path("/app/data")

# Duration comes only from estimated_time; when absent, fall back to this flat
# default. Importance (size) is never mapped to a duration.
_DEFAULT_MINUTES = 90


def _now_et() -> datetime:
    return datetime.now(ET).replace(tzinfo=None)


def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _today() -> str:
    return date.today().strftime("%Y%m%d")


def _rollover_cutoff() -> datetime:
    """Most recent 4:30 AM ET expressed as a naive UTC datetime."""
    now_et = datetime.now(ET)
    cutoff_et = now_et.replace(hour=4, minute=30, second=0, microsecond=0)
    if now_et < cutoff_et:
        cutoff_et -= timedelta(days=1)
    return cutoff_et.astimezone(timezone.utc).replace(tzinfo=None)


def _day_window() -> tuple[datetime, datetime]:
    """(yesterday 4:30 AM ET, now) as naive UTC datetimes."""
    day_start = _rollover_cutoff() - timedelta(days=1)
    day_end = datetime.now(timezone.utc).replace(tzinfo=None)
    return day_start, day_end


def _parse_file_ts(stem: str) -> datetime | None:
    try:
        parts = stem.split("_")
        return datetime.strptime(f"{parts[-2]}_{parts[-1]}", "%Y%m%d_%H%M%S")
    except Exception:
        return None


def _parse_json(text: str) -> dict | list:
    """Extract and parse the first JSON object or array from a string."""
    raw = re.sub(r'^```\w*\n?', '', text.strip())
    raw = re.sub(r'\n?```$', '', raw).strip()
    decoder = json.JSONDecoder()
    for i, ch in enumerate(raw):
        if ch in ('{', '['):
            try:
                val, _ = decoder.raw_decode(raw, i)
                return val
            except json.JSONDecodeError:
                continue
    raise ValueError(f"No JSON found in: {text[:200]}")


_json_cache: dict[str, tuple[float, object]] = {}


def _load_json(name: str, default=None):
    p = DATA_DIR / f"{name}.json"
    if not p.exists():
        return default if default is not None else {}
    mtime = p.stat().st_mtime
    cached = _json_cache.get(name)
    if cached and cached[0] == mtime:
        return cached[1]
    data = json.loads(p.read_text())
    _json_cache[name] = (mtime, data)
    return data


def _load_rd() -> dict:
    return _load_json("rd", {"columns": ["rd", "hq", "archives", "exile"], "cards": []})


def _save_rd(rd: dict):
    (DATA_DIR / "rd.json").write_text(json.dumps(rd, indent=2))


def _find_card(rd: dict, card_id: str) -> dict | None:
    return next((c for c in rd.get("cards", []) if c["id"] == card_id), None)


_ACTIVITY_LOG = DATA_DIR / "activity_log.json"
_RD_LOG = _ACTIVITY_LOG  # alias kept for pipeline.py archival


def _append_rd_log(action: str, title: str, source: str = "rd", **extra):
    _append_rd_log_batch([{"action": action, "title": title, "source": source, **extra}])


def _append_rd_log_batch(entries: list[dict]):
    if not entries:
        return
    log = json.loads(_ACTIVITY_LOG.read_text()) if _ACTIVITY_LOG.exists() else []
    now = datetime.now(timezone.utc).isoformat()
    for e in entries:
        log.append({"ts": now, **e})
    _ACTIVITY_LOG.write_text(json.dumps(log[-500:]))


def get_rd_log(limit: int = 20, source: str | None = None) -> list:
    if not _ACTIVITY_LOG.exists():
        return []
    log = json.loads(_ACTIVITY_LOG.read_text())
    if source:
        log = [e for e in log if e.get("source") == source]
    return log[-limit:][::-1]


def _advance_recurrence(d: date, recur_type: str) -> date | None:
    """Advance a date by one recurrence step. None for unknown type."""
    if recur_type == "week":
        return d + timedelta(days=7)
    if recur_type == "bi-week":
        return d + timedelta(days=14)
    if recur_type == "month":
        month = d.month + 1 if d.month < 12 else 1
        year = d.year if d.month < 12 else d.year + 1
        import calendar as _cal
        last_day = _cal.monthrange(year, month)[1]
        return date(year, month, min(d.day, last_day))
    if recur_type in ("holiday", "birthday"):
        try:
            return date(d.year + 1, d.month, d.day)
        except ValueError:
            return date(d.year + 1, d.month, 28)
    return None


def _next_recurrence(due_iso: str, recur_type: str, today: date | None = None) -> str | None:
    """Next ISO date for a recurring card.

    Advances one step from the card's due_date (or today, if it has no
    parseable due_date), then keeps stepping until the result is strictly
    in the future — so a card archived late lands on its next upcoming
    occurrence instead of staying overdue.
    """
    if today is None:
        today = _now_et().date()
    try:
        base = date.fromisoformat((due_iso or "")[:10])
    except Exception:
        base = today
    nxt = _advance_recurrence(base, recur_type)
    if nxt is None:
        return None
    guard = 0
    while nxt <= today and guard < 1000:
        stepped = _advance_recurrence(nxt, recur_type)
        if stepped is None or stepped == nxt:
            break
        nxt = stepped
        guard += 1
    return nxt.isoformat()


def _apply_context_update(action: str, note: str = "", match: str = "") -> dict:
    ctx_path = DATA_DIR / "profile.json"
    ctx = json.loads(ctx_path.read_text()) if ctx_path.exists() else {"notes": []}
    notes = ctx.get("notes", [])

    if action == "add":
        if not note.strip():
            return {"error": "note required for add"}
        existing = {n["note"].strip().lower() for n in notes}
        if note.strip().lower() not in existing:
            notes.append({"date": date.today().isoformat(), "note": note.strip()})
    elif action in ("remove", "replace"):
        if not match.strip():
            return {"error": "match required for remove/replace"}
        before = len(notes)
        notes = [n for n in notes if match.strip().lower() not in n["note"].lower()]
        if len(notes) == before:
            return {"error": f"no note matched: {match!r}"}
        if action == "replace":
            if not note.strip():
                return {"error": "note required for replace"}
            notes.append({"date": date.today().isoformat(), "note": note.strip()})
    else:
        return {"error": f"unknown action: {action}"}

    ctx["notes"] = notes
    ctx_path.write_text(json.dumps(ctx, indent=2))
    return {"ok": True, "action": action, "notes_count": len(notes)}
