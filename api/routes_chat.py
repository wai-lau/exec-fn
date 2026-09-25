import asyncio
import json
from typing import List

import anthropic
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from chat_passes import run_turn
from chat_store import _save_chat, sanitize_history_for_api
from helpers import DATA_DIR

router = APIRouter()


class ChatBody(BaseModel):
    messages: List[dict] = []
    stage: str = "planning"


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
        # Two passes, ACT then REPLY — see chat_passes. The event shapes are the
        # SSE frames the panel already reads (text / tool_call), plus a final.
        client = anthropic.AsyncAnthropic()
        async for ev in run_turn(client, messages, stage):
            if ev["type"] == "final":
                _save_chat(ev["messages"], stage)
                break
            yield f"data: {json.dumps(ev)}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'next_stage': stage})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
