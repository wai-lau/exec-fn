"""A poll that does not exist yet.

"create poll" on the owner page stores NOTHING: it gets a fresh slug and a
token for it -- an HMAC of the slug under a server secret -- and opens the page
as a draft. The host's first commit (settings or vote) carries the token back,
and only then is the poll written. So an abandoned "create" leaves no poll
behind, and nobody can mint polls on a slug of their own choosing: without
the owner's token for that exact slug the server does not create anything.

The secret is NOODLE_SECRET if set, else 32 random bytes kept in
DATA_DIR/secret.key (0600), made on first use.
"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime

from noodle import config, store

UNTITLED = "untitled noodle"
_secret: bytes | None = None


def _key() -> bytes:
    global _secret
    if _secret is None:
        env = os.environ.get("NOODLE_SECRET")
        if env:
            _secret = env.encode()
        else:
            path = config.DATA_DIR / "secret.key"
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(secrets.token_bytes(32))
            _secret = path.read_bytes()
    return _secret


def token(slug: str) -> str:
    return hmac.new(_key(), slug.encode(), hashlib.sha256).hexdigest()[:32]


def valid(slug: str, tok) -> bool:
    return isinstance(tok, str) and store.valid_slug(slug) and hmac.compare_digest(tok, token(slug))


def new() -> dict:
    """A slug nobody holds yet, and its token. Nothing is stored."""
    while True:
        slug = secrets.token_urlsafe(config.SLUG_BYTES)
        if store.valid_slug(slug) and not store.exists(slug):
            return {"slug": slug, "token": token(slug)}


def ensure(slug: str, body: dict) -> None:
    """Before a commit: write the poll if it is still a draft and the body
    carries its token. A poll that exists is left alone; one without a valid
    token stays missing (and the commit 404s)."""
    if not store.exists(slug) and valid(slug, body.get("draft")):
        store.create_at(slug, UNTITLED, datetime.now().isoformat(timespec="seconds"))
