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
from scheduler import is_dir_card

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


def _eligible(c: dict, today_iso: str) -> bool:
    """On today's dirs timeline, actionable, not a book — i.e. nudge-able."""
    return is_dir_card(c, today_iso) and c.get("size") != "book"


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
        nodes.append({
            "id": nd["id"],
            "label": nd.get("label", ""),
            "done": bool(nd.get("done", False)),
            "depth": int(nd.get("depth", 0)),
            "created_at": nd.get("created_at") or now,
        })
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
    n["awaiting_reply"] = False
    n["last_user_reply_at"] = _fmt_et(_now_et())
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
    "No Unicode emoji."
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
def decompose_sync(card: dict) -> dict:
    system = (
        "You are Exec, Wai's ADHD planning assistant. Build a SMALL internal dependency "
        "graph for ONE task: its concrete sub-steps and which must precede which (an edge "
        "{from,to} means `from` must be done before `to`). Then pick the FIRST doable node "
        "(no unfinished prerequisites) and write the opening nudge for ONLY that chunk.\n"
        f"{_TONE}\n"
        "The nudge is 1-2 sentences naming only the first chunk, plus 1 sentence of why it "
        "matters (reasoning / consequence / dependency). Never reveal the whole plan.\n\n"
        f"KNOWN CONTEXT ABOUT WAI:\n{_profile_text()}\n\n"
        'Return JSON only: {"nodes":[{"id":"n1","label":"..."},...],'
        '"edges":[{"from":"n1","to":"n2"},...],"active_node":"n1","nudge_text":"..."}'
    )
    return _normalize_graph(_json_call(system, _card_brief(card)))


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
