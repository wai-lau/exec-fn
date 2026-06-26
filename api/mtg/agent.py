import asyncio
import json
from typing import AsyncGenerator

from mtg.prompt import SYSTEM, SUMMARIZE
from mtg.tools import TOOL_FNS, TOOLS

_MODEL = "claude-opus-4-8"

# SYSTEM (~5.9K tokens) + TOOLS are static and reused across every research-loop
# iteration AND the summarize pass of one question. Cache the prefix so only the
# first call pays full price; the rest read it at ~0.1x. Same bytes at both call
# sites => the create() loop writes the cache and the stream() summarize reads it.
_SYSTEM_CACHED = [{"type": "text", "text": SYSTEM,
                   "cache_control": {"type": "ephemeral"}}]


def _err(e) -> str:
    return f"data: {json.dumps({'type': 'text', 'delta': f'[error: {e}]'})}\n\n"


async def stream_chat(messages: list) -> AsyncGenerator[str, None]:
    """Two passes. Pass 1 (research) runs the tool loop with its prose discarded —
    only the lookup chips surface, so the player never sees the model think out
    loud or reverse itself. Pass 2 (summarize) is the only streamed prose: one
    committed verdict synthesized from the gathered context."""
    import anthropic

    client = anthropic.AsyncAnthropic()
    messages = list(messages)

    # ── Pass 1: research (hidden) ──────────────────────────────────────────────
    try:
        for _ in range(8):  # max tool-call rounds
            resp = await client.messages.create(
                model=_MODEL,
                max_tokens=4096,
                system=_SYSTEM_CACHED,
                tools=TOOLS,
                messages=messages,
            )
            messages.append({
                "role": "assistant",
                "content": [
                    {"type": "text", "text": b.text} if b.type == "text"
                    else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
                    for b in resp.content if b.type in ("text", "tool_use")
                ],
            })

            tool_results = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                fn = TOOL_FNS.get(block.name)
                result = await asyncio.to_thread(fn, block.input) if fn else {"error": "unknown tool"}
                count = result.get("count", len(result.get("rulings", result.get("cards", []))))
                yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'count': count})}\n\n"
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})

            if not tool_results:
                break
            messages.append({"role": "user", "content": tool_results})
    except Exception as e:
        yield _err(e)
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    # ── Pass 2: summarize (the only visible prose) ─────────────────────────────
    # Deliver the summarize instruction inside a user turn: append to the trailing
    # tool_results turn if the loop ended there, else add a fresh user turn.
    last = messages[-1] if messages else None
    if last and last["role"] == "user" and isinstance(last["content"], list):
        last["content"].append({"type": "text", "text": SUMMARIZE})
    else:
        messages.append({"role": "user", "content": SUMMARIZE})

    try:
        async with client.messages.stream(
            model=_MODEL,
            max_tokens=2048,
            system=_SYSTEM_CACHED,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"
    except Exception as e:
        yield _err(e)

    yield f"data: {json.dumps({'type': 'done'})}\n\n"
