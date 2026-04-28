from typing import List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mtg.agent import stream_chat

router = APIRouter()


class ChatBody(BaseModel):
    messages: List[dict] = []


@router.post("/api/mtg/chat")
async def api_mtg_chat(body: ChatBody):
    return StreamingResponse(
        stream_chat(body.messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
