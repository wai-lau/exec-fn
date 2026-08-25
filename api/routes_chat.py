import asyncio
import json
from typing import List

import anthropic
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from chat import _build_chat_system_prompt, _chat_tools
from chat_store import _save_chat, sanitize_history_for_api
from chat_tools import _handle_tool
from helpers import DATA_DIR
from monitor import schedule_monitor

router = APIRouter()


_CHAT_TOOLS = _chat_tools()


class ChatBody(BaseModel):
    messages: List[dict] = []
    stage: str = "planning"


async def _stream_tool_followup(client, all_messages: list, tools: list, system: str):
    """Stream follow-up assistant turn after tool results."""
    cont_text = ""
    try:
        async with client.messages.stream(
            model="claude-opus-4-8",
            max_tokens=512,
            system=system,
            tools=tools,
            messages=all_messages,
        ) as stream2:
            async for text in stream2.text_stream:
                cont_text += text
                yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
            await stream2.get_final_message()
    except Exception:
        pass
    if cont_text:
        all_messages.append({"role": "assistant", "content": [{"type": "text", "text": cont_text}]})




@router.get("/api/chat")
def api_chat_get():
    from chat_store import get_chat
    return get_chat()


@router.delete("/api/chat")
def api_chat_clear():
    p = DATA_DIR / "chat.json"
    if p.exists():
        p.unlink()
    return {"ok": True}


async def _dispatch_tools(blocks, tool_result_contents, actions_taken):
    """Run each tool_use block: stream a tool_call SSE event, collect its
    tool_result, record the action for the follow-up diff, and fire the debounced
    monitor on a completed sub-step (advance_chunk) — same channel as R&D/HQ
    activity."""
    for block in blocks:
        if block.type != "tool_use":
            continue
        try:
            result = await asyncio.to_thread(_handle_tool, block.name, block.input)
        except Exception as e:
            # A tool handler can raise on a malformed LLM-supplied argument
            # (e.g. non-numeric prep_time). Left uncaught, this propagates out
            # of the async generator, aborts the whole SSE response mid-turn,
            # and skips _save_chat entirely — the turn (and any tool mutation
            # that already landed) vanishes with no error shown to Wai.
            result = {"error": f"tool failed: {e}"}
        if block.name == "advance_chunk" and isinstance(result, dict) and result.get("ok"):
            schedule_monitor()
        actions_taken.append({"name": block.name, "input": block.input, "result": result})
        yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'input': block.input, 'result': result})}\n\n"
        tool_result_contents.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})


@router.post("/api/chat")
async def api_chat(body: ChatBody):
    # Flatten history to text-only, role-alternating messages: drops the
    # server-side `ts` (the API rejects unknown keys) AND any prior-turn
    # tool_use/tool_result blocks the ts-merge may have orphaned (an unpaired
    # tool_use 400s the API). The fresh, correctly-paired tool round is appended
    # after this, so only past turns are flattened.
    messages = sanitize_history_for_api(body.messages)
    stage = body.stage

    # Any user turn counts as a reply to the focused awaiting nudge — a bare
    # "I'm on it" pauses the stall timer (must run before the prompt build).
    from nudge import clear_awaiting_focused
    await asyncio.to_thread(clear_awaiting_focused)

    async def generate():
        client = anthropic.AsyncAnthropic()
        system_prompt = _build_chat_system_prompt(stage)
        tools = _CHAT_TOOLS
        next_stage = stage
        full_text = ""
        final = None

        try:
            async with client.messages.stream(
                model="claude-opus-4-8",
                max_tokens=1024,
                system=system_prompt,
                tools=tools,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    full_text += text
                    yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
                final = await stream.get_final_message()
        except Exception as e:
            yield f"data: {json.dumps({'type': 'text', 'delta': f'[error: {e}]'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'next_stage': stage})}\n\n"
            return

        assistant_content = [
            {"type": "text", "text": b.text} if b.type == "text"
            else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
            for b in final.content if b.type in ("text", "tool_use")
        ]
        all_messages = messages + [{"role": "assistant", "content": assistant_content}]
        tool_result_contents = []
        actions_taken = []

        async for chunk in _dispatch_tools(final.content, tool_result_contents, actions_taken):
            yield chunk

        if tool_result_contents:
            all_messages.append({"role": "user", "content": tool_result_contents})
            if full_text:
                yield f"data: {json.dumps({'type': 'text', 'delta': '\n\n'})}\n\n"
            # Rebuild the follow-up system prompt WITH this turn's action diff, so
            # the model reads the refreshed board (now carrying any just-created
            # card) as the result of its own action — not a phantom duplicate.
            followup_system = _build_chat_system_prompt(next_stage, actions=actions_taken)
            async for chunk in _stream_tool_followup(client, all_messages, tools, followup_system):
                yield chunk

        _save_chat(all_messages, next_stage)
        yield f"data: {json.dumps({'type': 'done', 'next_stage': next_stage})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
