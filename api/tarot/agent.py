import asyncio
import json
from typing import AsyncGenerator

from tarot.state_echo import StateEchoFilter
from tarot.tools import TOOL_FNS, TOOLS


async def _round_text(stream) -> AsyncGenerator[str, None]:
    """One round's text, minus any parroted `[State: ...]` note."""
    echo = StateEchoFilter()
    async for raw in stream.text_stream:
        text = echo.feed(raw)
        if text:
            yield text
    tail = echo.flush()
    if tail:
        yield tail


def _text_evt(text: str) -> str:
    return f"data: {json.dumps({'type': 'text', 'delta': text})}\n\n"


async def stream_chat(messages: list, system: str) -> AsyncGenerator[str, None]:
    import anthropic

    client = anthropic.AsyncAnthropic()
    messages = list(messages)

    had_text = False
    for _ in range(8):
        final = None
        round_started = False
        try:
            async with client.messages.stream(
                model="claude-opus-4-8",
                max_tokens=4096,
                # Static prefix (system + tools) cached: a reading is many turns
                # reusing the same build_system(spread_type) + TOOLS. ~8.7-13.4K
                # prefix tokens read at ~0.1x after the first turn. The per-turn
                # spread context rides in messages, never in system, so the cache
                # prefix stays byte-stable across the reading.
                system=[{"type": "text", "text": system,
                         "cache_control": {"type": "ephemeral"}}],
                tools=TOOLS,
                messages=messages,
            ) as stream:
                async for text in _round_text(stream):
                    if not round_started and had_text:
                        yield _text_evt("\n\n")
                    round_started = True
                    had_text = True
                    yield _text_evt(text)
                final = await stream.get_final_message()
        except Exception as e:
            err = json.dumps({"type": "text", "delta": f"[error: {e}]"})
            yield f"data: {err}\n\n"
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
            fn = TOOL_FNS.get(block.name)
            result = await asyncio.to_thread(fn, block.input) if fn else {"error": "unknown tool"}
            count = result.get("count", 0)
            evt = json.dumps({"type": "tool_call", "name": block.name, "count": count, "input": block.input})
            yield f"data: {evt}\n\n"
            tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})

        if not tool_results:
            break

        messages.append({"role": "user", "content": tool_results})

    done = json.dumps({"type": "done"})
    yield f"data: {done}\n\n"
