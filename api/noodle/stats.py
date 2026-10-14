"""How many polls were created each day, for the owner's chart on /noodle.

The polls themselves cannot say: each is sealed under its own link (store.py),
so the server cannot read a `created_at` without that link, and a file's mtime
is its last write, not its birth. So creation is COUNTED as it happens, in
DATA_DIR/created.json = {"YYYY-MM-DD": n} -- a day and a number, no id, no
slug, nothing the access log does not already show. Requests carrying the
test suite's rate-limit exemption are not counted (routes.py), or every
commit's smoke run would draw a bar.
"""
import json
import os
import tempfile
import threading
from datetime import date
from pathlib import Path

from noodle import config

_LOCK = threading.Lock()


def _path() -> Path:
    return config.DATA_DIR / "created.json"


def per_day() -> dict[str, int]:
    """{"YYYY-MM-DD": polls created that day}, only days with any."""
    try:
        with open(_path(), encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError):
        return {}
    return {d: n for d, n in data.items() if isinstance(n, int) and n > 0}


def record(day: date | None = None, n: int = 1) -> None:
    """One more poll created on `day` (the server's today by default)."""
    key = (day or date.today()).isoformat()
    with _LOCK:
        data = per_day()
        data[key] = data.get(key, 0) + n
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=config.DATA_DIR, prefix=".tmp-created-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(dict(sorted(data.items())), f)
            os.replace(tmp, _path())
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
