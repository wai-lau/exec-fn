"""Task-decomposition + time-based nudge loop (Phase 1).

Pure logic + LLM calls; callers load/save rd.json (mirrors scheduler.schedule_to_day).
A card carries its loop state in card["nudge"]; the internal dependency graph lives
there and is used to surface the next chunk — it is never shown whole to Wai.

All timestamps here are naive-ET ISO (matching helpers._now_et), never mixed with the
UTC isoformat used by the activity log / chat.
"""
import anthropic
from datetime import datetime, timedelta

from helpers import _now_et, _load_json, _parse_json, _SIZE_MINUTES

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


def window_for(card: dict) -> int:
    est = card.get("estimated_time") or _SIZE_MINUTES.get(card.get("size") or "task", 90)
    return max(NUDGE_WINDOW_MIN, min(NUDGE_WINDOW_MAX, round(est * NUDGE_WINDOW_MULT)))


def decomposable(c: dict) -> bool:
    """Every actionable hq card should carry a plan (graph), placed today or not.

    Events are included (they can have prep steps) but never get time-based
    nudges — `_eligible` excludes them via `is_dir_card`. Reminders (no work)
    and books (reading only) are excluded from plans entirely.
    """
    return (
        c.get("column") == "hq"
        and not c.get("is_reminder")
        and c.get("size") != "book"
    )


def _eligible(c: dict, today_iso: str) -> bool:
    """Nudge-able: has a plan (decomposable hq card, events included) AND is
    scheduled for today. Everything with a plan scheduled today nudges; a
    dir_start_min slot is optional (see nudge_anchor for the fallback time)."""
    return decomposable(c) and c.get("scheduled_day") == today_iso


_EOD_HOUR = 21  # fallback deadline for a today card with no event time / due time


def _lead(c: dict) -> int:
    """Total minutes to do the whole task (sum of node work, or the estimate)."""
    return c.get("estimated_time") or _SIZE_MINUTES.get(c.get("size") or "task", 90)


def _has_fixed_deadline(c: dict) -> bool:
    """A real, user-set deadline: a timeline slot (event/placed) or a timed due_date."""
    return slot_datetime(c) is not None or "T" in (c.get("due_date") or "")


def card_deadline(c: dict) -> datetime:
    """When the whole card must be DONE: a fixed deadline (slot / timed due_date),
    else the auto-assigned staggered deadline, else end of its scheduled day."""
    slot = slot_datetime(c)
    if slot is not None:
        return slot
    dd = c.get("due_date") or ""
    if "T" in dd:
        try:
            return datetime.fromisoformat(dd)
        except ValueError:
            pass
    auto = (c.get("nudge") or {}).get("auto_deadline")
    if auto:
        d = _parse_et(auto)
        if d:
            return d
    sd = c.get("scheduled_day") or ""
    base = datetime.fromisoformat(sd[:10]) if sd else _now_et()
    return base.replace(hour=_EOD_HOUR, minute=0, second=0, microsecond=0)


def assign_auto_deadlines(cards: list, today_iso: str, now: datetime) -> bool:
    """Give every eligible today card a deadline. Cards without a fixed deadline
    get a staggered nudge.auto_deadline — stacked sequentially from now by each
    card's estimate, in `order` — so they spread across the day instead of all
    collapsing to end-of-day. Pinned once, stable across ticks. Returns dirty."""
    elig = [
        c for c in cards
        if _eligible(c, today_iso)
        and (c.get("nudge") or {}).get("stage") != "resolved"
        and not _has_fixed_deadline(c)
    ]
    elig.sort(key=lambda c: c.get("order", 0))
    cursor = now
    dirty = False
    for c in elig:
        n = ensure_nudge(c)
        if n.get("auto_deadline"):
            d = _parse_et(n["auto_deadline"])
            if d:
                cursor = max(cursor, d)
            continue
        cursor = cursor + timedelta(minutes=_lead(c))
        n["auto_deadline"] = _fmt_et(cursor)
        dirty = True
    return dirty


def _back_schedule(nodes: list, edges: list, D: datetime, default: int) -> dict:
    """Map node id -> deadline. A node's deadline is the earliest start of any
    successor (its deadline minus its duration); a sink's deadline is D."""
    by_id = {nd["id"]: nd for nd in nodes}
    succ: dict[str, list] = {}
    for e in edges:
        succ.setdefault(e["from"], []).append(e["to"])
    cache: dict[str, datetime] = {}

    def deadline_of(nid: str, seen: frozenset) -> datetime:
        if nid in cache:
            return cache[nid]
        outs = [] if nid in seen else succ.get(nid, [])
        cache[nid] = D if not outs else min(
            deadline_of(s, seen | {nid}) - timedelta(minutes=by_id[s].get("est_min", default))
            for s in outs if s in by_id
        )
        return cache[nid]

    return {nd["id"]: deadline_of(nd["id"], frozenset()) for nd in nodes}


def compute_deadlines(card: dict) -> bool:
    """Back-schedule a per-node deadline from the card deadline: the last node(s)
    finish by the deadline, each node finishes before any successor must start.
    Sets node['est_min'] and node['deadline'] (ISO). Returns True if anything
    changed. Pure (no I/O); cheap enough to run every tick."""
    n = ensure_nudge(card)
    nodes = n["graph"]["nodes"]
    if not nodes:
        return False
    default = max(5, round(_lead(card) / len(nodes)))
    changed = False
    for nd in nodes:
        if not nd.get("est_min"):
            nd["est_min"] = default
            changed = True
    deadlines = _back_schedule(nodes, n["graph"]["edges"], card_deadline(card), default)
    for nd in nodes:
        d = _fmt_et(deadlines[nd["id"]])
        if nd.get("deadline") != d:
            nd["deadline"] = d
            changed = True
    return changed


def active_anchor(card: dict) -> datetime | None:
    """When to nudge: the start time of the active node (its deadline minus its
    own duration) so it gets DONE by its deadline — not nudged at the deadline."""
    n = card.get("nudge") or {}
    active = next((nd for nd in n.get("graph", {}).get("nodes", [])
                   if nd["id"] == n.get("active_node")), None)
    if not active or not active.get("deadline"):
        return None
    dl = _parse_et(active["deadline"])
    return dl - timedelta(minutes=active.get("est_min") or _lead(card))


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
        if all(by_id.get(p, {}).get("done", True) for p in prereqs.get(n["id"], [])):
            return n["id"]
    return None


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
        nodes.append(node)
    ids = {n["id"] for n in nodes}
    edges = [
        {"from": e["from"], "to": e["to"]}
        for e in data.get("edges", [])
        if e.get("from") in ids and e.get("to") in ids
    ]
    active = data.get("active_node")
    if active not in ids:
        active = _first_open(nodes, edges)
    return {"nodes": nodes, "edges": edges, "active_node": active,
            "nudge_text": data.get("nudge_text", "")}


def morning_reconcile(cards: list, today_iso: str) -> None:
    """4:30 AM: re-anchor nudge timing to the day's fresh layout.

    Placed today  -> fresh first nudge at the (possibly restacked) slot.
    Not placed    -> disarm to idle so the card re-arms when its day comes
                     (NOT resolved — that would skip it forever).
    Keeps graph, active_node, redecompose metrics, and the consequences record.
    Never leaves a past-dated next_nudge_at (the stale overnight-fire bug).
    """
    for c in cards:
        n = c.get("nudge")
        if not isinstance(n, dict) or n.get("stage") in (None, "idle", "resolved"):
            continue
        n["awaiting_reply"] = False
        n["window_deadline"] = None
        # Fresh day: the scan re-arms from the active node's deadline + re-staggers.
        n["last_nudge_at"] = None
        n["last_nudge_text"] = ""
        n["auto_deadline"] = None
        if _eligible(c, today_iso):
            compute_deadlines(c)
            anchor = active_anchor(c)
            n["stage"] = "nudging"
            n["first_nudge_at"] = _fmt_et(anchor) if anchor else None
            n["next_nudge_at"] = _fmt_et(anchor) if anchor else None
        else:
            n["stage"] = "idle"
            n["first_nudge_at"] = None
            n["next_nudge_at"] = None


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


# ── LLM plumbing ──────────────────────────────────────────────────────────────
_TONE = (
    "VOICE: a practical adult with good executive function — gentle and inviting, never "
    "saccharine, fake-cheerful, or clipped/commanding. Use a warm opener and a soft "
    "suggestion. Model: \"Hey, why don't you open the app and see what's there?\" Avoid "
    "\"Just open the app...\" (too clipped) and \"You've totally got this!!\" (fake). "
    "No Unicode emoji. "
    "NEVER suggest blocking, scheduling, or carving out time on a calendar — Exec IS "
    "Wai's calendar and the task is already on today's timeline. Nudge the actual work, "
    "never calendar admin."
)


def _profile_text() -> str:
    ctx = _load_json("profile", {"notes": []})
    return "\n".join(f"- {n['note']}" for n in ctx.get("notes", [])) or "None."


def _card_brief(card: dict) -> str:
    parts = [f"TASK: {card.get('title', '')}"]
    if card.get("notes"):
        parts.append(f"NOTES: {card['notes']}")
    if card.get("estimated_time"):
        parts.append(f"ESTIMATE: ~{card['estimated_time']} min")
    if card.get("due_date"):
        parts.append(f"DUE: {card['due_date']}")
    ans = (card.get("nudge") or {}).get("consequences", {}).get("answer")
    if ans:
        parts.append(f"WAI'S STATED CONSEQUENCE IF NOT DONE: {ans}")
    return "\n".join(parts)


def _json_call(system: str, user: str, max_tokens: int = 700) -> dict:
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=_MODEL, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": user}],
    )
    return _parse_json(msg.content[0].text)


# ── decomposition (one LLM call: build graph + first node + opening nudge) ─────
def decompose_sync(card: dict, feedback: str = "") -> dict:
    system = (
        "You are Exec, Wai's ADHD planning assistant. Build a SMALL internal dependency "
        "graph for ONE task: its concrete sub-steps and which must precede which (an edge "
        "{from,to} means `from` must be done before `to`). Give each node est_min: how "
        "many minutes that single step realistically takes (the steps should sum to about "
        "the task estimate). Then pick the FIRST doable node (no unfinished prerequisites) "
        "and write the opening nudge for ONLY that chunk.\n"
        f"{_TONE}\n"
        "The nudge is 1-2 sentences naming only the first chunk, plus 1 sentence of why it "
        "matters (reasoning / consequence / dependency). Never reveal the whole plan.\n\n"
        f"KNOWN CONTEXT ABOUT WAI:\n{_profile_text()}\n\n"
        'Return JSON only: {"nodes":[{"id":"n1","label":"...","done":false,"est_min":15},...],'
        '"edges":[{"from":"n1","to":"n2"},...],"active_node":"n1","nudge_text":"..."}'
    )
    user = _card_brief(card)
    n = card.get("nudge") or {}
    nodes = n.get("graph", {}).get("nodes", [])
    if nodes:
        existing = "\n".join(
            f"- [{'done' if nd.get('done') else 'open'}] {nd['label']}" for nd in nodes
        )
        user += (
            f"\n\nEXISTING BREAKDOWN (rebuild from this — keep done steps done, "
            f"reuse labels where still right):\n{existing}"
        )
    if feedback.strip():
        user += f"\n\nWAI'S FEEDBACK TO INCORPORATE: {feedback.strip()}"
    return _normalize_graph(_json_call(system, user))


# ── stall: peel a smaller first sub-step off the active node ──────────────────
def peel_sync(card: dict) -> dict:
    """LLM only; caller mutates the graph. Returns {sub_label, nudge_text}."""
    n = ensure_nudge(card)
    chunk = active_label(card)
    system = (
        "You are Exec, Wai's ADHD planning assistant. Wai has stalled on a step. Peel "
        "off a SMALLER first sub-step: the tiniest concrete action that starts it. "
        "There is no floor — 'open the app' or 'put the tab on screen' is fine.\n"
        f"{_TONE}\n"
        "Also write the nudge for ONLY that sub-step: 1-2 sentences naming it, plus 1 "
        "sentence of why it matters (reasoning / consequence / dependency). Give est_min "
        "= minutes the tiny sub-step takes (usually 1-10).\n\n"
        f"KNOWN CONTEXT ABOUT WAI:\n{_profile_text()}\n\n"
        'Return JSON only: {"sub_label":"...","est_min":5,"nudge_text":"..."}'
    )
    user = (
        f"{_card_brief(card)}\n\nSTALLED STEP: {chunk}\n"
        f"ALREADY PEELED {n.get('redecompose_count', 0)} TIME(S) — go smaller than last time."
    )
    return _json_call(system, user, max_tokens=300)


def apply_peel(card: dict, sub_label: str, est_min: int = 5) -> str:
    """Insert the peeled sub-step as a prerequisite of the active node and make it
    active. Returns the new node id."""
    n = ensure_nudge(card)
    parent_id = n.get("active_node")
    nodes = n["graph"]["nodes"]
    parent = next((nd for nd in nodes if nd["id"] == parent_id), None)
    now = _now_et()
    new_id = f"peel-{now.strftime('%H%M%S')}-{len(nodes)}"
    nodes.append({
        "id": new_id,
        "label": sub_label,
        "done": False,
        "depth": (parent.get("depth", 0) + 1) if parent else 0,
        "created_at": _fmt_et(now),
        "est_min": max(1, int(est_min or 5)),
    })
    if parent_id:
        n["graph"]["edges"].append({"from": new_id, "to": parent_id})
    n["active_node"] = new_id
    n["redecompose_count"] = n.get("redecompose_count", 0) + 1
    n.setdefault("redecompose_at", []).append(_fmt_et(now))
    return new_id


# ── nudge text for the current chunk (graph already exists) ───────────────────
def nudge_text_sync(card: dict) -> str:
    n = ensure_nudge(card)
    chunk = active_label(card)
    redec = n.get("redecompose_count", 0)
    system = (
        "You are Exec, Wai's ADHD planning assistant. Write ONE nudge for the next chunk "
        "of a task. 1-2 sentences naming only that chunk, plus 1 sentence of why it "
        "matters (reasoning / consequence / dependency). Never reveal the whole plan.\n"
        f"{_TONE}\n"
        + (
            f"Wai has been re-nudged {redec} time(s) on this task without starting — keep "
            "it extra small and inviting, zero pressure.\n" if redec else ""
        )
        + f"\nKNOWN CONTEXT ABOUT WAI:\n{_profile_text()}\n\nReply with the nudge text only."
    )
    user = f"{_card_brief(card)}\n\nNEXT CHUNK: {chunk}"
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=_MODEL, max_tokens=200, system=system,
        messages=[{"role": "user", "content": user}],
    )
    return msg.content[0].text.strip()
