"""THE ASCENDANTS -- /spire's shared board of players who beat the game.

Owner, 2026-10-11: "when a player beats a game let them save their initials in
the Ascendants" -- one SHARED board, on the HONOUR SYSTEM. The game runs
entirely in the browser, so a win cannot be proven: anyone past Turnstile could
post one. The guard is only shape (three capital letters, a sane lives count, a
real trio of towers) plus a per-IP rate limit in routes_aspira.py.

Stdlib only (like gamesave_store.py), so the dev venv can unit-test it without
the app graph. One JSON file, `spire_ascendants.json` in DATA_DIR, written
atomically (temp + rename) under a lock; at most MAX_ENTRIES kept, newest first.
"""
import json
import re
import threading
import time
from pathlib import Path

FILE_NAME = "spire_ascendants.json"
MAX_ENTRIES = 500
MAX_LIVES = 100000
TOWER_KINDS = ("arc", "frz", "sol", "acd")
_INITIALS = re.compile(r"[A-Z]{3}")
_LOCK = threading.Lock()


def clean_entry(body: dict) -> dict | None:
    """The stored shape of a posted win, or None if it is not a plausible one."""
    initials = str(body.get("initials", "")).strip().upper()
    if not _INITIALS.fullmatch(initials):
        return None
    lives = body.get("lives")
    if not isinstance(lives, int) or isinstance(lives, bool) or not 0 < lives <= MAX_LIVES:
        return None
    team = body.get("team")
    if not isinstance(team, list) or not 1 <= len(team) <= 5 or any(k not in TOWER_KINDS for k in team):
        return None
    return {"initials": initials, "lives": lives, "team": sorted(team, key=TOWER_KINDS.index), "ts": int(time.time())}


def load(data_dir: Path) -> list:
    try:
        rows = json.loads((data_dir / FILE_NAME).read_text())
    except (OSError, ValueError):
        return []
    return rows if isinstance(rows, list) else []


def add(data_dir: Path, entry: dict) -> list:
    """Prepend `entry`, keep MAX_ENTRIES, write atomically; returns the board."""
    with _LOCK:
        rows = [entry] + load(data_dir)
        rows = rows[:MAX_ENTRIES]
        path = data_dir / FILE_NAME
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(rows))
        tmp.replace(path)
        return rows
