import asyncio
import json
from typing import List

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from chat import _build_chat_system_prompt, _chat_tools, _save_chat
from chat_tools import _handle_tool
from helpers import DATA_DIR, get_rd_log

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


def _parse_probe_ts(ts: str):
    from datetime import datetime
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


@router.get("/api/exec/probe")
async def exec_probe(since: str = Query(default="")):
    entries = get_rd_log(limit=20)  # newest first
    last_ts = entries[0].get("ts", "") if entries else ""

    if not since:
        return {"comment": None, "last_ts": last_ts}

    since_dt = _parse_probe_ts(since)
    if since_dt is None:
        return {"comment": None, "last_ts": last_ts}

    new_entries = [
        e for e in entries
        if (_parse_probe_ts(e.get("ts", "")) or _parse_probe_ts("1970-01-01T00:00:00+00:00")) > since_dt
    ]
    if not new_entries:
        return {"comment": None, "last_ts": since}

    lines = []
    for e in new_entries[:10]:
        line = f"- {e['action']} '{e['title']}'"
        if e["action"] == "moved":
            line += f" ({e.get('from_col', '?')} -> {e.get('to_col', '?')})"
        lines.append(line)

    comment = await asyncio.to_thread(_run_probe, "\n".join(lines))
    return {"comment": comment or None, "last_ts": new_entries[0].get("ts", since)}


def _run_probe(activity_text: str) -> str:
    import anthropic
    import logging
    client = anthropic.Anthropic()
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=100,
            messages=[{"role": "user", "content": (
                f"You are Exec, Wai's planning assistant monitoring card activity.\n"
                f"Recent activity:\n{activity_text}\n\n"
                "In 1 sentence, briefly note what changed. Be specific and direct. No emoji. No greeting. No sign-off."
            )}],
        )
        return msg.content[0].text.strip()
    except Exception as e:
        logging.warning(f"exec probe haiku error: {e}")
        return ""


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
