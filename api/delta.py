import base64
import json
from datetime import datetime, timedelta, timezone
from itertools import chain
from pathlib import Path

from helpers import (
    DATA_DIR, _load_json, _load_rd, _parse_json, _parse_file_ts,
    _day_window, _apply_context_update,
)
from rm import pull_rmdocs, _rm_latest_wai_modified


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

    ctx = _load_json("profile", {"notes": []})
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
        for f in DATA_DIR.glob("*.rmdoc")
        if start <= (mtime := datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).replace(tzinfo=None)) < end
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
        delta = {"analyzed_at": datetime.now(timezone.utc).isoformat(), "source_file": stem + ".rmdoc", "wai_notes": "", "adjustments": ""}
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
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
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
        "referenced_cards": list(set(chain.from_iterable(all_ref_cards or []))),
        "referenced_events": list(set(chain.from_iterable(all_ref_events or []))),
        "carry_forward": list(set(chain.from_iterable(all_carry_forward or []))),
        "new_tasks": list(set(chain.from_iterable(all_new_tasks or []))),
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
        result = {"analyzed_at": datetime.now(timezone.utc).isoformat(), "wai_notes": "", "adjustments": "", "referenced_cards": [], "referenced_events": [], "carry_forward": [], "new_tasks": []}
    elif len(marked) == 1:
        result = {**marked[0], "analyzed_at": datetime.now(timezone.utc).isoformat()}
    else:
        notes = [d["wai_notes"] for d in marked]
        adjs = [d.get("adjustments", "") for d in marked]
        ref_cards = [d.get("referenced_cards", []) for d in marked]
        ref_events = [d.get("referenced_events", []) for d in marked]
        carry_fwd = [d.get("carry_forward", []) for d in marked]
        new_tasks = [d.get("new_tasks", []) for d in marked]
        result = {**marked[-1], **_haiku_merge_deltas(notes, adjs, ref_cards, ref_events, carry_fwd, new_tasks), "analyzed_at": datetime.now(timezone.utc).isoformat()}

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
