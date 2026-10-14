"""THE ASCENDANTS -- /spire's shared board of players who beat the game.

Owner, 2026-10-11: "when a player beats a game let them save their initials in
the Ascendants" -- one SHARED board, on the HONOUR SYSTEM. The game runs
entirely in the browser, so a win cannot be proven: anyone past Turnstile could
post one. The guard is only shape (three capital letters, a sane lives count, a
real trio of towers) plus a per-IP rate limit in routes_aspira.py.

Stdlib only (like gamesave_store.py), so the dev venv can unit-test it without
the app graph.

NEVER LOSE AN ENTRY (owner, 2026-10-11, the first winner: "make sure we never
lose it"). Two files in DATA_DIR:
- `spire_ascendants.jsonl`, the JOURNAL: every accepted win appended as one line
  and fsynced BEFORE anything else changes. Append-only; nothing rewrites it.
- `spire_ascendants.json`, the board (newest first), rewritten atomically
  (temp + fsync + rename) from the journal's order after each append.
Nothing is ever trimmed. If the board is missing or does not parse, it is
REBUILT from the journal - never treated as empty and overwritten (the old
code would have replaced a corrupt board with the one new win). A journal
missing beside an existing board (the board predates it) is seeded from the
board first.
"""
import json
import os
import re
import threading
import time
from pathlib import Path

FILE_NAME = "spire_ascendants.json"
JOURNAL_NAME = "spire_ascendants.jsonl"
# THE OWNER'S OWN GAMES are hidden from everyone else (owner, 2026-10-12: "don't show results added by owner"): a post from
# the full session carries owner: true; games from before that flag are named in OWNER_MARKS ([ts, initials] pairs, set
# once by `python spire_board.py mark-owner <keep...>`) - the journal stays append-only, nothing in it is rewritten
OWNER_MARKS = "spire_ascendants_owner.json"
# games taken off the board for EVERYONE, by (ts, initials) (owner, 2026-10-13: "remove wai ugh and boo from the board"; written by
# `python spire_board.py hide <initials...>`) - like OWNER_MARKS, the journal stays append-only and keeps them
HIDDEN = "spire_ascendants_hidden.json"
SHOW_MAX = 500  # the most the GET returns (display only - the store keeps every entry)
MAX_LIVES = 100000
MIN_WAVE, WIN_WAVE, MAX_WAVE = 11, 120, 1000  # (a win is wave 120 since the 12-wave boss cycle, 2026-10-12)
TOWER_KINDS = ("arc", "frz", "sol", "acd")
_INITIALS = re.compile(r"[A-Z]{3}")
_LOCK = threading.Lock()


def _int(v, lo, hi) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def clean_entry(body: dict) -> dict | None:
    """The stored shape of a posted game, or None if it is not a plausible one.

    A WIN (won: true) needs lives left; any game that got PAST wave 10 may post too
    (owner, 2026-10-11: "for any wave after 10, allow user to post on the leaderboard"),
    its lives 0 when it ended in a breach."""
    initials = str(body.get("initials", "")).strip().upper()
    if not _INITIALS.fullmatch(initials):
        return None
    won = body.get("won", True) is True  # (a post with no `won` is the old client: a win)
    lives, wave = body.get("lives"), body.get("wave", WIN_WAVE if won else None)
    if not _int(lives, 1 if won else 0, MAX_LIVES) or not _int(wave, MIN_WAVE, MAX_WAVE):
        return None
    team = body.get("team")
    if not isinstance(team, list) or not 1 <= len(team) <= 5 or any(k not in TOWER_KINDS for k in team):
        return None
    return {"initials": initials, "lives": lives, "team": sorted(team, key=TOWER_KINDS.index), "ts": int(time.time()), "won": won, "wave": wave}


def ranked(rows: list) -> list:
    """TOP PLAYERS order: the Ascendants (wins; rows from before `won` existed are wins) by lives left, then everyone
    else by the wave they reached, then lives; ties to the earlier."""
    def key(r):
        won = r.get("won", True)
        return (0 if won else 1, -int(r.get("lives", 0)) if won else -int(r.get("wave", 0)), -int(r.get("lives", 0)), int(r.get("ts", 0)))
    return sorted(rows, key=key)


def _read_board(path: Path) -> list | None:
    """The board file's rows, or None when it is missing or unreadable."""
    try:
        rows = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return rows if isinstance(rows, list) else None


def _read_journal(path: Path) -> list:
    """Every journalled entry, oldest first; a torn last line (a crash mid-append) is skipped, never fatal."""
    out = []
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return out
    for line in lines:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def _append(path: Path, rows: list) -> None:
    # a torn last line (a crash mid-write) must not swallow the next entry: start on a fresh line
    torn = False
    try:
        with open(path, "rb") as f:
            f.seek(-1, os.SEEK_END)
            torn = f.read(1) != b"\n"
    except OSError:
        pass  # missing or empty: nothing to close off
    with open(path, "a") as f:
        if torn:
            f.write("\n")
        for row in rows:
            f.write(json.dumps(row) + "\n")
        f.flush()
        os.fsync(f.fileno())


def _write_board(path: Path, rows: list) -> None:
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as f:
        f.write(json.dumps(rows))
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)


def _seed_journal(data_dir: Path) -> None:
    """A board with no journal beside it (written before the journal existed): journal its rows, oldest first."""
    journal = data_dir / JOURNAL_NAME
    if journal.exists():
        return
    rows = _read_board(data_dir / FILE_NAME) or []
    _append(journal, list(reversed(rows)))


def _owner_marks(data_dir: Path) -> set:
    try:
        return {(int(ts), str(ini)) for ts, ini in json.loads((data_dir / OWNER_MARKS).read_text())}
    except (OSError, ValueError, TypeError):
        return set()


def _hidden(data_dir: Path) -> set:
    try:
        return {(int(ts), str(ini)) for ts, ini in json.loads((data_dir / HIDDEN).read_text())}
    except (OSError, ValueError, TypeError):
        return set()


# ...UNTIL 2026-10-14 (owner: "show owner on leaderboard, but only the ones starting from today"): the owner's games from
# midnight ET that day on show to everyone; the older ones (OWNER_MARKS and the flagged posts before it) stay hidden
OWNER_SHOWN_FROM = 1791950400  # 2026-10-14 00:00 America/New_York


def visible(data_dir: Path, rows: list, owner: bool) -> list:
    """`rows` as this caller may see them: never a HIDDEN game; everything else for the owner; everyone else without the
    owner's own games from before OWNER_SHOWN_FROM."""
    gone = _hidden(data_dir)
    rows = [r for r in rows if (r.get("ts"), r.get("initials")) not in gone]
    if owner:
        return rows
    marks = _owner_marks(data_dir)
    recent = lambda r: int(r.get("ts") or 0) >= OWNER_SHOWN_FROM  # noqa: E731
    return [r for r in rows if recent(r) or (not r.get("owner") and (r.get("ts"), r.get("initials")) not in marks)]


def hide(data_dir: Path, initials: set) -> int:
    """Take every game SO FAR under these initials off the board for everyone - each by (ts, initials) in HIDDEN, so later games
    under the same initials still show (owner, 2026-10-13); the journal untouched; returns how many."""
    rows = [r for r in load(data_dir) if r.get("initials") in initials and isinstance(r.get("ts"), int)]
    marks = sorted(_hidden(data_dir) | {(r["ts"], r["initials"]) for r in rows})
    _write_board(data_dir / HIDDEN, [list(m) for m in marks])
    return len(rows)


def mark_owner(data_dir: Path, keep: set) -> int:
    """Name every game on the board as the owner's, except those whose initials are in `keep`; returns how many."""
    rows = [r for r in load(data_dir) if r.get("initials") not in keep and isinstance(r.get("ts"), int)]
    marks = sorted(_owner_marks(data_dir) | {(r["ts"], r["initials"]) for r in rows})
    _write_board(data_dir / OWNER_MARKS, [list(m) for m in marks])
    return len(rows)


def load(data_dir: Path) -> list:
    """The whole board, newest first. A missing / corrupt board is rebuilt from the journal."""
    rows = _read_board(data_dir / FILE_NAME)
    if rows is not None:
        return rows
    return list(reversed(_read_journal(data_dir / JOURNAL_NAME)))


def add(data_dir: Path, entry: dict) -> list:
    """Journal `entry` (fsynced first), then rewrite the board as journal + old board merged; returns it, newest first."""
    with _LOCK:
        _seed_journal(data_dir)
        journal = data_dir / JOURNAL_NAME
        board = data_dir / FILE_NAME
        before = _read_board(board) or []
        _append(journal, [entry])
        rows = _merge(_read_journal(journal) + [entry], before)  # (the entry itself too: never lost to a bad journal read)
        _write_board(board, rows)
        return rows


def _merge(journal: list, board: list) -> list:
    """Every row in EITHER file, once each, newest first - so neither file alone can drop an entry."""
    seen, out = set(), []
    for row in list(reversed(journal)) + board:
        key = json.dumps(row, sort_keys=True)
        if key not in seen:
            seen.add(key)
            out.append(row)
    return sorted(out, key=lambda r: -int(r.get("ts", 0)) if isinstance(r.get("ts"), int) else 0)


if __name__ == "__main__":  # docker compose exec api python spire_board.py mark-owner JUU SMD
    import sys

    if len(sys.argv) >= 2 and sys.argv[1] == "hide":  # docker compose exec api python spire_board.py hide WAI UGH BOO
        n = hide(Path(os.environ.get("DATA_DIR", "/app/data")), set(a.upper() for a in sys.argv[2:]))
        print(f"hid {n} games")
    elif len(sys.argv) >= 2 and sys.argv[1] == "mark-owner":
        n = mark_owner(Path(os.environ.get("DATA_DIR", "/app/data")), set(a.upper() for a in sys.argv[2:]))
        print(f"marked {n} games as the owner's")
    else:
        print("usage: python spire_board.py mark-owner <initials to keep...> | hide <initials...>")
