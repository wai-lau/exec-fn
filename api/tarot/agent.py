import asyncio
import json
from typing import AsyncGenerator

from tarot.restyle import restyle_stream
from tarot.tools import TOOL_FNS, TOOLS


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _assistant_content(final) -> list:
    return [
        {"type": "text", "text": b.text} if b.type == "text"
        else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
        for b in final.content if b.type in ("text", "tool_use")
    ]


def _turn_text(final) -> str:
    return "".join(b.text for b in final.content if b.type == "text").strip()


async def _drive_stream(stream, persona_brief, prefix_sep) -> AsyncGenerator[str, None]:
    """Run the model stream to completion. Default (no persona): emit the
    reader's text deltas live, token by token. Persona: swallow the text here --
    it is restyled and emitted after the round closes."""
    if persona_brief is not None:
        async for _ in stream.text_stream:
            pass
        return
    first = True
    async for text in stream.text_stream:
        if first and prefix_sep:
            yield _sse({"type": "text", "delta": "\n\n"})
        first = False
        yield _sse({"type": "text", "delta": text})


async def _emit_restyled(text, persona_brief, opener, prefix_sep) -> AsyncGenerator[str, None]:
    """Re-voice this round's text through the persona restyle pass, streamed."""
    if not text:
        return
    if prefix_sep:
        yield _sse({"type": "text", "delta": "\n\n"})
    async for delta in restyle_stream(text, persona_brief, opener=opener):
        yield _sse({"type": "text", "delta": delta})


async def _emit_tools(final, tool_results: list) -> AsyncGenerator[str, None]:
    """Run each tool_use block, yield its tool_call SSE frame, collect results."""
    for block in final.content:
        if block.type != "tool_use":
            continue
        fn = TOOL_FNS.get(block.name)
        result = await asyncio.to_thread(fn, block.input) if fn else {"error": "unknown tool"}
        yield _sse({"type": "tool_call", "name": block.name,
                    "count": result.get("count", 0), "input": block.input})
        tool_results.append({"type": "tool_result", "tool_use_id": block.id,
                             "content": json.dumps(result)})


async def stream_chat(
    messages: list,
    system: str,
    persona_brief: str | None = None,
    persona_opener: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream the reader's turn. Default (persona_brief None) streams the reader
    text live, token by token. With a persona, each round's text is held back and
    re-voiced through a second-pass restyle (haiku) before emission; tool_use
    blocks pass through untouched, in turn order. `persona_opener`, if set, is
    used for the first restyled turn that has text (the opening) only."""
    import anthropic

    client = anthropic.AsyncAnthropic()
    messages = list(messages)

    had_text = False
    opener = persona_opener
    for _ in range(8):
        final = None
        try:
            async with client.messages.stream(
                model="claude-opus-4-8",
                max_tokens=4096,
                system=system,
                tools=TOOLS,
                messages=messages,
            ) as stream:
                async for frame in _drive_stream(stream, persona_brief, had_text):
                    yield frame
                final = await stream.get_final_message()
        except Exception as e:
            yield _sse({"type": "text", "delta": f"[error: {e}]"})
            break

        messages.append({"role": "assistant", "content": _assistant_content(final)})

        text = _turn_text(final)
        if persona_brief is not None:
            async for frame in _emit_restyled(text, persona_brief, opener, had_text):
                yield frame
        if text:
            had_text = True
            opener = None  # consumed on the first turn that produced text

        tool_results = []
        async for frame in _emit_tools(final, tool_results):
            yield frame
        if not tool_results:
            break
        messages.append({"role": "user", "content": tool_results})

    yield _sse({"type": "done"})
