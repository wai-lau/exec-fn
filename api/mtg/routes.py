import json
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mtg.agent import stream_chat

router = APIRouter()

_MTG_LOG = Path("/app/data/mtg_log.json")


def _append_mtg_log(user_msg: str, assistant_msg: str) -> None:
    log = []
    if _MTG_LOG.exists():
        try:
            log = json.loads(_MTG_LOG.read_text())
        except Exception:
            log = []
    log.append({
        "ts": datetime.now().isoformat(timespec="seconds"),
        "user": user_msg,
        "assistant": assistant_msg,
    })
    _MTG_LOG.write_text(json.dumps(log, indent=2))


async def _stream_and_log(messages: list) -> AsyncGenerator[str, None]:
    user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user" and isinstance(m["content"], str)), "")
    assistant_text = []
    async for chunk in stream_chat(messages):
        yield chunk
        try:
            data = json.loads(chunk.removeprefix("data: "))
            if data.get("type") == "text":
                assistant_text.append(data["delta"])
        except Exception:
            pass
    if user_msg or assistant_text:
        _append_mtg_log(user_msg, "".join(assistant_text))


@router.get("/api/mtg/log")
async def api_mtg_log():
    if not _MTG_LOG.exists():
        return {"entries": []}
    try:
        return {"entries": json.loads(_MTG_LOG.read_text())}
    except Exception:
        return {"entries": []}


class ChatBody(BaseModel):
    messages: List[dict] = []


@router.post("/api/mtg/chat")
async def api_mtg_chat(body: ChatBody):
    return StreamingResponse(
        _stream_and_log(body.messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
