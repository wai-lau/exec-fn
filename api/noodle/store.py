"""noodle's persistence: one ENCRYPTED file per poll under config.DATA_DIR/polls.

The link is the key. A poll's slug (128 random bits, and already the only
access control) is run through HKDF twice, under two labels: one output names
the file, the other is its AES-256-GCM key. Neither is ever written down, and
the filename gives back neither the slug nor the key -- so a copy of this
directory (a backup, a leaked disk, root browsing it) reads as noise, and the
server can open a poll only while a request carrying its link is in flight.
Everything above this module still sees a plain dict.

What it does NOT stop: a compromised RUNNING server sees each slug as it
arrives. This is encryption at rest, not end-to-end (ARCHITECTURE.md section 21d).

Every read-modify-write holds _LOCK around the whole cycle and every write is
an atomic tmp+rename, so a crash mid-write leaves the old file intact. The
slug is validated to its generated shape before anything is derived from it.
"""
import base64
import json
import os
import re
import secrets
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from noodle import config

_LOCK = threading.RLock()
_SLUG_RE = re.compile(r"[A-Za-z0-9_-]{%d}" % config.SLUG_LEN)
_ID_RE = re.compile(r"[0-9a-f]{64}")
# HKDF labels. web/noodle-admin.js derives the FILE id the same way (to put a
# title from the owner's own browser beside a listed id) -- change both or
# neither. Changing either orphans every stored poll.
_INFO_FILE = b"noodle poll file v1"
_INFO_KEY = b"noodle poll key v1"
_SALT = bytes(32)   # what HKDF uses for "no salt"; spelled out so the JS can match it
_FORMAT = 1


def valid_slug(slug: str) -> bool:
    return isinstance(slug, str) and bool(_SLUG_RE.fullmatch(slug))


def valid_id(poll_id: str) -> bool:
    return isinstance(poll_id, str) and bool(_ID_RE.fullmatch(poll_id))


def polls_dir() -> Path:
    d = config.DATA_DIR / "polls"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _derive(slug: str, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=_SALT, info=info).derive(slug.encode())


def poll_id(slug: str) -> str:
    """The poll's file name: derived from the slug, and no way back to it."""
    if not valid_slug(slug):
        raise KeyError(slug)
    return _derive(slug, _INFO_FILE).hex()


def _path(slug: str) -> Path:
    return polls_dir() / f"{poll_id(slug)}.json"


def _legacy_path(slug: str) -> Path:
    # a poll written before encryption: plain JSON named by its slug
    return polls_dir() / f"{slug}.json"


def _seal(slug: str, data: dict) -> dict:
    nonce = secrets.token_bytes(12)
    pt = json.dumps(data, ensure_ascii=False).encode()
    # the file id is the associated data: a blob moved under another poll's
    # name fails to open rather than serving one poll's votes as another's
    ct = AESGCM(_derive(slug, _INFO_KEY)).encrypt(nonce, pt, poll_id(slug).encode())
    return {"v": _FORMAT, "nonce": base64.b64encode(nonce).decode(),
            "ct": base64.b64encode(ct).decode()}


def _open(slug: str, blob: dict) -> dict:
    if blob.get("v") != _FORMAT:
        raise ValueError(f"unknown poll file format {blob.get('v')!r}")
    try:
        pt = AESGCM(_derive(slug, _INFO_KEY)).decrypt(
            base64.b64decode(blob["nonce"]), base64.b64decode(blob["ct"]), poll_id(slug).encode())
    except InvalidTag:
        raise ValueError("poll file does not decrypt -- tampered with, or not this poll's") from None
    return json.loads(pt)


def _write(slug: str, data: dict) -> None:
    path = _path(slug)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(_seal(slug, data), f)
            f.flush()
            os.fsync(f.fileno())   # on disk before the rename makes it the poll
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _migrate(slug: str) -> None:
    """Encrypt a pre-encryption poll in place: write the sealed file, then
    remove the plain one. Idempotent; runs on the poll's first touch."""
    with _LOCK:
        legacy = _legacy_path(slug)
        if not legacy.exists():
            return
        with open(legacy, encoding="utf-8") as f:
            data = json.load(f)
        if not _path(slug).exists():
            _write(slug, data)
        legacy.unlink()


def migrate_all() -> int:
    """Encrypt every pre-encryption poll (their slugs are their file names, so
    the server can still do it once). Returns how many it converted."""
    n = 0
    for p in sorted(polls_dir().glob("*.json")):
        if valid_slug(p.stem):
            _migrate(p.stem)
            n += 1
    return n


def load(slug: str) -> dict:
    """The poll, or KeyError for a malformed or unknown slug."""
    path = _path(slug)
    _migrate(slug)
    try:
        with open(path, encoding="utf-8") as f:
            return _open(slug, json.load(f))
    except FileNotFoundError:
        raise KeyError(slug) from None


@contextmanager
def edit(slug: str):
    """Load -> yield -> save, all under the lock. Raising inside the block
    skips the save, so a rejected vote never touches the file."""
    with _LOCK:
        poll = load(slug)
        yield poll
        _write(slug, poll)


def exists(slug: str) -> bool:
    return valid_slug(slug) and (_path(slug).exists() or _legacy_path(slug).exists())


def create(title: str, now_iso: str) -> dict:
    """A new poll on a fresh slug (see create_at)."""
    with _LOCK:
        while True:
            slug = secrets.token_urlsafe(config.SLUG_BYTES)
            if valid_slug(slug) and not exists(slug):
                return create_at(slug, title, now_iso)


def create_at(slug: str, title: str, now_iso: str, e2e: bool = False) -> dict:
    """A new poll has a title and nothing else. It has no date range (the
    calendar is endless; the host's picks decide what is on offer), and it
    starts unsplit -- one slot a day -- until the host splits it. On a slug
    that is already a poll, that poll is returned untouched (two first
    commits racing each other create it once). An END-TO-END poll (e2e.py)
    has no title here at all: its settings arrive sealed, as `head`."""
    with _LOCK:
        if exists(slug):
            return load(slug)
        if e2e:
            poll = {"slug": slug, "e2e": 1, "created_at": now_iso, "head": None, "voters": {}}
        else:
            poll = {
                "slug": slug, "title": title, "halves": False,
                "created_at": now_iso, "voters": {},
            }
        _write(slug, poll)
        return poll


def delete_id(poll_id_: str) -> bool:
    """Remove a poll for good by its FILE id (the owner's call -- the owner
    list knows ids, not links). False if there was none."""
    if not valid_id(poll_id_):
        raise KeyError(poll_id_)
    with _LOCK:
        try:
            (polls_dir() / f"{poll_id_}.json").unlink()
        except FileNotFoundError:
            return False
        return True


def delete(slug: str) -> bool:
    """Remove a poll for good by its link. False if there was none."""
    with _LOCK:
        _migrate(slug)
        return delete_id(poll_id(slug))


def all_polls() -> list[dict]:
    """Every stored poll as {id, modified}, newest first -- all the server can
    say without the links. Titles, voters and links stay sealed; the owner's
    browser fills in the ones it has opened (web/noodle-admin.js)."""
    migrate_all()
    out = []
    for p in polls_dir().glob("*.json"):
        if valid_id(p.stem):
            try:
                out.append({"id": p.stem, "modified": int(p.stat().st_mtime)})
            except FileNotFoundError:
                continue   # deleted between the glob and the stat
    return sorted(out, key=lambda p: p["modified"], reverse=True)
