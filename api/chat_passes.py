"""Exec's two-pass turn: ACT, then REPLY — shared by the web bubble and Discord.

Why two passes: the model used to act and talk in one response, and it learned
to talk INSTEAD of acting. History reaches it flattened
(`sanitize_history_for_api` strips every prior tool_use/tool_result), so it reads
dozens of its own past turns saying "Added X" with no tool call beside them. On
2026-09-24 it answered "hang out with Nick" and "hang out with Jesse" with
"Added ... to the ideas pool", called nothing, and invented a card id for the
answer row — past a static-prefix rule that already said, in capitals, never to
describe an action without calling the tool.

So the jobs are split and the reply can no longer run ahead of the board:

- PASS 1 — ACT. Tools on; any text it writes is DISCARDED. Tool rounds loop
  until it stops calling tools (bounded by `_MAX_ACT_ROUNDS`).
- PASS 2 — REPLY. `tool_choice: none`, so it cannot act, only describe; its
  system prompt carries `ACTIONS YOU JUST TOOK` and its messages carry every
  tool_result, so what it reports is what happened. If Wai asked for an action
  that is missing, it answers `[redo: <the action>]` instead of a reply, and
  pass 1 runs again with that instruction (`_MAX_REDOS`). The last reply pass
  may not redo — it says plainly what was not done.

`run_turn()` is an async generator of events so the web route can stream them
as SSE and Discord can just collect the text:
  {"type": "tool_call", name, input, result}   — per dispatched tool
  {"type": "text", "delta"}                    — reply text, pass 2 only
  {"type": "final", "messages", "actions", "text"} — last event, always
"""
import asyncio
import json

from chat import _build_chat_system_prompt, _chat_tools
from chat_store import assistant_content_blocks
from chat_tools import _handle_tool
from monitor import MONITORED_TOOLS, schedule_monitor
from monitor_sse import push_to_monitor

MODEL = "claude-opus-4-8"
_MAX_ACT_ROUNDS = 4   # tool rounds per act pass (a create, then its schedule, ...)
_MAX_REDOS = 2        # reply pass -> act pass bounces before the reply must stand
_REDO = "[redo:"
# Marks the act pass's redo instruction inside the conversation. It is the
# SERVER talking, not Wai, so `strip_notes` removes it before anything is saved.
_NOTE = "[auto-check, not from Wai]"

_TOOLS = _chat_tools()

_ACT_RULES = (
    "\n\nPASS 1 OF 2 — ACT. This pass takes actions; it does not talk to Wai. Call every tool "
    "Wai's latest message calls for — create, schedule, archive, exile, update, decompose, "
    "advance, remember — several in one response when it needs several. Any text you write in "
    "this pass is DISCARDED: a second pass writes the reply from what your tool calls actually "
    "did, so an action you only describe here does not happen. If the message needs no action (a "
    "question, conversation, an answer with nothing to record) or is too ambiguous to act on, "
    "call no tool and write nothing; the reply pass will answer or ask."
)
_REPLY_RULES = (
    "\n\nPASS 2 OF 2 — REPLY. Tools are closed in this pass. The ONLY actions taken this turn are "
    "the tool calls in the conversation above and the list under ACTIONS YOU JUST TOOK — if there "
    "are none, NOTHING changed on the board. Write your reply to Wai describing only those. Never "
    "say you added, created, scheduled, archived, exiled, moved or logged anything that is not "
    "there, and write a card= cell only with an id that appears in the board lists or a tool "
    "result — never a made-up one."
)
_REDO_RULE = (
    "\nIf Wai's latest message asked for an action that is MISSING and it is clear enough to "
    f"perform, do not write a reply: output exactly one line, {_REDO} <the missing action, "
    "precisely — which card, what change>] and nothing else. The action pass then runs again with "
    "that instruction. If it is ambiguous, ask Wai instead."
)
_LAST_RULE = (
    "\nIf something Wai asked for is missing, it was NOT done and cannot be now: say so plainly "
    "in one line. Never claim it."
)


def strip_notes(messages: list) -> list:
    """Drop the server's redo instructions from a finished conversation before it
    is saved — they are text blocks riding in a user message, so left in they
    would replay as something Wai said."""
    out = []
    for m in messages:
        c = m.get("content")
        if m.get("role") == "user" and isinstance(c, list):
            c = [b for b in c if not (b.get("type") == "text" and b.get("text", "").startswith(_NOTE))]
            if not c:
                continue
            m = {**m, "content": c}
        out.append(m)
    return out


def _add_note(convo: list, instruction: str) -> None:
    """Attach the redo instruction to the conversation's closing user message
    (it always ends on one: Wai's text or a tool_result round). Appended as a
    text block AFTER any tool_results, which the API requires to come first."""
    last = convo[-1]
    c = last["content"]
    blocks = [{"type": "text", "text": c}] if isinstance(c, str) else list(c)
    blocks.append({"type": "text", "text": (
        f"{_NOTE} The reply pass found an action Wai asked for that was not taken: "
        f"{instruction}. Take it now with the tool; if it truly cannot be done, call no tool."
    )})
    convo[-1] = {**last, "content": blocks}


async def _system(stage: str, actions: list, rules: str) -> list:
    """The ordinary Exec system prompt with a pass's rules appended to the
    VOLATILE block — the cached static prefix stays byte-stable."""
    system = await asyncio.to_thread(_build_chat_system_prompt, stage, actions)
    system[1] = {**system[1], "text": system[1]["text"] + rules}
    return system


async def _dispatch(uses: list, actions: list):
    """Run one response's tool_use blocks; yield a tool_call event each and
    return (via the last event) the tool_result blocks."""
    results = []
    board_changed = False
    for b in uses:
        try:
            result = await asyncio.to_thread(_handle_tool, b.name, b.input)
        except Exception as e:
            # A handler can raise on a malformed model-supplied argument; left
            # uncaught it would abort the turn after a mutation already landed.
            result = {"error": f"tool failed: {e}"}
        ok = isinstance(result, dict) and result.get("ok")
        if ok and b.name in MONITORED_TOOLS:
            schedule_monitor()
        if ok and b.name != "update_context":   # everything else writes rd.json
            board_changed = True
        actions.append({"name": b.name, "input": b.input, "result": result})
        results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(result)})
        yield {"type": "tool_call", "name": b.name, "input": b.input, "result": result}
    # The exec panel lives ON /rd + /hq: push now, so the board moves while the
    # reply is still being written rather than after it.
    if board_changed:
        await push_to_monitor({"cards_changed": True})
    yield {"type": "_results", "results": results}


async def _act(client, convo: list, stage: str, actions: list):
    """PASS 1. Loops tool rounds on `convo` in place; its text never leaves."""
    for _ in range(_MAX_ACT_ROUNDS):
        system = await _system(stage, actions, _ACT_RULES)
        resp = await client.messages.create(
            model=MODEL, max_tokens=1024, system=system, tools=_TOOLS, messages=convo,
        )
        uses = [b for b in resp.content if b.type == "tool_use"]
        if not uses:
            return
        # Keep only the tool_use blocks: the text beside them is pass-1 talk,
        # and pass 2 must not read it as something already said to Wai.
        convo.append({"role": "assistant", "content": [
            b for b in assistant_content_blocks(resp) if b["type"] == "tool_use"
        ]})
        async for ev in _dispatch(uses, actions):
            if ev["type"] == "_results":
                convo.append({"role": "user", "content": ev["results"]})
            else:
                yield ev


async def _reply(client, convo: list, stage: str, actions: list, last: bool, out: dict):
    """PASS 2. Streams the reply — unless it opens with `[redo:`, which is held
    back (never shown) and handed to the caller in `out["redo"]`. The opening is
    buffered only until it can no longer be the start of a redo line."""
    system = await _system(stage, actions, _REPLY_RULES + (_LAST_RULE if last else _REDO_RULE))
    text = ""
    decided = last          # the last pass cannot redo, so it streams at once
    redo = False
    async with client.messages.stream(
        model=MODEL, max_tokens=1024, system=system, tools=_TOOLS,
        tool_choice={"type": "none"}, messages=convo,
    ) as stream:
        async for delta in stream.text_stream:
            text += delta
            if decided:
                if not redo:
                    yield {"type": "text", "delta": delta}
                continue
            head = text.lstrip()
            if len(head) >= len(_REDO) or not _REDO.startswith(head):
                decided = True
                redo = head.startswith(_REDO)
                if not redo:
                    yield {"type": "text", "delta": text}
    if not decided and text.strip():     # too short to have been decided
        redo = text.lstrip().startswith(_REDO)
        if not redo:
            yield {"type": "text", "delta": text}
    if redo:
        out["redo"] = text.strip()[len(_REDO):].rstrip("]").strip() or "the action Wai asked for"
    else:
        out["text"] = text


async def run_turn(client, history: list, stage: str = "planning"):
    """One Exec turn over a sanitized, user-ending `history`. See module doc."""
    convo = list(history)
    actions: list = []
    text = ""
    for attempt in range(_MAX_REDOS + 1):
        try:
            async for ev in _act(client, convo, stage, actions):
                yield ev
            out: dict = {}
            async for ev in _reply(client, convo, stage, actions, attempt == _MAX_REDOS, out):
                yield ev
        except Exception as e:
            text = f"[error: {e}]"
            yield {"type": "text", "delta": text}
            break
        if "redo" in out:
            _add_note(convo, out["redo"])
            continue
        text = out.get("text", "")
        break
    if text:
        convo.append({"role": "assistant", "content": [{"type": "text", "text": text}]})
    yield {"type": "final", "messages": strip_notes(convo), "actions": actions, "text": text}
