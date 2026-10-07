"""The Exec panel's view of the one conversation, since it moved onto the sidecar.

Phase 3 of docs/plan-exec-cc-merge.md: the panel on /rd + /hq sends through
/api/cc/query, so its conversation IS the /cc thread. Two streams feed what the
panel shows, and they live in different places:

  - the conversation (Wai <-> Exec) -- the sidecar's transcript, /api/cc/history;
  - nudges and monitor comments -- still appended to chat.json by nudge_loop and
    monitor (`append_monitor_comment`), because they are pushed, not answered.

`merged_history` interleaves the two by time for replay. `recent_pushes` hands
the latest pushes to the model inside the <exec-context> block (exec_context.wrap):
the agent never sees chat.json, and without them Wai answering a comment ("what
do you mean, again?") is answering something Exec has no record of saying.
"""

from datetime import datetime, timezone

import cc_client
from chat_store import get_chat

RECENT_PUSHES = 5
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def _when(ts) -> datetime:
    """Sidecar stamps are ISO with a Z, chat.json's are isoformat() with +00:00;
    a missing or odd one sorts first rather than failing the replay."""
    try:
        t = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except ValueError:
        return _EPOCH


def _pushes() -> list:
    return [m for m in get_chat().get("messages") or [] if m.get("role") == "monitor"]


async def merged_history() -> dict:
    """{messages:[{role, text, ts, card_id?}], monitorTotal} oldest first.

    role is `user` / `assistant` (the sidecar thread), `action` (a tool call in
    it: name, input, result, isError) or `monitor` (a push); a
    user turn carries its pasted `images` too, so a reload keeps the picture the
    words were about. monitorTotal counts
    chat.json's pushes, which is what the unread badge has always counted."""
    thread = (await cc_client.history()).get("messages") or []
    rows = []
    for m in thread:
        if m.get("role") == "action":
            # A tool call Exec made, so the replay shows what it DID (one line
            # each in the panel), not only what it said about it.
            rows.append({k: m.get(k) for k in ("role", "name", "input", "result", "isError")}
                        | {"ts": m.get("ts") or ""})
            continue
        if m.get("role") not in ("user", "assistant") or not (m.get("text") or m.get("images")):
            continue
        row = {"role": m["role"], "text": m.get("text") or "", "ts": m.get("ts") or ""}
        if m.get("images"):
            row["images"] = m["images"]
        rows.append(row)
    pushes = _pushes()
    for m in pushes:
        row = {"role": "monitor", "text": m.get("content") or "", "ts": m.get("ts") or ""}
        if m.get("card_id"):
            row["card_id"] = m["card_id"]
        rows.append(row)
    rows.sort(key=lambda r: _when(r["ts"]))
    return {"messages": rows, "monitorTotal": len(pushes)}


def recent_pushes() -> str:
    """The last few nudges/comments, as a block for the per-turn context."""
    lines = [f"- [{m.get('ts', '')[:16]}] {m.get('content', '')}"
             for m in _pushes()[-RECENT_PUSHES:]]
    if not lines:
        return ""
    return ("MESSAGES YOU PUSHED TO WAI OUTSIDE THIS CHAT (nudges and comments, "
            "oldest first, UTC; they are yours -- own them if she replies to one):\n"
            + "\n".join(lines))
