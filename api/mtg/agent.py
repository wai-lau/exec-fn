import asyncio
import json
from typing import AsyncGenerator

from mtg.prompt import SYSTEM
from mtg.tools import TOOL_FNS, TOOLS


async def stream_chat(messages: list) -> AsyncGenerator[str, None]:
    import anthropic

    client = anthropic.AsyncAnthropic()
    messages = list(messages)

    had_text = False
    for _ in range(8):  # max tool-call rounds
        final = None
        round_started = False
        try:
            async with client.messages.stream(
                model="claude-opus-4-8",
                max_tokens=4096,
                system=SYSTEM,
                tools=TOOLS,
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
            fn = TOOL_FNS.get(block.name)
            result = await asyncio.to_thread(fn, block.input) if fn else {"error": "unknown tool"}
            count = result.get("count", len(result.get("rulings", result.get("cards", []))))
            yield f"data: {json.dumps({'type': 'tool_call', 'name': block.name, 'count': count})}\n\n"
            tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})

        if not tool_results:
            break

        messages.append({"role": "user", "content": tool_results})

    yield f"data: {json.dumps({'type': 'done'})}\n\n"
