"""Pre-generated opening turns for /tarot -- the store half.

THE PROBLEM. The reader's FIRST turn is the one turn whose content depends on
nothing but the clock: no history, no Significator, no spread -- an image of the
room at this hour, a blank line, the first Phase 1 question. Generating it live
cost an opus round-trip AND a TTS synth before the querent had said a word, and
on the first reading of a day the synth is a COLD one (~4.6s of model load
against 0.36s loaded -- see CLAUDE.md). That is the "slow start" this replaces.

THE SHAPE. Ten openings per hour of the day are generated ahead of time WITH
their audio already rendered (openings_gen.py), and the page plays one at
random for the hour it was opened in. No LLM call, no synth, just a JSON read
and a .wav -- and because the clip is picked by the CLIENT's hour, a querent in
another timezone still gets their own hour's light.

This module is the store: where clips live, the index, and the pick. The pure
half (pick/validate/shortfall) takes the index as an argument so it is testable
without a filesystem -- same reason tts_routing.py and gamesave_store.py are
stdlib-only (tests/test_tarot_openings.py).
"""
import json
import random
import re
from pathlib import Path

from helpers import DATA_DIR

OPENINGS_DIR = DATA_DIR / "tarot_openings"
INDEX_PATH = OPENINGS_DIR / "index.json"

# How many alternatives each hour holds. Ten is enough that a reading rarely
# repeats an opening within a week of daily use at the same hour.
TARGET_PER_HOUR = 10

VOICE = "nicole"      # the reader's voice (kokoro) -- must match tarot-voice.js
BACKEND = "kokoro"

# `h<HH>-<8 hex>`: the hour is in the name so a directory listing is readable,
# and the shape is narrow enough that the route can serve it as a path
# component without a traversal check that a later edit could drop.
_CLIP_ID_RE = re.compile(r"^h([01]\d|2[0-3])-[0-9a-f]{8}$")


def clip_id_ok(clip_id: str) -> bool:
    return bool(_CLIP_ID_RE.match(clip_id or ""))


def hour_key(hour: int) -> str:
    """Normalize any hour to the two-digit index key. Out-of-range wraps rather
    than raising: the hour arrives from a client clock, and a wrapped hour is a
    better answer than a 500."""
    return f"{int(hour) % 24:02d}"


def empty_index() -> dict:
    return {"version": 1, "voice": VOICE, "hours": {hour_key(h): [] for h in range(24)}}


def pick_clip(index: dict, hour: int, rng=random) -> dict | None:
    """One random clip for that hour, or None when the hour has none yet (the
    caller then falls back to generating the opening live)."""
    clips = (index.get("hours") or {}).get(hour_key(hour)) or []
    return rng.choice(clips) if clips else None


def shortfall(index: dict, target: int = TARGET_PER_HOUR) -> list[tuple[str, int]]:
    """[(hour_key, how many more it needs)] for every hour under target."""
    hours = index.get("hours") or {}
    out = []
    for h in range(24):
        k = hour_key(h)
        need = target - len(hours.get(k) or [])
        if need > 0:
            out.append((k, need))
    return out


def total_clips(index: dict) -> int:
    return sum(len(v or []) for v in (index.get("hours") or {}).values())


def clip_file(clip_id: str) -> Path:
    return OPENINGS_DIR / f"{clip_id}.wav"


_cache: tuple[float, dict] | None = None


def load_index() -> dict:
    """The index, memoized on mtime (the page reads it on every /tarot open;
    the generator is the only writer)."""
    global _cache
    try:
        mtime = INDEX_PATH.stat().st_mtime
    except OSError:
        return empty_index()
    if _cache and _cache[0] == mtime:
        return _cache[1]
    try:
        index = json.loads(INDEX_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return empty_index()
    if not isinstance(index, dict) or not isinstance(index.get("hours"), dict):
        return empty_index()
    _cache = (mtime, index)
    return index


def save_index(index: dict) -> None:
    OPENINGS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INDEX_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(index, indent=2))
    tmp.replace(INDEX_PATH)


def add_clip(index: dict, hour: int, clip: dict) -> dict:
    """Append one generated clip to its hour and persist. The generator is a
    single sequential writer, so this needs no lock -- but it re-reads nothing
    either, so callers must hold the index they loaded."""
    index.setdefault("hours", {}).setdefault(hour_key(hour), []).append(clip)
    save_index(index)
    return index


def drop_oldest(index: dict, hour: int, n: int) -> list[str]:
    """Remove the n oldest clips of an hour from the index (rotation). Returns
    the ids dropped so the caller can unlink their audio."""
    k = hour_key(hour)
    clips = sorted((index.get("hours") or {}).get(k) or [], key=lambda c: c.get("created") or "")
    dropped = [c["id"] for c in clips[:n]]
    index["hours"][k] = [c for c in index["hours"][k] if c["id"] not in dropped]
    return dropped
