"""Deadline math for the nudge engine: per-card deadline precedence, staggered
auto-deadlines, DAG back-scheduling of per-node deadlines, the event terminal
node, and the morning re-anchor.

Split out of nudge.py (alongside nudge_llm/nudge_loop) to keep modules under the
line cap. One-way: imports the state/eligibility leaves from nudge; nothing in
nudge imports back here."""
from datetime import datetime, timedelta

from helpers import _now_et, _prep_min, _work_min
from nudge import (
    ensure_nudge, decomposable, _eligible, _lead, _factor, slot_datetime,
    _fmt_et, _parse_et,
)

_EOD_HOUR = 21  # fallback deadline for a today card with no event time / due time
_EVENT_NODE_ID = "event-start"


def _total_min(c: dict) -> int:
    return _prep_min(c) + _work_min(c)


def _has_fixed_deadline(c: dict) -> bool:
    """A real, user-set deadline: a timeline slot (event/placed) or a timed due_date."""
    return slot_datetime(c) is not None or "T" in (c.get("due_date") or "")


def card_deadline(c: dict) -> datetime:
    """When the whole card must be DONE — the END of its timeline block, so the
    event block (the final `work` minutes) ends here and the prep back-schedules
    before the anchor (= deadline - work). Precedence:
      placed slot (block start) + total > timed due_date (event start) + work >
      auto-staggered block-end > end of its scheduled day.
    For a correctly placed timed card the first two agree (dir_start_min was set
    to event_time - prep)."""
    slot = slot_datetime(c)              # dir_start_min based = block start
    if slot is not None:
        return slot + timedelta(minutes=_total_min(c))
    dd = c.get("due_date") or ""
    if "T" in dd:
        try:
            return datetime.fromisoformat(dd) + timedelta(minutes=_work_min(c))
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


def ensure_event_block(card: dict) -> bool:
    """Every decomposable card carries ONE terminal event-block node — the atomic
    'work' the prep leads up to. Its est_min = the card's work minutes, so it
    occupies [anchor, anchor+work] at the end of the block while every prep step
    back-schedules before the anchor. Drops the node if the card stops being
    decomposable (became a reminder/book). Returns True if anything changed."""
    n = ensure_nudge(card)
    nodes, edges = n["graph"]["nodes"], n["graph"]["edges"]
    evt = next((nd for nd in nodes if nd.get("is_event_start")), None)
    work = _work_min(card)
    # The event block exists ONLY for an atomic external occurrence reached through
    # PREP (prep > 0 and work > 0). A self-directed task (work == 0) is all
    # prep/steps; and a card with NO prep (prep == 0) is fully decomposed into work
    # steps — neither carries an event node.
    if not decomposable(card) or work <= 0 or _prep_min(card) <= 0:
        if evt:
            n["graph"]["nodes"] = [nd for nd in nodes if not nd.get("is_event_start")]
            n["graph"]["edges"] = [e for e in edges if evt["id"] not in (e["from"], e["to"])]
            return True
        return False
    dirty = False
    label = card.get("title", "Event")
    if not evt:
        evt = {"id": _EVENT_NODE_ID, "label": label, "done": False, "depth": 0,
               "created_at": _fmt_et(_now_et()), "est_min": work, "is_event_start": True}
        nodes.append(evt)
        dirty = True
    else:
        if evt["label"] != label:
            evt["label"] = label
            dirty = True
        if evt.get("est_min") != work:
            evt["est_min"] = work
            dirty = True
    has_out = {e["from"] for e in edges}
    for nd in nodes:
        if nd["id"] == evt["id"] or nd["id"] in has_out:
            continue
        edges.append({"from": nd["id"], "to": evt["id"]})
        dirty = True
    return dirty


def compute_deadlines(card: dict) -> bool:
    """Back-schedule a per-node deadline from the card deadline: the last node(s)
    finish by the deadline, each node finishes before any successor must start.
    Sets node['est_min'] and node['deadline'] (ISO). Returns True if anything
    changed. Pure (no I/O); cheap enough to run every tick."""
    n = ensure_nudge(card)
    changed = ensure_event_block(card)
    nodes = n["graph"]["nodes"]
    if not nodes:
        return changed
    prep_nodes = [nd for nd in nodes if not nd.get("is_event_start")]
    # Budget the per-step default est across the decomposed nodes: prep minutes for
    # a prep+event card, the full estimate when there's no prep (fully decomposed).
    budget = _prep_min(card) or _total_min(card)
    default = max(5, round(budget / max(1, len(prep_nodes))))
    for nd in nodes:
        if nd.get("est_min") is None:               # the event node is set above
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
    est = active.get("est_min")
    # No node estimate -> _lead already carries the factor; otherwise bias the
    # node's own duration so a late-prone category gets nudged to start earlier.
    lead_min = _lead(card) if est is None else round(est * _factor(card))
    return dl - timedelta(minutes=lead_min)


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
