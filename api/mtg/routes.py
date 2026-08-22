import asyncio
import json
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from time import monotonic
from typing import AsyncGenerator, List

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mtg.agent import stream_chat
from mtg.lookup import lookup_rule

router = APIRouter()

# Guest-reachable and each request drives up to several real opus-4-8 calls
# (tool-loop + summarize pass) — mirrors tarot/routes.py's in-process per-IP
# limiter (same window/cap, same trusted-last-hop IP extraction).
_RL_WINDOW_SEC = 60.0
_RL_MAX_REQS = 20
_RL_SWEEP_EVERY = 500
_rl_buckets: dict[str, deque[float]] = defaultdict(deque)
_rl_calls_since_sweep = 0


def _client_ip(request: Request) -> str:
    # This app sits behind a single trusted nginx front which sets X-Real-IP
    # to $remote_addr and appends the real client IP as the LAST hop of
    # X-Forwarded-For via $proxy_add_x_forwarded_for — earlier hops are
    # caller-suppliable, so only the last one (or X-Real-IP) is trustworthy.
    xff = request.headers.get("x-forwarded-for", "")
    return (
        request.headers.get("x-real-ip")
        or (xff.rsplit(",", 1)[-1].strip() if xff else "")
        or (request.client.host if request.client else "unknown")
    )


def _rl_check(ip: str) -> None:
    global _rl_calls_since_sweep
    now = monotonic()
    bucket = _rl_buckets[ip]
    while bucket and bucket[0] < now - _RL_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= _RL_MAX_REQS:
        raise HTTPException(429, f"rate limit: max {_RL_MAX_REQS} requests per {int(_RL_WINDOW_SEC)}s")
    bucket.append(now)

    _rl_calls_since_sweep += 1
    if _rl_calls_since_sweep >= _RL_SWEEP_EVERY:
        _rl_calls_since_sweep = 0
        for k in [k for k, v in _rl_buckets.items() if not v]:
            del _rl_buckets[k]

_SESSIONS_DIR = Path("/app/data/mtg_sessions")
_OLD_LOG = Path("/app/data/mtg_log.json")


def _sessions_dir() -> Path:
    _SESSIONS_DIR.mkdir(exist_ok=True)
    return _SESSIONS_DIR


def _session_path(session_id: str) -> Path:
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_")
    return _sessions_dir() / f"{safe}.json"


def _append_exchange(session_id: str, user_msg: str, assistant_msg: str) -> None:
    path = _session_path(session_id)
    if path.exists():
        try:
            session = json.loads(path.read_text())
        except Exception:
            session = {"id": session_id, "started_at": datetime.now().isoformat(timespec="seconds"), "exchanges": []}
    else:
        session = {"id": session_id, "started_at": datetime.now().isoformat(timespec="seconds"), "exchanges": []}
    session["exchanges"].append({
        "ts": datetime.now().isoformat(timespec="seconds"),
        "user": user_msg,
        "assistant": assistant_msg,
    })
    path.write_text(json.dumps(session, indent=2))


def _migrate_old_log() -> None:
    if not _OLD_LOG.exists():
        return
    try:
        entries = json.loads(_OLD_LOG.read_text())
        for entry in entries:
            ts = entry.get("ts", datetime.now().isoformat(timespec="seconds"))
            sid = "mtg_backfill_" + ts.replace(":", "").replace("-", "").replace("T", "_")[:15]
            path = _session_path(sid)
            if not path.exists():
                session = {"id": sid, "started_at": ts, "exchanges": [entry]}
                path.write_text(json.dumps(session, indent=2))
    except Exception:
        pass
    _OLD_LOG.unlink(missing_ok=True)


_migrate_old_log()


async def _stream_and_log(session_id: str, messages: list) -> AsyncGenerator[str, None]:
    user_msg = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user" and isinstance(m["content"], str)), ""
    )
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
        _append_exchange(session_id, user_msg, "".join(assistant_text))


@router.get("/api/mtg/rule/{number}")
async def api_mtg_rule(number: str):
    """Rule text for the hover/tap preview. Looks up by number (e.g. 724.1b)."""
    res = await asyncio.to_thread(lookup_rule, number)
    rules = res.get("rules", [])
    return {
        "number": number,
        "text": "\n".join(rules),
        "count": res.get("count", len(rules)),
        "error": res.get("error"),
    }


# NOTE: GET /api/mtg/log is defined in routes_views.py on the owner-only
# `protected` router, NOT here — it returns EVERY session's transcript with no
# per-caller scoping, so it must never sit on the guest-reachable mtg_router.
# Same rationale as /api/tarot/readings (its sibling). Only /debug consumes it.


class ChatBody(BaseModel):
    messages: List[dict] = []
    session_id: str = ""


@router.post("/api/mtg/chat")
async def api_mtg_chat(body: ChatBody, request: Request):
    _rl_check(_client_ip(request))
    return StreamingResponse(
        _stream_and_log(body.session_id or "mtg_unknown", body.messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
