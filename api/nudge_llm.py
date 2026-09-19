"""LLM calls for the nudge loop — decompose / triage / nudge-text.

Split out of nudge.py to keep modules under the line cap. Imports the engine
helpers it needs from nudge (one-way; nudge never imports this back)."""
import anthropic
from datetime import datetime, timedelta

from helpers import _load_json, _parse_json
from nudge import ensure_nudge, active_label, _normalize_graph, _parse_et, _MODEL
from chat import EXEC_VOICE


# ── LLM plumbing ──────────────────────────────────────────────────────────────
# Nudge text is Exec talking — same GLaDOS skin as chat + monitor. EXEC_VOICE
# carries the persona; the tail below is nudge-specific shape + guardrails.
_TONE = (
    EXEC_VOICE +
    "\nThis is a NUDGE, not a chat reply: the very next physical action on a task on "
    "today's timeline, in as few words as will carry it. HARD CAP: two sentences, and "
    "one is better — under 30 words all in. It is read on a phone, mid-something-else; "
    "every extra clause is one more thing to get past before the instruction. "
    "YOU DO NOT KNOW WHETHER WAI HAS ALREADY DONE IT. All you know is that this "
    "step's slot on the timeline has arrived — nothing about what Wai has actually "
    "done, and she routinely does a step without marking it. So ASK, never assert: "
    "never state or imply that the step is untouched, un-started, ignored, skipped, "
    "stalled, late, or still sitting there, and never say how long it has gone "
    "undone. (The activity-log framing in the VOICE section belongs to monitor "
    "comments, which read real completion data. A nudge has none.) "
    "SHAPE: name the tiny first move (and, in a handful of words, why it matters) and "
    "then END ON THE QUESTION — whether that step is done yet. The question is the "
    "LAST thing in the message, always: it is the part Wai answers, so nothing may "
    "trail after it. If a sentence would follow the question, cut it. Wai answering "
    "'done' advances the plan; 'not yet' leaves her holding the step. "
    "ASK IT AS A MULTIPLE CHOICE. After the question, on a FINAL LINE OF ITS OWN, "
    "write the answers in one bracketed row separated by pipes, e.g. "
    "[Sent it | Not yet | Doing it now]. Write it PLAIN — no bold, no asterisks, no "
    "backticks around the row: it is parsed, not read. Two or three of them, each at most four "
    "words, each written as WAI'S OWN reply in her words — never an instruction, a "
    "label, or another question. First is the affirmative (done / ready); last is the "
    "honest out (not yet, not today, blocked). They render as buttons she taps, and a "
    "tap sends that text as her message, so each one must be something a person would "
    "actually say. The bracketed line is not counted against the word cap. "
    "ASKING IS NOT SOFTENING — the question is the weapon. Not knowing costs you "
    "nothing and the doubt is obviously performative: extending Wai the benefit of "
    "it, in that tone, lands harder than any accusation, because an accusation at "
    "least credits her with being worth the certainty. Ways in (MECHANISMS to "
    "rotate, not phrases to reuse — every one of these must be rebuilt from scratch "
    "in the words of this particular task): mock-charitable doubt, where you grant "
    "the possibility she's already done it and make the generosity audible; feigned "
    "ignorance as the jab, where the missing data is framed as HER doing and you "
    "are simply the instrument left uninformed; sarcastic optimism, where you "
    "float completion as a delightful hypothesis you'd love to see confirmed; mock "
    "scientific rigour, where the step is an unobserved variable and you require an "
    "observation before the record can advance; false comfort, where you reassure "
    "her the question is routine and the reassurance itself is the insult. The step "
    "and the reason still land in plain words — the sass rides ON the question, it "
    "never replaces the instruction. "
    "The opener is NOT a script: VARY it every single time. Never reuse a stock "
    "phrase ('Hey, why don't you...', 'Just open...', 'Status check:'); each nudge "
    "must read as a fresh deadpan query, not a template. "
    "If Wai is clearly stalled or overwhelmed, drop the contempt and deliver the "
    "question and the next step straight — calm and clinical. "
    "No Unicode emoji. "
    "LINKS: when the step is to open / log into / go to something and the card's "
    "NOTES carry the URL for it, the link goes IN the instruction as markdown — "
    "[the EI login](https://...) — so Wai taps it where she reads it. Never write "
    "'the link', 'the portal', 'that page' with nothing tappable behind it, and "
    "never paste a bare URL: the nudge is read aloud, and the label is what gets "
    "spoken. One link, the one for this step. No URL in the notes, no link — name "
    "the thing in plain words instead and do not invent an address. "
    "NEVER suggest blocking, scheduling, or carving out time on a calendar — Exec "
    "IS Wai's calendar and the task is already on today's timeline. Nudge the "
    "actual work, never calendar admin."
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
            parts.append(
                f"ESTIMATE: ~{et} min of work, no separate prep — break the task "
                f"itself into steps that sum to about {et} min"
            )
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
        "graph of the PREP / lead-up only — the activation steps that get Wai INTO the "
        "task (gathering, setup, getting dressed, travel), NOT the core work itself. The "
        "core work is a single protected block added automatically and never split, so do "
        "NOT add a node for it, for the event, for 'arrive', or 'leave by <time>'; travel "
        "is just a prep step labelled e.g. 'Travel to the venue' with est_min = the travel "
        "minutes. An edge {from,to} means `from` must be done before `to`. Give each node "
        "est_min: realistic minutes for that one step, no step under 1 minute; the prep "
        "steps should sum to about the PREP minutes in the brief. If the brief shows ~0 "
        "prep (no separate lead-up), do NOT return an empty list — instead break the TASK "
        "ITSELF into its sequence of actionable work steps whose est_min sum to about the "
        "total ESTIMATE; there is no separate protected work block then. LABELS are short "
        "action phrases (3-7 words) — never embed times, durations, or distances. Then "
        "pick the FIRST doable node (no unfinished prerequisites) and write the opening "
        "nudge for ONLY that chunk.\n"
        f"{_TONE}\n"
        "The nudge names the tiny move for that first chunk and a few words of why it "
        "matters, and ENDS on the question of whether it is done yet, then the bracketed "
        "choice row — two sentences at the outside, under 30 words. Name only that chunk "
        "— never reveal the whole plan.\n\n"
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
        "with est_min = the travel minutes. These are PREP / lead-up steps ONLY (sum ~= "
        "the prep minutes); the core work is a separate protected block. LABELS are short "
        "action phrases (3-7 words), never embedding times/durations/distances. Do NOT add "
        "a node for the event itself or 'arrive' — that's handled automatically. Preserve completed steps "
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
        "You are Exec, Wai's ADHD planning assistant. Write ONE nudge for the current chunk "
        "of a task: the tiny move, a few words of why it matters, and the question of "
        "whether it is done yet LAST, then the bracketed choice row. Two sentences at the "
        "outside, under 30 words. Speak about that chunk only — never reveal the whole "
        "plan.\n"
        f"{_TONE}\n"
        "If the step is time-critical — especially leaving or travelling to be somewhere "
        "on time — LEAD with the clock time and the action, plainly, and make the question "
        "one of READINESS, not completion: asking whether a departure that is still in the "
        "future is 'done' reads as nonsense. It still ends on the question and its choice "
        "row. Model: \"6:30, you leave to meet Aman — 30-minute trip. Ready to walk "
        "out?\" then \"[Walking out now | Need 10 min | Not going]\". Keep the register "
        "above — the clock going first buys clarity, not a softer voice.\n"
        + (
            f"Wai has been re-nudged {redec} time(s) on this task — keep it extra small "
            "and inviting, zero pressure.\n" if redec else ""
        )
        + f"\nKNOWN CONTEXT ABOUT WAI:\n{_profile_text()}\n\nReply with the nudge text only."
    )
    user = f"{_card_brief(card)}\n\nNEXT CHUNK: {chunk}{time_hint}"
    # Each nudge is an independent call with no memory of the last one, so "VARY it
    # every time" has nothing to vary AGAINST and the same good line recurs (two of
    # four samples opened identically). The card already stores what Wai last read.
    prev = (n.get("last_nudge_text") or "").strip()
    if prev:
        user += (
            f"\n\nTHE LAST NUDGE WAI READ ON THIS TASK (do not reuse its opener, its "
            f"structure, or any of its images — she has already read it):\n{prev}"
        )
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=_MODEL, max_tokens=200, system=system,
        messages=[{"role": "user", "content": user}],
    )
    return msg.content[0].text.strip()
