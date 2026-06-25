import json
import random
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from time import monotonic
from typing import Any, AsyncGenerator, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth import SESSION_TOKEN
from helpers import DATA_DIR
from tarot.agent import stream_chat
from tarot.cards import CARDS, CARDS_BY_ID
from tarot.personas import get_persona_brief, get_persona_opener, public_list
from tarot.prompt import build_system
from tarot.spreads import SPREADS

router = APIRouter()

_READINGS_PATH = DATA_DIR / "tarot_readings.json"

_SPREAD_SIZE = {"three": 3}
_REVERSED_CHANCE = 0.3


@router.get("/api/tarot/spreads")
async def api_tarot_spreads():
    return SPREADS


@router.get("/api/tarot/cards")
async def api_tarot_cards():
    return {"cards": CARDS}


@router.get("/api/tarot/personas")
async def api_tarot_personas():
    """Reader persona menu (id/name/voice_id/backend/gain) -- voice briefs are
    server-only and never sent here."""
    return {"personas": public_list()}


class DrawBody(BaseModel):
    spread_type: Literal["three"]
    significator_id: str | None = None


@router.post("/api/tarot/draw")
async def api_tarot_draw(body: DrawBody):
    spread = SPREADS[body.spread_type]
    n = _SPREAD_SIZE[body.spread_type]
    deck = [c for c in CARDS if c["id"] != body.significator_id] if body.significator_id else CARDS
    drawn = random.sample(deck, n)
    cards = []
    for pos, card in zip(spread["positions"], drawn):
        cards.append({
            "position": pos["key"],
            "position_label": pos["label"],
            "card_id": card["id"],
            "name": card["name"],
            "image": card["image"],
            "reversed": random.random() < _REVERSED_CHANCE,
        })
    return {
        "type": body.spread_type,
        "drawn_at": datetime.now().isoformat(timespec="seconds"),
        "cards": cards,
    }


class RevealedCard(BaseModel):
    position: str
    card_id: str
    name: str | None = None
    reversed: bool = False


class Significator(BaseModel):
    card_id: str
    name: str | None = None


class SpreadContext(BaseModel):
    type: Literal["three"] | None = None
    revealed: list[RevealedCard] = []
    face_down_positions: list[str] = []
    significator: Significator | None = None


class ChatBody(BaseModel):
    messages: list[dict] = []
    spread: SpreadContext | None = None
    persona: str | None = None


def _position_label(spread_type: str | None, position_key: str) -> str:
    if not spread_type or spread_type not in SPREADS:
        return position_key
    for pos in SPREADS[spread_type]["positions"]:
        if pos["key"] == position_key:
            return pos["label"]
    return position_key


def _count_phase1_answers(messages: list) -> int:
    """Count plain-text querent messages (non-bracket-event) — proxy for Phase 1 answers."""
    n = 0
    for m in messages:
        if m.get("role") != "user":
            continue
        c = m.get("content")
        if not isinstance(c, str):
            continue
        s = c.strip()
        if s.startswith("[") and s.endswith("]"):
            continue
        n += 1
    return n


def _is_opening(messages: list) -> bool:
    """True on the very first turn of a fresh reading -- the persona opener (if
    any) replaces the reader's atmospheric image here. Fresh start = the
    `[opened /tarot; no Significator ...]` marker with no assistant turn yet."""
    if any(m.get("role") == "assistant" for m in messages):
        return False
    last = messages[-1].get("content") if messages else None
    if not isinstance(last, str):
        return False
    s = last.lstrip()
    return s.startswith("[opened /tarot") and "no Significator" in s


_PHASE1_MIN = 5


def _build_spread_preamble(spread: SpreadContext | None, phase1_count: int | None = None) -> str | None:
    if spread is None:
        return None
    lines: list[str] = []
    if spread.significator:
        sig_name = spread.significator.name or CARDS_BY_ID.get(spread.significator.card_id, {}).get("name", spread.significator.card_id)
        lines.append(f"Significator (the querent's chosen self-figure): **{sig_name}** — card_id `{spread.significator.card_id}`. This card has been removed from the deck before the draw.")
    elif phase1_count is not None:
        if phase1_count < _PHASE1_MIN:
            lines.append(
                f"[State: Phase 1 turn count = {phase1_count} of {_PHASE1_MIN} minimum. "
                f"You may NOT call `set_significator` yet. Your response MUST be a single open Phase 1 question (≤30 words). "
                f"The exit clause does not activate until count >= {_PHASE1_MIN}.]"
            )
        else:
            lines.append(
                f"[State: Phase 1 turn count = {phase1_count} (>= {_PHASE1_MIN} minimum). "
                f"Exit clause is now eligible — if the picture is solid, take the exit turn now: declare the court card, call `set_significator`, ask the Phase 2 opening question.]"
            )
    if spread.type is None:
        return "\n".join(lines) if lines else None
    if not spread.revealed and not spread.face_down_positions and not lines:
        return None
    spread_label = SPREADS.get(spread.type, {}).get("label", spread.type)
    lines.append(f"The querent has drawn a {spread_label} spread.")
    if spread.revealed:
        lines.append("Revealed cards:")
        for c in spread.revealed:
            pos_label = _position_label(spread.type, c.position)
            orientation = "reversed" if c.reversed else "upright"
            name = c.name or CARDS_BY_ID.get(c.card_id, {}).get("name", c.card_id)
            lines.append(f"- {pos_label}: **{name}** ({orientation}) - card_id `{c.card_id}`")
    else:
        lines.append("No cards have been revealed yet.")
    if spread.face_down_positions:
        labels = [_position_label(spread.type, p) for p in spread.face_down_positions]
        lines.append(f"Face-down (unknown to both of us): {', '.join(labels)}.")
    return "\n".join(lines)


async def _stream(
    spread: SpreadContext | None, messages: list, persona: str | None = None
) -> AsyncGenerator[str, None]:
    spread_type = spread.type if spread else None
    system = build_system(spread_type)
    persona_brief = get_persona_brief(persona)
    persona_opener = get_persona_opener(persona) if _is_opening(messages) else None

    full_messages = list(messages)
    phase1_count = _count_phase1_answers(messages) if (spread is None or not spread.significator) else None
    preamble = _build_spread_preamble(spread, phase1_count=phase1_count)
    if preamble and full_messages:
        full_messages.insert(0, {"role": "user", "content": preamble})
        if full_messages[1]["role"] != "assistant":
            full_messages.insert(1, {"role": "assistant", "content": "Understood - I'll read what's been turned and wait for you to turn the rest."})

    async for chunk in stream_chat(
        full_messages, system, persona_brief=persona_brief, persona_opener=persona_opener
    ):
        yield chunk


_RL_WINDOW_SEC = 60.0
_RL_MAX_REQS = 20
_rl_buckets: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    return (
        request.headers.get("x-real-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


def _rl_check(ip: str) -> None:
    now = monotonic()
    bucket = _rl_buckets[ip]
    while bucket and bucket[0] < now - _RL_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= _RL_MAX_REQS:
        raise HTTPException(429, f"rate limit: max {_RL_MAX_REQS} requests per {int(_RL_WINDOW_SEC)}s")
    bucket.append(now)


@router.post("/api/tarot/chat")
async def api_tarot_chat(body: ChatBody, request: Request):
    _rl_check(_client_ip(request))
    return StreamingResponse(
        _stream(body.spread, body.messages, persona=body.persona),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class SaveBody(BaseModel):
    significator: dict | None = None
    spread: dict | None = None
    messages: list[dict] = []


def _atomic_write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)


@router.post("/api/tarot/save")
async def api_tarot_save(body: SaveBody, request: Request):
    """Append the current reading to tarot_readings.json (called on reset).
    Owner-only: saves only when the full session cookie is present (Wai).
    Guests no-op — their readings stay frontend/localStorage only."""
    if request.cookies.get("session") != SESSION_TOKEN:
        return {"saved": False, "reason": "guest"}
    if not body.messages and not body.spread and not body.significator:
        return {"saved": False, "reason": "empty"}

    reading = {
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "significator": body.significator,
        "spread": body.spread,
        "messages": body.messages,
    }

    try:
        existing = json.loads(_READINGS_PATH.read_text())
        if not isinstance(existing, list):
            existing = []
    except (FileNotFoundError, json.JSONDecodeError):
        existing = []

    existing.append(reading)
    _atomic_write_json(_READINGS_PATH, existing)
    return {"saved": True, "count": len(existing)}
