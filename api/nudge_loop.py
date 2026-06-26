"""In-process nudge loop (the asyncio ticker) — engine lives in nudge.py.

Extracted from main.py to keep it under the line cap."""
import time
import asyncio

import nudge_llm as _nllm
from monitor_sse import push_to_monitor
from chat import append_monitor_comment


# ── nudge loop ────────────────────────────────────────────────────────────────
# In-process ticker for the decomposition+nudge loop (see nudge.py). State lives
# on the cards in rd.json, so a --reload restart just re-arms on the next tick.

_nudges_inflight: set[str] = set()


def _arm_nudge(c: dict, anchor) -> bool:
    """Bring a card's nudge timing in line with its anchor. Returns dirty.

    While stage is 'nudging' (first nudge not yet sent) next_nudge_at tracks the
    card's current anchor each tick, so dragging the card on the timeline moves
    the nudge with it. Today-scheduled cards without a slot anchor to 10 AM/now.
    """
    import nudge as _nudge
    n = _nudge.ensure_nudge(c)
    anchor_s = _nudge._fmt_et(anchor)
    dirty = False
    if n["stage"] == "idle":
        n["stage"] = "nudging"
        n["first_nudge_at"] = anchor_s
        dirty = True
    if n["stage"] == "nudging" and not n["last_nudge_at"]:
        # First nudge not sent yet: keep tracking the anchor.
        # After that, next_nudge_at is owned by the loop (advance/stall).
        if n["next_nudge_at"] != anchor_s:
            n["next_nudge_at"] = anchor_s
            dirty = True
    return dirty


_nudge_retry_after: dict[str, float] = {}  # card_id -> monotonic ts (failure backoff)
_NUDGE_FAIL_BACKOFF_SEC = 300


def _due_kind(c: dict, now) -> str | None:
    """'stall' if the response window expired, 'nudge' if the active-node start
    arrived, else None. Skips cards in flight or in failure backoff."""
    import nudge as _nudge
    if c["id"] in _nudges_inflight or time.monotonic() < _nudge_retry_after.get(c["id"], 0):
        return None
    n = c["nudge"]
    if n["awaiting_reply"]:
        wd = _nudge._parse_et(n.get("window_deadline"))
        return "stall" if (wd and now >= wd) else None
    nna = _nudge._parse_et(n.get("next_nudge_at"))
    return "nudge" if (nna and now >= nna) else None


def _scan_due_nudges() -> list[tuple[str, str]]:
    """Arm/refresh next_nudge_at for eligible cards; return (id, kind) due now."""
    import nudge as _nudge
    import nudge_deadlines as _nd
    from scheduler import logical_today_iso
    from helpers import _load_rd, _save_rd, _now_et

    rd = _load_rd()
    today = logical_today_iso()
    now = _now_et()
    due = []
    cards = rd.get("cards", [])
    dirty = _nd.assign_auto_deadlines(cards, today, now)
    # Back-schedule node deadlines for EVERY hq card with a plan (not just today's),
    # so the breakdown graph shows deadlines whenever the card is opened.
    for c in cards:
        if _nudge.decomposable(c) and (c.get("nudge") or {}).get("graph", {}).get("nodes"):
            dirty |= _nd.compute_deadlines(c)
    for c in cards:
        n = c.get("nudge") or {}
        if not _nudge._eligible(c, today) or n.get("stage") == "resolved":
            continue
        if not n.get("graph", {}).get("nodes"):
            continue
        anchor = _nd.active_anchor(c)
        if anchor is not None:
            dirty |= _arm_nudge(c, anchor)
        kind = _due_kind(c, now)
        if kind:
            due.append((c["id"], kind))
    if dirty:
        _save_rd(rd)
    return due


async def _fire_nudge(card_id: str, kind: str = "nudge") -> bool:
    """Generate + deliver one nudge (or stall re-peel). Reloads rd around the
    LLM call so a concurrent PATCH /api/rd isn't clobbered."""
    import nudge as _nudge
    import nudge_deadlines as _nd
    from datetime import timedelta
    from scheduler import logical_today_iso
    from helpers import _load_rd, _save_rd, _find_card, _now_et

    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card or not _nudge._eligible(card, logical_today_iso()):
        return False
    n = _nudge.ensure_nudge(card)

    graph_update = active = peeled_label = None
    await push_to_monitor({"thinking": True})
    try:
        if kind == "stall" and n["graph"]["nodes"]:
            result = await asyncio.to_thread(_nllm.peel_sync, card)
            peeled_label = (result.get("sub_label") or "").strip()
            text = (result.get("nudge_text") or "").strip()
            if not peeled_label or not text:
                return False
        elif not n["graph"]["nodes"]:
            result = await asyncio.to_thread(_nllm.decompose_sync, card)
            graph_update = {"nodes": result["nodes"], "edges": result["edges"]}
            active = result["active_node"]
            text = result.get("nudge_text", "").strip()
            if not text:
                text = await asyncio.to_thread(_nllm.nudge_text_sync, card)
        else:
            text = await asyncio.to_thread(_nllm.nudge_text_sync, card)
    finally:
        await push_to_monitor({"thinking": False})

    # Re-load: rd.json may have changed during the LLM call.
    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card or not _nudge._eligible(card, logical_today_iso()):
        return False
    n = _nudge.ensure_nudge(card)
    if n["awaiting_reply"] != (kind == "stall"):
        return False  # state moved under us (reply landed / another fire) — drop
    if graph_update is not None:
        n["graph"] = graph_update
        n["active_node"] = active
    if peeled_label is not None:
        _nllm.apply_peel(card, peeled_label, result.get("est_min", 5))
    _nd.compute_deadlines(card)
    now = _now_et()
    n["stage"] = "awaiting"
    n["awaiting_reply"] = True
    n["last_nudge_at"] = _nudge._fmt_et(now)
    n["last_nudge_text"] = text
    n["window_deadline"] = _nudge._fmt_et(now + timedelta(minutes=_nudge.window_for(card)))
    n["next_nudge_at"] = None
    _save_rd(rd)

    append_monitor_comment(text)
    await push_to_monitor({"comment": text})
    return True


def _scan_missing_graphs() -> list[str]:
    """Actionable hq cards without a breakdown — everything in hq gets a plan."""
    import nudge as _nudge
    from helpers import _load_rd
    out = []
    for c in _load_rd().get("cards", []):
        if not _nudge.decomposable(c):
            continue
        n = c.get("nudge") or {}
        if (n.get("graph") or {}).get("nodes"):
            continue
        if c["id"] in _nudges_inflight or time.monotonic() < _nudge_retry_after.get(c["id"], 0):
            continue
        out.append(c["id"])
    return out


async def _build_graph(card_id: str) -> bool:
    """Silent decompose (no nudge sent) for an hq card missing its plan."""
    import nudge as _nudge
    import nudge_deadlines as _nd
    from helpers import _load_rd, _save_rd, _find_card
    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card or not _nudge.decomposable(card):
        return False
    result = await asyncio.to_thread(_nllm.decompose_sync, card)
    # Re-load: rd.json may have changed during the LLM call.
    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card or not _nudge.decomposable(card):
        return False
    n = _nudge.ensure_nudge(card)
    if n["graph"]["nodes"]:
        return False  # raced with a fire that already decomposed
    n["graph"] = {"nodes": result["nodes"], "edges": result["edges"]}
    n["active_node"] = result["active_node"]
    _nd.compute_deadlines(card)          # appends the event block (+ its deadline)
    g = n["graph"]
    if n["active_node"] not in {nd["id"] for nd in g["nodes"]}:
        n["active_node"] = _nudge._first_open(g["nodes"], g["edges"])
    _save_rd(rd)
    return True


def _scan_triage() -> list[str]:
    """Cards flagged for re-triage that still have a plan to re-evaluate."""
    import nudge as _nudge
    from helpers import _load_rd
    out = []
    for c in _load_rd().get("cards", []):
        n = c.get("nudge") or {}
        if not n.get("triage_pending"):
            continue
        if c["id"] in _nudges_inflight or time.monotonic() < _nudge_retry_after.get(c["id"], 0):
            continue
        if _nudge.decomposable(c) and n.get("graph", {}).get("nodes"):
            out.append(c["id"])
        else:
            n["triage_pending"] = False  # nothing to triage; clear it
    return out


async def _run_triage(card_id: str) -> bool:
    """Re-evaluate a card's plan against its updated details; rebuild if warranted."""
    import nudge as _nudge
    import nudge_deadlines as _nd
    from helpers import _load_rd, _save_rd, _find_card
    rd = _load_rd()
    card = _find_card(rd, card_id)
    if not card or not (card.get("nudge") or {}).get("graph", {}).get("nodes"):
        return False
    result = await asyncio.to_thread(_nllm.triage_sync, card)
    rd = _load_rd()  # reload around the LLM call
    card = _find_card(rd, card_id)
    if not card:
        return False
    n = _nudge.ensure_nudge(card)
    n["triage_pending"] = False
    changed = False
    if result.get("needs_update") and result.get("nodes"):
        n["graph"] = {"nodes": result["nodes"], "edges": result["edges"]}
        n["active_node"] = result["active_node"]
        _nd.compute_deadlines(card)
        changed = True
    _save_rd(rd)
    return changed


async def _nudge_tick() -> dict:
    fired, built, triaged = [], [], []
    # Triage pass: cards whose details changed re-check whether the plan should follow.
    for card_id in await asyncio.to_thread(_scan_triage):
        _nudges_inflight.add(card_id)
        try:
            if await _run_triage(card_id):
                triaged.append(card_id)
                _nudge_retry_after.pop(card_id, None)
        except Exception as e:
            print(f"[nudge] error triaging {card_id}: {e}")
            _nudge_retry_after[card_id] = time.monotonic() + _NUDGE_FAIL_BACKOFF_SEC
        finally:
            _nudges_inflight.discard(card_id)
    # Plan pass: every actionable hq card gets a graph + per-node deadlines,
    # so the fire pass below can read the active node's deadline to time the nudge.
    # Scans do file I/O + deadline recompute across all cards — offload off the
    # event loop so the 30s tick never freezes request/SSE handling.
    for card_id in await asyncio.to_thread(_scan_missing_graphs):
        _nudges_inflight.add(card_id)
        try:
            if await _build_graph(card_id):
                built.append(card_id)
                _nudge_retry_after.pop(card_id, None)
        except Exception as e:
            print(f"[nudge] error building graph for {card_id}: {e}")
            _nudge_retry_after[card_id] = time.monotonic() + _NUDGE_FAIL_BACKOFF_SEC
        finally:
            _nudges_inflight.discard(card_id)
    # Fire pass: nudge cards whose active-node start time has arrived.
    for card_id, kind in await asyncio.to_thread(_scan_due_nudges):
        _nudges_inflight.add(card_id)
        try:
            if await _fire_nudge(card_id, kind):
                fired.append(card_id)
                _nudge_retry_after.pop(card_id, None)
        except Exception as e:
            print(f"[nudge] error firing {card_id} ({kind}): {e}")
            _nudge_retry_after[card_id] = time.monotonic() + _NUDGE_FAIL_BACKOFF_SEC
        finally:
            _nudges_inflight.discard(card_id)
    return {"ok": True, "fired": fired, "built": built, "triaged": triaged}


async def _run_nudge_loop() -> None:
    from nudge import NUDGE_POLL_SEC
    while True:
        await asyncio.sleep(NUDGE_POLL_SEC)
        try:
            await _nudge_tick()
        except Exception as e:
            print(f"[nudge] tick error: {e}")
