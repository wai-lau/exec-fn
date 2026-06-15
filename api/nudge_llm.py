"""LLM calls for the nudge loop — decompose / triage / peel / nudge-text.

Split out of nudge.py to keep modules under the line cap. Imports the engine
helpers it needs from nudge (one-way; nudge never imports this back)."""
import anthropic
from datetime import datetime, timedelta

from helpers import _now_et, _load_json, _parse_json
from nudge import ensure_nudge, active_label, _normalize_graph, _fmt_et, _parse_et, _MODEL


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
    et = card.get("estimated_time")
    if et:
        prep = card.get("prep_time") or 0
        if prep:
            parts.append(
                f"ESTIMATE: ~{et} min total (~{prep} min prep/lead-up before "
                f"~{max(0, et - prep)} min of core work)"
            )
        else:
            parts.append(f"ESTIMATE: ~{et} min")
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
        "the task estimate). LABELS are short action phrases (3-7 words) — never embed "
        "times, durations, or distances in a label. Do NOT add a node for the event "
        "itself, 'arrive', or 'leave by <time>'; travel is just a step labelled e.g. "
        "'Travel to the venue' with est_min = the travel minutes. Then pick the FIRST "
        "doable node (no unfinished prerequisites) and write the opening nudge for ONLY "
        "that chunk.\n"
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
    work = [nd for nd in nodes if not nd.get("is_event_start")]
    if work:
        existing = "\n".join(
            f"- [{'done' if nd.get('done') else 'open'}] {nd['label']}" for nd in work
        )
        user += (
            f"\n\nEXISTING BREAKDOWN (rebuild from this — keep done steps done, "
            f"reuse labels where still right):\n{existing}"
        )
    if feedback.strip():
        user += f"\n\nWAI'S FEEDBACK TO INCORPORATE: {feedback.strip()}"
    return _normalize_graph(_json_call(system, user))


# ── triage: did a card edit change what the plan should be? ───────────────────
def triage_sync(card: dict) -> dict:
    """A card's details changed. Decide whether the breakdown should change to
    reflect them (a new constraint, scope change, or missing step) and, if so,
    return a rebuilt graph preserving completed steps.

    Returns {"needs_update": False} or
    {"needs_update": True, "nodes", "edges", "active_node"}."""
    nodes = ensure_nudge(card)["graph"]["nodes"]
    existing = "\n".join(
        f"- [{'done' if nd.get('done') else 'open'}] {nd['label']} ({nd.get('est_min', '?')}m)"
        for nd in nodes if not nd.get("is_event_start")
    ) or "(none)"
    system = (
        "You are Exec, Wai's ADHD planning assistant. A task's details changed. Update its "
        "step breakdown to reflect the new info. needs_update=true whenever the note adds "
        "a step, a person to contact, a location/travel detail, a dependency, or a "
        "constraint — only keep it false if the note genuinely changes nothing about what "
        "must be done. If a distance or 'N min away' appears, add a 'Travel to ...' step "
        "with est_min = the travel minutes. LABELS are short action phrases (3-7 words), "
        "never embedding times/durations/distances. Do NOT add a node for the event "
        "itself or 'arrive' — that's handled automatically. Preserve completed steps "
        "(done=true); give each node est_min.\n\n"
        f"KNOWN CONTEXT ABOUT WAI:\n{_profile_text()}\n\n"
        'Return JSON only. No change: {"needs_update":false}. '
        'Changed: {"needs_update":true,"nodes":[{"id":"n1","label":"...","done":false,'
        '"est_min":15},...],"edges":[{"from":"n1","to":"n2"},...],"active_node":"n1"}'
    )
    user = f"{_card_brief(card)}\n\nCURRENT BREAKDOWN:\n{existing}"
    data = _json_call(system, user, max_tokens=700)
    if not data.get("needs_update"):
        return {"needs_update": False}
    g = _normalize_graph(data)
    return {"needs_update": True, "nodes": g["nodes"],
            "edges": g["edges"], "active_node": g["active_node"]}


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


def _fmt_clock(dt: datetime) -> str:
    return dt.strftime("%-I:%M %p").lower()


def _active_node(card: dict) -> dict | None:
    n = card.get("nudge") or {}
    return next((nd for nd in n.get("graph", {}).get("nodes", [])
                 if nd["id"] == n.get("active_node")), None)


# ── nudge text for the current chunk (graph already exists) ───────────────────
def nudge_text_sync(card: dict) -> str:
    n = ensure_nudge(card)
    active = _active_node(card)
    chunk = active["label"] if active else active_label(card)
    redec = n.get("redecompose_count", 0)

    time_hint = ""
    if active and active.get("deadline"):
        dl = _parse_et(active["deadline"])
        start = dl - timedelta(minutes=active.get("est_min") or 0)
        time_hint = (
            f"\nTIMING: this step needs to be done by {_fmt_clock(dl)}; to make that, it "
            f"should start by {_fmt_clock(start)}."
        )

    system = (
        "You are Exec, Wai's ADHD planning assistant. Write ONE nudge for the next chunk "
        "of a task. 1-2 sentences naming only that chunk, plus 1 sentence of why it "
        "matters (reasoning / consequence / dependency). Never reveal the whole plan.\n"
        f"{_TONE}\n"
        "If the step is time-critical — especially leaving or travelling to be somewhere "
        "on time — LEAD with the clock time and the action, plainly. Model: "
        "\"By 6:30, leave home to meet Aman — it's a 30-minute trip and you don't want to "
        "be late.\" Keep the warm, practical register; just put the time first.\n"
        + (
            f"Wai has been re-nudged {redec} time(s) on this task without starting — keep "
            "it extra small and inviting, zero pressure.\n" if redec else ""
        )
        + f"\nKNOWN CONTEXT ABOUT WAI:\n{_profile_text()}\n\nReply with the nudge text only."
    )
    user = f"{_card_brief(card)}\n\nNEXT CHUNK: {chunk}{time_hint}"
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=_MODEL, max_tokens=200, system=system,
        messages=[{"role": "user", "content": user}],
    )
    return msg.content[0].text.strip()
