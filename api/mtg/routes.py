import asyncio
import json
from typing import List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mtg.lookup import lookup_rule

router = APIRouter()

_SYSTEM = """You are an expert Magic: The Gathering rules judge. Your job is to explain rules clearly to players of any experience level.

ALWAYS call lookup_rule before answering any rules question. Never answer from memory alone — look it up and cite the rule numbers.

When explaining:
- Lead with the plain-English answer
- Back it up with the specific rule numbers you found
- If rules interact, look up each one separately
- Keep it concise — players want answers, not essays"""

_TOOLS = [
    {
        "name": "lookup_rule",
        "description": "Search the MTG Comprehensive Rules. Pass a rule number (e.g. '702.2', '702') to get that rule and its subrules. Pass keywords (e.g. 'deathtouch', 'first strike damage') to search for matching rules.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Rule number (e.g. '702', '702.2', '702.2a') or keywords to search (e.g. 'deathtouch', 'trample combat damage').",
                }
            },
            "required": ["query"],
        },
    }
]


class ChatBody(BaseModel):
    messages: List[dict] = []


async def _stream_followup(client, messages, system):
    try:
        async with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system,
            tools=_TOOLS,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
            await stream.get_final_message()
    except Exception:
        pass


@router.post("/api/mtg/chat")
async def api_mtg_chat(body: ChatBody):
    async def generate():
        import anthropic

        client = anthropic.AsyncAnthropic()
        messages = body.messages
        full_text = ""
        final = None

        try:
            async with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=_SYSTEM,
                tools=_TOOLS,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    full_text += text
                    yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
                final = await stream.get_final_message()
        except Exception as e:
            yield f"data: {json.dumps({'type': 'text', 'delta': f'[error: {e}]'})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        assistant_content = [
            {"type": "text", "text": b.text} if b.type == "text"
            else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
            for b in final.content if b.type in ("text", "tool_use")
        ]
        all_messages = messages + [{"role": "assistant", "content": assistant_content}]
        tool_results = []

        for block in final.content:
            if block.type != "tool_use":
                continue
            result = await asyncio.to_thread(lookup_rule, block.input.get("query", ""))
            yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'query': block.input.get('query', ''), 'count': result.get('count', 0)})}\n\n"
            tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})

        if tool_results:
            all_messages.append({"role": "user", "content": tool_results})
            async for chunk in _stream_followup(client, all_messages, _SYSTEM):
                yield chunk

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
