"""JSON API routes: card CRUD, scheduling, profile/context, gcal, monitor +
nudge control. HTML page routes live in routes_views.py."""
import copy
import json
import time
import asyncio
from pathlib import Path

from fastapi import Request, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse

from routers import public, protected
from morning import build_morning
from card_llm import classify_card, parse_date_natural
from gcal import gcal_start_auth, gcal_complete_auth
from helpers import (
    DATA_DIR, _load_json, _append_rd_log_batch, _next_recurrence, get_rd_log,
)
from monitor import schedule_monitor, flush_monitor, _entry_is_significant
from monitor_sse import _monitor_subscribers
import nudge_llm as _nllm
from nudge_loop import _nudge_tick

_RD_COLUMNS = ["rd", "hq", "archives", "exile"]


@protected.post("/api/morning")
def api_morning():
    try:
        return build_morning()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/rd")
def api_rd():
    return _load_json("rd", {"columns": _RD_COLUMNS, "cards": []})


@protected.post("/api/rd/{card_id}/recalc")
async def api_rd_recalc(card_id: str, request: Request):
    """Rebuild a card's breakdown on demand (the dialog's 'recalculate' button),
    incorporating its latest notes."""
    import nudge as _nudge
    import nudge_deadlines as _nd
    from helpers import _load_rd, _save_rd, _find_card
    try:
        body = await request.json()
    except Exception:
        body = {}
    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card:
        raise HTTPException(status_code=404)
    if card.get("is_reminder") or card.get("is_book"):
        raise HTTPException(status_code=400, detail="not decomposable")
    if body.get("notes") is not None:
        card["notes"] = body["notes"]
    prep, dur = body.get("prep"), body.get("duration")
    if prep is not None or dur is not None:
        p, d = max(0, int(prep or 0)), max(0, int(dur or 0))
        card["prep_time"] = p          # lead-up slice of the total estimate
        if p + d > 0:
            card["estimated_time"] = p + d
    if body.get("notes") is not None or prep is not None or dur is not None:
        _save_rd(rd)  # persist edits before decomposing from them
    result = await asyncio.to_thread(_nllm.decompose_sync, card)
    rd = _load_rd()  # reload around the LLM call
    card = _find_card(rd, card_id)
    if not card:
        raise HTTPException(status_code=404)
    n = _nudge.ensure_nudge(card)
    n["graph"] = {"nodes": result["nodes"], "edges": result["edges"]}
    n["active_node"] = result["active_node"]
    n["triage_pending"] = False
    _nd.compute_deadlines(card)          # appends the event block
    g = n["graph"]
    if n["active_node"] not in {nd["id"] for nd in g["nodes"]}:
        n["active_node"] = _nudge._first_open(g["nodes"], g["edges"])
    _save_rd(rd)
    return {"ok": True, "nudge": card["nudge"]}


def _atomic_write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)


def _minutes_late(card) -> int:
    """How many minutes past its deadline a card was completed (clamped >= 0,
    capped at 4x the estimate so a card archived days later can't skew learning)."""
    import nudge_deadlines as _nd
    from helpers import _now_et
    try:
        dl = _nd.card_deadline(card)
    except Exception:
        return 0
    late = (_now_et() - dl).total_seconds() / 60
    est = card.get("estimated_time") or 90
    return max(0, min(round(late), est * 4))


def _advanced_entries(c, old, source):
    """A sub-step toggled done on the timeline (card-graph tap) PATCHes the whole
    card, mutating only a nested nudge node — the card-level diff misses it. Emit
    the same "advanced" signal the advance_chunk chat tool logs (one per node that
    went done false->true) so the monitor comments on it."""
    if not old:
        return []
    new_nodes = (c.get("nudge") or {}).get("graph", {}).get("nodes", [])
    if not new_nodes:
        return []
    old_done = {n.get("id"): n.get("done")
                for n in ((old.get("nudge") or {}).get("graph", {}).get("nodes", []))}
    remaining = sum(1 for n in new_nodes if not n.get("done"))
    # carry id + node_id so the monitor can re-check at fire time that the step is
    # still done (a done-then-undone within the debounce must not earn a comment)
    return [{"action": "advanced", "title": c.get("title", c.get("id")),
             "source": source, "step": n.get("label", ""), "remaining": remaining,
             "id": c.get("id"), "node_id": n.get("id")}
            for n in new_nodes if n.get("done") and not old_done.get(n.get("id"))]


def _log_entries_for_patch(new_cards, old_cards, source):
    entries = []
    for c in new_cards:
        old = old_cards.get(c.get("id"))
        if old is None:
            entries.append({"action": "created", "title": c.get("title", c.get("id")), "source": source, "column": c.get("column"), "is_reminder": c.get("is_reminder", False)})
        elif old.get("column") != c.get("column"):
            mv = {"action": "moved", "title": c.get("title", c.get("id")), "source": source, "from_col": old["column"], "to_col": c["column"], "is_reminder": c.get("is_reminder", False)}
            if c.get("column") == "archives":
                mv["category"] = c.get("category")  # recalibration keys factors by category
                if c.get("completed_late"):
                    mv["late"] = True
                    mv["estimated_time"] = c.get("estimated_time")
                    mv["minutes_late"] = _minutes_late(c)
            entries.append(mv)
        elif (old.get("notes") != c.get("notes") or old.get("title") != c.get("title")
              or old.get("current_page") != c.get("current_page")):
            entry = {"action": "updated", "title": c.get("title", c.get("id")), "source": source, "size": c.get("size", ""), "is_book": c.get("is_book", False)}
            if c.get("is_book") and c.get("current_page") is not None:
                entry["current_page"] = c.get("current_page")
                entry["total_pages"] = c.get("total_pages")
            entries.append(entry)
        # done-toggle is independent of the elif chain (a same-patch column change
        # must not mask a sub-step completion)
        entries.extend(_advanced_entries(c, old, source))
    new_ids = {c["id"] for c in new_cards}
    for cid, old in old_cards.items():
        if cid not in new_ids:
            entries.append({"action": "deleted", "title": old.get("title", cid), "source": source})
    return entries


def _recompute_node_deadlines(cards: list) -> None:
    """Refresh per-node deadlines so a due-time edit updates the plan immediately,
    not only on the next nudge tick."""
    import nudge_deadlines as _nd
    for c in cards:
        if (c.get("nudge") or {}).get("graph", {}).get("nodes"):
            _nd.compute_deadlines(c)


def _flag_triage(new_cards: list, old_cards: dict) -> None:
    """Mark a card for plan re-triage when its title/notes changed — the next tick
    decides whether the breakdown needs to follow the new info."""
    for c in new_cards:
        old = old_cards.get(c.get("id"))
        if not old or not (c.get("nudge") or {}).get("graph", {}).get("nodes"):
            continue
        if old.get("notes") != c.get("notes") or old.get("title") != c.get("title"):
            c["nudge"]["triage_pending"] = True


def _apply_patch_schedule(new_cards, old_cards):
    """Mutate new_cards in place for scheduling side-effects of a PATCH: handle
    hq<->rd column moves, and re-pin a today card's timeline block when its event
    TIME was edited."""
    from scheduler import schedule_to_day, logical_today_iso, timed_start_min
    for c in new_cards:
        old = old_cards.get(c.get("id"))
        if old and old.get("column") != c.get("column"):
            if old.get("column") == "hq" and c.get("column") != "hq":
                c["scheduled_day"] = None
                c.pop("dir_start_min", None)
            elif c.get("column") == "hq" and old.get("column") != "hq":
                # manual drag into hq: schedule on the card's due day (latest
                # actionable), today if no due_date; clamp so it stays in hq
                today_iso = logical_today_iso()
                target = (c.get("due_date") or "").split("T")[0] or today_iso
                schedule_to_day(c, new_cards, target, today_iso=today_iso, clamp_to_window=True)
        elif (old and c.get("column") == "hq"
                and c.get("scheduled_day") == logical_today_iso()
                and ((old.get("due_date") or "") != (c.get("due_date") or "")
                     or (old.get("prep_time") or 0) != (c.get("prep_time") or 0))):
            # Event TIME or PREP edited (e.g. in the card dialog) on a card already
            # placed today: re-pin its block to event_time - prep so the today
            # timeline repositions it (prep back-schedules to finish at the event).
            # A plain drag (no due/prep change) and timeless edits are left alone.
            pinned = timed_start_min(c)
            if pinned is not None:
                c["dir_start_min"] = pinned


@protected.patch("/api/rd")
async def api_rd_patch(request: Request, source: str = "rd"):
    body = await request.json()
    p = DATA_DIR / "rd.json"
    data = _load_json("rd", {"columns": _RD_COLUMNS})
    old_cards = {c["id"]: c for c in data.get("cards", [])}
    new_cards = body.get("cards", [])

    # Apply side-effects that mutate new_cards in place (scheduled_day logic)
    _apply_patch_schedule(new_cards, old_cards)

    log_entries = _log_entries_for_patch(new_cards, old_cards, source)

    # Recurring revival
    revived = []
    existing_titles_dates = {(c.get("title","").lower(), (c.get("due_date") or "")[:10]) for c in new_cards}
    existing_titles_dates |= {(c.get("title","").lower(), (c.get("due_date") or "")[:10]) for c in old_cards.values()}
    for c in new_cards:
        old = old_cards.get(c.get("id"))
        if (old and old.get("column") != "archives" and c.get("column") == "archives"
                and c.get("recur_type")):
            next_due = _next_recurrence(c.get("due_date") or "", c["recur_type"])
            key = (c.get("title","").lower(), (next_due or "")[:10])
            if next_due and key not in existing_titles_dates:
                clone = copy.deepcopy(c)
                clone["id"] = f"card-{int(time.time() * 1000) + len(revived)}"
                clone["column"] = "rd"
                clone["due_date"] = next_due
                clone["scheduled_day"] = None
                clone["order"] = min((x.get("order", 0) for x in new_cards if x.get("column") == "rd"), default=0) - 1
                clone.pop("nudge", None)  # next occurrence starts its own loop
                clone.pop("dir_start_min", None)
                revived.append(clone)
                log_entries.append({"action": "revived", "title": c.get("title", c["id"]), "source": source, "next_due": next_due})

    _recompute_node_deadlines(new_cards)
    _flag_triage(new_cards, old_cards)
    data["cards"] = new_cards + revived
    _atomic_write_json(p, data)
    _append_rd_log_batch(log_entries)
    if any(_entry_is_significant(e) for e in log_entries):
        schedule_monitor()
    return {"ok": True}


@protected.get("/api/rd/log")
def api_rd_log():
    return get_rd_log(limit=20)


@protected.get("/api/monitor/stream")
async def monitor_stream():
    q: asyncio.Queue = asyncio.Queue()
    _monitor_subscribers.append(q)

    async def gen():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(msg if isinstance(msg, dict) else {'comment': msg})}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            try:
                _monitor_subscribers.remove(q)
            except ValueError:
                pass

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@protected.post("/api/nudge/tick")
async def api_nudge_tick():
    """Manual one-shot tick of the nudge loop (the in-process loop runs this
    automatically every NUDGE_POLL_SEC)."""
    return await _nudge_tick()


@protected.post("/api/monitor/flush")
async def monitor_flush():
    """Fire monitor immediately if significant activity exists since last comment."""
    return await flush_monitor()


@protected.get("/api/hq")
def api_hq_get(start: str = ""):
    from hq import get_week_data
    return get_week_data(start or None)


@protected.patch("/api/hq")
async def api_hq_patch(request: Request):
    body = await request.json()
    from hq import bulk_update_scheduled_days
    return bulk_update_scheduled_days(body.get("updates", []))


@protected.get("/api/hq/log")
def api_hq_log():
    from hq import get_hq_log
    return get_hq_log(limit=100)


@protected.post("/api/rd/classify")
async def api_rd_classify(request: Request):
    body = await request.json()
    title = body.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    try:
        return classify_card(title)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.get("/api/profile")
def api_profile():
    return _load_json("profile", {"notes": []})


@protected.get("/api/context")
def api_context():
    return _load_json("profile", {"notes": []})


@protected.patch("/api/context")
async def api_context_patch(request: Request):
    body = await request.json()
    data = _load_json("profile", {"notes": []})
    data["notes"] = body.get("notes", data.get("notes", []))
    _atomic_write_json(DATA_DIR / "profile.json", data)
    return {"ok": True}


# Exec-panel scratch todo list — a lightweight, separate list from rd.json cards
# (these are DELETED on checkbox, not archived). Lives in exec_todos.json.
def _save_todos(data) -> None:
    _atomic_write_json(DATA_DIR / "exec_todos.json", data)


@protected.get("/api/todos")
def api_todos():
    return _load_json("exec_todos", {"items": []})


@protected.post("/api/todos")
async def api_todos_add(request: Request):
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty todo")
    data = _load_json("exec_todos", {"items": []})
    item = {"id": f"todo-{int(time.time() * 1000)}", "text": text}
    data.setdefault("items", []).append(item)
    _save_todos(data)
    return item


@protected.delete("/api/todos/{todo_id}")
def api_todos_delete(todo_id: str):
    data = _load_json("exec_todos", {"items": []})
    data["items"] = [t for t in data.get("items", []) if t.get("id") != todo_id]
    _save_todos(data)
    return {"ok": True}


@protected.get("/api/gcal/auth")
def api_gcal_auth():
    try:
        auth_url = gcal_start_auth()
        return RedirectResponse(auth_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@protected.post("/api/gcal/import_cards")
def api_gcal_import_cards():
    try:
        from gcal import import_gcal_cards
        return import_gcal_cards()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@public.get("/api/gcal/callback")
def api_gcal_callback(code: str = "", state: str = "", error: str = ""):
    if error:
        return HTMLResponse(f"<pre>GCal auth error: {error}</pre>", status_code=400)
    try:
        gcal_complete_auth(code, state)
        return HTMLResponse("<pre>Google Calendar connected. You can close this tab.</pre>")
    except Exception as e:
        return HTMLResponse(f"<pre>Auth failed: {e}</pre>", status_code=500)


@protected.post("/api/parse_date")
async def api_parse_date(request: Request):
    data = await request.json()
    text = (data.get("text") or "").strip()
    if not text:
        return {"iso": None}
    size = data.get("size")
    estimated_minutes = data.get("estimated_minutes")
    iso = parse_date_natural(text, size=size, estimated_minutes=estimated_minutes)
    return {"iso": iso}
