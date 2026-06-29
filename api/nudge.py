"""Task-decomposition + time-based nudge loop (Phase 1).

Pure logic + LLM calls; callers load/save rd.json (mirrors scheduler.schedule_to_day).
A card carries its loop state in card["nudge"]; the internal dependency graph lives
there and is used to surface the next chunk — it is never shown whole to Wai.

All timestamps here are naive-ET ISO (matching helpers._now_et), never mixed with the
UTC isoformat used by the activity log / chat.
"""
from datetime import datetime, timedelta

from helpers import _now_et, _DEFAULT_MINUTES

# ── tuning constants ──────────────────────────────────────────────────────────
NUDGE_WINDOW_MULT = 2.6        # stall window ~= estimate * this
NUDGE_WINDOW_MIN = 45          # minutes
NUDGE_WINDOW_MAX = 240         # minutes
NUDGE_POLL_SEC = 30            # in-process loop tick interval

_FMT = "%Y-%m-%dT%H:%M:%S"
_MODEL = "claude-opus-4-8"


# ── time helpers ──────────────────────────────────────────────────────────────
def _fmt_et(dt: datetime) -> str:
    return dt.strftime(_FMT)


def _parse_et(s: str | None) -> datetime | None:
    return datetime.strptime(s, _FMT) if s else None


def slot_datetime(card: dict) -> datetime | None:
    """Wall-clock ET datetime of a card's placement: scheduled_day @ dir_start_min.

    dir_start_min is minutes-from-midnight (may exceed 1440 for after-midnight slots),
    so adding it to the scheduled_day midnight rolls correctly past midnight.
    """
    sd = card.get("scheduled_day")
    dsm = card.get("dir_start_min")
    if not sd or dsm is None:
        return None
    try:
        base = datetime.fromisoformat(sd[:10])
    except ValueError:
        return None
    return base + timedelta(minutes=dsm)


def _factor(card: dict) -> float:
    """Per-category lateness multiplier (>=1.0); 1.0 if recalibration is unavailable
    or the category has no history. Never let a bad store break the nudge loop."""
    try:
        import recalibration
        return recalibration.factor_for(card)
    except Exception:
        return 1.0


def window_for(card: dict) -> int:
    return max(NUDGE_WINDOW_MIN, min(NUDGE_WINDOW_MAX, round(_lead(card) * NUDGE_WINDOW_MULT)))


def decomposable(c: dict) -> bool:
    """Every actionable hq card should carry a plan (graph), placed today or not.

    Events are included (they can have prep steps) but never get time-based
    nudges — `_eligible` excludes them via `is_dir_card`. Reminders (no work)
    and books (reading only) are excluded from plans entirely.
    """
    return (
        c.get("column") == "hq"
        and not c.get("is_reminder")
        and not c.get("is_book")
    )


def _eligible(c: dict, today_iso: str) -> bool:
    """Nudge-able: has a plan (decomposable hq card, events included) AND is
    scheduled for today. Everything with a plan scheduled today nudges; a
    dir_start_min slot is optional (see nudge_anchor for the fallback time)."""
    return decomposable(c) and c.get("scheduled_day") == today_iso


def _lead(c: dict) -> int:
    """Total minutes to do the whole task (the estimate, biased up by the card's
    category lateness factor so chronically-late kinds reserve more time)."""
    base = c.get("estimated_time") or _DEFAULT_MINUTES
    return round(base * _factor(c))


# Deadline math (card_deadline, compute_deadlines, active_anchor, the staggered
# auto-deadlines, and morning_reconcile) lives in nudge_deadlines.py — it depends
# on the leaves above; importing it here would cycle.


# ── state ─────────────────────────────────────────────────────────────────────
def default_nudge_state() -> dict:
    return {
        "stage": "idle",          # idle|nudging|awaiting|stalled|consequences|resolved
        "graph": {"nodes": [], "edges": []},
        "active_node": None,
        "redecompose_count": 0,
        "redecompose_at": [],
        "first_nudge_at": None,
        "next_nudge_at": None,
        "window_deadline": None,
        "awaiting_reply": False,
        "last_nudge_at": None,
        "last_nudge_text": "",
        "last_user_reply_at": None,
        "consequences": {"asked_at": None, "answer": None, "decision": None},
        "auto_deadline": None,        # staggered deadline when no fixed one is set
        "triage_pending": False,      # card details changed -> tick re-checks the plan
        "version": 1,
    }


def ensure_nudge(card: dict) -> dict:
    n = card.get("nudge")
    if not isinstance(n, dict) or "version" not in n:
        card["nudge"] = default_nudge_state()
    return card["nudge"]


# ── dependency-graph helpers ──────────────────────────────────────────────────
def _first_open(nodes: list, edges: list) -> str | None:
    """First not-done node whose prerequisites (incoming edges) are all done.

    An edge {from, to} means `from` is a prerequisite of `to`.
    """
    by_id = {n["id"]: n for n in nodes}
    prereqs: dict[str, list] = {}
    for e in edges:
        prereqs.setdefault(e["to"], []).append(e["from"])
    for n in nodes:
        if n.get("done"):
            continue
        # The event block CAN go active — that is the "start the work/event"
        # nudge, fired at its anchor once all prep is done.
        if all(by_id.get(p, {}).get("done", True) for p in prereqs.get(n["id"], [])):
            return n["id"]
    return None


def _linearize_chain(nodes: list, edges: list) -> tuple[list, list]:
    """Force the breakdown into a strict linear chain — a breakdown is a
    sequence of steps, never parallel work. Topo-sort the prep nodes by the
    given edges (stable on input order, which is the model's plan order) so any
    intended precedence survives, then re-chain step0 -> step1 -> ... -> stepN
    and discard the model's branching edges. Event-block nodes (is_event_start)
    are kept out of the chain; ensure_event_block re-attaches the lone terminal
    sink after deadlines. Idempotent: a chain in stays a chain out."""
    prep = [n for n in nodes if not n.get("is_event_start")]
    events = [n for n in nodes if n.get("is_event_start")]
    if len(prep) <= 1:
        return prep + events, []
    ids = [n["id"] for n in prep]
    idset = set(ids)
    indeg = {i: 0 for i in ids}
    succ = {i: [] for i in ids}
    for e in edges:
        f, t = e.get("from"), e.get("to")
        if f in idset and t in idset and f != t:
            indeg[t] += 1
            succ[f].append(t)
    by_id = {n["id"]: n for n in prep}
    ordered, placed = [], set()
    while len(ordered) < len(ids):
        nxt = next((i for i in ids if i not in placed and indeg[i] == 0), None)
        if nxt is None:                      # cycle/stuck — keep the rest in input order
            ordered.extend(by_id[i] for i in ids if i not in placed)
            break
        ordered.append(by_id[nxt])
        placed.add(nxt)
        for s in succ[nxt]:
            indeg[s] -= 1
    chain = [{"from": ordered[k]["id"], "to": ordered[k + 1]["id"]}
             for k in range(len(ordered) - 1)]
    return ordered + events, chain


def _normalize_graph(data: dict) -> dict:
    now = _fmt_et(_now_et())
    nodes = []
    for nd in data.get("nodes", []):
        if not nd.get("id"):
            continue
        node = {
            "id": nd["id"],
            "label": nd.get("label", ""),
            "done": bool(nd.get("done", False)),
            "depth": int(nd.get("depth", 0)),
            "created_at": nd.get("created_at") or now,
        }
        try:
            if nd.get("est_min"):
                node["est_min"] = max(1, int(nd["est_min"]))
        except (TypeError, ValueError):
            pass
        try:
            if nd.get("tl_offset") is not None:        # manual dirs-timeline placement
                node["tl_offset"] = int(nd["tl_offset"])
        except (TypeError, ValueError):
            pass
        if nd.get("is_event_start"):
            node["is_event_start"] = True   # est_min (the work block) set by ensure_event_block
        nodes.append(node)
    ids = {n["id"] for n in nodes}
    edges = [
        {"from": e["from"], "to": e["to"]}
        for e in data.get("edges", [])
        if e.get("from") in ids and e.get("to") in ids
    ]
    nodes, edges = _linearize_chain(nodes, edges)   # breakdown is a chain, never parallel
    active = data.get("active_node")
    if active not in ids:
        active = _first_open(nodes, edges)
    return {"nodes": nodes, "edges": edges, "active_node": active,
            "nudge_text": data.get("nudge_text", "")}


def clear_awaiting_focused() -> str | None:
    """User spoke in exec chat: mark the focused awaiting card replied-to so the
    stall timer stops. Focused = most recently nudged (a reply about card A must
    not silence card B's stall). Returns the card id or None."""
    from helpers import _load_rd, _save_rd
    from scheduler import logical_today_iso
    rd = _load_rd()
    today = logical_today_iso()
    cands = [
        c for c in rd.get("cards", [])
        if _eligible(c, today) and (c.get("nudge") or {}).get("awaiting_reply")
    ]
    if not cands:
        return None
    card = max(cands, key=lambda c: c["nudge"].get("last_nudge_at") or "")
    n = card["nudge"]
    now = _now_et()
    n["awaiting_reply"] = False
    n["last_user_reply_at"] = _fmt_et(now)
    if n.get("stage") == "awaiting":
        # Replied but not done: restart the no-response window so the loop
        # re-nudges if Wai goes quiet again (advance/consequences override this).
        n["stage"] = "nudging"
        n["next_nudge_at"] = _fmt_et(now + timedelta(minutes=window_for(card)))
        n["window_deadline"] = None
    _save_rd(rd)
    return card["id"]


def active_label(card: dict) -> str:
    n = card.get("nudge") or {}
    for nd in n.get("graph", {}).get("nodes", []):
        if nd["id"] == n.get("active_node"):
            return nd["label"]
    return card.get("title", "")
