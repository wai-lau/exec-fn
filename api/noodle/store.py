"""Noodle's persistence: one JSON file per poll under config.DATA_DIR/polls.

Every read-modify-write holds _LOCK around the whole cycle and every write is
an atomic tmp+rename, so a crash mid-write leaves the old file intact. The
slug is validated to its generated shape BEFORE it becomes a path component,
so no request can name a file outside the polls directory.
"""
import json
import os
import re
import secrets
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from noodle import config

_LOCK = threading.RLock()
_SLUG_RE = re.compile(r"[A-Za-z0-9_-]{%d}" % config.SLUG_LEN)


def valid_slug(slug: str) -> bool:
    return isinstance(slug, str) and bool(_SLUG_RE.fullmatch(slug))


def polls_dir() -> Path:
    d = config.DATA_DIR / "polls"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(slug: str) -> Path:
    if not valid_slug(slug):
        raise KeyError(slug)
    return polls_dir() / f"{slug}.json"


def _write(path: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def load(slug: str) -> dict:
    """The poll, or KeyError for a malformed or unknown slug."""
    path = _path(slug)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise KeyError(slug) from None


@contextmanager
def edit(slug: str):
    """Load -> yield -> save, all under the lock. Raising inside the block
    skips the save, so a rejected vote never touches the file."""
    with _LOCK:
        poll = load(slug)
        yield poll
        _write(_path(slug), poll)


def create(title: str, start: str, end: str, now_iso: str) -> dict:
    with _LOCK:
        while True:
            slug = secrets.token_urlsafe(config.SLUG_BYTES)
            if valid_slug(slug) and not _path(slug).exists():
                break
        poll = {
            "slug": slug, "title": title, "start": start, "end": end,
            "created_at": now_iso, "voters": {},
            "ask": {"total": 0, "by_voter": {}},
        }
        _write(_path(slug), poll)
        return poll


def all_polls() -> list[dict]:
    out = []
    for p in sorted(polls_dir().glob("*.json")):
        if valid_slug(p.stem):
            try:
                out.append(load(p.stem))
            except (KeyError, ValueError):
                continue
    return sorted(out, key=lambda p: p.get("created_at", ""), reverse=True)
