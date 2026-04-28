import asyncio
import json
from typing import List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mtg.lookup import lookup_card, lookup_rule, lookup_rulings

router = APIRouter()

_SYSTEM = """You are an expert Magic: The Gathering rules judge. Your job is to answer rules questions clearly and accurately.

When a card is mentioned:
1. Call lookup_card to get its oracle text and oracle_id
2. Call lookup_rulings with that oracle_id to get official WotC rulings
3. Call lookup_rule for any relevant comprehensive rules

Use all three sources together to give a complete answer. Always cite rule numbers and quote relevant oracle text. If rulings clarify something, include them.

FORMATTING: Use markdown. No Unicode emoji. Ultra-concise. One sentence if possible. Expand only when truly necessary.
Hyperlink every card name you mention: [Card Name](https://scryfall.com/search?q=!"Card+Name") — replace spaces with + in the URL."""

_TOOLS = [
    {
        "name": "lookup_card",
        "description": "Look up a Magic card by name. Returns oracle text, type line, mana cost, keywords, and oracle_id (needed for lookup_rulings).",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Card name, e.g. 'Lightning Bolt', 'Deathtouch'"}
            },
            "required": ["name"],
        },
    },
    {
        "name": "lookup_rulings",
        "description": "Get official WotC rulings for a card by its oracle_id (from lookup_card). Returns judge rulings that clarify how the card works.",
        "input_schema": {
            "type": "object",
            "properties": {
                "oracle_id": {"type": "string", "description": "oracle_id from lookup_card result"}
            },
            "required": ["oracle_id"],
        },
    },
    {
        "name": "lookup_rule",
        "description": "Search the MTG Comprehensive Rules. Pass a rule number (e.g. '702.2', '702') to get that rule and subrules. Pass keywords (e.g. 'deathtouch', 'trample combat damage') to find matching rules.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Rule number (e.g. '702', '702.2') or keywords to search"}
            },
            "required": ["query"],
        },
    },
]

_TOOL_FNS = {
    "lookup_card": lambda inp: lookup_card(inp.get("name", "")),
    "lookup_rulings": lambda inp: lookup_rulings(inp.get("oracle_id", "")),
    "lookup_rule": lambda inp: lookup_rule(inp.get("query", "")),
}


class ChatBody(BaseModel):
    messages: List[dict] = []


@router.post("/api/mtg/chat")
async def api_mtg_chat(body: ChatBody):
    async def generate():
        import anthropic

        client = anthropic.AsyncAnthropic()
        messages = list(body.messages)

        had_text = False
        for _ in range(8):  # max tool-call rounds
            final = None
            round_started = False
            try:
                async with client.messages.stream(
                    model="claude-sonnet-4-6",
                    max_tokens=4096,
                    system=_SYSTEM,
                    tools=_TOOLS,
                    messages=messages,
                ) as stream:
                    async for text in stream.text_stream:
                        if not round_started and had_text:
                            yield f"data: {json.dumps({'type': 'text', 'delta': '\n\n'})}\n\n"
                        round_started = True
                        had_text = True
                        yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
                    final = await stream.get_final_message()
            except Exception as e:
                yield f"data: {json.dumps({'type': 'text', 'delta': f'[error: {e}]'})}\n\n"
                break

            assistant_content = [
                {"type": "text", "text": b.text} if b.type == "text"
                else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
                for b in final.content if b.type in ("text", "tool_use")
            ]
            messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for block in final.content:
                if block.type != "tool_use":
                    continue
                fn = _TOOL_FNS.get(block.name)
                result = await asyncio.to_thread(fn, block.input) if fn else {"error": "unknown tool"}
                count = result.get("count", len(result.get("rulings", result.get("cards", []))))
                yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'count': count})}\n\n"
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})

            if not tool_results:
                break

            messages.append({"role": "user", "content": tool_results})

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
