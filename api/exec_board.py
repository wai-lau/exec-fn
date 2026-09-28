"""The board as Exec sees it each turn: which cards, and how each one reads.

In scope (Wai's call, 2026-09-28):
  - EVERY card in rd and hq -- the ideas pool used to be cut at the top 15, so
    Exec could not act on a backlog card it was never shown;
  - archives + exile cards MOVED there in the last 7 days, so "what did I get
    done this week" and "bring back the one I dropped" work, without the whole
    history (hundreds of cards) riding in every turn.

Cards carry no move timestamp, so "moved in the last 7 days" is read from the
activity logs: today's activity_log.json plus the dated archives the 4:30 run
rotates out (activity_log_YYYYMMDD.json). A move entry names the card by id;
the exile tool's entries had no id until 2026-09-28, so those fall back to the
title.
"""

import json
from datetime import datetime, timedelta, timezone

from helpers import DATA_DIR

RECENT_DAYS = 7
_DONE_COLS = ("archives", "exile")


def _log_files(now: datetime) -> list:
    """Today's log plus every rotated one young enough to hold a move in window.
    A file is named for the day it was ROTATED, holding the day before -- one
    extra day of slack covers that."""
    oldest = (now - timedelta(days=RECENT_DAYS + 1)).strftime("%Y%m%d")
    files = [p for p in DATA_DIR.glob("activity_log_[0-9]*.json")
             if len(p.stem) == len("activity_log_20260101") and p.stem[-8:] >= oldest]
    return sorted(files) + [DATA_DIR / "activity_log.json"]


def recent_moves(now: datetime | None = None) -> dict:
    """{id-or-title: (to_col, ts)} for the LATEST move of each card into
    archives/exile within RECENT_DAYS. Unreadable logs are skipped: a missing
    day costs a few cards of context, never the turn."""
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=RECENT_DAYS)).isoformat()
    moves = {}
    for p in _log_files(now):
        try:
            entries = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        for e in entries if isinstance(entries, list) else []:
            if e.get("action") != "moved" or e.get("to_col") not in _DONE_COLS:
                continue
            ts = e.get("ts") or ""
            if ts < cutoff:
                continue
            key = e.get("id") or e.get("title")
            if key and ts >= moves.get(key, ("", ""))[1]:
                moves[key] = (e["to_col"], ts)
    return moves


def _line(c: dict) -> str:
    return (f"- id:{c['id']} [{c.get('size', 'idea')}] {c['title']} "
            f"({c.get('category', '')}): {c.get('notes', '')}")


def _recent(cards: list, moves: dict, col: str) -> list:
    """Cards now in `col` whose latest logged move there is in window. Still in
    the column is required: a card archived Monday and revived Tuesday is not
    'done this week'."""
    out = []
    for c in cards:
        if c.get("column") != col:
            continue
        hit = moves.get(c["id"]) or moves.get(c.get("title"))
        if hit and hit[0] == col:
            out.append((hit[1], c))
    return [c for _, c in sorted(out, key=lambda t: t[0], reverse=True)]


def board_sections(cards: list) -> str:
    by_order = lambda c: c.get("order", 0)  # noqa: E731
    selected = sorted([c for c in cards if c.get("column") == "hq"], key=by_order)
    ideas = sorted([c for c in cards if c.get("column") == "rd"], key=by_order)
    moves = recent_moves()
    done = _recent(cards, moves, "archives")
    dropped = _recent(cards, moves, "exile")

    def block(rows):
        return "\n".join(_line(c) for c in rows) or "None."

    return (
        f"CURRENTLY SELECTED TASKS:\n{block(selected)}\n\n"
        f"IDEAS POOL (all):\n{block(ideas)}\n\n"
        f"ARCHIVED IN THE LAST {RECENT_DAYS} DAYS (done, newest first):\n{block(done)}\n\n"
        f"EXILED IN THE LAST {RECENT_DAYS} DAYS (dropped, newest first):\n{block(dropped)}"
    )
