"""Exec-chat persistence — the chat.json store, split out of chat.py.

chat.json is ONE chronological stream (conversation + monitor lines) sorted by a
server-side `ts`. This module owns reading it (`get_chat`), writing conversation
turns (`_save_chat`), appending monitor comments (`append_monitor_comment`), and
flattening the stored history into an API-safe message list
(`sanitize_history_for_api`). Kept separate from chat.py's prompt/tool builders
so neither file crosses the 500-line cap.
"""

import json
from datetime import datetime, timezone

from helpers import DATA_DIR


def assistant_content_blocks(final) -> list:
    """An API message's text + tool_use blocks in storable dict form. Shared by
    both Exec send paths (web SSE + Discord) so a follow-up turn's tool_use is
    kept, not flattened away — dropping it made Exec announce an action it never
    performed."""
    return [
        {"type": "text", "text": b.text} if b.type == "text"
        else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
        for b in final.content if b.type in ("text", "tool_use")
    ]


def _msg_text_key(m: dict) -> tuple | None:
    """Canonical (role, text) identity for ts-matching a stored/incoming
    message, or None if it carries no matchable text. A tool_use/tool_result
    block set has no text and is never round-tripped by the frontend (it only
    ever echoes back a flattened {role, content:<string>} per turn), so those
    always come back None and inherit their turn's ts (see `_save_chat`)."""
    content = m.get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = "".join(
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    else:
        return None
    return (m.get("role"), text) if text else None


def sanitize_history_for_api(messages: list) -> list:
    """Flatten a stored/round-tripped conversation to a text-only, role-alternating
    message list safe to send to the Anthropic API.

    Prior-turn `tool_use`/`tool_result` blocks carry no value for the next turn
    (the effect is already on the board and stated in the follow-up text), and the
    chronological ts-merge in `_save_chat` can split a tool_use from its
    tool_result — an orphaned tool_use makes the API 400 ("tool_use ids were found
    without tool_result blocks immediately after"). So strip every tool block,
    keep the text, drop monitor/empty entries, and merge consecutive same-role
    messages (dropping a tool_result can leave two users adjacent). Callers append
    the fresh, correctly-paired tool round AFTER this — only history is flattened.
    """
    cleaned: list = []
    for m in messages:
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        content = m.get("content")
        if isinstance(content, list):
            text = "\n".join(
                b.get("text", "") for b in content
                if isinstance(b, dict) and b.get("type") == "text" and b.get("text")
            )
        else:
            text = content or ""
        if not text.strip():
            continue
        if cleaned and cleaned[-1]["role"] == role:
            cleaned[-1]["content"] += "\n\n" + text
        else:
            cleaned.append({"role": role, "content": text})
    return cleaned


def _save_chat(messages: list, stage: str):
    p = DATA_DIR / "chat.json"
    existing = json.loads(p.read_text()) if p.exists() else {}
    existing_msgs = existing.get("messages", [])
    now = datetime.now(timezone.utc).isoformat()

    # Stamp each conversation message with a `ts`, matched by (role, text)
    # rather than list position. Position-based matching is unsafe: the
    # frontend only ever tracks ONE flattened {role, content:<string>} entry
    # per turn, while a turn that fires a tool call saves 3-4 structured
    # entries here (assistant tool_use, user tool_result, assistant
    # follow-up) — so the two lists' lengths diverge the moment a tool runs,
    # and index i silently stops meaning "the same message" on both sides (a
    # later, genuinely new message then inherits a stale ts left over from an
    # earlier turn's extra entries). A text-content match survives the
    # frontend's string-vs-block-list round-trip and recovers the true ts.
    existing_convo = [m for m in existing_msgs if m.get("role") != "monitor"]
    ts_queue: dict[tuple, list] = {}
    for m in existing_convo:
        key = _msg_text_key(m)
        if key:
            ts_queue.setdefault(key, []).append(m.get("ts"))

    # A tool_use/tool_result-only message has no text key → it must INHERIT the
    # preceding message's ts (it belongs to that same turn), never a fresh `now`.
    # Otherwise the chronological sort below floats it away from its partner and
    # orphans the tool_use, which the Anthropic API rejects on the next re-send.
    stamped = []
    prev_ts = None
    for m in messages:
        key = _msg_text_key(m)
        bucket = ts_queue.get(key) if key else None
        if bucket:
            ts = bucket.pop(0)
        elif key is None and prev_ts is not None:
            ts = prev_ts
        else:
            ts = now
        stamped.append({**m, "ts": ts})
        prev_ts = ts

    # Preserve monitor comments (each keeps its own ts); dedup any that somehow
    # rode in on the incoming conversation.
    incoming_monitor_contents = {
        m.get("content") for m in messages if m.get("role") == "monitor"
    }
    monitor_msgs = [
        m for m in existing_msgs
        if m.get("role") == "monitor" and m.get("content") not in incoming_monitor_contents
    ]
    for m in monitor_msgs:
        m.setdefault("ts", now)

    # Merge conversation + monitor into one chronological stream. Stable sort
    # keeps a turn's assistant/tool_result/follow-up (same ts) in order.
    merged = sorted(stamped + monitor_msgs, key=lambda m: m.get("ts") or "")
    p.write_text(json.dumps({
        "messages": merged,
        "stage": stage,
        "updated_at": now,
    }, indent=2))


def append_monitor_comment(comment: str):
    p = DATA_DIR / "chat.json"
    data = json.loads(p.read_text()) if p.exists() else {"messages": [], "stage": "planning"}
    now = datetime.now(timezone.utc).isoformat()
    data["messages"].append({"role": "monitor", "content": comment, "ts": now})
    # Keep the stored stream chronological so the frontend renders it merged.
    data["messages"].sort(key=lambda m: m.get("ts") or "")
    data["updated_at"] = now
    p.write_text(json.dumps(data, indent=2))


def get_chat() -> dict:
    p = DATA_DIR / "chat.json"
    return json.loads(p.read_text()) if p.exists() else {"messages": [], "stage": "planning"}
