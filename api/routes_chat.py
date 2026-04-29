import asyncio
import json
from typing import List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from chat import _build_chat_system_prompt, _chat_tools, _save_chat
from chat_tools import _handle_tool
from helpers import DATA_DIR

router = APIRouter()


class ChatBody(BaseModel):
    messages: List[dict] = []
    stage: str = "planning"


async def _stream_tool_followup(client, all_messages: list, tools: list, system: str):
    """Stream follow-up assistant turn after tool results."""
    cont_text = ""
    try:
        async with client.messages.stream(
            model="claude-haiku-4-5-20251001",
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
    from chat import get_chat
    return get_chat()


@router.delete("/api/chat")
def api_chat_clear():
    p = DATA_DIR / "chat.json"
    if p.exists():
        p.unlink()
    return {"ok": True}


@router.post("/api/chat")
async def api_chat(body: ChatBody):
    import anthropic as _anthropic

    messages = body.messages
    stage = body.stage

    async def generate():
        client = _anthropic.AsyncAnthropic()
        system_prompt = _build_chat_system_prompt(stage)
        tools = _chat_tools()
        next_stage = stage
        full_text = ""
        final = None

        try:
            async with client.messages.stream(
                model="claude-haiku-4-5-20251001",
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

        for block in final.content:
            if block.type != "tool_use":
                continue
            result = await asyncio.to_thread(_handle_tool, block.name, block.input)
            yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'result': result})}\n\n"
            tool_result_contents.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})

        if tool_result_contents:
            all_messages.append({"role": "user", "content": tool_result_contents})
            if full_text:
                yield f"data: {json.dumps({'type': 'text', 'delta': '\n\n'})}\n\n"
            async for chunk in _stream_tool_followup(client, all_messages, tools, _build_chat_system_prompt(next_stage)):
                yield chunk

        _save_chat(all_messages, next_stage)
        yield f"data: {json.dumps({'type': 'done', 'next_stage': next_stage})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
