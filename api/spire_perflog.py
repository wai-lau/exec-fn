"""/spire SLOW LOGS (owner, 2026-10-12: "make it so that each session takes slowlogs and sends them back to the server every
3 min of play - put them somewhere tmp so they don't clog up the machine"): a session's frame-time and audio summary
(web/aspira-perflog.js), one small JSON file each, in data/spire-perflog/ (kept across deploys) - capped at MAX_FILES (the oldest dropped). Read back by the owner (GET /api/spire/perflog).
"""
import json
import os
import secrets
import time
from pathlib import Path

from helpers import DATA_DIR  # noqa: E402

# in the DATA folder, not /tmp (owner, 2026-10-12: "stop wiping old slowlogs" - every redeploy cleared /tmp); still capped
LOG_DIR = Path(os.environ.get("SPIRE_PERFLOG_DIR", str(DATA_DIR / "spire-perflog")))
MAX_FILES, MAX_BYTES = 400, 16_000


def save(entry: dict, ua: str) -> bool:
    """Write one summary; False when it is not a small JSON object. Never raises on disk trouble."""
    if not isinstance(entry, dict):
        return False
    entry = {**entry, "at": int(time.time()), "ua": (ua or "")[:300]}
    text = json.dumps(entry, separators=(",", ":"))
    if len(text) > MAX_BYTES:
        return False
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        (LOG_DIR / f"{time.time_ns()}-{secrets.token_hex(3)}.json").write_text(text)
        files = sorted(LOG_DIR.glob("*.json"))
        for old in files[: max(0, len(files) - MAX_FILES)]:
            old.unlink(missing_ok=True)
    except OSError:
        return False
    return True


def recent(n: int = 50) -> list[dict]:
    """The newest n summaries, newest first; unreadable files skipped."""
    out = []
    for f in sorted(LOG_DIR.glob("*.json"), reverse=True)[:n] if LOG_DIR.is_dir() else []:
        try:
            out.append(json.loads(f.read_text()))
        except (OSError, ValueError):
            continue
    return out
