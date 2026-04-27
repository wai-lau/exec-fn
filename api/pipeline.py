import json
import re
import subprocess
import base64
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DATA_DIR = Path("/app/data")
RM_FOLDER = "/EXEC"

_SIZE_MINUTES: dict[str, int] = {"chore": 30, "task": 90, "project": 240, "titan": 480, "book": 60}

def _minutes_to_size(minutes: int) -> str:
    if minutes <= 45:
        return "chore"
    if minutes <= 165:
        return "task"
    if minutes <= 360:
        return "project"
    return "titan"


# ── time helpers ──────────────────────────────────────────────────────────────

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
    day_end = datetime.utcnow()
    return day_start, day_end


def _parse_file_ts(stem: str) -> datetime | None:
    try:
        parts = stem.split("_")
        return datetime.strptime(f"{parts[-2]}_{parts[-1]}", "%Y%m%d_%H%M%S")
    except Exception:
        return None


# ── json helpers ──────────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict | list:
    """Extract and parse the first JSON object or array from a string."""
    raw = re.sub(r'^```\w*\n?', '', text.strip())
    raw = re.sub(r'\n?```$', '', raw).strip()
    m = re.search(r'(\{[\s\S]*\}|\[[\s\S]*\])', raw)
    if m:
        return json.loads(m.group())
    raise ValueError(f"No JSON found in: {text[:200]}")


def _load_json(name: str, default=None):
    p = DATA_DIR / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else (default if default is not None else {})


def _load_rd() -> dict:
    return _load_json("rd", {"columns": ["rd", "hq", "archives", "exile"], "cards": []})


def _save_rd(rd: dict):
    (DATA_DIR / "rd.json").write_text(json.dumps(rd, indent=2))


def _find_card(rd: dict, card_id: str) -> dict | None:
    return next((c for c in rd.get("cards", []) if c["id"] == card_id), None)


# ── reMarkable helpers ────────────────────────────────────────────────────────

def _rm_list_wai() -> list[str]:
    ls = subprocess.run(["rmapi", "ls", RM_FOLDER], capture_output=True, text=True, timeout=30)
    if ls.returncode != 0:
        return []
    return sorted([
        line.strip().split()[-1]
        for line in ls.stdout.splitlines()
        if line.strip().startswith("[f]") and line.strip().split()[-1].startswith("WAI_")
    ])


def _rm_stat_modified(name: str) -> datetime | None:
    try:
        stat = subprocess.run(
            ["rmapi", "stat", f"{RM_FOLDER}/{name}"],
            capture_output=True, text=True, timeout=15,
        )
        if stat.returncode != 0:
            return None
        data = json.loads(stat.stdout)
        return datetime.fromisoformat(data["ModifiedClient"].replace("Z", ""))
    except Exception:
        return None


def _rm_latest_wai_modified() -> datetime | None:
    names = _rm_list_wai()
    return _rm_stat_modified(names[-1]) if names else None


# ── pull ──────────────────────────────────────────────────────────────────────


def pull_rmdocs() -> str:
    """Pull the latest WAI_* doc, keeping its original rM filename.

    Skips download if the local copy is already up-to-date (mtime >= rM ModifiedClient).
    """
    wai_names = _rm_list_wai()
    if not wai_names:
        raise RuntimeError("No WAI_* document found in EXEC folder on reMarkable")

    latest = wai_names[-1]
    dest = DATA_DIR / f"{latest}.rmdoc"

    if dest.exists():
        modified = _rm_stat_modified(latest)
        if modified is not None:
            file_mtime = datetime.utcfromtimestamp(dest.stat().st_mtime)
            if file_mtime >= modified:
                return str(dest)

    result = subprocess.run(
        ["rmapi", "get", f"{RM_FOLDER}/{latest}"],
        cwd=str(DATA_DIR), capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rmapi get failed: {(result.stderr or result.stdout).strip()}")

    src = DATA_DIR / f"{latest}.rmdoc"
    if not src.exists():
        raise RuntimeError(f"rmapi get succeeded but {latest}.rmdoc not found in data dir")

    return str(dest)


def push_pdf() -> str:
    from build_pdf import build as pdf_build

    pdf_path = DATA_DIR / f"WAI_{_ts()}.pdf"
    pdf_build(str(pdf_path))

    result = subprocess.run(
        ["rmapi", "put", "--force", str(pdf_path), RM_FOLDER],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rmapi put failed: {result.stderr.strip()}")

    return pdf_path.name


# ── archive ───────────────────────────────────────────────────────────────────

def list_archive() -> list:
    import zipfile
    entries = []

    for f in DATA_DIR.glob("WAI_*.rmdoc"):
        mtime = f.stat().st_mtime
        label = datetime.utcfromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        try:
            with zipfile.ZipFile(f) as z:
                uid = [n for n in z.namelist() if n.endswith(".content")][0].replace(".content", "")
                content = json.loads(z.read(f"{uid}.content"))
                pages = (content.get("cPages") or {}).get("pages") or content.get("pages") or []
                page_count = len(pages) or 1
        except Exception:
            page_count = 1
        entries.append({"filename": f.name, "label": label, "pages": page_count, "_mtime": mtime})

    for f in DATA_DIR.glob("delta_*.png"):
        mtime = f.stat().st_mtime
        label = "delta " + datetime.utcfromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        entries.append({"filename": f.name, "label": label, "pages": 1, "_mtime": mtime})

    entries.sort(key=lambda e: e["_mtime"], reverse=True)
    for e in entries:
        del e["_mtime"]
    return entries


# ── delta ─────────────────────────────────────────────────────────────────────

def _delta_prompt() -> str:
    rd = _load_rd()
    omens = _load_json("omens", {}).get("events", [])
    selected = sorted(
        [c for c in rd.get("cards", []) if c.get("column") == "hq"],
        key=lambda c: c.get("order", 0),
    )
    if selected:
        directives_text = "TODAY'S SELECTED TASKS:\n" + "\n".join(
            f"[id:{c['id']}] [{c.get('size', 'task')}] {c['title']}" for c in selected
        )
    else:
        directives_text = "No tasks selected for today."

    omens_text = ""
    if omens:
        omens_text = "\nUPCOMING CALENDAR EVENTS:\n" + "\n".join(
            f"[event_id:{e.get('event_id','')}] {e.get('title','')} ({e.get('date','')})" for e in omens
        )

    ctx = _load_json("context", {"notes": []})
    known = "\n".join(f"- {n['note']}" for n in ctx.get("notes", [])) or "None."

    return (
        f"{directives_text}{omens_text}\n\n"
        "The image shows Wai's reMarkable page. The printed text above was already there. "
        "Any handwritten marks/strokes are Wai's annotations added during the day.\n\n"
        "1. Describe the handwritten annotations (if any visible).\n"
        "2. Based on those, how should tomorrow's plan change?\n"
        "3. Which task IDs or event IDs are referenced in the handwriting? Use exact IDs from the lists above.\n"
        "4. Which tasks from TODAY'S SELECTED TASKS are explicitly NOT done and should carry forward? List their IDs in carry_forward.\n"
        "5. Did Wai write any new tasks to add (things not already in the task list)? List short titles in new_tasks.\n"
        "6. Extract context_updates: long-term facts about Wai to add, remove, or replace. "
        "Each entry: {\"action\": \"add\"|\"remove\"|\"replace\", \"note\": \"new fact\", \"match\": \"substring of old note to remove\"}. "
        "add: new fact not already known. remove: existing note is now wrong (match= substring). replace: update stale fact (both note + match). "
        "Short declarative sentences only. Empty list if nothing new.\n"
        f"ALREADY KNOWN — do not repeat, only update if stale:\n{known}\n\n"
        'JSON only: {"wai_notes": "...", "adjustments": "...", "referenced_cards": ["card-id1"], "referenced_events": ["event_id1"], "carry_forward": ["card-id1"], "new_tasks": ["task title"], "context_updates": [{"action": "add", "note": "..."}]}'
    )


def _wai_files_in_window(start: datetime, end: datetime) -> list[str]:
    files = [
        (mtime, f)
        for f in DATA_DIR.glob("WAI_*.rmdoc")
        if start <= (mtime := datetime.utcfromtimestamp(f.stat().st_mtime)) < end
    ]
    files.sort(key=lambda x: x[0], reverse=True)
    return [str(f) for _, f in files]


def _analyze_wai_doc(wai_path: str) -> dict:
    """Analyze one WAI rmdoc via vision. Cached to delta_wai_{ts}.json."""
    import anthropic
    from rm_to_pdf import rasterize

    stem = Path(wai_path).stem
    ts = stem[len("WAI_"):]
    delta_path = DATA_DIR / f"delta_wai_{ts}.json"

    if delta_path.exists() and delta_path.stat().st_mtime >= Path(wai_path).stat().st_mtime:
        return json.loads(delta_path.read_text())

    png_bytes = rasterize(wai_path, page_index=0)
    b64 = base64.standard_b64encode(png_bytes).decode()
    client = anthropic.Anthropic()

    # Quick marks check with Haiku before running the full Sonnet analysis
    has_marks = True
    try:
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                {"type": "text", "text": "Are there any handwritten marks or annotations in this image? YES or NO only."},
            ]}],
        )
        has_marks = "YES" in resp.content[0].text.upper()
    except Exception:
        pass

    if not has_marks:
        delta = {"analyzed_at": datetime.now().isoformat(), "source_file": stem + ".rmdoc", "wai_notes": "", "adjustments": ""}
        delta_path.write_text(json.dumps(delta, indent=2))
        return delta

    (DATA_DIR / f"delta_wai_{ts}.png").write_bytes(png_bytes)
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
            {"type": "text", "text": _delta_prompt()},
        ]}],
    )

    try:
        parsed = _parse_json(msg.content[0].text)
    except Exception:
        parsed = {"wai_notes": msg.content[0].text, "adjustments": ""}

    delta = {
        "analyzed_at": datetime.now().isoformat(),
        "source_file": stem + ".rmdoc",
        "wai_notes": parsed.get("wai_notes", ""),
        "adjustments": parsed.get("adjustments", ""),
        "referenced_cards": [c for c in parsed.get("referenced_cards", []) if isinstance(c, str)],
        "referenced_events": [e for e in parsed.get("referenced_events", []) if isinstance(e, str)],
        "carry_forward": [c for c in parsed.get("carry_forward", []) if isinstance(c, str)],
        "new_tasks": [t for t in parsed.get("new_tasks", []) if isinstance(t, str) and t.strip()],
    }
    delta_path.write_text(json.dumps(delta, indent=2))

    for u in parsed.get("context_updates", []):
        if isinstance(u, str) and u.strip():
            _apply_context_update("add", note=u)
        elif isinstance(u, dict):
            _apply_context_update(u.get("action", "add"), note=u.get("note", ""), match=u.get("match", ""))

    return delta


def _haiku_merge_deltas(all_notes: list[str], all_adjustments: list[str], all_ref_cards: list | None = None, all_ref_events: list | None = None, all_carry_forward: list | None = None, all_new_tasks: list | None = None) -> dict:
    """Use Haiku to deduplicate and merge multiple delta analyses into one."""
    import anthropic

    merged_notes = "\n\n---\n\n".join(all_notes)
    merged_adj = "\n\n---\n\n".join(filter(None, all_adjustments))
    result = {
        "wai_notes": merged_notes,
        "adjustments": merged_adj,
        "referenced_cards": list({c for lst in (all_ref_cards or []) for c in lst}),
        "referenced_events": list({e for lst in (all_ref_events or []) for e in lst}),
        "carry_forward": list({c for lst in (all_carry_forward or []) for c in lst}),
        "new_tasks": list({t for lst in (all_new_tasks or []) for t in lst}),
    }

    try:
        client = anthropic.Anthropic()
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": (
                "Deduplicate and merge these delta analyses from the same day. "
                "Preserve all distinct observations.\n\n"
                f"WAI_NOTES:\n{merged_notes}\n\n"
                f"ADJUSTMENTS:\n{merged_adj or 'none'}\n\n"
                'JSON only: {"wai_notes": "...", "adjustments": "..."}'
            )}],
        )
        parsed = _parse_json(resp.content[0].text)
        result["wai_notes"] = parsed.get("wai_notes", merged_notes)
        result["adjustments"] = parsed.get("adjustments", merged_adj)
    except Exception:
        pass

    return result


def _merge_day_deltas(day_start: datetime, day_end: datetime) -> dict:
    """Merge all delta_wai_*.json in window → delta_MMDD.json."""
    daily_path = DATA_DIR / f"delta_{day_start.strftime('%m%d')}.json"

    deltas = []
    for f in sorted(DATA_DIR.glob("delta_wai_????????_??????.json")):
        ts = _parse_file_ts(f.stem)
        if ts and day_start <= ts < day_end:
            try:
                deltas.append(json.loads(f.read_text()))
            except Exception:
                pass

    marked = [d for d in deltas if d.get("wai_notes", "").strip()]

    if not marked:
        result = {"analyzed_at": datetime.now().isoformat(), "wai_notes": "", "adjustments": "", "referenced_cards": [], "referenced_events": [], "carry_forward": [], "new_tasks": []}
    elif len(marked) == 1:
        result = {**marked[0], "analyzed_at": datetime.now().isoformat()}
    else:
        notes = [d["wai_notes"] for d in marked]
        adjs = [d.get("adjustments", "") for d in marked]
        ref_cards = [d.get("referenced_cards", []) for d in marked]
        ref_events = [d.get("referenced_events", []) for d in marked]
        carry_fwd = [d.get("carry_forward", []) for d in marked]
        new_tasks = [d.get("new_tasks", []) for d in marked]
        result = {**marked[-1], **_haiku_merge_deltas(notes, adjs, ref_cards, ref_events, carry_fwd, new_tasks), "analyzed_at": datetime.now().isoformat()}

    daily_path.write_text(json.dumps(result, indent=2))
    return result


def _load_daily_delta() -> dict:
    day_start, _ = _day_window()
    return _load_json(f"delta_{day_start.strftime('%m%d')}")


def _load_yesterday_delta() -> dict:
    day_start, _ = _day_window()
    prev_start = day_start - timedelta(days=1)
    return _load_json(f"delta_{prev_start.strftime('%m%d')}")


def _load_all_recent_deltas() -> dict:
    """Merge all today's delta_wai_*.json. Cached to delta_merged.json."""
    day_start, _ = _day_window()
    now = datetime.now()

    files = []
    for f in DATA_DIR.glob("delta_wai_????????_??????.json"):
        try:
            ts = datetime.strptime(f.stem[len("delta_wai_"):], "%Y%m%d_%H%M%S")
        except ValueError:
            continue
        if day_start <= ts <= now:
            files.append((ts, f))

    if not files:
        return _load_daily_delta()

    files.sort(key=lambda x: x[0])
    cache_path = DATA_DIR / "delta_merged.json"
    newest_source = max(f.stat().st_mtime for _, f in files)

    if cache_path.exists() and cache_path.stat().st_mtime >= newest_source:
        return json.loads(cache_path.read_text())

    deltas = [json.loads(f.read_text()) for _, f in files]
    all_notes = [d["wai_notes"] for d in deltas if d.get("wai_notes")]
    all_adjs  = [d.get("adjustments", "") for d in deltas]

    if not all_notes:
        return _load_daily_delta()

    all_ref_cards   = [d.get("referenced_cards", []) for d in deltas]
    all_ref_events  = [d.get("referenced_events", []) for d in deltas]
    all_carry_fwd   = [d.get("carry_forward", []) for d in deltas]
    all_new_tasks   = [d.get("new_tasks", []) for d in deltas]

    if len(all_notes) == 1:
        result = {
            "wai_notes": all_notes[0],
            "adjustments": all_adjs[0] if all_adjs else "",
            "referenced_cards": all_ref_cards[0] if all_ref_cards else [],
            "referenced_events": all_ref_events[0] if all_ref_events else [],
            "carry_forward": all_carry_fwd[0] if all_carry_fwd else [],
            "new_tasks": all_new_tasks[0] if all_new_tasks else [],
        }
    else:
        result = _haiku_merge_deltas(all_notes, all_adjs, all_ref_cards, all_ref_events, all_carry_fwd, all_new_tasks)

    cache_path.write_text(json.dumps(result, indent=2))
    return result


def analyze_delta(path: str = None) -> dict:
    if path is not None:
        return _analyze_wai_doc(path)

    day_start, day_end = _day_window()
    daily_path = DATA_DIR / f"delta_{day_start.strftime('%m%d')}.json"

    if daily_path.exists():
        try:
            existing = json.loads(daily_path.read_text())
            analyzed_at = datetime.fromisoformat(existing["analyzed_at"])
            modified = _rm_latest_wai_modified()
            if modified and analyzed_at > modified:
                return existing
        except Exception:
            pass

    candidates = _wai_files_in_window(day_start, day_end) or [pull_rmdocs()]
    for wai_path in candidates:
        _analyze_wai_doc(wai_path)

    return _merge_day_deltas(day_start, day_end)


def analyze_delta_to_now() -> None:
    """Pull latest rmdoc (if stale) and analyze all WAI files since rollover."""
    day_start, _ = _day_window()
    try:
        pull_rmdocs()
    except Exception:
        pass
    for wai_path in _wai_files_in_window(day_start, datetime.now()):
        _analyze_wai_doc(wai_path)


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
    """Apply delta instructions: archive completed cards, carry forward incomplete ones, create new tasks."""
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

    # Include event_id in events text so Haiku can output it in schedule entries
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

    # Valid IDs for post-processing — no title matching
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
        # else: not in known IDs — drop
    return result


# ── morning pipeline ───────────────────────────────────────────────────────────

def generate_morning_recap(delta: dict, omens: dict, rd_changes: str) -> dict:
    import anthropic

    ctx = _load_json("context", {"notes": []})
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

    prompt = (
        "Generate a morning briefing for Wai's planning terminal. Be terse. Use lists. No prose except the final question.\n\n"
        f"YESTERDAY — what Wai wrote/did:\n{delta.get('wai_notes', 'No annotations recorded.')}\n\n"
        f"YESTERDAY — adjustments for today:\n{delta.get('adjustments', 'None.')}\n\n"
        f"R&D CHANGES APPLIED:\n{rd_changes or 'None.'}\n\n"
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


def build_morning() -> dict:
    chat_path = DATA_DIR / "chat.json"
    if chat_path.exists():
        chat_path.unlink()

    ctx_path = DATA_DIR / "context.json"
    if ctx_path.exists():
        ctx = json.loads(ctx_path.read_text())
        if len(ctx.get("notes", [])) > 1:
            ctx["notes"] = _dedupe_context(ctx["notes"])
            ctx_path.write_text(json.dumps(ctx, indent=2))

    latest_path = pull_rmdocs()
    delta = analyze_delta(path=latest_path)
    omens = analyze_omens()
    rd_changes = update_rd_from_delta(delta)
    recap = generate_morning_recap(delta, omens, rd_changes)
    push_pdf()
    return recap


# ── gcal auth ─────────────────────────────────────────────────────────────────

GCAL_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
GCAL_CONFIG_DIR = Path("/root/.config/gcal")
GCAL_TOKEN_PATH = GCAL_CONFIG_DIR / "token.json"
GCAL_CREDS_PATH = GCAL_CONFIG_DIR / "credentials.json"
GCAL_REDIRECT_URI = "https://wai-lau.net/api/gcal/callback"
_gcal_pending_state: dict = {}


def gcal_start_auth() -> str:
    from google_auth_oauthlib.flow import Flow

    if not GCAL_CREDS_PATH.exists():
        raise RuntimeError(f"Missing {GCAL_CREDS_PATH} — copy credentials.json there first.")

    flow = Flow.from_client_secrets_file(
        str(GCAL_CREDS_PATH), scopes=GCAL_SCOPES, redirect_uri=GCAL_REDIRECT_URI
    )
    auth_url, state = flow.authorization_url(prompt="consent", access_type="offline")
    _gcal_pending_state["state"] = state
    _gcal_pending_state["flow"] = flow
    return auth_url


def gcal_complete_auth(code: str, state: str) -> None:
    if state != _gcal_pending_state.get("state"):
        raise RuntimeError("OAuth state mismatch — restart auth flow.")
    flow = _gcal_pending_state.get("flow")
    if not flow:
        raise RuntimeError("No pending auth flow — visit /api/gcal/auth first.")
    flow.fetch_token(code=code)
    creds = flow.credentials
    GCAL_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    GCAL_TOKEN_PATH.write_text(creds.to_json())
    _gcal_pending_state.clear()


# ── omens ─────────────────────────────────────────────────────────────────────

def _gcal_creds():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    if not GCAL_TOKEN_PATH.exists():
        raise RuntimeError(
            "Google Calendar not authenticated. Visit https://wai-lau.net/api/gcal/auth"
        )
    creds = Credentials.from_authorized_user_file(str(GCAL_TOKEN_PATH))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        GCAL_TOKEN_PATH.write_text(creds.to_json())
    return creds


CALENDAR_IDS = [
    "wl.wailau@gmail.com",
    "family02183524598292154389@group.calendar.google.com",
    "lk327a43fqki6f02k23hg7uufg5kn5vj@import.calendar.google.com",
]

ICS_FEEDS = [
    "http://mcc.janeapp.com/ical/23xbVylhhdvV0NzKSpbh/appointments.ics",
]


def _fetch_ics_events(url: str, days_ahead: int) -> list:
    import urllib.request
    from icalendar import Calendar

    now_dt = datetime.now(timezone.utc)
    end_dt = now_dt + timedelta(days=days_ahead)

    with urllib.request.urlopen(url, timeout=15) as resp:
        cal = Calendar.from_ical(resp.read())

    events = []
    for component in cal.walk():
        if component.name != "VEVENT":
            continue
        try:
            dtstart = component.get("DTSTART").dt
            if not hasattr(dtstart, "tzinfo"):
                dtstart = datetime(dtstart.year, dtstart.month, dtstart.day, tzinfo=timezone.utc)
            elif dtstart.tzinfo is None:
                dtstart = dtstart.replace(tzinfo=timezone.utc)
            if dtstart < now_dt or dtstart > end_dt:
                continue
            summary = str(component.get("SUMMARY", "Untitled"))
            events.append({
                "id": str(component.get("UID", "")),
                "summary": summary,
                "start": dtstart.isoformat(),
                "description": str(component.get("DESCRIPTION", "")),
            })
        except Exception:
            pass
    return events


def fetch_calendar_events(days_ahead: int = 14) -> list:
    from googleapiclient.discovery import build as gcal_build

    creds = _gcal_creds()
    service = gcal_build("calendar", "v3", credentials=creds)
    now = datetime.now(timezone.utc).isoformat()
    end = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).isoformat()

    events, seen = [], set()
    for cal_id in CALENDAR_IDS:
        try:
            result = service.events().list(
                calendarId=cal_id, timeMin=now, timeMax=end,
                singleEvents=True, orderBy="startTime", maxResults=20,
            ).execute()
            for item in result.get("items", []):
                key = (item.get("summary", ""), item["start"].get("dateTime", item["start"].get("date", "")))
                if key not in seen:
                    seen.add(key)
                    events.append({
                        "id": item.get("id", ""),
                        "summary": item.get("summary", "Untitled"),
                        "start": item["start"].get("dateTime", item["start"].get("date", "")),
                        "description": item.get("description", ""),
                    })
        except Exception:
            pass

    for ics_url in ICS_FEEDS:
        try:
            for ev in _fetch_ics_events(ics_url, days_ahead):
                key = (ev["summary"], ev["start"])
                if key not in seen:
                    seen.add(key)
                    events.append(ev)
        except Exception:
            pass

    events.sort(key=lambda e: e["start"])
    return events


PRIMARY_CALENDAR_ID = "wl.wailau@gmail.com"


def create_gcal_event(title: str, start: str, end: str | None = None, description: str = "") -> dict:
    from googleapiclient.discovery import build as gcal_build

    creds = _gcal_creds()
    service = gcal_build("calendar", "v3", credentials=creds)

    # Determine if all-day or timed
    all_day = "T" not in start
    if all_day:
        start_obj = {"date": start[:10]}
        if end:
            end_obj = {"date": end[:10]}
        else:
            # Default: same day (GCal all-day end is exclusive so +1 day)
            end_date = (date.fromisoformat(start[:10]) + timedelta(days=1)).isoformat()
            end_obj = {"date": end_date}
    else:
        start_obj = {"dateTime": start, "timeZone": "America/New_York"}
        if end:
            end_obj = {"dateTime": end, "timeZone": "America/New_York"}
        else:
            # Default: 1 hour
            from datetime import datetime as _dt
            start_dt = _dt.fromisoformat(start)
            end_dt = start_dt + timedelta(hours=1)
            end_obj = {"dateTime": end_dt.isoformat(), "timeZone": "America/New_York"}

    body = {"summary": title, "start": start_obj, "end": end_obj}
    if description:
        body["description"] = description

    event = service.events().insert(calendarId=PRIMARY_CALENDAR_ID, body=body).execute()
    return {"ok": True, "event_id": event.get("id"), "link": event.get("htmlLink")}


def analyze_omens() -> dict:
    def _fmt_date(iso: str) -> str:
        try:
            today = date.today()
            if "T" in iso:
                dt = datetime.fromisoformat(iso)
                d, delta = dt.date(), (dt.date() - today).days
                hour = dt.strftime("%I%p").lstrip("0").replace(":00", "")
                return f"{d.strftime('%A')} {hour}" if delta <= 6 else f"{d.strftime('%B %-d')} {hour}"
            else:
                d = date.fromisoformat(iso[:10])
                delta = (d - today).days
                return d.strftime("%A") if delta <= 6 else d.strftime("%B %-d")
        except Exception:
            return iso

    events = fetch_calendar_events()
    omens = {
        "checked_at": datetime.now().isoformat(),
        "events": [{"event_id": e.get("id", ""), "title": e["summary"], "date": _fmt_date(e["start"])} for e in events],
    }
    (DATA_DIR / "omens.json").write_text(json.dumps(omens, indent=2))
    return omens


# ── chat ──────────────────────────────────────────────────────────────────────

def _build_chat_system_prompt(stage: str = "planning") -> str:
    ctx = _load_json("context", {"notes": []})
    delta = _load_daily_delta()
    omens = _load_json("omens")
    rd = _load_rd()
    morning = _load_json("morning")

    cards = rd.get("cards", [])
    selected = sorted([c for c in cards if c.get("column") == "hq"], key=lambda c: c.get("order", 0))
    ideas = sorted([c for c in cards if c.get("column") == "rd"], key=lambda c: c.get("order", 0))

    ctx_text = "\n".join(f"- [{n.get('date','')}] {n['note']}" for n in ctx.get("notes", [])) or "None."
    delta_text = f"NOTES: {delta.get('wai_notes', 'None.')}\nADJUSTMENTS: {delta.get('adjustments', 'None.')}"
    events_text = "\n".join(f"- {e['title']} ({e.get('date','?')})" for e in omens.get("events", [])) or "None."
    selected_text = "\n".join(
        f"- id:{c['id']} [{c.get('size','task')}] {c['title']} ({c.get('category','')}): {c.get('description','')}"
        for c in selected
    ) or "None."
    ideas_text = "\n".join(
        f"- id:{c['id']} [{c.get('size','task')}] {c['title']} ({c.get('category','')}): {c.get('description','')}"
        for c in ideas[:15]
    ) or "None."

    stage_instructions = {
        "planning": (
            "Help Wai select tasks for today from the ideas pool or confirm existing selected tasks. "
            "Consider their available time and energy. Make specific suggestions with card IDs. "
            "Book category cards are for reading only — do NOT select them for directives. "
            "You can manage cards freely: create_card (new idea), move_card (change column), update_card (edit fields), delete_card (permanent removal). "
            "Use move_card to archive completed tasks or exile dropped ones without being asked twice. "
            "When finalizing, categorize each card: SEEK=requires going outdoors, HACK=quick at home (under 1h), DIVE=extended focus/setup/cleanup (over 1h). "
            "When the plan looks ready, call assemble_plan to generate the schedule and show Wai the preview. "
            "After Wai approves the preview, call build_pdf to generate the PDF. "
            "When Wai says yes to pushing, immediately call finalize_and_push — do NOT ask for another confirmation. "
            "Keep responses concise — this is a planning terminal, not a chat app."
        ),
        "done": "The plan has been finalized and pushed to reMarkable. Wrap up warmly. No more actions needed.",
    }

    today_str = _now_et().strftime("%A, %B %-d, %Y %H:%M ET")
    return (
        f"You are Wai's personal AI planning assistant. Wai has ADHD and uses this tool daily for executive function.\n"
        f"TODAY: {today_str}\n"
        f"FORMATTING: Plain text only. No markdown — no **, no *, no #, no -, no bullet points, no headers.\n"
        f"Never expose raw card IDs or internal formats in your responses — refer to tasks by title only.\n"
        f"CRITICAL: When calling any tool that takes a card id, you MUST use ONLY the exact ids listed in CURRENTLY SELECTED TASKS or IDEAS POOL. Never invent, guess, or construct card ids. If you cannot find the card in the lists, say so.\n"
        f"Never state that a card is selected or on the active board unless it appears under CURRENTLY SELECTED TASKS. Do not invent or assume task status.\n"
        f"CRITICAL: NEVER describe taking an action without calling the tool. If you say you will create a card, move a card, update context, or do anything else — you MUST call the tool in that same response. Describing the action is not the action.\n"
        f"CRITICAL: When Wai says 'remember [X]' or 'don't forget [X]', immediately call update_context with action=add and note=[X]. No exceptions.\n\n"
        f"STAGE: {stage.upper()}\n"
        f"INSTRUCTION: {stage_instructions.get(stage, stage_instructions['planning'])}\n\n"
        f"MORNING BRIEFING CONTEXT:\n{morning.get('opening_message', 'No briefing available.')}\n\n"
        f"YESTERDAY'S DELTA:\n{delta_text}\n\n"
        f"UPCOMING EVENTS:\n{events_text}\n\n"
        f"CURRENTLY SELECTED TASKS:\n{selected_text}\n\n"
        f"IDEAS POOL (top 15):\n{ideas_text}\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}"
    )


def _chat_tools() -> list:
    return [
        {
            "name": "finalize_and_push",
            "description": "Finalize today's plan and push the PDF to reMarkable. Categorize each selected card into SEEK/HACK/DIVE. Call immediately once Wai confirms — no second confirmation needed.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "seek_ids": {"type": "array", "items": {"type": "string"}, "description": "Card IDs requiring going outdoors (errands, outdoor activities, travel)."},
                    "hack_ids": {"type": "array", "items": {"type": "string"}, "description": "Card IDs that can be done quickly at home (under an hour, minimal setup)."},
                    "dive_ids": {"type": "array", "items": {"type": "string"}, "description": "Card IDs requiring setup/cleanup, extended focus, or a complete session (over an hour)."},
                    "encouraging_message": {"type": "string", "description": "Short encouraging message for Wai, printed on the reMarkable. Incorporate yesterday's delta into the tone and content."},
                    "context_note": {"type": "string", "description": "New long-term fact about Wai to remember (optional)."},
                },
                "required": ["seek_ids", "hack_ids", "dive_ids", "encouraging_message"],
            },
        },
        {
            "name": "create_card",
            "description": "Add a new card to the r&d ideas pool. Use when Wai mentions a new project or task idea. Also use to create new tasks from delta notes (set column=hq for tasks to do today/tomorrow).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short title for the card."},
                    "category": {"type": "string", "enum": ["Hobby", "Interfacing", "Social", "Self", "Book"], "description": "Interfacing=admin/home/parents/partner/work; Hobby=crafts/art/gaming; Social=events/friends; Self=self-care/wellness/improvement; Book=reading/studying."},
                    "size": {"type": "string", "enum": ["chore", "task", "project", "titan", "book"], "description": "Size: chore (<45min), task (<3h), project (<6h), titan (6h+), book (long read)."},
                    "description": {"type": "string", "description": "One-sentence description."},
                    "column": {"type": "string", "enum": ["rd", "hq"], "description": "rd=ideas pool (default), hq=active today."},
                    "estimated_time": {"type": "integer", "description": "Estimated duration in minutes. Auto-populated from size if omitted."},
                    "start_before": {"type": "string", "description": "ISO date (YYYY-MM-DD) if this task is intended for a specific day."},
                },
                "required": ["title", "category", "size"],
            },
        },
        {
            "name": "refresh_omens",
            "description": "Refetch upcoming calendar events from Google Calendar and update omens.",
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "create_gcal_event",
            "description": "Create a Google Calendar event on Wai's primary calendar. Use when Wai asks to schedule something or add an event to the calendar.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Event title/summary."},
                    "start": {"type": "string", "description": "Start as ISO 8601: YYYY-MM-DD for all-day, or YYYY-MM-DDTHH:MM:SS for timed events (ET timezone)."},
                    "end": {"type": "string", "description": "End as ISO 8601. Optional — defaults to 1 hour after start for timed, same day for all-day."},
                    "description": {"type": "string", "description": "Optional event notes/description."},
                },
                "required": ["title", "start"],
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
            "description": "Update fields on an existing card. Only include fields that should change. Setting estimated_time auto-updates size if the duration implies a different category.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "category": {"type": "string", "enum": ["Hobby", "Interfacing", "Social", "Self", "Book"]},
                    "size": {"type": "string", "enum": ["chore", "task", "project", "titan", "book"]},
                    "notes": {"type": "string"},
                    "estimated_time": {"type": "integer", "description": "Estimated duration in minutes. Auto-updates size if the new value implies a different size category."},
                    "start_before": {"type": "string", "description": "ISO date (YYYY-MM-DD) if this task is intended for a specific day."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "delete_card",
            "description": "Permanently delete a card. Use only when Wai explicitly asks to remove it entirely.",
            "input_schema": {
                "type": "object",
                "properties": {"id": {"type": "string", "description": "Card ID to delete."}},
                "required": ["id"],
            },
        },
        {
            "name": "assemble_plan",
            "description": "Refresh omens and delta, generate encouraging message and daily schedule, write plan.json. Call when card selection looks ready, then ask Wai to confirm before building the PDF.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "seek_ids": {"type": "array", "items": {"type": "string"}, "description": "Card IDs requiring going outdoors."},
                    "hack_ids": {"type": "array", "items": {"type": "string"}, "description": "Card IDs that can be done quickly at home (under an hour)."},
                    "dive_ids": {"type": "array", "items": {"type": "string"}, "description": "Card IDs requiring extended focus or setup (over an hour)."},
                },
                "required": ["seek_ids", "hack_ids", "dive_ids"],
            },
        },
        {
            "name": "build_pdf",
            "description": "Build the PDF from the current plan.json. Call after Wai approves the plan preview.",
            "input_schema": {"type": "object", "properties": {}},
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
                "Add, remove, or replace a long-term fact about Wai in context.json. "
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


# ── tool handlers ─────────────────────────────────────────────────────────────

def _tool_finalize_and_push(input_: dict) -> dict:
    seek_ids = list(input_.get("seek_ids", []))
    hack_ids = list(input_.get("hack_ids", []))
    dive_ids = list(input_.get("dive_ids", []))
    context_note = input_.get("context_note", "")

    plan_path = DATA_DIR / "plan.json"
    if not (seek_ids or hack_ids or dive_ids) and plan_path.exists():
        plan = json.loads(plan_path.read_text())
        seek_ids = [c["id"] for c in plan.get("seek", []) if isinstance(c, dict)]
        hack_ids = [c["id"] for c in plan.get("hack", []) if isinstance(c, dict)]
        dive_ids = [c["id"] for c in plan.get("dive", []) if isinstance(c, dict)]

    selected_ids = set(seek_ids + hack_ids + dive_ids)

    rd = _load_rd()
    for c in rd.get("cards", []):
        if c.get("column") in ("hq", "rd"):
            c["column"] = "hq" if c["id"] in selected_ids else "rd"
    _save_rd(rd)

    if context_note and context_note.strip():
        ctx_path = DATA_DIR / "context.json"
        ctx = json.loads(ctx_path.read_text()) if ctx_path.exists() else {"notes": []}
        ctx["notes"].append({"date": date.today().isoformat(), "note": context_note.strip()})
        ctx_path.write_text(json.dumps(ctx, indent=2))

    # Push pre-built PDF if available, otherwise build a new one
    pdf_name = None
    if plan_path.exists():
        plan = json.loads(plan_path.read_text())
        latest_pdf = plan.get("latest_pdf")
        if latest_pdf and (DATA_DIR / latest_pdf).exists():
            result = subprocess.run(
                ["rmapi", "put", "--force", str(DATA_DIR / latest_pdf), RM_FOLDER],
                capture_output=True, text=True, timeout=60,
            )
            if result.returncode != 0:
                raise RuntimeError(f"rmapi put failed: {result.stderr.strip()}")
            pdf_name = latest_pdf

    if not pdf_name:
        pdf_name = push_pdf()

    return {"pushed": pdf_name, "selected": len(selected_ids)}


def _tool_create_card(input_: dict) -> dict:
    import time as _time

    rd = _load_rd()
    cards = rd.get("cards", [])
    column = input_.get("column", "rd")
    min_order = min((c.get("order", 0) for c in cards if c.get("column") == column), default=0)

    size = input_.get("size", "task")
    estimated_time = input_.get("estimated_time") or _SIZE_MINUTES.get(size, 90)

    new_card = {
        "id": f"card-{int(_time.time() * 1000)}",
        "title": input_.get("title", ""),
        "category": input_.get("category", "Self"),
        "size": size,
        "description": input_.get("description", ""),
        "column": column,
        "order": min_order - 1,
        "due_date": None,
        "notes": "",
        "estimated_time": estimated_time,
    }
    if input_.get("start_before"):
        new_card["start_before"] = input_["start_before"]

    cards.append(new_card)
    rd["cards"] = cards
    _save_rd(rd)
    return {"ok": True, "id": new_card["id"], "title": new_card["title"]}


def _tool_refresh_omens(input_: dict) -> dict:
    result = analyze_omens()
    events = result.get("events", [])
    return {"ok": True, "event_count": len(events), "events": ", ".join(e.get("title", "") for e in events) or "none"}


def _tool_move_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    card["column"] = input_["column"]
    _save_rd(rd)
    return {"ok": True, "id": card["id"], "title": card["title"], "column": card["column"]}


def _tool_update_card(input_: dict) -> dict:
    rd = _load_rd()
    card = _find_card(rd, input_.get("id", ""))
    if not card:
        return {"error": f"Card not found: {input_.get('id')}"}
    for field in ("title", "description", "category", "size", "notes", "start_before"):
        if field in input_:
            card[field] = input_[field]
    if "estimated_time" in input_:
        card["estimated_time"] = input_["estimated_time"]
        if card.get("size") != "book":
            new_size = _minutes_to_size(input_["estimated_time"])
            if new_size != card.get("size"):
                card["size"] = new_size
    _save_rd(rd)
    return {"ok": True, "id": card["id"], "title": card["title"]}


def _tool_delete_card(input_: dict) -> dict:
    rd = _load_rd()
    before = len(rd.get("cards", []))
    rd["cards"] = [c for c in rd.get("cards", []) if c["id"] != input_.get("id")]
    if len(rd["cards"]) == before:
        return {"error": f"Card not found: {input_.get('id')}"}
    _save_rd(rd)
    return {"ok": True, "deleted": input_.get("id")}


def _build_card_obj(cards_by_id: dict, card_id: str) -> dict | None:
    card = cards_by_id.get(card_id)
    if not card or card.get("column") not in ("hq", "rd"):
        return None
    steps = [s.strip() for s in card.get("description", "").split(".") if s.strip()]
    return {"id": card_id, "title": card["title"], "steps": steps, "size": card.get("size", "task"), "estimated_time": card.get("estimated_time")}


def _build_plan_cards(rd: dict, seek_ids: list, hack_ids: list, dive_ids: list) -> tuple[list, list, list]:
    cards_by_id = {c["id"]: c for c in rd.get("cards", [])}
    def mk(i):
        return _build_card_obj(cards_by_id, i)

    seek_cards = [o for o in (mk(i) for i in seek_ids) if o]
    hack_cards = [o for o in (mk(i) for i in hack_ids) if o]
    dive_cards = [o for o in (mk(i) for i in dive_ids) if o]

    selected_ids = set(seek_ids + hack_ids + dive_ids)
    remaining_hq = sorted(
        [c for c in rd.get("cards", []) if c.get("column") == "hq" and c["id"] not in selected_ids and c.get("size") != "book"],
        key=lambda c: c.get("order", 0),
    )
    for raw in remaining_hq:
        obj = mk(raw["id"])
        if obj:
            (dive_cards if raw.get("size") in ("project", "titan") else hack_cards).append(obj)

    # Auto-populate estimated_time on any card missing it
    dirty = False
    for c in seek_cards + hack_cards + dive_cards:
        raw = cards_by_id.get(c["id"])
        if raw and "estimated_time" not in raw:
            raw["estimated_time"] = _SIZE_MINUTES.get(raw.get("size", "task"), 90)
            c["estimated_time"] = raw["estimated_time"]
            dirty = True
    if dirty:
        _save_rd(rd)

    return seek_cards, hack_cards, dive_cards


def _tool_assemble_plan(input_: dict) -> dict:
    import anthropic

    seek_ids = list(input_.get("seek_ids", []))
    hack_ids = list(input_.get("hack_ids", []))
    dive_ids = list(input_.get("dive_ids", []))

    try:
        analyze_omens()
    except Exception:
        pass

    delta_error = None
    try:
        analyze_delta_to_now()
    except Exception as e:
        import traceback
        delta_error = f"{e}\n{traceback.format_exc()}"

    yesterday_delta = _load_yesterday_delta()
    today_delta = _load_all_recent_deltas()
    delta_text = " ".join(filter(None, [today_delta.get("wai_notes", ""), today_delta.get("adjustments", "")])).strip()

    try:
        update_rd_from_delta(today_delta)
    except Exception:
        pass

    events = _load_json("omens", {}).get("events", [])
    rd = _load_rd()
    seek_cards, hack_cards, dive_cards = _build_plan_cards(rd, seek_ids, hack_ids, dive_ids)

    # Encouraging message
    encouraging = ""
    try:
        client = anthropic.Anthropic()
        yesterday_text = " ".join(filter(None, [yesterday_delta.get("wai_notes", ""), yesterday_delta.get("adjustments", "")])).strip()
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": (
                f"YESTERDAY: {yesterday_text or 'none'}\n"
                f"TODAY (so far, since 4:30am): {delta_text or 'none'}\n\n"
                "Write a warm, personal encouraging message for Wai (3-5 sentences). "
                "Be specific about what they did yesterday and what they have already done today. "
                "Plain text only. No em-dashes."
            )}],
        )
        encouraging = resp.content[0].text.strip()
    except Exception:
        pass

    schedule = _generate_schedule(seek_cards, hack_cards, dive_cards, events, delta_text)

    plan = {
        "generated_at": datetime.now().isoformat(),
        "seek": seek_cards,
        "hack": hack_cards,
        "dive": dive_cards,
        "encouraging_message": encouraging,
        "omens": events,
        "schedule": schedule,
    }
    (DATA_DIR / "plan.json").write_text(json.dumps(plan, indent=2))

    directives = {k: plan[k] for k in ("generated_at", "seek", "hack", "dive", "encouraging_message")}
    (DATA_DIR / "directives.json").write_text(json.dumps(directives, indent=2))

    result = {"ok": True}
    if delta_error:
        result["delta_error"] = delta_error
    return result


def _tool_reschedule(input_: dict) -> dict:
    plan_path = DATA_DIR / "plan.json"
    if not plan_path.exists():
        return {"error": "No plan.json found"}

    plan = json.loads(plan_path.read_text())
    seek_cards = plan.get("seek", [])
    hack_cards = plan.get("hack", [])
    dive_raw = plan.get("dive", [])
    dive_cards = [dive_raw] if isinstance(dive_raw, dict) else dive_raw
    events = plan.get("omens", [])
    feedback = input_.get("feedback", "")

    # Exclude tasks whose scheduled slot has already passed
    now_et = _now_et()
    done_titles = set()
    for entry in plan.get("schedule", []):
        try:
            t = datetime.strptime(entry["time"], "%H:%M").replace(year=now_et.year, month=now_et.month, day=now_et.day)
            if t + timedelta(minutes=entry.get("duration_min", 0)) < now_et:
                done_titles.add(entry.get("title", ""))
        except Exception:
            pass

    remaining_seek = [c for c in seek_cards if (c.get("title", c) if isinstance(c, dict) else c) not in done_titles]
    remaining_hack = [c for c in hack_cards if (c.get("title", c) if isinstance(c, dict) else c) not in done_titles]
    remaining_dive = [c for c in dive_cards if (c.get("title", c) if isinstance(c, dict) else c) not in done_titles]

    delta_text = _load_all_recent_deltas().get("wai_notes", "")
    schedule = _generate_schedule(remaining_seek, remaining_hack, remaining_dive, events, delta_text, feedback=feedback)

    plan["schedule"] = schedule
    plan_path.write_text(json.dumps(plan, indent=2))
    return {"ok": True, "schedule": schedule}


def _apply_context_update(action: str, note: str = "", match: str = "") -> dict:
    ctx_path = DATA_DIR / "context.json"
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


def _tool_update_context(input_: dict) -> dict:
    return _apply_context_update(
        action=input_.get("action", ""),
        note=input_.get("note", ""),
        match=input_.get("match", ""),
    )


def _tool_build_pdf(input_: dict) -> dict:
    from build_pdf import build as pdf_build

    pdf_path = DATA_DIR / f"WAI_{_ts()}.pdf"
    pdf_build(str(pdf_path))

    plan_path = DATA_DIR / "plan.json"
    if plan_path.exists():
        plan = json.loads(plan_path.read_text())
        plan["latest_pdf"] = pdf_path.name
        plan_path.write_text(json.dumps(plan, indent=2))

    return {"ok": True, "pdf": pdf_path.name}


def _tool_create_gcal_event(input_: dict) -> dict:
    try:
        return create_gcal_event(
            title=input_["title"],
            start=input_["start"],
            end=input_.get("end"),
            description=input_.get("description", ""),
        )
    except Exception as e:
        return {"error": str(e)}


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
            "Parse the due date from user input and compute a 'start before' deadline (due date minus task duration). "
            "Reply with ONLY two ISO 8601 strings separated by a newline: first line = due date/datetime, second line = start_before date/datetime. "
            "Use YYYY-MM-DD or YYYY-MM-DDTHH:MM format. Reply 'null' on either line if not applicable."
        ),
        messages=[{"role": "user", "content": text}],
    )
    lines = msg.content[0].text.strip().splitlines()
    due = lines[0].strip() if lines else "null"
    start_before = lines[1].strip() if len(lines) > 1 else "null"
    return (None if due == "null" or not due else due,
            None if start_before == "null" or not start_before else start_before)


_TOOL_HANDLERS = {
    "finalize_and_push": _tool_finalize_and_push,
    "create_card":       _tool_create_card,
    "refresh_omens":     _tool_refresh_omens,
    "move_card":         _tool_move_card,
    "update_card":       _tool_update_card,
    "delete_card":       _tool_delete_card,
    "assemble_plan":     _tool_assemble_plan,
    "reschedule":        _tool_reschedule,
    "build_pdf":         _tool_build_pdf,
    "update_context":    _tool_update_context,
    "create_gcal_event": _tool_create_gcal_event,
}


def _handle_tool(name: str, input_: dict) -> dict:
    handler = _TOOL_HANDLERS.get(name)
    if not handler:
        return {"error": f"Unknown tool: {name}"}
    return handler(input_)


# ── context deduplication ─────────────────────────────────────────────────────

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


# ── card classification ───────────────────────────────────────────────────────

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
            'JSON only: {"category": "...", "size": "...", "description": "one sentence"}'
        )}],
    )
    try:
        parsed = _parse_json(msg.content[0].text)
    except Exception:
        parsed = {}
    return {
        "category": parsed.get("category", "Self"),
        "size": parsed.get("size", "task"),
        "description": parsed.get("description", ""),
    }


# ── chat persistence ──────────────────────────────────────────────────────────

def _save_chat(messages: list, stage: str):
    (DATA_DIR / "chat.json").write_text(json.dumps({
        "messages": messages,
        "stage": stage,
        "updated_at": datetime.now().isoformat(),
    }, indent=2))


def get_chat() -> dict:
    p = DATA_DIR / "chat.json"
    return json.loads(p.read_text()) if p.exists() else {"messages": [], "stage": "planning"}
